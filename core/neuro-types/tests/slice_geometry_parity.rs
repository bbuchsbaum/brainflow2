//! Cross-language parity fixtures for the slice-frame geometry contract.
//!
//! This test is the *producer* for the JSON fixtures consumed by the TypeScript
//! port in `ui2/src/utils/sliceGeometry.ts` (see
//! `ui2/src/utils/__tests__/sliceGeometryParity.test.ts`). It exercises the
//! canonical Rust geometry — `SliceGeometry::full_extent`, `pixel_to_world`,
//! `to_gpu_frame_params`, and `refit_to_px` — over four representative volumes
//! (identity affine, non-square dims, negative-X affine, oblique affine) and
//! records the exact numeric outputs.
//!
//! Mechanism (mirrors the render-golden harness):
//!   * `UPDATE_SLICE_GEOMETRY_FIXTURES=1 cargo test -p neuro-types --test slice_geometry_parity`
//!     (re)writes the committed fixture. It is also written automatically on the
//!     first run if the file is missing.
//!   * The default run recomputes the geometry and asserts the committed fixture
//!     still reproduces it within 1e-4, so Rust-side drift is caught here and
//!     TS-side drift is caught by the vitest parity test — both anchored to the
//!     same committed JSON.

use nalgebra::Matrix4;
use neuro_types::view_rect::ViewOrientation;
use neuro_types::{Handedness, SliceGeometry, VolumeMetadata};
use serde_json::{json, Value};
use std::path::PathBuf;

const PARITY_TOL: f64 = 1e-4;

fn fixture_path() -> PathBuf {
    // <repo>/core/neuro-types -> <repo>
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../ui2/src/utils/__tests__/fixtures/sliceGeometryParity.json")
}

struct Case {
    name: &'static str,
    orientation: ViewOrientation,
    dims: [usize; 3],
    affine: Matrix4<f32>,
    crosshair: [f32; 3],
    screen_px_max: [u32; 2],
    refit_px: [u32; 2],
}

fn orientation_str(o: ViewOrientation) -> &'static str {
    match o {
        ViewOrientation::Axial => "axial",
        ViewOrientation::Coronal => "coronal",
        ViewOrientation::Sagittal => "sagittal",
    }
}

/// The negative-X ("Schaefer-like") affine: diag(-1, 1, 1) + translation.
fn schaefer_affine() -> Matrix4<f32> {
    Matrix4::new(
        -1.0, 0.0, 0.0, 90.0, //
        0.0, 1.0, 0.0, -126.0, //
        0.0, 0.0, 1.0, -72.0, //
        0.0, 0.0, 0.0, 1.0,
    )
}

/// A rotation-only oblique affine (rot_z(20deg) * rot_x(-15deg)) + translation.
fn oblique_affine() -> Matrix4<f32> {
    let theta_z = 20.0_f32.to_radians();
    let theta_x = -15.0_f32.to_radians();

    let rz = Matrix4::new(
        theta_z.cos(),
        -theta_z.sin(),
        0.0,
        0.0, //
        theta_z.sin(),
        theta_z.cos(),
        0.0,
        0.0, //
        0.0,
        0.0,
        1.0,
        0.0, //
        0.0,
        0.0,
        0.0,
        1.0,
    );
    let rx = Matrix4::new(
        1.0,
        0.0,
        0.0,
        0.0, //
        0.0,
        theta_x.cos(),
        -theta_x.sin(),
        0.0, //
        0.0,
        theta_x.sin(),
        theta_x.cos(),
        0.0, //
        0.0,
        0.0,
        0.0,
        1.0,
    );
    let mut affine = rz * rx;
    affine[(0, 3)] = -90.0;
    affine[(1, 3)] = -126.0;
    affine[(2, 3)] = -72.0;
    affine
}

fn cases() -> Vec<Case> {
    vec![
        Case {
            name: "identity_axial",
            orientation: ViewOrientation::Axial,
            dims: [193, 229, 193],
            affine: Matrix4::identity(),
            crosshair: [96.0, 114.0, 96.0],
            screen_px_max: [256, 256],
            refit_px: [300, 220],
        },
        Case {
            name: "nonsquare_coronal",
            orientation: ViewOrientation::Coronal,
            dims: [160, 96, 200],
            affine: Matrix4::identity(),
            crosshair: [80.0, 48.0, 100.0],
            screen_px_max: [256, 256],
            refit_px: [220, 300],
        },
        Case {
            name: "negative_x_axial",
            orientation: ViewOrientation::Axial,
            dims: [182, 218, 182],
            affine: schaefer_affine(),
            crosshair: [-0.5, 44.9, 34.6],
            screen_px_max: [512, 512],
            refit_px: [400, 256],
        },
        Case {
            name: "oblique_sagittal",
            orientation: ViewOrientation::Sagittal,
            dims: [96, 112, 88],
            affine: oblique_affine(),
            crosshair: oblique_center(),
            screen_px_max: [512, 512],
            refit_px: [256, 400],
        },
    ]
}

fn oblique_center() -> [f32; 3] {
    let affine = oblique_affine();
    let dims = [96usize, 112, 88];
    let center_voxel = [
        (dims[0] as f32 - 1.0) / 2.0,
        (dims[1] as f32 - 1.0) / 2.0,
        (dims[2] as f32 - 1.0) / 2.0,
    ];
    let p = affine * nalgebra::Point4::new(center_voxel[0], center_voxel[1], center_voxel[2], 1.0);
    [p[0], p[1], p[2]]
}

fn f3(v: [f32; 3]) -> Value {
    json!([v[0] as f64, v[1] as f64, v[2] as f64])
}

fn f4(v: [f32; 4]) -> Value {
    json!([v[0] as f64, v[1] as f64, v[2] as f64, v[3] as f64])
}

fn view_plane_json(geom: &SliceGeometry) -> Value {
    json!({
        "origin_mm": f3(geom.origin_mm),
        "u_mm": f3(geom.u_mm),
        "v_mm": f3(geom.v_mm),
        "dim_px": [geom.dim_px[0], geom.dim_px[1]],
    })
}

/// Pixel sample points that stay in-bounds for any raster of size `dim_px`.
fn sample_points(dim_px: [u32; 2]) -> Vec<(u32, u32)> {
    let w = dim_px[0].max(1);
    let h = dim_px[1].max(1);
    vec![
        (0, 0),
        (w / 2, h / 2),
        (w - 1, h - 1),
        (7.min(w - 1), 3.min(h - 1)),
    ]
}

fn build_case_json(case: &Case) -> Value {
    let meta = VolumeMetadata {
        dimensions: case.dims,
        voxel_to_world: case.affine,
    };
    let geom = SliceGeometry::full_extent(
        case.orientation,
        case.crosshair,
        &meta,
        case.screen_px_max,
        Handedness::Neurological,
    );

    let pixel_to_world: Vec<Value> = sample_points(geom.dim_px)
        .into_iter()
        .map(|(x, y)| {
            json!({
                "x": x,
                "y": y,
                "world": f3(geom.pixel_to_world(x, y)),
            })
        })
        .collect();

    let (origin, u_vec, v_vec) = geom.to_gpu_frame_params();
    let refit = geom.refit_to_px(case.refit_px);

    json!({
        "name": case.name,
        "orientation": orientation_str(case.orientation),
        "view_plane": view_plane_json(&geom),
        "pixel_to_world": pixel_to_world,
        "gpu_frame_params": {
            "origin": f4(origin),
            "u": f4(u_vec),
            "v": f4(v_vec),
        },
        "refit": {
            "dim_px": [case.refit_px[0], case.refit_px[1]],
            "view_plane": view_plane_json(&refit),
        },
    })
}

fn build_fixture() -> Value {
    Value::Array(cases().iter().map(build_case_json).collect())
}

/// Deep numeric-tolerant comparison. Numbers must agree within `PARITY_TOL`;
/// structure/keys must match exactly.
fn values_close(a: &Value, b: &Value, path: &str) -> Result<(), String> {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            let xf = x.as_f64().unwrap_or(f64::NAN);
            let yf = y.as_f64().unwrap_or(f64::NAN);
            if (xf - yf).abs() <= PARITY_TOL {
                Ok(())
            } else {
                Err(format!("{path}: {xf} vs {yf} (Δ={})", (xf - yf).abs()))
            }
        }
        (Value::Array(xs), Value::Array(ys)) => {
            if xs.len() != ys.len() {
                return Err(format!("{path}: array length {} vs {}", xs.len(), ys.len()));
            }
            for (i, (x, y)) in xs.iter().zip(ys).enumerate() {
                values_close(x, y, &format!("{path}[{i}]"))?;
            }
            Ok(())
        }
        (Value::Object(xs), Value::Object(ys)) => {
            if xs.len() != ys.len() {
                return Err(format!(
                    "{path}: object key count {} vs {}",
                    xs.len(),
                    ys.len()
                ));
            }
            for (k, xv) in xs {
                let yv = ys
                    .get(k)
                    .ok_or_else(|| format!("{path}: missing key '{k}' in committed fixture"))?;
                values_close(xv, yv, &format!("{path}.{k}"))?;
            }
            Ok(())
        }
        (x, y) if x == y => Ok(()),
        (x, y) => Err(format!("{path}: {x} vs {y}")),
    }
}

#[test]
fn slice_geometry_parity_fixture() {
    let path = fixture_path();
    let fresh = build_fixture();

    let update = std::env::var_os("UPDATE_SLICE_GEOMETRY_FIXTURES").is_some();

    if update || !path.exists() {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).expect("failed to create fixtures dir");
        }
        let pretty = serde_json::to_string_pretty(&fresh).expect("serialize fixture");
        std::fs::write(&path, format!("{pretty}\n")).expect("write fixture");
        eprintln!("slice_geometry_parity: wrote {}", path.display());
        return;
    }

    let committed: Value =
        serde_json::from_str(&std::fs::read_to_string(&path).expect("read committed fixture"))
            .expect("parse committed fixture");

    if let Err(err) = values_close(&fresh, &committed, "$") {
        panic!(
            "Rust slice geometry drifted from committed fixture {}: {err}. \
             Regenerate with UPDATE_SLICE_GEOMETRY_FIXTURES=1 if this change is intended \
             (and re-run the vitest parity test).",
            path.display()
        );
    }
}
