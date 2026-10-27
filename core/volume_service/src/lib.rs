//! Volume acquisition, publication and removal, independent of Tauri and GPU APIs.
//!
//! Hosts supply source I/O and registry/resource ownership. A decoded volume stays
//! private until all source metadata is ready and publication is admitted.
use async_trait::async_trait;
use bridge_types::{BridgeError, BridgeResult, VolumeHandleInfo, VolumeSendable};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeMetadataInfo {
    pub name: String,
    pub path: String,
    pub dtype: String,
    pub volume_type: bridge_types::VolumeType,
    pub time_series_info: Option<bridge_types::TimeSeriesInfo>,
}

/// Owns decoded data until a repository publishes it or the operation is dropped.
pub struct PreparedVolume {
    pub data: VolumeSendable,
    pub metadata: VolumeMetadataInfo,
    pub handle: VolumeHandleInfo,
}

/// One load request's publication right. Closing it is synchronous and permanent.
/// A workspace owner can close pending requests when it closes or replaces them.
#[derive(Default)]
pub struct LoadScope {
    closed: Mutex<bool>,
}

impl LoadScope {
    pub fn close(&self) {
        *self.closed.lock().unwrap_or_else(|p| p.into_inner()) = true;
    }

    pub fn check(&self) -> BridgeResult<()> {
        self.commit(|| Ok(()))
    }

    /// Serialize the final synchronous registry insertion with scope closure.
    /// Acquire async host locks first; do not await inside this closure.
    pub fn commit<T>(&self, publish: impl FnOnce() -> BridgeResult<T>) -> BridgeResult<T> {
        let closed = self.closed.lock().unwrap_or_else(|p| p.into_inner());
        if *closed {
            return Err(BridgeError::Input {
                code: 1005,
                details: "Volume load was cancelled or its destination was closed".into(),
            });
        }
        publish()
    }
}

#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
pub trait VolumeSource: Sync {
    /// Return decoded data and all metadata without publishing any resources.
    /// Blocking workers retain ownership until they finish, even if cancelled.
    async fn acquire(&self, scope: &LoadScope) -> BridgeResult<PreparedVolume>;
}

#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
pub trait VolumeRepository: Sync {
    /// Acquire host locks, then call scope.commit for the final insertion.
    /// There must be no await or fallible work after successful publication.
    async fn publish(
        &self,
        volume: PreparedVolume,
        scope: &LoadScope,
    ) -> BridgeResult<VolumeHandleInfo>;
    /// Remove a volume and dependent resources, or leave it intact on failure.
    /// Hosts may refuse removal while active layers still reference the volume.
    async fn remove(&self, volume_id: &str) -> BridgeResult<()>;
}

pub struct VolumeLoadingService;

impl VolumeLoadingService {
    pub async fn load(
        source: &impl VolumeSource,
        repository: &impl VolumeRepository,
        scope: &LoadScope,
    ) -> BridgeResult<VolumeHandleInfo> {
        let mut pending = PendingLoad {
            scope,
            complete: false,
        };
        scope.check()?;
        let volume = source.acquire(scope).await?;
        scope.check()?;
        let handle = repository.publish(volume, scope).await?;
        pending.complete = true;
        Ok(handle)
    }

    pub async fn unload(repository: &impl VolumeRepository, volume_id: &str) -> BridgeResult<()> {
        repository.remove(volume_id).await
    }
}

struct PendingLoad<'a> {
    scope: &'a LoadScope,
    complete: bool,
}

impl Drop for PendingLoad<'_> {
    fn drop(&mut self) {
        if !self.complete {
            self.scope.close();
        }
    }
}

#[cfg(test)]
mod tests;
