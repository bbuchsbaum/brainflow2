//! Releasing a layer's GPU residency.

use crate::*;

pub(crate) async fn release_layer_gpu_resources_internal(
    layer_id: String,
    bridge_state: &BridgeState,
) -> BridgeResult<ReleaseResult> {
    release_layer_gpu_resources_with(layer_id, bridge_state, false).await
}

/// Release a layer's GPU resources. When the release frees a slot, the
/// layers frames left out because their allocation failed may fit now, so
/// their skip marks are cleared (N32) — unless `for_upload`: the UI evicts to
/// make room for an upload it requests next, and a frame must not hand that
/// slot to a starved layer first. The upload's completion clears the marks
/// then (see `request_layer_gpu_resources_with_upload_hook`).
pub(crate) async fn release_layer_gpu_resources_with(
    layer_id: String,
    bridge_state: &BridgeState,
    for_upload: bool,
) -> BridgeResult<ReleaseResult> {
    let result = release_layer_gpu_resources_locked(layer_id.clone(), bridge_state).await;
    // The layer's own mark goes either way: its residency changed.
    bridge_state
        .render_skipped_layers
        .lock()
        .await
        .remove(&layer_id);
    if matches!(&result, Ok(ReleaseResult { freed: true, .. })) && !for_upload {
        clear_allocation_failed_skips(bridge_state, None).await;
    }
    result
}

async fn release_layer_gpu_resources_locked(
    layer_id: String,
    bridge_state: &BridgeState,
) -> BridgeResult<ReleaseResult> {
    let _operation = bridge_state.volume_operations.lock().await;
    release_layer_gpu_resources_held(layer_id, bridge_state).await
}

/// [`release_layer_gpu_resources_locked`] for a caller that already holds
/// `volume_operations`.
pub(crate) async fn release_layer_gpu_resources_held(
    layer_id: String,
    bridge_state: &BridgeState,
) -> BridgeResult<ReleaseResult> {
    info!(
        "Bridge: release_layer_gpu_resources called for layer {}",
        layer_id
    );

    // Prefer the RAII-managed lease path when available.
    if let Some(lease) = {
        let mut leases = bridge_state.layer_leases.lock().await;
        leases.remove(&layer_id)
    } {
        let service_guard = bridge_state.render_loop_service.lock().await;
        let service_arc =
            service_guard
                .as_ref()
                .ok_or_else(|| BridgeError::ServiceNotInitialized {
                    code: 5008,
                    details:
                        "GPU rendering service is not initialized. Cannot release GPU resources."
                            .to_string(),
                })?;
        let mut render_loop_service = service_arc.lock().await;

        match lease
            .release_with_service(&mut render_loop_service, "manual")
            .await?
        {
            Some(outcome) => {
                return Ok(ReleaseResult {
                    success: true,
                    message: format!(
                        "Released GPU resources for layer {} (atlas layer {})",
                        layer_id, outcome.atlas_index
                    ),
                    freed: true,
                });
            }
            None => {
                return Ok(ReleaseResult {
                    success: true,
                    message: format!(
                        "Layer {} was already released; no GPU resources were active",
                        layer_id
                    ),
                    freed: false,
                });
            }
        }
    }

    // Look up the atlas layer index for this UI layer
    let atlas_layer_idx = {
        let layer_map = bridge_state.layer_to_atlas_map.lock().await;
        match layer_map.get(&layer_id) {
            Some(&idx) => idx,
            None => {
                return Ok(ReleaseResult {
                    success: false,
                    message: format!("Layer {} not found in GPU resources", layer_id),
                    freed: false,
                });
            }
        }
    };

    // Get the render loop service
    let service_guard = bridge_state.render_loop_service.lock().await;
    let service_arc = service_guard
        .as_ref()
        .ok_or_else(|| BridgeError::ServiceNotInitialized {
            code: 5008,
            details: "GPU rendering service is not initialized. Cannot release GPU resources."
                .to_string(),
        })?;
    let mut render_loop_service = service_arc.lock().await;

    // A mapping without a lease names a bare index. If another layer's lease
    // or ring owns the residency there now, the index was refilled: only this
    // layer's bookkeeping goes, never that layer's texture.
    let owned_elsewhere = match render_loop_service.slot_handle(atlas_layer_idx) {
        Some(current) => {
            let by_ring = bridge_state
                .resident_image_sets
                .lock()
                .await
                .iter()
                .any(|(id, ring)| *id != layer_id && ring.owns(current));
            let by_lease = bridge_state
                .layer_leases
                .lock()
                .await
                .iter()
                .any(|(id, lease)| *id != layer_id && lease.slot() == current);
            by_ring || by_lease
        }
        None => false,
    };

    // Reclaim the layer's GPU-resident image-set ring (its extra resident members
    // hold multi-texture slots not tracked by the lease) before the atlas teardown.
    release_resident_image_set(&layer_id, bridge_state, &mut render_loop_service).await;

    // Release the atlas layer
    let removed_from_render_state = if owned_elsewhere {
        warn!(
            "Layer '{}' maps to atlas index {}, which another layer owns now; leaving its texture",
            layer_id, atlas_layer_idx
        );
        false
    } else {
        render_loop_service
            .release_layer_resources(atlas_layer_idx)
            .map_err(|e| BridgeError::GpuError {
                code: 5080,
                details: format!(
                    "Failed to remove layer {} from render state: {:?}",
                    layer_id, e
                ),
            })?
    };

    // Uploads add no render-state entry; only a layer the last frame drew has one.
    if !removed_from_render_state {
        debug!(
            "Release requested for layer '{}' but no render-state entry matched atlas index {}",
            layer_id, atlas_layer_idx
        );
    }

    // Remove from our tracking map
    {
        let mut layer_map = bridge_state.layer_to_atlas_map.lock().await;
        layer_map.remove(&layer_id);
    }
    {
        let mut volume_map = bridge_state.layer_to_volume_map.lock().await;
        volume_map.remove(&layer_id);
    }
    {
        let mut timepoint_map = bridge_state.layer_to_timepoint_map.lock().await;
        timepoint_map.remove(&layer_id);
    }
    {
        let mut lease_map = bridge_state.layer_leases.lock().await;
        lease_map.remove(&layer_id);
    }

    info!(
        "Released GPU resources for layer {} (atlas layer {})",
        layer_id, atlas_layer_idx
    );

    Ok(ReleaseResult {
        success: true,
        message: if removed_from_render_state {
            format!(
                "Released GPU resources and render state for layer {} (atlas layer {})",
                layer_id, atlas_layer_idx
            )
        } else {
            format!(
                "Released GPU resources for layer {} (atlas layer {}); the last frame did not draw it",
                layer_id, atlas_layer_idx
            )
        },
        freed: true,
    })
}
