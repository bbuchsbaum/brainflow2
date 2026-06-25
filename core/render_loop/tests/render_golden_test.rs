//! Render-correctness verification harness (visual / golden).
//!
//! Proves that a fixed volume + fixed view renders identically before and after
//! a change. This is the prerequisite gate for the rendering-data-affecting perf
//! work (native-dtype decode, `values()` elimination, off-reactor convert,
//! progressive low-res): each of those touches how voxel data reaches the GPU,
//! and must not alter the rendered pixels.
//!
//! Two tests:
//!   * `render_golden_axial_matches_committed` — renders a deterministic volume to
//!     an RGBA buffer and compares against a committed golden artifact
//!     (`tests/goldens/render_golden_axial.rgba`). Exact-hash fast path, with a
//!     per-pixel tolerance fallback sized for f16 texture quantization.
//!   * `render_golden_detects_single_voxel_perturbation` — the sensitivity check:
//!     flips a single voxel on the rendered plane and asserts the harness *sees*
//!     the difference. Self-contained (before/after in one process, one adapter),
//!     so it is machine-independent and proves the harness catches regressions.
//!
//! Commands:
//!   Verify:     cargo test -p render_loop --test render_golden_test
//!   Regenerate: UPDATE_RENDER_GOLDEN=1 cargo test -p render_loop --test render_golden_test
//!
//! GPU-bound: if no WGPU adapter is available (e.g. headless CI without a GPU)
//! the tests print a SKIP line and pass rather than failing the suite.

use std::fs;
use std::path::{Path, PathBuf};

use nalgebra::Matrix4;
use render_loop::view_state::{LayerConfig, SliceOrientation, ViewId, ViewState};
use render_loop::{BlendMode, RenderLoopService, SliceFeatureUbo};
use volmath::{DenseVolume3, NeuroSpaceExt};

const VOLUME_ID: &str = "golden-volume";
const VIEWPORT: [u32; 2] = [128, 128];
const VOLUME_DIMS: [usize; 3] = [32, 32, 16];

/// Voxel on the rendered axial plane, used by the sensitivity test. With an
/// identity affine and world center `[16, 16, 8]`, the axial slice samples voxel
/// plane z = 8, and (16, 16) is the in-plane center.
const PERTURB_VOXEL: [usize; 3] = [16, 16, 8];

// --- Tolerance for the golden comparison ------------------------------------
// The render currently uploads as R32Float, so on a single machine the buffer is
// bit-identical run to run and the FNV fast path matches exactly. These
// tolerances exist for when the perf work moves the upload to f16 (R16Float):
// f16 has a 10-bit mantissa, so over a [0,1] intensity window mapped through the
// colormap LUT to 8-bit output the per-channel drift is at most a few LSB. A real
// regression (wrong slice/axis/colormap/data) changes most pixels by tens-to-
// hundreds, far outside these bounds. Conservative and tunable.
const TOL_PER_CHANNEL: u8 = 1; // a pixel differing by more than this counts as "changed"
const GOLDEN_MAX_DIFF: u8 = 6; // no single channel may differ by more than this
const GOLDEN_MAX_CHANGED_FRAC: f64 = 0.05; // at most 5% of pixels may differ at all

fn goldens_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("goldens")
}

fn golden_rgba_path(stem: &str) -> PathBuf {
    goldens_dir().join(format!("{stem}.rgba"))
}

fn golden_png_path(stem: &str) -> PathBuf {
    goldens_dir().join(format!("{stem}.png"))
}

/// Deterministic test volume: a smooth tri-linear gradient in [0,1] (so f16
/// quantization shows up as small per-pixel diffs the tolerance must absorb) with
/// a high-intensity centered box (structure that catches geometric/colormap
/// regressions). `perturb` overrides a single voxel for the sensitivity test.
fn make_test_volume(perturb: Option<([usize; 3], f32)>) -> DenseVolume3<f32> {
    let dims = VOLUME_DIMS;
    let space = <volmath::NeuroSpace as NeuroSpaceExt>::from_affine_matrix4(
        dims.to_vec(),
        Matrix4::identity(),
    )
    .expect("failed to create test neurospace");

    let mut data = Vec::with_capacity(dims[0] * dims[1] * dims[2]);
    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                let xn = x as f32 / (dims[0] - 1) as f32;
                let yn = y as f32 / (dims[1] - 1) as f32;
                let zn = z as f32 / (dims[2] - 1) as f32;
                let mut v = 0.10 + 0.50 * xn + 0.30 * yn + 0.10 * zn;
                if (10..22).contains(&x) && (10..22).contains(&y) && (5..11).contains(&z) {
                    v = 0.90;
                }
                data.push(v);
            }
        }
    }

    if let Some(([px, py, pz], val)) = perturb {
        let idx = pz * dims[0] * dims[1] + py * dims[0] + px;
        data[idx] = val;
    }

    DenseVolume3::<f32>::from_data(space, data)
}

/// The pinned view. Every field that affects output pixels is fixed here so the
/// render is fully deterministic: axial orientation, fixed center/fov, single
/// scalar layer, colormap 0, full [0,1] window, no crosshair.
fn golden_view_state() -> ViewState {
    let layer = LayerConfig::new(VOLUME_ID.to_string())
        .with_opacity(1.0)
        .with_colormap(0)
        .with_blend_mode(BlendMode::Normal)
        .with_intensity_window(0.0, 1.0);

    ViewState::from_basic_params(
        VOLUME_ID.to_string(),
        [16.0, 16.0, 8.0],
        SliceOrientation::Axial,
        32.0,
        VIEWPORT,
        (0.0, 1.0),
    )
    .with_layers(vec![layer])
    .with_crosshair(false)
}

/// Mirrors the authoritative headless flow (see `slice_outline_render_test`):
/// new -> load_shaders -> enable_world_space_rendering -> register_volume_with_upload
/// -> initialize_colormap -> create_world_space_bind_groups -> request_frame.
///
/// Returns `None` (with a SKIP line) when no GPU adapter is available so the
/// suite stays green in headless CI; the flow is GPU-bound by nature.
///
/// `format` is the GPU texture format the volume is uploaded as. `R16Float` is
/// what the real app upload path (`upload_volume_3d_labelaware`) selects by
/// default for non-U8 volumes; `R32Float` is the exact/reference path.
async fn render_volume(
    volume: &DenseVolume3<f32>,
    format: wgpu::TextureFormat,
) -> Option<(Vec<u8>, [u32; 2])> {
    let mut service = match RenderLoopService::new().await {
        Ok(service) => service,
        Err(err) => {
            eprintln!("SKIP render_golden_test: WGPU adapter unavailable ({err}). GPU-bound test.");
            return None;
        }
    };

    service.load_shaders().expect("failed to load shaders");
    service
        .enable_world_space_rendering()
        .expect("failed to enable world-space rendering");
    service
        .register_volume_with_upload(VOLUME_ID.to_string(), volume, format)
        .expect("failed to register/upload volume");
    service
        .initialize_colormap()
        .expect("failed to initialize colormap");
    service
        .create_world_space_bind_groups()
        .expect("failed to create world-space bind groups");
    service.update_slice_feature_ubo(SliceFeatureUbo::default());

    let result = service
        .request_frame(ViewId::new("render-golden"), golden_view_state())
        .await
        .expect("failed to render frame");

    Some((result.image_data, result.dimensions))
}

/// 64-bit FNV-1a over the RGBA buffer. Cheap exact-identity check; no crate dep.
fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for &b in bytes {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

struct DiffReport {
    max_diff: u8,
    changed_pixels: usize,
    total_pixels: usize,
}

impl DiffReport {
    fn changed_frac(&self) -> f64 {
        self.changed_pixels as f64 / self.total_pixels.max(1) as f64
    }
}

/// Per-pixel RGBA comparison: a pixel "changes" when its largest per-channel
/// absolute difference exceeds `tol`.
fn compare_rgba(a: &[u8], b: &[u8], tol: u8) -> DiffReport {
    let n = a.len().min(b.len());
    let mut max_diff = 0u8;
    let mut changed = 0usize;
    let mut total = 0usize;
    for px in a[..n].chunks_exact(4).zip(b[..n].chunks_exact(4)) {
        total += 1;
        let pixel_max = (0..4).map(|c| px.0[c].abs_diff(px.1[c])).max().unwrap_or(0);
        if pixel_max > max_diff {
            max_diff = pixel_max;
        }
        if pixel_max > tol {
            changed += 1;
        }
    }
    DiffReport {
        max_diff,
        changed_pixels: changed,
        total_pixels: total,
    }
}

fn write_golden(image: &[u8], dims: [u32; 2], stem: &str) {
    fs::create_dir_all(goldens_dir()).expect("failed to create goldens dir");
    fs::write(golden_rgba_path(stem), image).expect("failed to write golden .rgba");
    // Companion PNG for human inspection (not used by the comparison).
    if let Some(buf) =
        image::ImageBuffer::<image::Rgba<u8>, _>::from_raw(dims[0], dims[1], image.to_vec())
    {
        let _ = buf.save(golden_png_path(stem));
    }
    eprintln!(
        "render_golden: wrote {} ({}x{}, fnv {:016x})",
        golden_rgba_path(stem).display(),
        dims[0],
        dims[1],
        fnv1a(image)
    );
}

/// Renders the pinned volume+view at `format` and compares against the committed
/// golden named `stem`. Shared by the R32Float (exact reference) and R16Float
/// (app-default, f16-tolerant) cases.
async fn run_golden_compare(format: wgpu::TextureFormat, stem: &str) {
    let volume = make_test_volume(None);
    let (image, dims) = match render_volume(&volume, format).await {
        Some(out) => out,
        None => return, // GPU unavailable; skip line already printed.
    };

    assert_eq!(
        dims, VIEWPORT,
        "render dimensions must match the pinned viewport"
    );
    assert_eq!(
        image.len(),
        (dims[0] * dims[1] * 4) as usize,
        "image_data must be raw RGBA (4 bytes/pixel)"
    );

    let update = std::env::var_os("UPDATE_RENDER_GOLDEN").is_some();
    let golden_path = golden_rgba_path(stem);

    if update {
        write_golden(&image, dims, stem);
        return;
    }

    if !golden_path.exists() {
        // First run with no committed baseline: capture it and pass loudly.
        // CI runs against the committed artifact, so this only happens locally.
        write_golden(&image, dims, stem);
        eprintln!(
            "render_golden: no committed baseline for '{stem}'; captured one. \
             Commit tests/goldens/ and re-run to verify."
        );
        return;
    }

    let golden = fs::read(&golden_path).expect("failed to read committed golden");
    let hash = fnv1a(&image);
    let golden_hash = fnv1a(&golden);

    // Exact-match fast path (bit-stable per machine for a given format).
    if hash == golden_hash {
        return;
    }

    assert_eq!(
        image.len(),
        golden.len(),
        "golden '{stem}' size mismatch (rendered {} vs golden {} bytes) — regenerate \
         with UPDATE_RENDER_GOLDEN=1 if the view or volume intentionally changed",
        image.len(),
        golden.len(),
    );

    let diff = compare_rgba(&image, &golden, TOL_PER_CHANNEL);
    assert!(
        diff.max_diff <= GOLDEN_MAX_DIFF && diff.changed_frac() <= GOLDEN_MAX_CHANGED_FRAC,
        "render '{stem}' differs from golden beyond f16 tolerance: max_diff={} (limit {}), \
         changed={}/{} pixels = {:.3}% (limit {:.1}%). fnv {:016x} vs golden {:016x}. \
         If this is an intended visual change, regenerate with UPDATE_RENDER_GOLDEN=1.",
        diff.max_diff,
        GOLDEN_MAX_DIFF,
        diff.changed_pixels,
        diff.total_pixels,
        100.0 * diff.changed_frac(),
        100.0 * GOLDEN_MAX_CHANGED_FRAC,
        hash,
        golden_hash,
    );
}

/// Exact/reference path: R32Float upload, bit-stable, exact-hash match.
#[tokio::test]
async fn render_golden_axial_matches_committed() {
    run_golden_compare(wgpu::TextureFormat::R32Float, "render_golden_axial").await;
}

/// App-default path: R16Float upload (what `upload_volume_3d_labelaware` selects
/// for non-U8 volumes). This is the format the native-dtype perf work renders
/// through, so the f16 tolerance is sized for exactly this case.
#[tokio::test]
async fn render_golden_axial_r16f_matches_committed() {
    run_golden_compare(wgpu::TextureFormat::R16Float, "render_golden_axial_r16f").await;
}

#[tokio::test]
async fn render_golden_detects_single_voxel_perturbation() {
    // Baseline value at PERTURB_VOXEL is the box intensity (0.90); flip it to 0.0
    // so the change is unambiguous on the rendered plane.
    let baseline = make_test_volume(None);
    let perturbed = make_test_volume(Some((PERTURB_VOXEL, 0.0)));

    // Use the app-default R16Float path so the sensitivity guarantee covers the
    // format the perf work actually renders through.
    let fmt = wgpu::TextureFormat::R16Float;
    let baseline_img = match render_volume(&baseline, fmt).await {
        Some(out) => out.0,
        None => return, // GPU unavailable; skip line already printed.
    };
    // First render succeeded, so the adapter is present; a failure here is real.
    let perturbed_img = render_volume(&perturbed, fmt)
        .await
        .expect("second render failed after the first succeeded")
        .0;

    let diff = compare_rgba(&baseline_img, &perturbed_img, TOL_PER_CHANNEL);

    // The harness must SEE a 1-voxel perturbation — this is the whole point.
    assert!(
        diff.changed_pixels > 0,
        "sensitivity check failed: a single-voxel perturbation produced an identical \
         frame (max_diff={}). The harness cannot catch regressions.",
        diff.max_diff
    );

    // ...and the change must be localized, proving sensitivity to a *small* edit
    // rather than a coincidental global shift.
    assert!(
        diff.changed_frac() < 0.25,
        "a single-voxel perturbation changed {:.1}% of pixels; expected a localized \
         change, so the harness or view geometry may be off",
        100.0 * diff.changed_frac()
    );

    eprintln!(
        "render_golden sensitivity: 1-voxel perturbation changed {} px (max_diff={})",
        diff.changed_pixels, diff.max_diff
    );
}
