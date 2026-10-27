//! Owned readback completion. Native polling never runs on the caller's executor;
//! browser WebGPU delivers mapping callbacks through its event loop.
use crate::{FrameResult, RenderLoopError, RenderLoopService, ViewId};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::Instant;

fn error(code: u16, details: impl Into<String>) -> RenderLoopError {
    RenderLoopError::Internal {
        code,
        details: details.into(),
    }
}

/// Error code of an exhausted readback staging budget (too many buffers in
/// flight or too many bytes).
pub(crate) const STAGING_BUDGET_EXHAUSTED: u16 = 8013;

pub(crate) fn is_staging_budget_exhausted(error: &RenderLoopError) -> bool {
    matches!(error, RenderLoopError::Internal { code, .. } if *code == STAGING_BUDGET_EXHAUSTED)
}

/// Opaque mid-grey RGBA frame shown when a readback could not be staged.
pub(crate) fn placeholder_frame(size: [u32; 2]) -> Vec<u8> {
    [128u8, 128, 128, 255].repeat(size[0] as usize * size[1] as usize)
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ReadbackMetrics {
    /// Owned staging allocations, including completed results not yet consumed.
    pub buffers: usize,
    /// Padded staging payload only, not total GPU/process memory.
    pub bytes: u64,
}

#[derive(Clone, Default)]
pub struct ReadbackMonitor(Arc<Mutex<ReadbackMetrics>>);

impl ReadbackMonitor {
    pub fn snapshot(&self) -> ReadbackMetrics {
        *self.0.lock().unwrap_or_else(|p| p.into_inner())
    }
}

#[derive(Default)]
pub(crate) struct ViewEpoch(Arc<AtomicU64>);

impl ViewEpoch {
    pub(crate) fn invalidate(&self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
    pub(crate) fn advance(&self, id: &ViewId) -> ViewStamp {
        self.invalidate();
        self.stamp(id)
    }
    pub(crate) fn stamp(&self, id: &ViewId) -> ViewStamp {
        ViewStamp {
            epoch: Arc::clone(&self.0),
            revision: self.0.load(Ordering::SeqCst),
            id: id.clone(),
        }
    }
}

#[derive(Clone)]
pub(crate) struct ViewStamp {
    epoch: Arc<AtomicU64>,
    revision: u64,
    id: ViewId,
}
impl ViewStamp {
    fn check(&self) -> Result<(), RenderLoopError> {
        if self.epoch.load(Ordering::SeqCst) != self.revision {
            return Err(error(
                8010,
                format!("Frame for view '{}' was superseded or closed", self.id.0),
            ));
        }
        Ok(())
    }
}

#[derive(Clone)]
pub(crate) struct ReadbackDriver {
    device: Arc<wgpu::Device>,
    monitor: ReadbackMonitor,
    #[cfg(all(test, not(target_arch = "wasm32")))]
    gate: Arc<TestPollGate>,
    #[cfg(not(target_arch = "wasm32"))]
    wake: std::sync::mpsc::SyncSender<()>,
}

impl ReadbackDriver {
    pub(crate) fn new(device: Arc<wgpu::Device>) -> Result<Self, RenderLoopError> {
        #[cfg(all(test, not(target_arch = "wasm32")))]
        let gate = Arc::new(TestPollGate::default());
        #[cfg(not(target_arch = "wasm32"))]
        let wake = {
            let (send, receive) = std::sync::mpsc::sync_channel(1);
            let poll_device = Arc::clone(&device);
            #[cfg(test)]
            let poll_gate = Arc::clone(&gate);
            std::thread::Builder::new()
                .name("brainflow-readback".into())
                .spawn(move || {
                    // A one-entry wake queue coalesces requests. Drain queued work
                    // before shutdown; no executor thread blocks and no Drop joins.
                    while receive.recv().is_ok() {
                        #[cfg(test)]
                        poll_gate.wait();
                        poll_device.poll(wgpu::Maintain::Wait);
                    }
                })
                .map_err(|e| error(8014, format!("Cannot start GPU progress worker: {e}")))?;
            send
        };
        Ok(Self {
            device,
            monitor: ReadbackMonitor::default(),
            #[cfg(all(test, not(target_arch = "wasm32")))]
            gate,
            #[cfg(not(target_arch = "wasm32"))]
            wake,
        })
    }

    pub(crate) fn monitor(&self) -> ReadbackMonitor {
        self.monitor.clone()
    }

    pub(crate) fn buffer(
        &self,
        size: u64,
        label: &'static str,
    ) -> Result<Arc<ReadbackBuffer>, RenderLoopError> {
        let mut counts = self.monitor.0.lock().unwrap_or_else(|p| p.into_inner());
        // Bound overlap now that callers can submit while older frames map.
        // A single device-sized buffer remains admissible (e.g. large exports).
        let bytes = counts
            .bytes
            .checked_add(size)
            .ok_or_else(|| error(8013, "Readback byte count overflow"))?;
        if size == 0 || counts.buffers >= 16 || bytes > self.device.limits().max_buffer_size {
            return Err(error(
                STAGING_BUDGET_EXHAUSTED,
                "Readback staging budget is exhausted",
            ));
        }
        let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some(label),
            size,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        counts.buffers += 1;
        counts.bytes = bytes;
        Ok(Arc::new(ReadbackBuffer {
            buffer,
            size,
            mapped: AtomicBool::new(false),
            monitor: self.monitor.clone(),
        }))
    }

    pub(crate) fn map(
        &self,
        buffer: Arc<ReadbackBuffer>,
        regions: Vec<ReadbackRegion>,
        stamps: Vec<ViewStamp>,
    ) -> Result<PendingReadback, RenderLoopError> {
        let (send, receive) = flume::bounded(1);
        let owner = Arc::clone(&buffer);
        buffer
            .buffer
            .slice(..)
            .map_async(wgpu::MapMode::Read, move |result| {
                let result = result
                    .map(|()| {
                        owner.mapped.store(true, Ordering::SeqCst);
                        owner
                    })
                    .map_err(|e| error(8006, format!("GPU buffer mapping failed: {e}")));
                // If the caller disappeared, SendError owns and drops the result,
                // which unmaps/releases the buffer after mapping actually completes.
                let _ = send.send(result);
            });
        #[cfg(not(target_arch = "wasm32"))]
        match self.wake.try_send(()) {
            Ok(()) | Err(std::sync::mpsc::TrySendError::Full(())) => {}
            Err(std::sync::mpsc::TrySendError::Disconnected(())) => {
                return Err(error(8014, "GPU progress worker stopped"))
            }
        }
        Ok(PendingReadback {
            receive,
            regions,
            stamps,
            _driver: self.clone(),
        })
    }
}

pub(crate) struct ReadbackBuffer {
    pub(crate) buffer: wgpu::Buffer,
    size: u64,
    mapped: AtomicBool,
    monitor: ReadbackMonitor,
}

impl Drop for ReadbackBuffer {
    fn drop(&mut self) {
        if self.mapped.load(Ordering::SeqCst) {
            self.buffer.unmap();
        }
        let mut counts = self.monitor.0.lock().unwrap_or_else(|p| p.into_inner());
        counts.buffers -= 1;
        counts.bytes -= self.size;
    }
}

pub(crate) struct ReadbackRegion {
    pub offset: u64,
    pub bytes: u64,
    pub stride: u32,
    pub size: [u32; 2],
}
impl ReadbackRegion {
    pub(crate) fn new(size: [u32; 2], offset: u64, limit: u64) -> Result<Self, RenderLoopError> {
        let invalid = || error(8007, "Invalid or oversized readback dimensions");
        if size.contains(&0) {
            return Err(invalid());
        }
        let stride = size[0]
            .checked_mul(4)
            .ok_or_else(invalid)?
            .div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT)
            .checked_mul(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT)
            .ok_or_else(invalid)?;
        let bytes = u64::from(stride) * u64::from(size[1]);
        if offset.checked_add(bytes).ok_or_else(invalid)? > limit {
            return Err(invalid());
        }
        Ok(Self {
            offset,
            bytes,
            stride,
            size,
        })
    }
}

/// Owns one submitted copy/map operation without borrowing the renderer.
/// Dropping it cancels delivery; the mapping callback retains GPU ownership.
pub struct PendingReadback {
    receive: flume::Receiver<Result<Arc<ReadbackBuffer>, RenderLoopError>>,
    regions: Vec<ReadbackRegion>,
    stamps: Vec<ViewStamp>,
    _driver: ReadbackDriver,
}

impl PendingReadback {
    /// Capture the submitted pixels independently of the target's later reuse.
    /// Hosts using cache-slot IDs for independent requests must validate their
    /// own destination/request identity before displaying these snapshots.
    pub fn into_snapshot(mut self) -> Self {
        self.stamps.clear();
        self
    }

    pub async fn complete(self) -> Result<Vec<Vec<u8>>, RenderLoopError> {
        for stamp in &self.stamps {
            stamp.check()?;
        }
        let owner = self
            .receive
            .recv_async()
            .await
            .map_err(|_| error(8005, "GPU mapping callback disconnected"))??;
        for stamp in &self.stamps {
            stamp.check()?;
        }
        let data = owner.buffer.slice(..).get_mapped_range();
        let images = self
            .regions
            .iter()
            .map(|r| {
                RenderLoopService::unpack_gpu_buffer_to_image(
                    &data[r.offset as usize..(r.offset + r.bytes) as usize],
                    r.size[0],
                    r.size[1],
                    r.stride,
                )
            })
            .collect();
        drop(data);
        for stamp in &self.stamps {
            stamp.check()?;
        }
        Ok(images)
    }
}

/// A rendered frame whose readback can complete after the renderer lock is released.
pub struct FrameSubmission {
    pub(crate) result: FrameResult,
    pub(crate) readback: Option<PendingReadback>,
    pub(crate) stamp: Option<ViewStamp>,
    pub(crate) request_start: Instant,
    pub(crate) readback_start: Instant,
}

impl FrameSubmission {
    /// Keep an immutable request snapshot when the host, rather than the cache
    /// target ID, owns destination validity (e.g. native IPC to multiple panes).
    pub fn into_snapshot(mut self) -> Self {
        self.stamp = None;
        self.readback = self.readback.map(PendingReadback::into_snapshot);
        self
    }

    pub async fn complete(mut self) -> Result<FrameResult, RenderLoopError> {
        if let Some(stamp) = &self.stamp {
            stamp.check()?;
        }
        if let Some(readback) = self.readback.take() {
            self.result.image_data = readback.complete().await?.remove(0);
            self.result.diagnostics.readback_ms =
                self.readback_start.elapsed().as_secs_f32() * 1000.;
        }
        if let Some(stamp) = &self.stamp {
            stamp.check()?;
        }
        self.result.render_time_ms = self.request_start.elapsed().as_secs_f32() * 1000.;
        self.result.diagnostics.total_ms = self.result.render_time_ms;
        Ok(self.result)
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
#[derive(Default)]
struct TestPollGate {
    paused: Mutex<bool>,
    wake: std::sync::Condvar,
}
#[cfg(all(test, not(target_arch = "wasm32")))]
impl TestPollGate {
    fn wait(&self) {
        let mut paused = self.paused.lock().unwrap();
        while *paused {
            paused = self.wake.wait(paused).unwrap();
        }
    }
    fn resume(&self) {
        *self.paused.lock().unwrap() = false;
        self.wake.notify_all();
    }
}
#[cfg(all(test, not(target_arch = "wasm32")))]
#[path = "readback_tests.rs"]
mod tests;
