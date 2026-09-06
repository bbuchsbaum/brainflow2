//! CPU source ownership for population sampling. All disk I/O, decoding and
//! sampling run on a blocking worker, serialized per cache. Entries have bounded
//! decoded payload bytes, observable file stamps and a digest of the exact private
//! snapshot decoded. No borrowed volume escapes the sampling closure.
use bridge_types::{BridgeError, BridgeResult, VolumeSendable};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{File, Metadata, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::SystemTime,
};

const DEFAULT_BYTES: usize = 512 * 1024 * 1024;
const MAX_SOURCE_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
struct FileStamp {
    length: u64,
    modified: SystemTime,
    #[cfg(unix)]
    identity: (u64, u64, i64, i64),
}
impl FileStamp {
    fn read(metadata: Metadata) -> BridgeResult<Self> {
        if !metadata.is_file() {
            return Err(input("Population sources must be regular files."));
        }
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;
        Ok(Self {
            length: metadata.len(),
            modified: metadata.modified()?,
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

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleSourceRevision {
    pub sha256: String,
    pub source_bytes: u64,
}

struct Entry {
    stamp: FileStamp,
    revision: SampleSourceRevision,
    volume: VolumeSendable,
    bytes: usize,
    used: u64,
}
struct CacheState {
    entries: HashMap<PathBuf, Entry>,
    resident_bytes: usize,
    clock: u64,
    budget: usize,
}
#[derive(Clone)]
pub struct SetSampleCache {
    inner: Arc<Mutex<CacheState>>,
    admission: Arc<tokio::sync::Semaphore>,
}
impl Default for SetSampleCache {
    fn default() -> Self {
        let bytes = std::env::var("BRAINFLOW_SET_SAMPLE_CACHE_BYTES")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(DEFAULT_BYTES);
        Self::new(bytes)
    }
}
impl SetSampleCache {
    pub fn new(budget: usize) -> Self {
        Self {
            admission: Arc::new(tokio::sync::Semaphore::new(1)),
            inner: Arc::new(Mutex::new(CacheState {
                entries: HashMap::new(),
                resident_bytes: 0,
                clock: 0,
                budget,
            })),
        }
    }

    /// A cache hit revalidates filesystem identity/length/modification metadata
    /// (also inode and change time on Unix). The digest identifies snapshot bytes;
    /// metadata equality is a freshness shortcut, not an adversarial file monitor.
    pub async fn with_volume<T: Send + 'static>(
        &self,
        path: PathBuf,
        sample: impl FnOnce(&VolumeSendable, &SampleSourceRevision) -> BridgeResult<T> + Send + 'static,
    ) -> BridgeResult<T> {
        let inner = Arc::clone(&self.inner);
        let permit = Arc::clone(&self.admission)
            .acquire_owned()
            .await
            .map_err(|_| input("Population source admission is closed."))?;
        tokio::task::spawn_blocking(move || {
            let _permit = permit; // Cancellation cannot release an in-flight decode's admission.
            let mut cache = inner.lock().map_err(|_| input("Population source cache is unavailable."))?;
            let path = path.canonicalize()?;
            let stamp = FileStamp::read(path.metadata()?)?;
            cache.clock = cache.clock.wrapping_add(1);
            let used = cache.clock;
            if let Some(entry) = cache.entries.get_mut(&path) {
                if entry.stamp == stamp {
                    entry.used = used;
                    return sample(&entry.volume, &entry.revision);
                }
            }
            cache.remove(&path);
            let snapshot = Snapshot::copy(&path, &stamp)?;
            let header = neuroim::io::read_header(&snapshot.path)
                .map_err(|error| input(format!("Cannot read population source header: {error}")))?;
            // Conservative f64 payload admission before decode. Decoder scratch
            // and process overhead are separate from resident payload accounting.
            let bound = header.dim.iter().try_fold(8usize, |bytes, &dim| bytes.checked_mul(dim))
                .ok_or_else(|| input("Population volume dimensions overflow the decode budget."))?;
            let max_decode = cache.budget.max(DEFAULT_BYTES);
            if bound > max_decode {
                return Err(input(format!("Population volume requires up to {bound} decoded bytes; limit is {max_decode}.")));
            }
            let admission = bound.min(cache.budget);
            cache.make_room(admission);
            let volume = nifti_loader::load_nifti_auto_dimension(&snapshot.path)
                .map_err(|error| input(format!("Cannot decode population source: {error}")))?;
            let revision = snapshot.revision.clone();
            let bytes = payload_bytes(&volume)?;
            if bytes <= cache.budget {
                cache.make_room(bytes);
                cache.resident_bytes += bytes;
                cache.entries.insert(path.clone(), Entry { stamp, revision, volume, bytes, used });
                let entry = &cache.entries[&path];
                sample(&entry.volume, &entry.revision)
            } else {
                sample(&volume, &revision)
            }
        }).await.map_err(|error| input(format!("Population sampling worker failed: {error}")))?
    }

    pub async fn clear(&self) -> BridgeResult<()> {
        let inner = Arc::clone(&self.inner);
        let permit = Arc::clone(&self.admission)
            .acquire_owned()
            .await
            .map_err(|_| input("Population source admission is closed."))?;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let mut cache = inner
                .lock()
                .map_err(|_| input("Population source cache is unavailable."))?;
            cache.entries.clear();
            cache.resident_bytes = 0;
            Ok(())
        })
        .await
        .map_err(|error| input(format!("Population cache cleanup failed: {error}")))?
    }
}
impl CacheState {
    fn remove(&mut self, path: &Path) {
        if let Some(entry) = self.entries.remove(path) {
            self.resident_bytes -= entry.bytes;
        }
    }
    fn make_room(&mut self, bytes: usize) {
        while self.resident_bytes > self.budget.saturating_sub(bytes) {
            let Some(path) = self
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.used)
                .map(|(path, _)| path.clone())
            else {
                break;
            };
            self.remove(&path);
        }
    }
}
fn input(details: impl Into<String>) -> BridgeError {
    BridgeError::Input {
        code: 2025,
        details: details.into(),
    }
}
fn payload_bytes(volume: &VolumeSendable) -> BridgeResult<usize> {
    let width = match volume {
        VolumeSendable::VolF64(..) | VolumeSendable::Vec4DF64(..) => 8,
        VolumeSendable::VolF32(..)
        | VolumeSendable::Vec4DF32(..)
        | VolumeSendable::VolI32(..)
        | VolumeSendable::Vec4DI32(..)
        | VolumeSendable::VolU32(..)
        | VolumeSendable::Vec4DU32(..) => 4,
        VolumeSendable::VolI16(..)
        | VolumeSendable::Vec4DI16(..)
        | VolumeSendable::VolU16(..)
        | VolumeSendable::Vec4DU16(..) => 2,
        _ => 1,
    };
    crate::get_spatial_dims_from_volume(volume)
        .iter()
        .try_fold(
            width * crate::stack_length_for_volume(volume),
            |bytes, &dim| bytes.checked_mul(dim),
        )
        .ok_or_else(|| input("Population payload size overflow."))
}

struct Snapshot {
    path: PathBuf,
    revision: SampleSourceRevision,
}
impl Drop for Snapshot {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}
impl Snapshot {
    fn copy(path: &Path, expected: &FileStamp) -> BridgeResult<Self> {
        let name = path.to_string_lossy();
        let suffix = if name.ends_with(".nii.gz") {
            ".nii.gz"
        } else if name.ends_with(".nii") {
            ".nii"
        } else {
            return Err(input(
                "Population sampling requires a single-file .nii or .nii.gz source.",
            ));
        };
        if expected.length > MAX_SOURCE_BYTES {
            return Err(input("Population source exceeds the 2 GiB snapshot limit."));
        }
        let snapshot_path = std::env::temp_dir().join(format!(
            "brainflow-population-{}{suffix}",
            uuid::Uuid::new_v4()
        ));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let output = options.open(&snapshot_path)?;
        let mut snapshot = Self {
            path: snapshot_path,
            revision: SampleSourceRevision {
                sha256: String::new(),
                source_bytes: 0,
            },
        };
        let mut output = output; // Drop the open writer before the snapshot guard on every exit.
        let mut source = File::open(path)?;
        if FileStamp::read(source.metadata()?)? != *expected {
            return Err(input("Population source changed before snapshot."));
        }
        let mut hash = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let count = source.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            snapshot.revision.source_bytes += count as u64;
            if snapshot.revision.source_bytes > MAX_SOURCE_BYTES {
                return Err(input("Population source grew beyond the snapshot limit."));
            }
            hash.update(&buffer[..count]);
            output.write_all(&buffer[..count])?;
        }
        if FileStamp::read(source.metadata()?)? != *expected
            || FileStamp::read(path.metadata()?)? != *expected
        {
            return Err(input(
                "Population source changed during snapshot; retry the query.",
            ));
        }
        output.flush()?;
        snapshot.revision.sha256 = format!("{:x}", hash.finalize());
        Ok(snapshot)
    }
}

#[cfg(test)]
pub(crate) struct TestSource {
    pub path: PathBuf,
}
#[cfg(test)]
impl Drop for TestSource {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}
#[cfg(test)]
impl TestSource {
    pub fn new(dims: &[usize], values: &[f32]) -> Self {
        let source = Self {
            path: std::env::temp_dir().join(format!(
                "brainflow-source-test-{}.nii",
                uuid::Uuid::new_v4()
            )),
        };
        source.write(dims, values);
        source
    }
    pub fn write(&self, dims: &[usize], values: &[f32]) {
        assert_eq!(dims.iter().product::<usize>(), values.len());
        // Minimal independent single-file NIfTI-1 fixture, x-fastest samples,
        // identity sform, float32. Tests exercise the real loader and cache.
        let mut bytes = vec![0u8; 352];
        bytes[0..4].copy_from_slice(&348i32.to_le_bytes());
        bytes[40..42].copy_from_slice(&(dims.len() as i16).to_le_bytes());
        for (i, &dim) in dims.iter().enumerate() {
            bytes[42 + i * 2..44 + i * 2].copy_from_slice(&(dim as i16).to_le_bytes());
        }
        bytes[70..72].copy_from_slice(&16i16.to_le_bytes());
        bytes[72..74].copy_from_slice(&32i16.to_le_bytes());
        for i in 0..8 {
            bytes[76 + i * 4..80 + i * 4].copy_from_slice(&1f32.to_le_bytes());
        }
        bytes[108..112].copy_from_slice(&352f32.to_le_bytes());
        bytes[112..116].copy_from_slice(&1f32.to_le_bytes());
        bytes[123] = 10; // mm + seconds
        bytes[254..256].copy_from_slice(&1i16.to_le_bytes());
        for offset in [280, 300, 320] {
            bytes[offset..offset + 4].copy_from_slice(&1f32.to_le_bytes());
        }
        bytes[344..348].copy_from_slice(b"n+1\0");
        for value in values {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        std::fs::write(&self.path, bytes).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn sample(cache: &SetSampleCache, source: &TestSource) -> (f32, String) {
        cache
            .with_volume(source.path.clone(), |volume, revision| {
                Ok((
                    crate::read_stack_at_voxel(volume, 0, 0, 0).unwrap()[0],
                    revision.sha256.clone(),
                ))
            })
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn set_source_cache_refreshes_replaced_bytes_and_hashes_decoded_snapshot() {
        let source = TestSource::new(&[2, 2, 2], &[2.0; 8]);
        let cache = SetSampleCache::new(1024);
        let (value, first_hash) = sample(&cache, &source).await;
        assert_eq!(value, 2.0);
        assert_eq!(
            first_hash,
            format!("{:x}", Sha256::digest(std::fs::read(&source.path).unwrap()))
        );
        source.write(&[2, 2, 2], &[9.0; 8]);
        let (value, second_hash) = sample(&cache, &source).await;
        assert_eq!(value, 9.0);
        assert_ne!(first_hash, second_hash);
        assert_eq!(sample(&cache, &source).await.1, second_hash);
        assert_eq!(cache.inner.lock().unwrap().entries.len(), 1);
    }

    #[tokio::test]
    async fn set_source_cache_evicts_and_clears_owned_payload() {
        let a = TestSource::new(&[2, 2, 2], &[1.0; 8]);
        let b = TestSource::new(&[2, 2, 2], &[2.0; 8]);
        let cache = SetSampleCache::new(32);
        for source in [&a, &b, &a, &b] {
            sample(&cache, source).await;
            let state = cache.inner.lock().unwrap();
            assert!(state.resident_bytes <= 32);
            assert_eq!(state.entries.len(), 1);
        }
        cache.clear().await.unwrap();
        assert_eq!(cache.inner.lock().unwrap().resident_bytes, 0);
        assert!(cache.inner.lock().unwrap().entries.is_empty());
        let uncached = SetSampleCache::new(0);
        assert_eq!(sample(&uncached, &a).await.0, 1.0);
        assert!(uncached.inner.lock().unwrap().entries.is_empty());
    }

    #[tokio::test]
    async fn set_source_cache_coalesces_concurrent_reads_and_preserves_4d() {
        let source = TestSource::new(&[1, 1, 1, 3], &[4.0, 7.0, 11.0]);
        let cache = SetSampleCache::new(1024);
        let (a, b) = tokio::join!(sample(&cache, &source), sample(&cache, &source));
        assert_eq!(a, b);
        let state = cache.inner.lock().unwrap();
        assert_eq!(state.entries.len(), 1);
        let entry = state.entries.values().next().unwrap();
        assert_eq!(entry.bytes, 12);
        assert_eq!(
            crate::read_stack_at_voxel(&entry.volume, 0, 0, 0).unwrap(),
            vec![4.0, 7.0, 11.0]
        );
    }

    #[tokio::test]
    async fn set_source_cache_never_serves_deleted_source_as_current() {
        let source = TestSource::new(&[1, 1, 1], &[4.0]);
        let cache = SetSampleCache::new(1024);
        sample(&cache, &source).await;
        std::fs::remove_file(&source.path).unwrap();
        assert!(cache
            .with_volume(source.path.clone(), |_, _| Ok(()))
            .await
            .is_err());
    }

    #[tokio::test]
    async fn set_source_cache_cancelled_caller_retains_decode_admission() {
        let source = TestSource::new(&[1, 1, 1], &[4.0]);
        let cache = SetSampleCache::new(1024);
        let worker_cache = cache.clone();
        let path = source.path.clone();
        let (entered, ready) = tokio::sync::oneshot::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let task = tokio::spawn(async move {
            worker_cache
                .with_volume(path, move |_, _| {
                    entered.send(()).unwrap();
                    wait.recv().unwrap();
                    Ok(())
                })
                .await
        });
        ready.await.unwrap();
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        assert_eq!(cache.admission.available_permits(), 0);
        release.send(()).unwrap();
        cache.clear().await.unwrap();
        assert_eq!(cache.admission.available_permits(), 1);
        assert_eq!(cache.inner.lock().unwrap().resident_bytes, 0);
    }
}
