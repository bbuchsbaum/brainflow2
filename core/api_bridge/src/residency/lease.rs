//! `LayerLease`: the owner of one layer's texture residency.

use crate::*;

#[derive(Debug, Clone)]
pub(crate) struct ReleaseOutcome {
    pub(crate) slot: SlotHandle,
    #[allow(dead_code)]
    render_state_entry_removed: bool,
    /// Whether a texture slot was really freed: the lease's own (it may have
    /// gone already) or one of its ring's.
    pub(crate) freed: bool,
}

pub(crate) struct LayerLease {
    inner: Arc<LayerLeaseInner>,
}

pub(crate) struct LayerLeaseInner {
    layer_id: String,
    /// The residency this lease owns: the layer's upload, or the ring member
    /// it was repointed to. Released through its generation, so a slot freed
    /// elsewhere and refilled by another layer is never released from here.
    slot: std::sync::Mutex<SlotHandle>,
    render_loop_service: Arc<Mutex<Option<Arc<Mutex<RenderLoopService>>>>>,
    layer_slots: Arc<Mutex<LayerSlotMap>>,
    layer_to_volume_map: Arc<Mutex<HashMap<String, String>>>,
    layer_to_timepoint_map: Arc<Mutex<HashMap<String, Option<usize>>>>,
    resident_image_sets: Arc<Mutex<HashMap<String, image_set::ResidentImageSet>>>,
    is_released: AtomicBool,
    created_at: Instant,
}

impl LayerLease {
    pub(crate) fn new(
        layer_id: String,
        slot: SlotHandle,
        render_loop_service: Arc<Mutex<Option<Arc<Mutex<RenderLoopService>>>>>,
        layer_slots: Arc<Mutex<LayerSlotMap>>,
        layer_to_volume_map: Arc<Mutex<HashMap<String, String>>>,
        layer_to_timepoint_map: Arc<Mutex<HashMap<String, Option<usize>>>>,
        resident_image_sets: Arc<Mutex<HashMap<String, image_set::ResidentImageSet>>>,
    ) -> Self {
        Self {
            inner: Arc::new(LayerLeaseInner {
                layer_id,
                slot: std::sync::Mutex::new(slot),
                render_loop_service,
                layer_slots,
                layer_to_volume_map,
                layer_to_timepoint_map,
                resident_image_sets,
                is_released: AtomicBool::new(false),
                created_at: Instant::now(),
            }),
        }
    }

    /// A lease for an allocation the bridge just made for `layer_id`.
    pub(crate) fn for_state(state: &BridgeState, layer_id: String, slot: SlotHandle) -> Self {
        Self::new(
            layer_id,
            slot,
            Arc::clone(&state.render_loop_service),
            Arc::clone(&state.layer_slots),
            Arc::clone(&state.layer_to_volume_map),
            Arc::clone(&state.layer_to_timepoint_map),
            Arc::clone(&state.resident_image_sets),
        )
    }

    pub(crate) fn slot(&self) -> SlotHandle {
        self.inner.slot()
    }

    /// The layer now shows another residency (a resident image-set swap).
    pub(crate) fn repoint(&self, slot: SlotHandle) {
        *self.inner.slot.lock().unwrap_or_else(|e| e.into_inner()) = slot;
    }

    #[allow(dead_code)]
    pub(crate) fn layer_id(&self) -> &str {
        &self.inner.layer_id
    }

    pub(crate) fn is_released(&self) -> bool {
        self.inner.is_released.load(Ordering::SeqCst)
    }

    pub(crate) fn age(&self) -> Duration {
        self.inner.created_at.elapsed()
    }

    /// Model a lease released elsewhere without running its release.
    #[cfg(test)]
    pub(crate) fn mark_released_for_test(&self) {
        self.inner.is_released.store(true, Ordering::SeqCst);
    }

    /// Observe the lease's shared state without keeping it alive.
    #[cfg(test)]
    pub(crate) fn observe_for_test(&self) -> std::sync::Weak<LayerLeaseInner> {
        Arc::downgrade(&self.inner)
    }

    #[cfg(test)]
    pub(crate) async fn prepare_release_for_test(
        &self,
        render_service: &mut RenderLoopService,
    ) -> Option<SlotHandle> {
        self.inner.prepare_release(render_service).await
    }

    #[cfg(test)]
    pub(crate) async fn release_from_service_with_for_test(
        &self,
        render_service: &mut RenderLoopService,
        slot: SlotHandle,
        release_slot: impl FnOnce(
            &mut RenderLoopService,
            SlotHandle,
        ) -> Result<Option<bool>, render_loop::RenderLoopError>,
    ) -> BridgeResult<Option<ReleaseOutcome>> {
        self.inner
            .release_from_service_with(render_service, slot, "test", release_slot)
            .await
    }

    pub(crate) async fn release(
        &self,
        reason: &'static str,
    ) -> BridgeResult<Option<ReleaseOutcome>> {
        self.inner.release(reason).await
    }

    pub(crate) async fn release_with_service(
        &self,
        render_service: &mut RenderLoopService,
        reason: &'static str,
    ) -> BridgeResult<Option<ReleaseOutcome>> {
        self.inner
            .release_with_service(render_service, reason)
            .await
    }
}

impl LayerLeaseInner {
    fn slot(&self) -> SlotHandle {
        *self.slot.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Whether the lease has been released (watchdog snapshots, tests).
    #[cfg(test)]
    pub(crate) fn released(&self) -> bool {
        self.is_released.load(Ordering::SeqCst)
    }

    /// Mark the lease released and drop the layer's bookkeeping if it is this
    /// lease's: the layer maps to this lease's residency, or to one that is
    /// gone (freed, perhaps refilled by another layer whose texture the layer
    /// must not keep drawing). A newer allocation of the same layer releases
    /// the old lease before it maps itself, so it keeps its maps. `None` when
    /// the lease was already released.
    async fn prepare_release(&self, render_service: &mut RenderLoopService) -> Option<SlotHandle> {
        if self.is_released.swap(true, Ordering::SeqCst) {
            return None;
        }
        let slot = self.slot();
        let mut layer_map = self.layer_slots.lock().await;
        if layer_map.is_released_by(&self.layer_id, slot, Some(&*render_service)) {
            layer_map.remove(&self.layer_id);
            drop(layer_map);
            self.layer_to_volume_map.lock().await.remove(&self.layer_id);
            self.layer_to_timepoint_map
                .lock()
                .await
                .remove(&self.layer_id);
        }
        Some(slot)
    }

    async fn release_from_service(
        &self,
        render_service: &mut RenderLoopService,
        slot: SlotHandle,
        reason: &'static str,
    ) -> BridgeResult<Option<ReleaseOutcome>> {
        self.release_from_service_with(render_service, slot, reason, |service, slot| {
            service.release_layer_slot(slot)
        })
        .await
    }

    /// [`Self::release_from_service`] with the slot release supplied (a seam
    /// for tests). The ring is torn down even when the slot release fails:
    /// the lease is already marked released, so nothing would retry it.
    async fn release_from_service_with(
        &self,
        render_service: &mut RenderLoopService,
        slot: SlotHandle,
        reason: &'static str,
        release_slot: impl FnOnce(
            &mut RenderLoopService,
            SlotHandle,
        ) -> Result<Option<bool>, render_loop::RenderLoopError>,
    ) -> BridgeResult<Option<ReleaseOutcome>> {
        // The lease's own residency first, with its render-state entry; then
        // the rest of the layer's ring, if the ring is this residency's.
        let released = release_slot(render_service, slot);
        let ring_freed = release_resident_image_set_allocations(
            &self.layer_id,
            Some(slot),
            &self.resident_image_sets,
            render_service,
        )
        .await;
        let removed_from_render_state = released.map_err(|err| BridgeError::GpuError {
            code: 5080,
            details: format!("Failed to release layer {}: {err}", self.layer_id),
        })?;
        info!(
            "LayerLease({}) released atlas index {} (reason: {}{})",
            self.layer_id,
            slot.index(),
            reason,
            if removed_from_render_state.is_none() {
                "; its slot was already released"
            } else {
                ""
            }
        );

        Ok(Some(ReleaseOutcome {
            slot,
            render_state_entry_removed: removed_from_render_state.unwrap_or(false),
            freed: removed_from_render_state.is_some() || ring_freed > 0,
        }))
    }

    async fn release_with_service(
        &self,
        render_service: &mut RenderLoopService,
        reason: &'static str,
    ) -> BridgeResult<Option<ReleaseOutcome>> {
        let Some(slot) = self.prepare_release(render_service).await else {
            return Ok(None);
        };

        self.release_from_service(render_service, slot, reason)
            .await
    }

    async fn release(&self, reason: &'static str) -> BridgeResult<Option<ReleaseOutcome>> {
        let service_option = {
            let guard = self.render_loop_service.lock().await;
            guard.clone()
        };

        let Some(service_arc) = service_option else {
            // No renderer, so no texture: only the bookkeeping goes.
            if self.is_released.swap(true, Ordering::SeqCst) {
                return Ok(None);
            }
            let mut layer_map = self.layer_slots.lock().await;
            if layer_map.is_released_by(&self.layer_id, self.slot(), None) {
                layer_map.remove(&self.layer_id);
                drop(layer_map);
                self.layer_to_volume_map.lock().await.remove(&self.layer_id);
                self.layer_to_timepoint_map
                    .lock()
                    .await
                    .remove(&self.layer_id);
            }
            return Err(BridgeError::ServiceNotInitialized {
                code: 5008,
                details: format!(
                    "GPU rendering service is not initialized. Cannot release layer {}.",
                    self.layer_id
                ),
            });
        };

        let mut render_service = service_arc.lock().await;
        self.release_with_service(&mut render_service, reason).await
    }
}

impl Drop for LayerLease {
    fn drop(&mut self) {
        if self.inner.is_released.load(Ordering::SeqCst) {
            return;
        }

        let inner = Arc::clone(&self.inner);
        match Handle::try_current() {
            Ok(handle) => {
                handle.spawn(async move {
                    if let Err(err) = inner.release("drop").await {
                        warn!("LayerLease drop release failed: {:?}", err);
                    }
                });
            }
            Err(_) => {
                std::thread::spawn(move || {
                    if let Ok(rt) = tokio::runtime::Runtime::new() {
                        if let Err(err) = rt.block_on(inner.release("drop")) {
                            eprintln!("LayerLease drop release failed (thread): {:?}", err);
                        }
                    }
                });
            }
        }
    }
}

/// Release a lease `layer_id` still holds before a new allocation maps the
/// layer. Never this allocation's residency: it has no lease yet.
pub(crate) async fn release_superseded_lease(
    state: &BridgeState,
    layer_id: &str,
    render_service: &mut RenderLoopService,
) {
    let previous = state.layer_leases.lock().await.remove(layer_id);
    if let Some(previous) = previous {
        if let Err(error) = previous
            .release_with_service(render_service, "superseded")
            .await
        {
            warn!("Could not release the superseded lease of layer '{layer_id}': {error:?}");
        }
    }
}
