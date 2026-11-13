//! Compare inputs: one decode per member per request, decoded in parallel and
//! reduced in a fixed member order, with the member-set moments cached by
//! source revision so paging the active member recomputes only its own maps.
//!
//! Determinism: workers decode out of order, but the consumer pushes volumes
//! into the accumulator strictly in input order (a reorder buffer), so every
//! floating-point reduction runs in the same sequence as the serial code did.
use super::validate_grid_affines;
use crate::population::CompactMoments;
use std::collections::BTreeMap;
#[cfg(test)]
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::UNIX_EPOCH;

/// A decoded 3D volume as Compare needs it: x-fastest f32 values, the grid
/// dimensions and the column-major homogeneous voxel-to-world affine.
#[derive(Debug, Clone)]
pub struct DecodedVolume {
    pub values: Arc<Vec<f32>>,
    pub dims: Vec<usize>,
    pub affine: Vec<f32>,
}

impl DecodedVolume {
    /// `None` for anything but a 3D volume (Compare refuses multi-frame inputs
    /// through the loader, which reports the reason).
    pub fn from_volume(volume: &bridge_types::VolumeSendable) -> Option<Self> {
        use bridge_types::VolumeSendable as V;
        let affine = match volume {
            V::VolF32(_, a)
            | V::VolI16(_, a)
            | V::VolU8(_, a)
            | V::VolI8(_, a)
            | V::VolU16(_, a)
            | V::VolI32(_, a)
            | V::VolU32(_, a)
            | V::VolF64(_, a) => a.to_homogeneous().as_slice().to_vec(),
            _ => return None,
        };
        let (values, dims) = super::extract_volume_values(volume).ok()?;
        Some(Self {
            values: Arc::new(values),
            dims,
            affine,
        })
    }
}

/// Already-decoded volumes the host can lend (the bridge's population source
/// cache). A source must return only a volume decoded from the file's current
/// bytes; returning `None` makes Compare decode the file itself.
pub trait DecodedVolumeSource: Sync {
    fn decoded(&self, path: &Path) -> Option<DecodedVolume>;
}

pub struct NoDecodedVolumes;
impl DecodedVolumeSource for NoDecodedVolumes {
    fn decoded(&self, _path: &Path) -> Option<DecodedVolume> {
        None
    }
}

#[cfg(test)]
pub(super) static LOADER_CALLS: Mutex<Option<HashMap<String, usize>>> = Mutex::new(None);

/// Loader calls per path in this process (tests count re-reads with it).
#[cfg(test)]
pub(super) fn loader_calls(path: &str) -> usize {
    LOADER_CALLS
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|calls| calls.get(path).copied())
        .unwrap_or(0)
}

pub(super) fn decode_volume(
    path: &str,
    source: &dyn DecodedVolumeSource,
) -> Result<DecodedVolume, String> {
    if let Some(decoded) = source.decoded(Path::new(path)) {
        return Ok(decoded);
    }
    #[cfg(test)]
    {
        let mut calls = LOADER_CALLS.lock().unwrap();
        *calls
            .get_or_insert_with(HashMap::new)
            .entry(path.to_string())
            .or_default() += 1;
    }
    let (volume, affine) = nifti_loader::load_nifti_volume_auto(Path::new(path))
        .map_err(|error| format!("Failed to load {}: {}", path, error))?;
    let (values, dims) =
        super::extract_volume_values(&volume).map_err(|error| format!("{} ({})", error, path))?;
    Ok(DecodedVolume {
        values: Arc::new(values),
        dims,
        affine: affine.to_homogeneous().as_slice().to_vec(),
    })
}

pub(super) const CANCELLED: &str = "Compare materialization was cancelled.";

pub(super) fn check_cancel(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        Err(CANCELLED.to_string())
    } else {
        Ok(())
    }
}

/// Process-wide cap on concurrent Compare decodes, shared by every request
/// and job, so overlapping requests cannot multiply the decode pool.
const MAX_PROCESS_DECODES: usize = 6;
static DECODE_SLOTS: (Mutex<usize>, Condvar) = (Mutex::new(0), Condvar::new());

struct DecodeSlot;
impl DecodeSlot {
    fn acquire() -> Self {
        let mut busy = DECODE_SLOTS.0.lock().unwrap_or_else(|p| p.into_inner());
        while *busy >= MAX_PROCESS_DECODES {
            busy = DECODE_SLOTS.1.wait(busy).unwrap_or_else(|p| p.into_inner());
        }
        *busy += 1;
        Self
    }
}
impl Drop for DecodeSlot {
    fn drop(&mut self) {
        *DECODE_SLOTS.0.lock().unwrap_or_else(|p| p.into_inner()) -= 1;
        DECODE_SLOTS.1.notify_one();
    }
}

/// A decode that panics (a malformed file the loader does not reject cleanly)
/// becomes this member's error instead of leaving the consumer waiting.
fn decode_caught(path: &str, source: &dyn DecodedVolumeSource) -> Result<DecodedVolume, String> {
    let _slot = DecodeSlot::acquire();
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| decode_volume(path, source)))
        .unwrap_or_else(|panic| {
            let reason = panic
                .downcast_ref::<&str>()
                .map(|s| s.to_string())
                .or_else(|| panic.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "decoder panicked".to_string());
            Err(format!("Failed to load {}: {}", path, reason))
        })
}

/// Decode workers: bounded by the machine and by a small constant, since each
/// in-flight decode holds a full volume plus decoder scratch.
fn worker_count(paths: usize) -> usize {
    std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(1)
        .min(6)
        .min(paths)
        .max(1)
}

struct OrderedState {
    next_claim: usize,
    next_consume: usize,
    ready: BTreeMap<usize, Result<DecodedVolume, String>>,
    stop: bool,
}

/// Decode `paths` with a bounded pool and hand each volume to `consume` in
/// input order. At most `2 * workers` decoded volumes wait at any time. The
/// first error in input order is returned, as a serial loop would return it.
/// `cancel` is checked before every claim and every consume: once set, no
/// further member is decoded and the call returns the cancellation error.
pub(super) fn decode_ordered(
    paths: &[String],
    source: &dyn DecodedVolumeSource,
    cancel: &AtomicBool,
    mut consume: impl FnMut(usize, DecodedVolume) -> Result<(), String>,
) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let workers = worker_count(paths.len());
    let ahead = 2 * workers;
    let shared = (
        Mutex::new(OrderedState {
            next_claim: 0,
            next_consume: 0,
            ready: BTreeMap::new(),
            stop: false,
        }),
        Condvar::new(),
    );
    struct StopOnExit<'a>(&'a (Mutex<OrderedState>, Condvar));
    impl Drop for StopOnExit<'_> {
        fn drop(&mut self) {
            if let Ok(mut state) = self.0 .0.lock() {
                state.stop = true;
            }
            self.0 .1.notify_all();
        }
    }
    std::thread::scope(|scope| {
        for _ in 0..workers {
            let shared = &shared;
            scope.spawn(move || loop {
                let index = {
                    let mut state = shared.0.lock().unwrap();
                    while !state.stop
                        && state.next_claim < paths.len()
                        && state.next_claim >= state.next_consume + ahead
                    {
                        state = shared.1.wait(state).unwrap();
                    }
                    if state.stop
                        || state.next_claim >= paths.len()
                        || cancel.load(Ordering::Relaxed)
                    {
                        return;
                    }
                    state.next_claim += 1;
                    state.next_claim - 1
                };
                let decoded = decode_caught(&paths[index], source);
                let mut state = shared.0.lock().unwrap();
                state.ready.insert(index, decoded);
                drop(state);
                shared.1.notify_all();
            });
        }
        let _stop = StopOnExit(&shared);
        for index in 0..paths.len() {
            check_cancel(cancel)?;
            let decoded = {
                let mut state = shared.0.lock().unwrap();
                loop {
                    if let Some(decoded) = state.ready.remove(&index) {
                        state.next_consume = index + 1;
                        break decoded;
                    }
                    // Workers stop claiming once cancelled; poll so an
                    // unclaimed index cannot leave this wait unanswered.
                    if cancel.load(Ordering::Relaxed) && state.next_claim <= index {
                        return Err(CANCELLED.to_string());
                    }
                    state = shared
                        .1
                        .wait_timeout(state, std::time::Duration::from_millis(25))
                        .unwrap()
                        .0;
                }
            };
            shared.1.notify_all();
            consume(index, decoded?)?;
        }
        Ok(())
    })
}

/// Builds the dimension-mismatch message: (path, actual dims, expected dims).
pub(super) type DimsError = dyn Fn(&str, &[usize], &[usize]) -> String;

/// Observable identity of one source file's bytes. Equality is the freshness
/// rule for the in-process moments cache (stronger than the manifest stamps:
/// nanosecond times plus inode and change time on Unix). Limitation: off Unix,
/// and on network filesystems that report coarse or synthetic times and inode
/// numbers (SMB, some NFS), a same-length rewrite within the timestamp
/// resolution keeps the old revision; the Compare manifests have the same rule.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct SourceRevision {
    path: String,
    length: u64,
    modified_ns: u128,
    #[cfg(unix)]
    identity: (u64, u64, i64, i64),
}

impl SourceRevision {
    pub(super) fn read(path: &str) -> Option<Self> {
        let metadata = std::fs::metadata(path).ok()?;
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;
        Some(Self {
            path: path.to_string(),
            length: metadata.len(),
            modified_ns: metadata
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_nanos(),
            #[cfg(unix)]
            identity: (
                metadata.dev(),
                metadata.ino(),
                metadata.ctime(),
                metadata.ctime_nsec(),
            ),
        })
    }
}

/// Moments of one ordered member list, plus (within budget) the decoded
/// member values so leave-one-out and per-member maps need no decode.
pub(super) struct MemberSetStats {
    revisions: Vec<SourceRevision>,
    pub dims: Vec<usize>,
    pub affine: Vec<f32>,
    pub reference_path: String,
    pub moments: CompactMoments,
    values: Option<Vec<Arc<Vec<f32>>>>,
}

impl MemberSetStats {
    /// Decoded values of a member of this set, if retained.
    pub(super) fn member_values(&self, path: &str) -> Option<Arc<Vec<f32>>> {
        let values = self.values.as_ref()?;
        let index = self.revisions.iter().position(|r| r.path == path)?;
        // The cached revision is current only if the file is unchanged now.
        if SourceRevision::read(path).as_ref() != Some(&self.revisions[index]) {
            return None;
        }
        Some(Arc::clone(&values[index]))
    }

    fn bytes(&self) -> usize {
        self.moments.allocated_bytes()
            + self
                .values
                .as_ref()
                .map_or(0, |v| v.iter().map(|x| x.len() * 4).sum())
    }
}

#[cfg(test)]
thread_local! {
    pub(super) static VALUES_BUDGET_OVERRIDE: std::cell::Cell<Option<usize>> =
        const { std::cell::Cell::new(None) };
}

/// Retained member values are a convenience; the moments are the contract.
fn values_budget() -> usize {
    #[cfg(test)]
    if let Some(budget) = VALUES_BUDGET_OVERRIDE.with(|b| b.get()) {
        return budget;
    }
    std::env::var("BRAINFLOW_COMPARE_VALUES_CACHE_BYTES")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(256 * 1024 * 1024)
}
// Tests share one process cache across concurrent test threads.
const MAX_CACHED_SETS: usize = if cfg!(test) { 64 } else { 2 };
const MAX_CACHED_BYTES: usize = 768 * 1024 * 1024;

static STATS_CACHE: Mutex<Vec<Arc<MemberSetStats>>> = Mutex::new(Vec::new());

/// Member-set computations in progress, so concurrent identical requests
/// (rapid paging, a job and a direct call) share one decode pass.
enum Flight {
    Running,
    Done(Result<Arc<MemberSetStats>, String>),
}
type FlightSlot = Arc<(Mutex<Flight>, Condvar)>;
static IN_FLIGHT: Mutex<Vec<(Vec<SourceRevision>, FlightSlot)>> = Mutex::new(Vec::new());

/// Drop every cached member set (workspace teardown). In-flight passes finish
/// and are cached afresh only if still requested.
pub fn clear_compare_cache() {
    if let Ok(mut cache) = STATS_CACHE.lock() {
        cache.clear();
    }
}

/// The moments of `paths` in this order: a cache hit when every member's
/// revision is unchanged, otherwise one parallel decode pass. A pass already
/// running for the same revisions is joined rather than repeated; if it is
/// cancelled, a waiter that is not cancelled runs its own.
pub(super) fn member_set_stats(
    paths: &[String],
    source: &dyn DecodedVolumeSource,
    cancel: &AtomicBool,
    dims_error: &DimsError,
) -> Result<Arc<MemberSetStats>, String> {
    let revisions: Option<Vec<_>> = paths.iter().map(|p| SourceRevision::read(p)).collect();
    let Some(key) = revisions.clone() else {
        return compute_member_set_stats(paths, source, cancel, dims_error, None);
    };
    loop {
        check_cancel(cancel)?;
        {
            let mut cache = STATS_CACHE.lock().map_err(|_| "Compare cache poisoned.")?;
            if let Some(position) = cache.iter().position(|s| s.revisions == key) {
                let hit = cache.remove(position);
                cache.insert(0, Arc::clone(&hit));
                return Ok(hit);
            }
        }
        let (slot, leader) = {
            let mut flights = IN_FLIGHT.lock().map_err(|_| "Compare cache poisoned.")?;
            match flights.iter().find(|(k, _)| *k == key) {
                Some((_, slot)) => (Arc::clone(slot), false),
                None => {
                    let slot: FlightSlot = Arc::new((Mutex::new(Flight::Running), Condvar::new()));
                    flights.push((key.clone(), Arc::clone(&slot)));
                    (slot, true)
                }
            }
        };
        if leader {
            struct Land<'a>(&'a FlightSlot, &'a [SourceRevision]);
            impl Drop for Land<'_> {
                fn drop(&mut self) {
                    if let Ok(mut flights) = IN_FLIGHT.lock() {
                        flights.retain(|(k, s)| !(k == self.1 && Arc::ptr_eq(s, self.0)));
                    }
                    if let Ok(mut flight) = self.0 .0.lock() {
                        if matches!(*flight, Flight::Running) {
                            // Leader unwound or was cancelled: waiters retry.
                            *flight = Flight::Done(Err(CANCELLED.to_string()));
                        }
                    }
                    self.0 .1.notify_all();
                }
            }
            let _land = Land(&slot, &key);
            let result =
                compute_member_set_stats(paths, source, cancel, dims_error, revisions.clone());
            *slot.0.lock().map_err(|_| "Compare cache poisoned.")? = Flight::Done(result.clone());
            return result;
        }
        let mut flight = slot.0.lock().map_err(|_| "Compare cache poisoned.")?;
        loop {
            match &*flight {
                Flight::Done(Err(error)) if error == CANCELLED => break,
                Flight::Done(result) => return result.clone(),
                Flight::Running => {
                    check_cancel(cancel)?;
                    flight = slot
                        .1
                        .wait_timeout(flight, std::time::Duration::from_millis(25))
                        .map_err(|_| "Compare cache poisoned.")?
                        .0;
                }
            }
        }
    }
}

fn compute_member_set_stats(
    paths: &[String],
    source: &dyn DecodedVolumeSource,
    cancel: &AtomicBool,
    dims_error: &DimsError,
    revisions: Option<Vec<SourceRevision>>,
) -> Result<Arc<MemberSetStats>, String> {
    let started = std::time::Instant::now();
    let budget = values_budget();
    let mut moments: Option<CompactMoments> = None;
    let mut dims: Option<Vec<usize>> = None;
    let mut affine: Option<Vec<f32>> = None;
    let mut values: Option<Vec<Arc<Vec<f32>>>> = Some(Vec::new());
    decode_ordered(paths, source, cancel, |index, decoded| {
        let path = &paths[index];
        validate_grid_affines(
            affine.as_deref().unwrap_or(&decoded.affine),
            &decoded.affine,
        )
        .map_err(|error| format!("{} ({})", error, path))?;
        match &dims {
            Some(expected) if expected != &decoded.dims => {
                return Err(dims_error(path, &decoded.dims, expected));
            }
            None => {
                dims = Some(decoded.dims.clone());
                affine = Some(decoded.affine.clone());
                moments = Some(CompactMoments::new(decoded.values.len()));
                if paths.len() * decoded.values.len() * 4 > budget {
                    values = None;
                }
            }
            _ => {}
        }
        moments
            .as_mut()
            .expect("initialized with the first member")
            .push(&decoded.values)
            .map_err(|error| error.to_string())?;
        if let Some(values) = values.as_mut() {
            values.push(decoded.values);
        }
        Ok(())
    })?;
    let stats = Arc::new(MemberSetStats {
        revisions: revisions.clone().unwrap_or_default(),
        dims: dims.ok_or("Missing dimensions for the member set.")?,
        affine: affine.ok_or("Missing world affine for the member set.")?,
        reference_path: paths[0].clone(),
        moments: moments.ok_or("Member set accumulation never initialized.")?,
        values,
    });
    log::info!(
        "[perf] compare member-set moments: {} members, {} ms (decode + reduce, {} workers)",
        paths.len(),
        started.elapsed().as_millis(),
        worker_count(paths.len()),
    );
    // Cache only if every revision was observable and still is after decode.
    let after: Option<Vec<_>> = paths.iter().map(|p| SourceRevision::read(p)).collect();
    if revisions.is_some() && after == revisions && stats.bytes() <= MAX_CACHED_BYTES {
        let mut cache = STATS_CACHE.lock().map_err(|_| "Compare cache poisoned.")?;
        cache.insert(0, Arc::clone(&stats));
        cache.truncate(MAX_CACHED_SETS);
        while cache.iter().map(|s| s.bytes()).sum::<usize>() > MAX_CACHED_BYTES {
            cache.pop();
        }
    }
    Ok(stats)
}

/// Cached moments of exactly this ordered list, if every source is unchanged.
pub(super) fn cached_stats(paths: &[String]) -> Option<Arc<MemberSetStats>> {
    let revisions: Vec<_> = paths
        .iter()
        .map(|p| SourceRevision::read(p))
        .collect::<Option<_>>()?;
    let cache = STATS_CACHE.lock().ok()?;
    cache.iter().find(|s| s.revisions == revisions).cloned()
}

/// A member volume retained by any cached member set, if its source is unchanged.
/// The set's validated grid stands in for the member's own header grid.
pub(super) fn retained_member(path: &str) -> Option<DecodedVolume> {
    let cache = STATS_CACHE.lock().ok()?;
    cache.iter().find_map(|set| {
        set.member_values(path).map(|values| DecodedVolume {
            values,
            dims: set.dims.clone(),
            affine: set.affine.clone(),
        })
    })
}

/// Every listed member's retained volume, in order, or `None` if any is missing.
pub(super) fn retained_set(paths: &[String]) -> Option<Vec<DecodedVolume>> {
    paths.iter().map(|path| retained_member(path)).collect()
}
