//! Compare materialization: reference equivalence, load counting and a
//! synthetic 35-member timing run.
use super::*;
use std::sync::Mutex;

/// Tests that count decodes or clear the process cache run one at a time.
static CACHE_TESTS: Mutex<()> = Mutex::new(());
fn cache_test_guard() -> std::sync::MutexGuard<'static, ()> {
    CACHE_TESTS.lock().unwrap_or_else(|p| p.into_inner())
}
use bridge_types::{StudioReducerKind, StudioReducerSpec, StudioRoleBindingInput};
use nifti::NiftiHeader;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

pub(super) struct TempSet {
    pub dir: PathBuf,
    pub paths: Vec<String>,
    pub label: String,
}

impl Drop for TempSet {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn unique(label: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{label}-{}-{nanos}", std::process::id())
}

pub(super) fn write_volume(path: &Path, dims: [usize; 3], data: &[f32]) {
    let header = NiftiHeader {
        dim: [
            3,
            dims[0] as u16,
            dims[1] as u16,
            dims[2] as u16,
            1,
            1,
            1,
            1,
        ],
        datatype: 16,
        bitpix: 32,
        sform_code: 1,
        qform_code: 0,
        srow_x: [2.0, 0.0, 0.0, -90.0],
        srow_y: [0.0, 2.0, 0.0, -126.0],
        srow_z: [0.0, 0.0, 2.0, -72.0],
        ..NiftiHeader::default()
    };
    let array =
        ndarray::Array3::from_shape_vec((dims[0], dims[1], dims[2]).f(), data.to_vec()).unwrap();
    WriterOptions::new(path)
        .reference_header(&header)
        .write_nifti(&array)
        .unwrap();
}

pub(super) fn temp_set(label: &str, dims: [usize; 3], members: &[Vec<f32>]) -> TempSet {
    let label = unique(label);
    let dir = std::env::temp_dir().join(format!("field-table-{label}"));
    fs::create_dir_all(&dir).unwrap();
    let paths = members
        .iter()
        .enumerate()
        .map(|(index, data)| {
            let path = dir.join(format!("sub-{index:03}_stat.nii.gz"));
            write_volume(&path, dims, data);
            path.to_string_lossy().into_owned()
        })
        .collect();
    TempSet { dir, paths, label }
}

fn member_id(index: usize) -> String {
    format!("sub-{index:03}")
}

/// The request the Set studio sends: cohort of every member, the selected
/// role's SD and leave-one-out mean as reducers.
pub(super) fn ui_request(set: &TempSet, active: usize) -> StudioCompareMaterializeRequest {
    let bindings = set
        .paths
        .iter()
        .enumerate()
        .map(|(index, path)| StudioRoleBindingInput {
            member_id: member_id(index),
            role: "stat".to_string(),
            feature_id: Some("stat".to_string()),
            source_path: Some(path.clone()),
            support_kind: StudioSupportKind::Volume,
            support_label: Some(set.label.clone()),
            availability: StudioFieldBindingAvailability::Available,
        })
        .collect::<Vec<_>>();
    StudioCompareMaterializeRequest {
        support_label: set.label.clone(),
        compare_ready: true,
        force_rematerialize: false,
        active_member_id: Some(member_id(active)),
        active_member_source_path: Some(set.paths[active].clone()),
        cohort_member_source_paths: set.paths.clone(),
        compare_cohort_id: Some("all-members".to_string()),
        compare_cohort_label: Some("All members".to_string()),
        compare_cohort_member_count: Some(set.paths.len()),
        active_expression_label: Some("Z vs all".to_string()),
        active_expression_recipe: Some("zscore(current, cohort:all-members)".to_string()),
        reducer_specs: Some(vec![
            StudioReducerSpec {
                id: "sd-stat".to_string(),
                label: "stat SD".to_string(),
                kind: StudioReducerKind::Sd,
                role: "stat".to_string(),
                cohort_id: Some("all-members".to_string()),
                excluded_member_id: None,
            },
            StudioReducerSpec {
                id: "loo-mean-stat".to_string(),
                label: "stat leave-one-out mean".to_string(),
                kind: StudioReducerKind::LeaveOneOutMean,
                role: "stat".to_string(),
                cohort_id: Some("all-members".to_string()),
                excluded_member_id: Some(member_id(active)),
            },
        ]),
        active_member_role_bindings: Some(vec![bindings[active].clone()]),
        cohort_member_role_bindings: Some(bindings),
    }
}

pub(super) fn remove_outputs(panes: &[StudioComparePaneSpec]) {
    for pane in panes {
        let Some(binding) = &pane.binding else {
            continue;
        };
        if binding.kind != StudioCompareBindingKind::DerivedField {
            continue;
        }
        for path in [&binding.source_path, &binding.provenance_path]
            .into_iter()
            .flatten()
        {
            let _ = fs::remove_file(path);
        }
    }
}

fn xorshift(state: &mut u64) -> f32 {
    *state ^= *state << 13;
    *state ^= *state >> 7;
    *state ^= *state << 17;
    ((*state >> 40) as f32 / (1u64 << 24) as f32) * 2.0 - 1.0
}

/// 35 gzipped 91x109x91 float maps, zero outside an ellipsoid, as a real
/// 2 mm MNI statistic set is. Prints wall time for a cold Compare and for
/// paging to the next member.
#[test]
#[ignore = "timing run; cargo test -p field_table --release compare_real_size_timing -- --ignored --nocapture"]
fn compare_real_size_timing() {
    let dims = [91usize, 109, 91];
    let count = dims.iter().product::<usize>();
    let mut state = 0x9e3779b97f4a7c15u64;
    let members = (0..35)
        .map(|_| {
            let mut data = vec![0.0f32; count];
            for z in 0..dims[2] {
                for y in 0..dims[1] {
                    for x in 0..dims[0] {
                        let r = ((x as f32 - 45.0) / 36.0).powi(2)
                            + ((y as f32 - 54.0) / 44.0).powi(2)
                            + ((z as f32 - 45.0) / 36.0).powi(2);
                        if r < 1.0 {
                            data[x + dims[0] * (y + dims[1] * z)] = xorshift(&mut state);
                        }
                    }
                }
            }
            data
        })
        .collect::<Vec<_>>();
    let set = temp_set("compare-timing", dims, &members);
    let bytes = fs::metadata(&set.paths[0]).unwrap().len();
    drop(members);

    let started = Instant::now();
    let cold = materialize_compare_panes(ui_request(&set, 0));
    let cold_ms = started.elapsed().as_millis();
    let started = Instant::now();
    let paged = materialize_compare_panes(ui_request(&set, 1));
    let page_ms = started.elapsed().as_millis();
    let started = Instant::now();
    let again = materialize_compare_panes(ui_request(&set, 1));
    let hit_ms = started.elapsed().as_millis();
    for panes in [&cold, &paged, &again] {
        for pane in panes.iter() {
            assert_eq!(
                pane.status,
                StudioComparePaneStatus::Live,
                "{}: {}",
                pane.id,
                pane.reason
            );
        }
    }
    println!(
        "compare timing: members=35 dims={dims:?} gz_bytes={bytes} cold_ms={cold_ms} page_ms={page_ms} hit_ms={hit_ms}"
    );
    remove_outputs(&cold);
    remove_outputs(&paged);
}

fn read_values(path: &str) -> Vec<f32> {
    let (volume, _) = nifti_loader::load_nifti_volume_auto(Path::new(path)).unwrap();
    extract_volume_values(&volume).unwrap().0
}

fn pane_output(panes: &[StudioComparePaneSpec], id: &str) -> Vec<f32> {
    let pane = panes.iter().find(|pane| pane.id == id).unwrap();
    assert_eq!(
        pane.status,
        StudioComparePaneStatus::Live,
        "{}: {}",
        pane.id,
        pane.reason
    );
    read_values(pane.binding.as_ref().unwrap().source_path.as_ref().unwrap())
}

fn assert_close(label: &str, actual: &[f32], expected: &[Option<f64>]) {
    assert_eq!(actual.len(), expected.len(), "{label}");
    for (index, (&a, e)) in actual.iter().zip(expected).enumerate() {
        match e {
            None => assert!(a.is_nan(), "{label}[{index}] = {a}, expected unavailable"),
            Some(e) => assert!(
                (f64::from(a) - e).abs() <= 1e-6 * e.abs().max(1.0),
                "{label}[{index}] = {a}, expected {e}"
            ),
        }
    }
}

/// Straightforward two-pass reductions over the finite values at a location.
fn reference_moments(members: &[&Vec<f32>], index: usize) -> (usize, f64, f64) {
    let finite: Vec<f64> = members
        .iter()
        .map(|m| f64::from(m[index]))
        .filter(|v| v.is_finite())
        .collect();
    let n = finite.len();
    let mean = finite.iter().sum::<f64>() / n.max(1) as f64;
    let ss = finite.iter().map(|v| (v - mean).powi(2)).sum::<f64>();
    (n, mean, ss)
}

/// Five members on a 3x2x2 grid with NaN, infinity, measured zeros and a
/// location with a single finite value.
fn small_members() -> Vec<Vec<f32>> {
    let nan = f32::NAN;
    vec![
        vec![1.0, 0.0, nan, 2.0, -1.0, 0.0, 5.0, nan, 3.0, 0.25, 7.0, 0.0],
        vec![3.0, 0.0, nan, 2.0, 1.0, 0.0, nan, nan, -3.0, 0.5, 7.0, 0.0],
        vec![
            5.0,
            0.0,
            nan,
            2.0,
            f32::INFINITY,
            0.0,
            nan,
            1.0,
            6.0,
            0.75,
            7.0,
            0.0,
        ],
        vec![7.0, 0.0, nan, 2.0, 2.0, 4.0, nan, nan, 0.0, 1.0, 7.0, 0.0],
        vec![9.0, 0.0, nan, 2.0, 3.0, 0.0, nan, nan, 1.5, 1.25, 7.0, 0.0],
    ]
}

#[test]
#[allow(clippy::needless_range_loop)] // index addresses five parallel references
fn compare_maps_match_reference_reductions_with_nans_and_zeros() {
    let members = small_members();
    let set = temp_set("compare-reference", [3, 2, 2], &members);
    for active in [0usize, 2, 4] {
        let panes = materialize_compare_panes(ui_request(&set, active));
        let all: Vec<&Vec<f32>> = members.iter().collect();
        let others: Vec<&Vec<f32>> = members
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != active)
            .map(|(_, m)| m)
            .collect();
        let member = &members[active];
        let mut mean = Vec::new();
        let mut sd = Vec::new();
        let mut residual = Vec::new();
        let mut zscore = Vec::new();
        let mut loo = Vec::new();
        for index in 0..member.len() {
            let (n, m, ss) = reference_moments(&all, index);
            let mean_here = (n > 0).then_some(m);
            mean.push(mean_here);
            sd.push((n > 1).then(|| (ss / (n - 1) as f64).sqrt()));
            residual.push(member[index] - mean_here.map_or(f32::NAN, |m| m as f32));
            let pop_sd = (ss / n as f64).sqrt();
            zscore.push(
                (n > 0 && member[index].is_finite() && pop_sd > 0.0)
                    .then(|| (f64::from(member[index]) - m) / pop_sd),
            );
            let (n, m, _) = reference_moments(&others, index);
            loo.push((n > 0).then_some(m));
        }
        assert_close("cohort-mean", &pane_output(&panes, "cohort-mean"), &mean);
        assert_close("sd-stat", &pane_output(&panes, "sd-stat"), &sd);
        // Member minus the stored f32 mean, including +inf members.
        let actual = pane_output(&panes, "residual");
        for (a, e) in actual.iter().zip(&residual) {
            assert!(
                a.to_bits() == e.to_bits() || (a.is_nan() && e.is_nan()),
                "{a} vs {e}"
            );
        }
        assert_close("zscore", &pane_output(&panes, "zscore"), &zscore);
        assert_close("loo-mean-stat", &pane_output(&panes, "loo-mean-stat"), &loo);
        // Bit-equal to the serial reducers Compare used before.
        let sorted: Vec<Vec<f32>> = members.to_vec();
        assert_eq!(
            pane_output(&panes, "sd-stat")
                .iter()
                .map(|v| v.to_bits())
                .collect::<Vec<_>>(),
            sd_values(&sorted)
                .unwrap()
                .iter()
                .map(|v| v.to_bits())
                .collect::<Vec<_>>()
        );
        let mut old_mean = crate::population::MeanField::new(member.len());
        for values in &members {
            old_mean.push(values).unwrap();
        }
        let old_mean: Vec<u32> = old_mean
            .means()
            .map(|v| summary_to_f32(v).unwrap().to_bits())
            .collect();
        assert_eq!(
            pane_output(&panes, "cohort-mean")
                .iter()
                .map(|v| v.to_bits())
                .collect::<Vec<_>>(),
            old_mean
        );
        let loo_members: Vec<Vec<f32>> = others.iter().map(|m| (*m).clone()).collect();
        assert_eq!(
            pane_output(&panes, "loo-mean-stat")
                .iter()
                .map(|v| v.to_bits())
                .collect::<Vec<_>>(),
            mean_values(&loo_members)
                .unwrap()
                .iter()
                .map(|v| v.to_bits())
                .collect::<Vec<_>>()
        );
        remove_outputs(&panes);
    }
}

#[test]
fn compact_moments_equal_field_moments_bitwise() {
    let members = small_members();
    let mut compact = crate::population::CompactMoments::new(12);
    let mut full = crate::population::FieldMoments::new(12, 0.0).unwrap();
    for values in &members {
        compact.push(values).unwrap();
        full.push(values, None).unwrap();
    }
    for (index, summary) in full.summaries().enumerate() {
        assert_eq!(
            compact.mean(index).map(f64::to_bits),
            summary.mean.map(f64::to_bits)
        );
        assert_eq!(
            compact.sample_sd(index).map(f64::to_bits),
            summary.sample_sd.map(f64::to_bits)
        );
        assert_eq!(
            compact.population_sd(index).map(f64::to_bits),
            summary.population_sd.map(f64::to_bits)
        );
    }
}

/// A cold Compare decodes each member once; paging to another member decodes
/// nothing and does not recompute the member-set moments; a rewritten member
/// invalidates the cached moments.
#[test]
fn paging_the_active_member_reuses_member_set_moments() {
    let _serial = cache_test_guard();
    let members: Vec<Vec<f32>> = (0..6)
        .map(|i| {
            (0..24)
                .map(|j| ((i * 7 + j * 3) % 11) as f32 - 4.0)
                .collect()
        })
        .collect();
    let set = temp_set("compare-paging", [4, 3, 2], &members);
    let loads = |set: &TempSet| -> Vec<usize> {
        set.paths
            .iter()
            .map(|p| compare_inputs::loader_calls(p))
            .collect()
    };
    let cold = materialize_compare_panes(ui_request(&set, 0));
    assert!(cold
        .iter()
        .all(|pane| pane.status == StudioComparePaneStatus::Live));
    assert_eq!(loads(&set), vec![1; 6], "one decode per member when cold");
    let paged = materialize_compare_panes(ui_request(&set, 3));
    assert!(paged
        .iter()
        .all(|pane| pane.status == StudioComparePaneStatus::Live));
    assert_eq!(loads(&set), vec![1; 6], "paging decodes no member again");
    // The z-score for member 3 still matches a direct computation.
    let z = pane_output(&paged, "zscore");
    let all: Vec<&Vec<f32>> = members.iter().collect();
    for (index, &value) in z.iter().enumerate() {
        let (n, m, ss) = reference_moments(&all, index);
        let sd = (ss / n as f64).sqrt();
        let expected = (sd > 0.0).then(|| (f64::from(members[3][index]) - m) / sd);
        assert_close("zscore", &[value], &[expected]);
    }
    // Rewriting a member changes its revision: its moments are recomputed.
    std::thread::sleep(std::time::Duration::from_millis(20));
    let mut changed = members[5].clone();
    changed[0] = 100.0;
    write_volume(Path::new(&set.paths[5]), [4, 3, 2], &changed);
    let refreshed = materialize_compare_panes(ui_request(&set, 3));
    assert_eq!(loads(&set), vec![2; 6], "a changed member re-reads the set");
    let mean = pane_output(&refreshed, "cohort-mean");
    let expected = (members[..5].iter().map(|m| f64::from(m[0])).sum::<f64>() + 100.0) / 6.0;
    assert!((f64::from(mean[0]) - expected).abs() < 1e-5);
    for panes in [&cold, &paged, &refreshed] {
        remove_outputs(panes);
    }
}

struct LentVolumes(Vec<(String, DecodedVolume)>);
impl DecodedVolumeSource for LentVolumes {
    fn decoded(&self, path: &Path) -> Option<DecodedVolume> {
        self.0
            .iter()
            .find(|(p, _)| Path::new(p) == path)
            .map(|(_, v)| v.clone())
    }
}

#[test]
fn lent_host_volumes_replace_decodes() {
    let members = small_members();
    let set = temp_set("compare-lent", [3, 2, 2], &members);
    let lent = LentVolumes(
        set.paths
            .iter()
            .map(|path| {
                let (volume, _) = nifti_loader::load_nifti_volume_auto(Path::new(path)).unwrap();
                (path.clone(), DecodedVolume::from_volume(&volume).unwrap())
            })
            .collect(),
    );
    let lent_panes = materialize_compare_panes_with_source(ui_request(&set, 1), &lent);
    assert!(set
        .paths
        .iter()
        .all(|p| compare_inputs::loader_calls(p) == 0));
    for id in [
        "cohort-mean",
        "residual",
        "zscore",
        "sd-stat",
        "loo-mean-stat",
    ] {
        let lent_values = pane_output(&lent_panes, id);
        assert!(lent_values.len() == 12, "{id}");
    }
    // Same bits as the serial reducer over the decoded files.
    let all: Vec<Vec<f32>> = members.to_vec();
    assert_eq!(
        pane_output(&lent_panes, "sd-stat")
            .iter()
            .map(|v| v.to_bits())
            .collect::<Vec<_>>(),
        sd_values(&all)
            .unwrap()
            .iter()
            .map(|v| v.to_bits())
            .collect::<Vec<_>>()
    );
    remove_outputs(&lent_panes);
}

#[test]
fn ordered_parallel_decode_reports_the_first_failure_in_input_order() {
    let members = small_members();
    let set = temp_set("compare-order", [3, 2, 2], &members);
    let mut paths = set.paths.clone();
    paths.insert(2, set.dir.join("missing-a.nii.gz").to_string_lossy().into());
    paths.push(set.dir.join("missing-b.nii.gz").to_string_lossy().into());
    let mut seen = Vec::new();
    let error = compare_inputs::decode_ordered(
        &paths,
        &NoDecodedVolumes,
        &AtomicBool::new(false),
        |index, _| {
            seen.push(index);
            Ok(())
        },
    )
    .unwrap_err();
    assert_eq!(seen, vec![0, 1]);
    assert!(error.contains("missing-a"), "{error}");
}

/// Runs `f` on a thread and fails (instead of hanging the suite) if it does
/// not finish within `seconds`.
fn within<T: Send + 'static>(seconds: u64, f: impl FnOnce() -> T + Send + 'static) -> T {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(f());
    });
    rx.recv_timeout(Duration::from_secs(seconds))
        .expect("did not finish: a decode worker left the consumer waiting")
}

fn synthetic(len: usize, value: f32) -> DecodedVolume {
    DecodedVolume {
        values: Arc::new(vec![value; len]),
        dims: vec![len, 1, 1],
        affine: vec![
            1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.,
        ],
    }
}

/// Serves synthetic volumes, counting calls; optional per-call delay, a
/// path that panics, and a cancel flag set after `cancel_after` calls.
struct ScriptedSource {
    calls: AtomicUsize,
    per_path: Mutex<HashMap<String, usize>>,
    delay: Duration,
    panic_on: Option<String>,
    cancel_after: Option<(usize, Arc<AtomicBool>)>,
}
impl ScriptedSource {
    fn new(delay: Duration) -> Self {
        Self {
            calls: AtomicUsize::new(0),
            per_path: Mutex::new(HashMap::new()),
            delay,
            panic_on: None,
            cancel_after: None,
        }
    }
}
impl DecodedVolumeSource for ScriptedSource {
    fn decoded(&self, path: &Path) -> Option<DecodedVolume> {
        let path = path.to_string_lossy().into_owned();
        let call = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
        *self
            .per_path
            .lock()
            .unwrap()
            .entry(path.clone())
            .or_default() += 1;
        if let Some((after, cancel)) = &self.cancel_after {
            if call >= *after {
                cancel.store(true, Ordering::SeqCst);
            }
        }
        std::thread::sleep(self.delay);
        if self.panic_on.as_deref() == Some(path.as_str()) {
            panic!("malformed header in {path}");
        }
        Some(synthetic(4, call as f32))
    }
}

#[test]
fn a_panicking_decoder_is_an_error_not_a_hang() {
    let result = within(20, || {
        let paths: Vec<String> = (0..12).map(|i| format!("/virtual/panic-{i}.nii")).collect();
        let mut source = ScriptedSource::new(Duration::from_millis(2));
        source.panic_on = Some(paths[3].clone());
        compare_inputs::decode_ordered(&paths, &source, &AtomicBool::new(false), |_, _| Ok(()))
    });
    let error = result.unwrap_err();
    assert!(
        error.contains("panic-3") && error.contains("malformed header"),
        "{error}"
    );
}

#[test]
fn cancelling_stops_further_decodes() {
    let cancel = Arc::new(AtomicBool::new(false));
    let paths: Vec<String> = (0..60)
        .map(|i| format!("/virtual/cancel-{i}.nii"))
        .collect();
    let mut source = ScriptedSource::new(Duration::from_millis(5));
    source.cancel_after = Some((3, Arc::clone(&cancel)));
    let source = Arc::new(source);
    let (worker_source, worker_cancel) = (Arc::clone(&source), Arc::clone(&cancel));
    let result = within(20, move || {
        compare_inputs::decode_ordered(&paths, &*worker_source, &worker_cancel, |_, _| Ok(()))
    });
    assert_eq!(result.unwrap_err(), compare_inputs::CANCELLED);
    // Only decodes already claimed when the flag flipped may finish.
    let calls = source.calls.load(Ordering::SeqCst);
    assert!(calls <= 3 + 6, "{calls} decodes after cancelling at 3");
    // A request cancelled up front decodes nothing.
    let set = temp_set("compare-cancelled", [3, 2, 2], &small_members());
    let quiet = ScriptedSource::new(Duration::ZERO);
    let panes =
        materialize_compare_panes_cancelable(ui_request(&set, 0), &quiet, &AtomicBool::new(true));
    assert_eq!(quiet.calls.load(Ordering::SeqCst), 0);
    assert!(set
        .paths
        .iter()
        .all(|p| compare_inputs::loader_calls(p) == 0));
    let mean = panes.iter().find(|p| p.id == "cohort-mean").unwrap();
    assert_eq!(mean.status, StudioComparePaneStatus::Blocked);
    assert!(mean.reason.contains("cancelled"), "{}", mean.reason);
}

#[test]
fn concurrent_identical_requests_share_one_decode_pass() {
    let _serial = cache_test_guard();
    let set = temp_set("compare-single-flight", [3, 2, 2], &small_members());
    let source = Arc::new(ScriptedSource::new(Duration::from_millis(40)));
    let paths = Arc::new(set.paths.clone());
    let runs: Vec<_> = (0..3)
        .map(|_| {
            let (source, paths) = (Arc::clone(&source), Arc::clone(&paths));
            std::thread::spawn(move || {
                compare_inputs::member_set_stats(
                    &paths,
                    &*source,
                    &AtomicBool::new(false),
                    &|p, _, _| p.to_string(),
                )
                .unwrap()
            })
        })
        .collect();
    let stats: Vec<_> = runs.into_iter().map(|r| r.join().unwrap()).collect();
    assert!(stats.windows(2).all(|w| Arc::ptr_eq(&w[0], &w[1])));
    let per_path = source.per_path.lock().unwrap();
    assert_eq!(per_path.len(), set.paths.len());
    assert!(per_path.values().all(|&n| n == 1), "{per_path:?}");
    drop(per_path);
    // Teardown drops the cached set.
    assert!(compare_inputs::cached_stats(&set.paths).is_some());
    clear_compare_cache();
    assert!(compare_inputs::cached_stats(&set.paths).is_none());
}

#[test]
fn downdated_leave_one_out_mean_matches_a_fresh_pass() {
    let members = small_members();
    let mut state = 0x2545f4914f6cdd1du64;
    let mut wide: Vec<Vec<f32>> = (0..9)
        .map(|_| (0..64).map(|_| xorshift(&mut state) * 1e3).collect())
        .collect();
    wide[2][5] = f32::NAN;
    wide[4][9] = 0.0;
    for set in [members.clone(), wide] {
        let len = set[0].len();
        let mut full = crate::population::CompactMoments::new(len);
        for m in &set {
            full.push(m).unwrap();
        }
        for out in 0..set.len() {
            let mut rest = crate::population::CompactMoments::new(len);
            for (i, m) in set.iter().enumerate() {
                if i != out {
                    rest.push(m).unwrap();
                }
            }
            for index in 0..len {
                let exact = rest.mean(index);
                let down = full.mean_without(index, set[out][index]);
                match (exact, down) {
                    (None, None) => {}
                    (Some(e), Some(d)) => {
                        let scale = set
                            .iter()
                            .map(|m| f64::from(m[index]).abs())
                            .filter(|v| v.is_finite())
                            .fold(0., f64::max);
                        // Stated tolerance: 1e-12 of the location's largest |value|.
                        assert!((e - d).abs() <= 1e-12 * scale.max(1e-300), "{e} vs {d}");
                    }
                    other => panic!("availability differs: {other:?}"),
                }
            }
        }
    }
}

/// Past the values budget, paging computes the leave-one-out mean from the
/// cached full-set moments: one decode per page (the active member), not n - 1.
#[test]
fn leave_one_out_past_the_values_budget_decodes_only_the_active_member() {
    let _serial = cache_test_guard();
    compare_inputs::VALUES_BUDGET_OVERRIDE.with(|b| b.set(Some(0)));
    let members = small_members();
    let set = temp_set("compare-loo-budget", [3, 2, 2], &members);
    let loads = |set: &TempSet| -> usize {
        set.paths
            .iter()
            .map(|p| compare_inputs::loader_calls(p))
            .sum()
    };
    let cold = materialize_compare_panes(ui_request(&set, 0));
    let after_cold = loads(&set);
    assert_eq!(
        after_cold,
        members.len() + 1,
        "set pass plus the active member"
    );
    let paged = materialize_compare_panes(ui_request(&set, 2));
    assert_eq!(
        loads(&set),
        after_cold + 1,
        "paging decodes only the new active member"
    );
    let others: Vec<&Vec<f32>> = members
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != 2)
        .map(|(_, m)| m)
        .collect();
    let loo = pane_output(&paged, "loo-mean-stat");
    for (index, &value) in loo.iter().enumerate() {
        let (n, m, _) = reference_moments(&others, index);
        assert_close("loo", &[value], &[(n > 0).then_some(m)]);
    }
    compare_inputs::VALUES_BUDGET_OVERRIDE.with(|b| b.set(None));
    remove_outputs(&cold);
    remove_outputs(&paged);
}

/// Z-scores and residuals are bit-equal to the pre-change algorithm
/// (`FieldMoments` summaries; member minus the f32-stored mean).
#[test]
fn zscore_is_bit_equal_to_field_moments_reference() {
    let members = small_members();
    let set = temp_set("compare-zscore-bits", [3, 2, 2], &members);
    let panes = materialize_compare_panes(ui_request(&set, 1));
    let mut moments = crate::population::FieldMoments::new(12, 0.0).unwrap();
    for m in &members {
        moments.push(m, None).unwrap();
    }
    let expected: Vec<u32> = members[1]
        .iter()
        .zip(moments.summaries())
        .map(|(member, summary)| {
            let value = match (summary.mean, summary.population_sd) {
                (Some(mean), Some(sd)) if member.is_finite() && sd > 0.0 => {
                    Some((f64::from(*member) - mean) / sd)
                }
                _ => None,
            };
            summary_to_f32(value).unwrap().to_bits()
        })
        .collect();
    let actual: Vec<u32> = pane_output(&panes, "zscore")
        .iter()
        .map(|v| v.to_bits())
        .collect();
    assert_eq!(actual, expected);
    remove_outputs(&panes);
}
