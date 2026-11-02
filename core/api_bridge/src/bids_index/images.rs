//! On-demand thumbnails: slices, median slices and carpets. Each image is the
//! same rule for every run (slice chosen by world z through the affine, window
//! the 2nd to 98th percentile of nonzero voxels), cached on disk keyed on file
//! size, mtime and parameters.
//!
//! Readers decode whole files, so callers hold a permit of a two-slot semaphore
//! and `MAX_DECODED_BYTES` refuses what would not fit.

use super::{file_stamp, sha256_hex, write_atomic};
use base64::Engine;
use bridge_types::bids::{BidsMedianSliceImage, BidsSliceImage, BidsSliceRequest};
use ndarray::{Array3, Axis};
use neuroim::NeuroSpace;
use std::path::{Path, PathBuf};

const MAX_DECODED_BYTES: u64 = 6 << 30;
const MAX_MEAN_VOLUMES: usize = 8;
const MAX_MEDIAN_RUNS: usize = 15;
const CACHE_VERSION: &str = "1";

/// Voxel-to-world rows. The translation is in the *last* column of neuroim's
/// `trans`, which is 5x5 for a 4D space.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Affine3x4 {
    pub rows: [[f64; 4]; 3],
}

impl Affine3x4 {
    pub fn from_space(space: &NeuroSpace) -> Self {
        let trans = &space.trans;
        let last = trans.ncols() - 1;
        let row = |r: usize| {
            [
                trans[(r, 0)],
                trans[(r, 1)],
                trans[(r, 2)],
                trans[(r, last)],
            ]
        };
        Self {
            rows: [row(0), row(1), row(2)],
        }
    }

    /// The voxel axis that moves most along a world axis.
    fn dominant_axis(&self, world: usize, among: &[usize]) -> usize {
        among
            .iter()
            .copied()
            .max_by(|&a, &b| {
                self.rows[world][a]
                    .abs()
                    .total_cmp(&self.rows[world][b].abs())
            })
            .unwrap_or(0)
    }

    fn spacing(&self, axis: usize) -> f64 {
        self.rows
            .iter()
            .map(|row| row[axis] * row[axis])
            .sum::<f64>()
            .sqrt()
    }
}

/// How a volume maps to an axial image: columns run to +R, rows to -A.
#[derive(Debug, Clone, Copy)]
pub(crate) struct AxialPlan {
    slice_axis: usize,
    column_axis: usize,
    row_axis: usize,
    slice_index: usize,
    /// World z at the volume's in-plane centre on the chosen slice.
    pub world_z: f64,
}

/// Choose the slice nearest `world_z`, through the affine. `None` is the middle
/// slice. The world z returned is that of the slice actually drawn.
pub(crate) fn plan_axial(affine: &Affine3x4, dim: [usize; 3], world_z: Option<f64>) -> AxialPlan {
    let slice_axis = affine.dominant_axis(2, &[0, 1, 2]);
    let others: Vec<usize> = (0..3).filter(|&axis| axis != slice_axis).collect();
    let column_axis = affine.dominant_axis(0, &others);
    let row_axis = others
        .iter()
        .copied()
        .find(|&a| a != column_axis)
        .unwrap_or(1);
    let z_row = affine.rows[2];
    let centre = |axis: usize| (dim[axis].max(1) - 1) as f64 / 2.0;
    let in_plane =
        z_row[3] + z_row[column_axis] * centre(column_axis) + z_row[row_axis] * centre(row_axis);
    let top = dim[slice_axis].max(1) - 1;
    let slice_index = match world_z {
        Some(target) if z_row[slice_axis].abs() > f64::EPSILON => {
            (((target - in_plane) / z_row[slice_axis]).round().max(0.0) as usize).min(top)
        }
        _ => top / 2,
    };
    AxialPlan {
        slice_axis,
        column_axis,
        row_axis,
        slice_index,
        world_z: in_plane + z_row[slice_axis] * slice_index as f64,
    }
}

struct Plane {
    width: usize,
    height: usize,
    values: Vec<f32>,
}

/// Sample the planned slice onto a square-pixel grid, at most `max_px` a side,
/// so anisotropic voxels stay undistorted. Bilinear.
fn sample_plane(volume: &Array3<f32>, affine: &Affine3x4, plan: &AxialPlan, max_px: u32) -> Plane {
    let dim = volume.shape();
    let (nu, nv) = (dim[plan.column_axis], dim[plan.row_axis]);
    let (su, sv) = (
        affine.spacing(plan.column_axis),
        affine.spacing(plan.row_axis),
    );
    let pixel = su.min(sv).max(f64::MIN_POSITIVE);
    let (mm_w, mm_h) = (nu as f64 * su, nv as f64 * sv);
    let scale = (f64::from(max_px) / (mm_w.max(mm_h) / pixel)).min(1.0);
    let width = ((mm_w / pixel * scale).round() as usize).max(1);
    let height = ((mm_h / pixel * scale).round() as usize).max(1);

    let flip_u = affine.rows[0][plan.column_axis] < 0.0;
    let flip_v = affine.rows[1][plan.row_axis] > 0.0;
    let at = |u: usize, v: usize| -> f32 {
        let mut index = [0usize; 3];
        index[plan.column_axis] = u;
        index[plan.row_axis] = v;
        index[plan.slice_axis] = plan.slice_index;
        volume[index]
    };
    let axis_coord = |position: usize, out: usize, n: usize, flip: bool| -> f64 {
        let coord = (position as f64 + 0.5) / out as f64 * n as f64 - 0.5;
        let coord = coord.clamp(0.0, n.saturating_sub(1) as f64);
        if flip {
            (n - 1) as f64 - coord
        } else {
            coord
        }
    };
    let mut values = Vec::with_capacity(width * height);
    for row in 0..height {
        let v = axis_coord(row, height, nv, flip_v);
        let (v0, v1) = (v.floor() as usize, (v.ceil() as usize).min(nv - 1));
        let tv = (v - v0 as f64) as f32;
        for column in 0..width {
            let u = axis_coord(column, width, nu, flip_u);
            let (u0, u1) = (u.floor() as usize, (u.ceil() as usize).min(nu - 1));
            let tu = (u - u0 as f64) as f32;
            let near = at(u0, v0) * (1.0 - tu) + at(u1, v0) * tu;
            let far = at(u0, v1) * (1.0 - tu) + at(u1, v1) * tu;
            values.push(near * (1.0 - tv) + far * tv);
        }
    }
    Plane {
        width,
        height,
        values,
    }
}

/// 2nd and 98th percentile of the nonzero finite values.
pub(crate) fn percentile_window(values: &[f32]) -> (f32, f32) {
    let mut sorted: Vec<f32> = values
        .iter()
        .copied()
        .filter(|value| value.is_finite() && *value != 0.0)
        .collect();
    if sorted.is_empty() {
        return (0.0, 1.0);
    }
    sorted.sort_by(f32::total_cmp);
    let at = |fraction: f64| sorted[((sorted.len() - 1) as f64 * fraction).round() as usize];
    let (low, high) = (at(0.02), at(0.98));
    if high > low {
        (low, high)
    } else {
        (low, low + 1.0)
    }
}

fn to_gray(value: f32, low: f32, high: f32) -> u8 {
    if !value.is_finite() {
        return 0;
    }
    (((value - low) / (high - low)).clamp(0.0, 1.0) * 255.0).round() as u8
}

fn gray_png(width: usize, height: usize, gray: &[u8]) -> Result<String, String> {
    let rgba: Vec<u8> = gray.iter().flat_map(|&g| [g, g, g, 255]).collect();
    let bytes = crate::render_bridge_adapter::encode_png_frame(width as u32, height as u32, rgba)
        .map_err(|e| format!("PNG encoding failed: {e:?}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn require_decodable(path: &Path) -> Result<nifti_loader::HeaderSummary, String> {
    let header = nifti_loader::read_header_summary(path).map_err(|e| e.to_string())?;
    let voxels: u64 = header.dim.iter().map(|&d| u64::from(d.max(1))).product();
    if voxels.saturating_mul(4) > MAX_DECODED_BYTES {
        return Err(format!(
            "{} is too large to decode for a thumbnail.",
            path.display()
        ));
    }
    Ok(header)
}

struct Reduced {
    volume: Array3<f32>,
    affine: Affine3x4,
    volumes_used: u32,
}

fn io_error(error: impl std::fmt::Display) -> String {
    format!("Could not decode image: {error}")
}

/// `n` indices evenly spaced over `len`, always the middle of each stretch.
fn even_indices(len: usize, n: usize) -> Vec<usize> {
    let n = n.min(len);
    (0..n).map(|i| (2 * i + 1) * len / (2 * n)).collect()
}

/// Reduce to one 3D volume. Decoding through neuroim keeps scaled integers as
/// floats with slope and intercept applied.
fn reduce(path: &Path, kind: &str) -> Result<Reduced, String> {
    let header = require_decodable(path)?;
    let volumes = header.n_volumes.unwrap_or(1) as usize;
    if volumes <= 1 || kind == "first" || kind == "anat" {
        let vol = neuroim::io::read_vol_f32(path, 0).map_err(io_error)?;
        return Ok(Reduced {
            affine: Affine3x4::from_space(&vol.space),
            volume: vol.data,
            volumes_used: 1,
        });
    }
    let vec = neuroim::io::read_vec_f32(path).map_err(io_error)?;
    let affine = Affine3x4::from_space(&vec.space);
    let shape = vec.data.shape();
    let dim = (shape[0], shape[1], shape[2]);
    let n_t = shape[3];
    if kind == "tsnr" {
        let mean = vec.data.mean_axis(Axis(3)).ok_or("Empty series")?;
        let std = vec.data.std_axis(Axis(3), 1.0);
        let volume = Array3::from_shape_fn(dim, |(x, y, z)| {
            let (m, s) = (mean[[x, y, z]], std[[x, y, z]]);
            if s > 0.0 && m > 0.0 {
                m / s
            } else {
                0.0
            }
        });
        return Ok(Reduced {
            volume,
            affine,
            volumes_used: n_t as u32,
        });
    }
    let indices = even_indices(n_t, MAX_MEAN_VOLUMES);
    let mut volume = Array3::<f32>::zeros(dim);
    for &t in &indices {
        volume += &vec.data.index_axis(Axis(3), t);
    }
    volume /= indices.len() as f32;
    Ok(Reduced {
        volume,
        affine,
        volumes_used: indices.len() as u32,
    })
}

pub(crate) fn render_slice(request: &BidsSliceRequest) -> Result<BidsSliceImage, String> {
    let reduced = reduce(Path::new(&request.path), &request.kind)?;
    let shape = reduced.volume.shape();
    let plan = plan_axial(
        &reduced.affine,
        [shape[0], shape[1], shape[2]],
        request.world_z_mm.map(f64::from),
    );
    let plane = sample_plane(
        &reduced.volume,
        &reduced.affine,
        &plan,
        request.max_px.clamp(16, 1024),
    );
    let (low, high) = percentile_window(&plane.values);
    let gray: Vec<u8> = plane
        .values
        .iter()
        .map(|&v| to_gray(v, low, high))
        .collect();
    Ok(BidsSliceImage {
        png_base64: gray_png(plane.width, plane.height, &gray)?,
        width: plane.width as u32,
        height: plane.height as u32,
        world_z_mm: Some(plan.world_z as f32),
        window_low: low,
        window_high: high,
        volumes_used: reduced.volumes_used,
    })
}

fn cache_path(cache_root: &Path, key_parts: &[&str]) -> PathBuf {
    let key = sha256_hex(key_parts);
    cache_root.join("bids-images").join(format!("{key}.json"))
}

fn slice_cache_path(cache_root: &Path, request: &BidsSliceRequest) -> Option<PathBuf> {
    let stamp = file_stamp(Path::new(&request.path))?;
    let z = request
        .world_z_mm
        .map_or_else(|| "mid".to_string(), |z| format!("{z:.2}"));
    Some(cache_path(
        cache_root,
        &[
            CACHE_VERSION,
            "slice",
            &request.path,
            &stamp,
            &request.kind,
            &z,
            &request.max_px.to_string(),
        ],
    ))
}

fn read_cached<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

/// A failed cache write loses nothing but the speed-up.
fn write_cached<T: serde::Serialize>(path: &Path, value: &T) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(bytes) = serde_json::to_vec(value) {
        let _ = write_atomic(path, &bytes);
    }
}

pub(crate) fn cached_slice(
    cache_root: &Path,
    request: &BidsSliceRequest,
) -> Option<BidsSliceImage> {
    read_cached(&slice_cache_path(cache_root, request)?)
}

pub(crate) fn get_slice(
    cache_root: &Path,
    request: &BidsSliceRequest,
) -> Result<BidsSliceImage, String> {
    if let Some(image) = cached_slice(cache_root, request) {
        return Ok(image);
    }
    let image = render_slice(request)?;
    if let Some(path) = slice_cache_path(cache_root, request) {
        write_cached(&path, &image);
    }
    Ok(image)
}

fn decode_gray(image: &BidsSliceImage) -> Option<Vec<u8>> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&image.png_base64)
        .ok()?;
    let decoded = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png).ok()?;
    Some(decoded.to_luma8().into_raw())
}

fn modal_grid(images: &[(BidsSliceImage, Vec<u8>)]) -> Option<(u32, u32)> {
    let mut counts: Vec<((u32, u32), usize)> = Vec::new();
    for (image, _) in images {
        let grid = (image.width, image.height);
        match counts.iter_mut().find(|(known, _)| *known == grid) {
            Some((_, count)) => *count += 1,
            None => counts.push((grid, 1)),
        }
    }
    counts.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    counts.first().map(|(grid, _)| *grid)
}

/// The runs a median is built from: at most 15, evenly spaced through `paths`.
pub(crate) fn median_runs(paths: &[String]) -> Vec<String> {
    even_indices(paths.len(), MAX_MEDIAN_RUNS)
        .into_iter()
        .map(|index| paths[index].clone())
        .collect()
}

fn median_cache_path(cache_root: &Path, chosen: &[String], request: &BidsSliceRequest) -> PathBuf {
    let mut key: Vec<String> = chosen
        .iter()
        .map(|path| {
            format!(
                "{path}|{}",
                file_stamp(Path::new(path.as_str())).unwrap_or_default()
            )
        })
        .collect();
    key.sort();
    key.push(format!(
        "median|{}|{:?}|{}",
        request.kind, request.world_z_mm, request.max_px
    ));
    let keys: Vec<&str> = key.iter().map(String::as_str).collect();
    cache_path(cache_root, &keys)
}

/// A finished median, without touching any run: a remote file already in the
/// cache needs no download.
pub(crate) fn cached_median(
    cache_root: &Path,
    chosen: &[String],
    request: &BidsSliceRequest,
) -> Option<BidsMedianSliceImage> {
    read_cached(&median_cache_path(cache_root, chosen, request))
}

/// Pixelwise median of windowed slices on the modal grid. Each run is windowed
/// by the same percentile rule first, so scanner gain does not weight the
/// median. At most 15 runs, evenly spaced through `paths`.
pub(crate) fn get_median_slice(
    cache_root: &Path,
    paths: &[String],
    request: &BidsSliceRequest,
) -> Result<BidsMedianSliceImage, String> {
    let chosen = median_runs(paths);
    let cached_at = median_cache_path(cache_root, &chosen, request);
    if let Some(cached) = read_cached(&cached_at) {
        return Ok(cached);
    }

    let mut images: Vec<(BidsSliceImage, Vec<u8>)> = Vec::new();
    for path in &chosen {
        let single = BidsSliceRequest {
            path: path.clone(),
            ..request.clone()
        };
        images.extend(
            get_slice(cache_root, &single)
                .ok()
                .and_then(|image| decode_gray(&image).map(|gray| (image, gray))),
        );
    }
    let (width, height) = modal_grid(&images).ok_or("No run could be read for a median image")?;
    images.retain(|(image, _)| (image.width, image.height) == (width, height));
    let n_pixels = width as usize * height as usize;
    let mut gray = vec![0u8; n_pixels];
    let mut stack = vec![0u8; images.len()];
    for (pixel, out) in gray.iter_mut().enumerate() {
        for (slot, (_, values)) in stack.iter_mut().zip(&images) {
            *slot = values[pixel];
        }
        stack.sort_unstable();
        *out = stack[stack.len() / 2];
    }
    let runs_skipped = (chosen.len() - images.len()) as u32;
    let result = BidsMedianSliceImage {
        image: BidsSliceImage {
            png_base64: gray_png(width as usize, height as usize, &gray)?,
            width,
            height,
            world_z_mm: images[0].0.world_z_mm,
            window_low: 0.0,
            window_high: 1.0,
            volumes_used: images[0].0.volumes_used,
        },
        runs_used: images.len() as u32,
        runs_skipped,
    };
    write_cached(&cached_at, &result);
    Ok(result)
}

fn carpet_cache_path(cache_root: &Path, path: &Path, width: u32, height: u32) -> Option<PathBuf> {
    let stamp = file_stamp(path)?;
    let key = [
        CACHE_VERSION,
        "carpet",
        &path.to_string_lossy(),
        &stamp,
        &width.to_string(),
        &height.to_string(),
    ];
    Some(cache_path(cache_root, &key))
}

/// A finished carpet, without decoding or downloading the run.
pub(crate) fn cached_carpet(
    cache_root: &Path,
    path: &Path,
    width: u32,
    height: u32,
) -> Option<BidsSliceImage> {
    read_cached(&carpet_cache_path(cache_root, path, width, height)?)
}

/// Carpet: z-scored time series of evenly sampled in-brain voxels, one row per
/// voxel, time along x, shown over -2 to 2 SD. In-brain is mean intensity above
/// the volume's overall mean.
pub(crate) fn get_carpet(
    cache_root: &Path,
    path: &Path,
    width: u32,
    height: u32,
) -> Result<BidsSliceImage, String> {
    let cached_at = carpet_cache_path(cache_root, path, width, height)
        .ok_or_else(|| format!("Cannot access {}", path.display()))?;
    if let Some(cached) = read_cached(&cached_at) {
        return Ok(cached);
    }
    require_decodable(path)?;
    let vec = neuroim::io::read_vec_f32(path).map_err(io_error)?;
    let shape = vec.data.shape().to_vec();
    let (nx, ny, nz, nt) = (shape[0], shape[1], shape[2], shape[3]);
    if nt < 2 {
        return Err("A carpet needs more than one volume.".into());
    }
    let mean = vec.data.mean_axis(Axis(3)).ok_or("Empty series")?;
    let threshold = mean.mean().unwrap_or(0.0);
    let mut voxels = Vec::new();
    for z in 0..nz {
        for y in 0..ny {
            for x in 0..nx {
                if mean[[x, y, z]] > threshold {
                    voxels.push((x, y, z));
                }
            }
        }
    }
    if voxels.is_empty() {
        return Err("No in-brain voxels found.".into());
    }
    let out_w = (width.clamp(16, 2048) as usize).min(nt);
    let out_h = (height.clamp(16, 2048) as usize).min(voxels.len());
    let mut gray = Vec::with_capacity(out_w * out_h);
    for &voxel_index in &even_indices(voxels.len(), out_h) {
        let (x, y, z) = voxels[voxel_index];
        let series: Vec<f32> = (0..nt).map(|t| vec.data[[x, y, z, t]]).collect();
        let m = series.iter().sum::<f32>() / nt as f32;
        let variance = series.iter().map(|v| (v - m) * (v - m)).sum::<f32>() / nt as f32;
        let sd = variance.sqrt().max(f32::EPSILON);
        for column in 0..out_w {
            let start = column * nt / out_w;
            let end = ((column + 1) * nt / out_w).max(start + 1);
            let bin = series[start..end].iter().sum::<f32>() / (end - start) as f32;
            gray.push(to_gray((bin - m) / sd, -2.0, 2.0));
        }
    }
    let image = BidsSliceImage {
        png_base64: gray_png(out_w, out_h, &gray)?,
        width: out_w as u32,
        height: out_h as u32,
        world_z_mm: None,
        window_low: -2.0,
        window_high: 2.0,
        volumes_used: nt as u32,
    };
    write_cached(&cached_at, &image);
    Ok(image)
}
