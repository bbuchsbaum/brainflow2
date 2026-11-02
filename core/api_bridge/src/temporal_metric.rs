//! Temporal metric maps (variance, mean over time) on a view-plane grid.
//!
//! The grid follows `ViewPlane` semantics: `origin_mm` is the outer corner of
//! pixel (0, 0), and `u_mm` / `v_mm` are the world step of one grid pixel, so
//! pixel (i, j) samples its centre `origin + (i + 0.5) u + (j + 0.5) v`, as the
//! GPU does. Voxels are chosen through the volume's inverse affine, so any
//! affine and any view work, and sampling is nearest-neighbour. A pixel outside
//! the volume is NaN, which reaches JavaScript as `null` through JSON
//! (`TemporalHeatmapService` restores it).

use crate::{get_affine_from_volume, BridgeError, BridgeResult, BridgeState, VolumeSendable};
use ndarray::{Array4, Axis};
use serde::{Deserialize, Serialize};
use tauri::{command, State};
use tracing::info;
use ts_rs::TS;

/// Refuses absurd requests; the UI asks for at most 512 per side.
const MAX_GRID_SIDE: u32 = 2048;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TemporalMetricResult {
    pub width: u32,
    pub height: u32,
    /// Row-major: pixel (i, j) is at `j * width + i`; NaN outside the volume.
    pub data: Vec<f32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TemporalMetric {
    Variance,
    Mean,
}

impl TemporalMetric {
    fn parse(name: &str) -> BridgeResult<Self> {
        match name {
            "variance" => Ok(Self::Variance),
            "mean" => Ok(Self::Mean),
            other => Err(BridgeError::Input {
                code: 2010,
                details: format!("Unknown metric '{other}'. Supported: variance, mean"),
            }),
        }
    }
}

/// A view-plane sampling grid; see the module docs for its semantics.
#[derive(Debug, Clone, Copy)]
struct PlaneGrid {
    origin_mm: [f32; 3],
    u_mm: [f32; 3],
    v_mm: [f32; 3],
    width: u32,
    height: u32,
}

impl PlaneGrid {
    fn validate(&self) -> BridgeResult<()> {
        let input_error = |details: String| BridgeError::Input {
            code: 2012,
            details,
        };
        if self.width == 0
            || self.height == 0
            || self.width > MAX_GRID_SIDE
            || self.height > MAX_GRID_SIDE
        {
            return Err(input_error(format!(
                "Grid {}x{} must be 1 to {MAX_GRID_SIDE} per side",
                self.width, self.height
            )));
        }
        let finite = |v: &[f32; 3]| v.iter().all(|c| c.is_finite());
        if !finite(&self.origin_mm) || !finite(&self.u_mm) || !finite(&self.v_mm) {
            return Err(input_error("Plane vectors must be finite".to_string()));
        }
        let u = nalgebra::Vector3::from(self.u_mm);
        let v = nalgebra::Vector3::from(self.v_mm);
        let cross = u.cross(&v);
        if cross.norm() == 0.0 {
            return Err(input_error("Plane vectors are degenerate".to_string()));
        }
        Ok(())
    }
}

/// One grid pixel that lies in the volume, and the voxel it samples.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PlaneSample {
    pixel: usize,
    voxel: [usize; 3],
}

/// The grid pixels inside the volume, each with its nearest voxel.
fn plane_samples(
    volume: &VolumeSendable,
    dims: [usize; 3],
    grid: &PlaneGrid,
) -> BridgeResult<Vec<PlaneSample>> {
    let world_to_voxel = get_affine_from_volume(volume)?
        .to_homogeneous()
        .cast::<f64>()
        .try_inverse()
        .ok_or_else(|| BridgeError::Internal {
            code: 5007,
            details: "The volume's affine cannot be inverted".to_string(),
        })?;
    let [ox, oy, oz] = grid.origin_mm.map(f64::from);
    let u = grid.u_mm.map(f64::from);
    let v = grid.v_mm.map(f64::from);
    let (width, height) = (grid.width as usize, grid.height as usize);
    let mut samples = Vec::with_capacity(width * height);
    for j in 0..height {
        let b = j as f64 + 0.5;
        for i in 0..width {
            let a = i as f64 + 0.5;
            let world = nalgebra::Vector4::new(
                ox + a * u[0] + b * v[0],
                oy + a * u[1] + b * v[1],
                oz + a * u[2] + b * v[2],
                1.0,
            );
            let voxel = world_to_voxel * world;
            // Voxel n covers [n - 0.5, n + 0.5): round() puts -0.5 outside and,
            // past the last voxel, reaches dims[axis].
            let index = [voxel.x.round(), voxel.y.round(), voxel.z.round()];
            let inside = (0..3).all(|axis| index[axis] >= 0.0 && index[axis] < dims[axis] as f64);
            if inside {
                samples.push(PlaneSample {
                    pixel: j * width + i,
                    voxel: index.map(|c| c as usize),
                });
            }
        }
    }
    Ok(samples)
}

/// The metric of each sampled voxel's series, in `pixels` row-major values.
///
/// Walks frame by frame, the storage order of column-major series, without
/// copying them. Variance is the population variance (Welford, in f64).
fn metric_over_series<T: Copy>(
    data: &Array4<T>,
    samples: &[PlaneSample],
    pixels: usize,
    metric: TemporalMetric,
    to_f64: impl Fn(T) -> f64,
) -> Vec<f32> {
    let mut means = vec![0.0f64; samples.len()];
    let mut m2 = vec![0.0f64; samples.len()];
    let frames = data.len_of(Axis(3));
    for (t, frame) in data.axis_iter(Axis(3)).enumerate() {
        let weight = 1.0 / (t + 1) as f64;
        for (index, sample) in samples.iter().enumerate() {
            let value = to_f64(frame[sample.voxel]);
            let delta = value - means[index];
            means[index] += delta * weight;
            if metric == TemporalMetric::Variance {
                m2[index] += delta * (value - means[index]);
            }
        }
    }
    let mut out = vec![f32::NAN; pixels];
    if frames == 0 {
        return out;
    }
    for (index, sample) in samples.iter().enumerate() {
        out[sample.pixel] = match metric {
            TemporalMetric::Mean => means[index] as f32,
            TemporalMetric::Variance => (m2[index] / frames as f64) as f32,
        };
    }
    out
}

/// The metric map of a 4D volume on a plane grid.
fn plane_metric(
    volume: &VolumeSendable,
    metric: TemporalMetric,
    grid: &PlaneGrid,
) -> BridgeResult<TemporalMetricResult> {
    // Every 4D element type through one generic kernel.
    macro_rules! compute {
        ($vec:expr, $to_f64:expr) => {{
            let (nx, ny, nz, _) = $vec.data.dim();
            let samples = plane_samples(volume, [nx, ny, nz], grid)?;
            let pixels = grid.width as usize * grid.height as usize;
            metric_over_series(&$vec.data, &samples, pixels, metric, $to_f64)
        }};
    }
    let data = match volume {
        VolumeSendable::Vec4DF32(vec) => compute!(vec, f64::from),
        VolumeSendable::Vec4DF64(vec) => compute!(vec, |v: f64| v),
        VolumeSendable::Vec4DI8(vec) => compute!(vec, f64::from),
        VolumeSendable::Vec4DU8(vec) => compute!(vec, f64::from),
        VolumeSendable::Vec4DI16(vec) => compute!(vec, f64::from),
        VolumeSendable::Vec4DU16(vec) => compute!(vec, f64::from),
        VolumeSendable::Vec4DI32(vec) => compute!(vec, f64::from),
        VolumeSendable::Vec4DU32(vec) => compute!(vec, f64::from),
        _ => {
            return Err(BridgeError::Input {
                code: 2011,
                details: "compute_temporal_metric_plane requires a 4D volume".to_string(),
            })
        }
    };
    Ok(TemporalMetricResult {
        width: grid.width,
        height: grid.height,
        data,
    })
}

/// The temporal metric of a 4D volume on a view-plane grid (module docs).
// A Tauri command's arguments are its wire contract.
#[allow(clippy::too_many_arguments)]
#[command]
#[tracing::instrument(skip_all, err, name = "api.compute_temporal_metric_plane")]
pub async fn compute_temporal_metric_plane(
    volume_id: String,
    metric: String,
    origin_mm: [f32; 3],
    u_mm: [f32; 3],
    v_mm: [f32; 3],
    width: u32,
    height: u32,
    state: State<'_, BridgeState>,
) -> BridgeResult<TemporalMetricResult> {
    info!(
        "compute_temporal_metric_plane: volume={}, metric={}, grid={}x{}",
        volume_id, metric, width, height
    );
    let metric = TemporalMetric::parse(&metric)?;
    let grid = PlaneGrid {
        origin_mm,
        u_mm,
        v_mm,
        width,
        height,
    };
    grid.validate()?;
    // A shared handle: the computation holds no registry lock, and an unload
    // during it only delays the release of the series.
    let volume = {
        let registry = state.volume_registry.lock().await;
        let entry = registry
            .get_entry(&volume_id)
            .ok_or_else(|| BridgeError::VolumeNotFound {
                code: 4041,
                details: format!("Volume {volume_id} not found"),
            })?;
        entry.data.clone()
    };
    tokio::task::spawn_blocking(move || plane_metric(&volume, metric, &grid))
        .await
        .map_err(|error| BridgeError::Internal {
            code: 5008,
            details: format!("Temporal metric task failed: {error}"),
        })?
}

#[cfg(test)]
mod tests {
    use super::*;
    use nalgebra::{DMatrix, Rotation3, Vector3};
    use neuroim::{DenseNeuroVec, NeuroSpace};

    const DIMS: [usize; 4] = [6, 7, 8, 4];
    /// Known voxel, and its series: mean 5, population variance 5.
    const VOXEL: [usize; 3] = [2, 3, 4];
    const SERIES: [f32; 4] = [2.0, 4.0, 6.0, 8.0];

    fn affine_4x4(rotation: Rotation3<f64>, spacing: [f64; 3], origin: [f64; 3]) -> DMatrix<f64> {
        let mut trans = DMatrix::<f64>::identity(4, 4);
        let m = rotation.matrix();
        for r in 0..3 {
            for c in 0..3 {
                trans[(r, c)] = m[(r, c)] * spacing[c];
            }
            trans[(r, 3)] = origin[r];
        }
        trans
    }

    /// An oblique space: the 4D trans is 5x5 with the origin in its last column.
    fn oblique_space(trans: DMatrix<f64>) -> NeuroSpace {
        NeuroSpace::new(DIMS.to_vec(), None, None, None, Some(trans)).unwrap()
    }

    fn oblique_f32(trans: DMatrix<f64>) -> VolumeSendable {
        let mut vec = DenseNeuroVec::<f32>::zeros(oblique_space(trans)).unwrap();
        for (t, value) in SERIES.iter().enumerate() {
            vec.data[[VOXEL[0], VOXEL[1], VOXEL[2], t]] = *value;
        }
        VolumeSendable::Vec4DF32(vec)
    }

    fn world_of(volume: &VolumeSendable, voxel: [usize; 3]) -> Vector3<f32> {
        let p = nalgebra::Point3::new(voxel[0] as f32, voxel[1] as f32, voxel[2] as f32);
        get_affine_from_volume(volume)
            .unwrap()
            .transform_point(&p)
            .coords
    }

    /// A grid whose pixel `at` is centred on `world`, along `u`, `v`.
    fn grid_through(
        world: Vector3<f32>,
        u: Vector3<f32>,
        v: Vector3<f32>,
        at: (u32, u32),
        size: (u32, u32),
    ) -> PlaneGrid {
        let origin = world - u * (at.0 as f32 + 0.5) - v * (at.1 as f32 + 0.5);
        PlaneGrid {
            origin_mm: origin.into(),
            u_mm: u.into(),
            v_mm: v.into(),
            width: size.0,
            height: size.1,
        }
    }

    fn pixel(result: &TemporalMetricResult, i: u32, j: u32) -> f32 {
        result.data[(j * result.width + i) as usize]
    }

    fn close(actual: f32, expected: f32) {
        assert!((actual - expected).abs() < 1e-4, "{actual} != {expected}");
    }

    fn oblique_trans() -> DMatrix<f64> {
        // Tilted 25° about x and 10° about z, anisotropic, off-centre origin.
        let rotation = Rotation3::from_euler_angles(25f64.to_radians(), 0.0, 10f64.to_radians());
        affine_4x4(rotation, [2.0, 3.0, 4.0], [-10.0, 7.0, -4.0])
    }

    #[test]
    fn known_voxel_lands_on_its_plane_pixel_of_an_oblique_volume() {
        let volume = oblique_f32(oblique_trans());
        // The 4D affine keeps its origin (last column of the 5x5 trans).
        let rotated = world_of(&volume, [0, 0, 0]);
        close(rotated.x, -10.0);
        close(rotated.y, 7.0);
        close(rotated.z, -4.0);
        // An axial view through a volume whose voxel axes leave the plane.
        let grid = grid_through(
            world_of(&volume, VOXEL),
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(0.0, -1.0, 0.0),
            (9, 6),
            (20, 16),
        );
        let variance = plane_metric(&volume, TemporalMetric::Variance, &grid).unwrap();
        let mean = plane_metric(&volume, TemporalMetric::Mean, &grid).unwrap();
        assert_eq!((variance.width, variance.height), (20, 16));
        assert_eq!(variance.data.len(), 20 * 16);
        close(pixel(&variance, 9, 6), 5.0);
        close(pixel(&mean, 9, 6), 5.0);
        // Its neighbours in the plane are other (constant zero) voxels: the
        // voxel covers pixels near (9, 6) only.
        close(pixel(&variance, 9 + 5, 6), 0.0);
        close(pixel(&variance, 9, 6 + 5), 0.0);
    }

    #[test]
    fn outside_the_volume_is_nan() {
        let volume = oblique_f32(oblique_trans());
        let grid = grid_through(
            world_of(&volume, VOXEL),
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(0.0, 1.0, 0.0),
            (100, 100),
            (200, 200),
        );
        let map = plane_metric(&volume, TemporalMetric::Mean, &grid).unwrap();
        close(pixel(&map, 100, 100), 5.0);
        assert!(pixel(&map, 0, 0).is_nan());
        assert!(pixel(&map, 199, 199).is_nan());
        // Entirely off the volume: all NaN, still a full grid.
        let far = grid_through(
            Vector3::new(500.0, 500.0, 500.0),
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(0.0, 1.0, 0.0),
            (2, 2),
            (4, 4),
        );
        let map = plane_metric(&volume, TemporalMetric::Mean, &far).unwrap();
        assert_eq!(map.data.len(), 16);
        assert!(map.data.iter().all(|v| v.is_nan()));
    }

    #[test]
    fn nan_reaches_the_frontend_as_null() {
        // The contract TemporalHeatmapService relies on.
        let result = TemporalMetricResult {
            width: 2,
            height: 1,
            data: vec![1.0, f32::NAN],
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("[1.0,null]"), "{json}");
    }

    #[test]
    fn half_voxel_boundaries_decide_inside_and_outside() {
        // Identity spacing 1 at origin 0: voxel 0 covers x in [-0.5, 0.5).
        let trans = affine_4x4(Rotation3::identity(), [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]);
        let volume = oblique_f32(trans);
        let grid = PlaneGrid {
            // Pixel centres at x = -0.75, -0.25, ..., y = 0, z = 0.
            origin_mm: [-1.0, -0.25, 0.0],
            u_mm: [0.5, 0.0, 0.0],
            v_mm: [0.0, 0.5, 0.0],
            width: 16,
            height: 1,
        };
        let map = plane_metric(&volume, TemporalMetric::Mean, &grid).unwrap();
        assert!(map.data[0].is_nan());
        assert!(!map.data[1].is_nan());
        // x = 5.25 is in voxel 5; x = 5.75 is past the last voxel's edge.
        assert!(!map.data[12].is_nan());
        assert!(map.data[13].is_nan());
    }

    #[test]
    fn rotation_in_and_through_the_plane() {
        // A 45° in-plane rotation of the volume, then 45° through the plane.
        let in_plane = Rotation3::from_axis_angle(&Vector3::z_axis(), 45f64.to_radians());
        let through = Rotation3::from_axis_angle(&Vector3::x_axis(), 45f64.to_radians());
        let trans = affine_4x4(through * in_plane, [2.0, 2.0, 2.0], [5.0, -3.0, 2.0]);
        let volume = oblique_f32(trans);
        let world = world_of(&volume, VOXEL);

        // A view tilted the same way lies exactly on the voxel's slice: walking
        // one voxel along u reaches the next voxel of that slice.
        let u = (through * in_plane).matrix().column(0).into_owned() * 2.0;
        let v = (through * in_plane).matrix().column(1).into_owned() * 2.0;
        let (u, v): (Vector3<f32>, Vector3<f32>) = (u.cast(), v.cast());
        let aligned = grid_through(world, u, v, (2, 3), (DIMS[0] as u32, DIMS[1] as u32));
        let map = plane_metric(&volume, TemporalMetric::Variance, &aligned).unwrap();
        close(pixel(&map, 2, 3), 5.0);
        let nonzero = map.data.iter().filter(|v| **v != 0.0).count();
        assert_eq!(nonzero, 1, "exactly one voxel of the slice varies");

        // An axial view through the same voxel crosses it obliquely.
        let axial = grid_through(
            world,
            Vector3::new(0.5, 0.0, 0.0),
            Vector3::new(0.0, -0.5, 0.0),
            (30, 30),
            (60, 60),
        );
        let map = plane_metric(&volume, TemporalMetric::Variance, &axial).unwrap();
        close(pixel(&map, 30, 30), 5.0);
        assert!(map.data.iter().any(|v| v.is_nan()));
    }

    #[test]
    fn every_integer_element_type_uses_the_same_kernel() {
        let trans = oblique_trans();
        let world = world_of(&oblique_f32(trans.clone()), VOXEL);
        let grid = grid_through(
            world,
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(0.0, 1.0, 0.0),
            (5, 5),
            (10, 10),
        );
        macro_rules! check {
            ($t:ty, $variant:ident) => {{
                let mut vec = DenseNeuroVec::<$t>::zeros(oblique_space(trans.clone())).unwrap();
                for (t, value) in SERIES.iter().enumerate() {
                    vec.data[[VOXEL[0], VOXEL[1], VOXEL[2], t]] = *value as $t;
                }
                let volume = VolumeSendable::$variant(vec);
                let variance = plane_metric(&volume, TemporalMetric::Variance, &grid).unwrap();
                let mean = plane_metric(&volume, TemporalMetric::Mean, &grid).unwrap();
                close(pixel(&variance, 5, 5), 5.0);
                close(pixel(&mean, 5, 5), 5.0);
            }};
        }
        check!(f64, Vec4DF64);
        check!(i8, Vec4DI8);
        check!(u8, Vec4DU8);
        check!(i16, Vec4DI16);
        check!(u16, Vec4DU16);
        check!(i32, Vec4DI32);
        check!(u32, Vec4DU32);
    }

    #[test]
    fn large_integers_keep_their_variance() {
        // Summing as f32 would lose these; the series is 1e6 + {2, 4, 6, 8}.
        let mut vec = DenseNeuroVec::<i32>::zeros(oblique_space(oblique_trans())).unwrap();
        for (t, value) in SERIES.iter().enumerate() {
            vec.data[[VOXEL[0], VOXEL[1], VOXEL[2], t]] = 1_000_000 + *value as i32;
        }
        let volume = VolumeSendable::Vec4DI32(vec);
        let world = world_of(&volume, VOXEL);
        let grid = grid_through(
            world,
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(0.0, 1.0, 0.0),
            (0, 0),
            (1, 1),
        );
        let map = plane_metric(&volume, TemporalMetric::Variance, &grid).unwrap();
        close(map.data[0], 5.0);
    }

    #[test]
    fn rejects_a_3d_volume_an_unknown_metric_and_a_bad_grid() {
        let space = NeuroSpace::new(vec![4, 4, 4], None, None, None, None).unwrap();
        let volume = VolumeSendable::VolF32(
            volmath::DenseVolume3::new(neuroim::DenseNeuroVol::<f32>::zeros(space)),
            nalgebra::Affine3::identity(),
        );
        let grid = PlaneGrid {
            origin_mm: [0.0; 3],
            u_mm: [1.0, 0.0, 0.0],
            v_mm: [0.0, 1.0, 0.0],
            width: 2,
            height: 2,
        };
        assert!(plane_metric(&volume, TemporalMetric::Mean, &grid).is_err());
        assert!(TemporalMetric::parse("std").is_err());
        assert!(grid.validate().is_ok());
        for bad in [
            PlaneGrid { width: 0, ..grid },
            PlaneGrid {
                height: MAX_GRID_SIDE + 1,
                ..grid
            },
            PlaneGrid {
                u_mm: [f32::NAN, 0.0, 0.0],
                ..grid
            },
            PlaneGrid {
                v_mm: grid.u_mm,
                ..grid
            },
        ] {
            assert!(bad.validate().is_err());
        }
    }

    /// Timing probe, not a check: `cargo test -p api-bridge --lib --offline
    /// temporal_plane_timing -- --ignored --nocapture`. 650 MiB of series.
    #[test]
    #[ignore]
    fn temporal_plane_timing() {
        let dims = vec![106, 106, 64, 453];
        let spacing = vec![2.0, 2.0, 2.0, 1.0];
        let origin = vec![-106.0, -106.0, -64.0, 0.0];
        let space = NeuroSpace::new(dims, Some(spacing), Some(origin), None, None).unwrap();
        let mut vec = DenseNeuroVec::<i16>::zeros(space).unwrap();
        vec.data
            .iter_mut()
            .enumerate()
            .for_each(|(n, value)| *value = (n % 1009) as i16);
        let volume = VolumeSendable::Vec4DI16(vec);
        for side in [106, 512] {
            let step = 212.0 / side as f32;
            let grid = PlaneGrid {
                origin_mm: [-106.0, -106.0, 0.0],
                u_mm: [step, 0.0, 0.0],
                v_mm: [0.0, step, 0.0],
                width: side,
                height: side,
            };
            let start = std::time::Instant::now();
            let map = plane_metric(&volume, TemporalMetric::Variance, &grid).unwrap();
            println!("{side}x{side}: {:?} ({})", start.elapsed(), map.data.len());
        }
    }
}
