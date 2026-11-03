//! Bookkeeping for visible layers a frame left out (`render_skipped_layers`).

use crate::*;

/// Why a frame left a visible layer out (see `render_skipped_layers`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RenderSkip {
    /// The frame already held the render state's layer cap.
    OverCap,
    /// Its GPU resources could not be allocated; not retried until the
    /// layer is requested or released again.
    AllocationFailed,
}

/// Note that a frame left `layer_id` out: a warning the first time, a debug
/// line while it stays out for the same reason.
pub(crate) async fn note_render_skip(
    bridge_state: &BridgeState,
    layer_id: &str,
    reason: RenderSkip,
    detail: &str,
) {
    let mut skipped = bridge_state.render_skipped_layers.lock().await;
    if skipped.insert(layer_id.to_string(), reason) == Some(reason) {
        debug!("Layer {} still skipped: {}", layer_id, detail);
    } else {
        warn!("Layer {} skipped: {}", layer_id, detail);
    }
}

/// Forget every `AllocationFailed` skip mark (and any mark for `layer_id`) so
/// the next frame retries those layers. Called whenever texture slots are
/// freed: a mark that only the released layer cleared left other views black
/// after the pressure was gone (N32).
pub(crate) async fn clear_allocation_failed_skips(
    bridge_state: &BridgeState,
    layer_id: Option<&str>,
) {
    let mut skipped = bridge_state.render_skipped_layers.lock().await;
    if let Some(layer_id) = layer_id {
        skipped.remove(layer_id);
    }
    skipped.retain(|_, reason| *reason != RenderSkip::AllocationFailed);
}
