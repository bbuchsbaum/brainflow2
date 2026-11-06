//! Residency demand: what each frame (a view tab, a Studio pane, a segmentation
//! view) needs drawn, as the UI declares it. R5a of
//! `docs/plans/gpu-residency-r5-plan-2026-11.md`. Pure data; nothing here talks
//! to the GPU, and the UI never names slots or bindings.

use std::collections::HashMap;

/// Milliseconds on whichever clock the caller uses (the fake clock in tests).
pub(crate) type Millis = u64;

/// A frame that declares demand: one view tab, Studio pane or segmentation view.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub(crate) struct FrameId(pub String);

impl FrameId {
    pub(crate) fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }
}

/// A frame's demand revision. The publisher bumps it for every message it sends
/// for that frame, so a set or clear carrying an older epoch is stale.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) struct Epoch(pub u64);

/// Front frames are on screen; Background frames are behind the front tab.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Priority {
    Front,
    Background,
}

/// Why a layer must stay resident whatever its frame's priority.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum PinReason {
    StudioPane,
    SegmentationSession,
    EditableDocument,
}

/// One visible layer of a frame, as the renderer would draw it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DemandedLayer {
    pub layer_id: String,
    pub volume_id: String,
    pub pin: Option<PinReason>,
}

impl DemandedLayer {
    pub(crate) fn new(layer_id: impl Into<String>, volume_id: impl Into<String>) -> Self {
        Self {
            layer_id: layer_id.into(),
            volume_id: volume_id.into(),
            pin: None,
        }
    }

    pub(crate) fn pinned(mut self, reason: PinReason) -> Self {
        self.pin = Some(reason);
        self
    }
}

/// A frame's whole demand. `layers` are its visible layers in stack order,
/// bottom first, the order `prepare_frontend_layers_for_render` draws them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FrameDemand {
    pub epoch: Epoch,
    pub priority: Priority,
    pub layers: Vec<DemandedLayer>,
    /// When the frame was last in front; for a Front frame, now.
    pub last_front_at: Millis,
}

/// Whether a ledger update took effect.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LedgerOutcome {
    Applied,
    Stale,
}

#[derive(Debug, Default)]
struct FrameEntry {
    /// The newest epoch seen for the frame, kept after a clear so an older set
    /// that arrives late cannot bring the demand back.
    epoch: Option<Epoch>,
    demand: Option<FrameDemand>,
}

/// Every frame's current demand. Each frame's epochs must strictly increase.
#[derive(Debug, Default)]
pub(crate) struct DemandLedger {
    frames: HashMap<FrameId, FrameEntry>,
}

impl DemandLedger {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    fn admits(entry: &FrameEntry, epoch: Epoch) -> bool {
        entry.epoch.is_none_or(|seen| epoch > seen)
    }

    /// Replace the frame's demand, unless `demand.epoch` is not newer than the
    /// last epoch seen for it.
    pub(crate) fn set(&mut self, frame: FrameId, demand: FrameDemand) -> LedgerOutcome {
        let entry = self.frames.entry(frame).or_default();
        if !Self::admits(entry, demand.epoch) {
            return LedgerOutcome::Stale;
        }
        entry.epoch = Some(demand.epoch);
        entry.demand = Some(demand);
        LedgerOutcome::Applied
    }

    /// Drop the frame's demand (its tab closed), unless `epoch` is not newer
    /// than the last epoch seen for it.
    pub(crate) fn clear(&mut self, frame: &FrameId, epoch: Epoch) -> LedgerOutcome {
        let entry = self.frames.entry(frame.clone()).or_default();
        if !Self::admits(entry, epoch) {
            return LedgerOutcome::Stale;
        }
        entry.epoch = Some(epoch);
        entry.demand = None;
        LedgerOutcome::Applied
    }

    pub(crate) fn get(&self, frame: &FrameId) -> Option<&FrameDemand> {
        self.frames
            .get(frame)
            .and_then(|entry| entry.demand.as_ref())
    }

    /// Frames with demand, in frame-id order so plans are deterministic.
    pub(crate) fn frames(&self) -> Vec<(&FrameId, &FrameDemand)> {
        let mut frames: Vec<_> = self
            .frames
            .iter()
            .filter_map(|(id, entry)| entry.demand.as_ref().map(|demand| (id, demand)))
            .collect();
        frames.sort_by(|a, b| a.0.cmp(b.0));
        frames
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn demand(epoch: u64, layers: &[&str]) -> FrameDemand {
        FrameDemand {
            epoch: Epoch(epoch),
            priority: Priority::Front,
            layers: layers
                .iter()
                .map(|id| DemandedLayer::new(*id, *id))
                .collect(),
            last_front_at: 0,
        }
    }

    #[test]
    fn stale_epoch_is_ignored() {
        let mut ledger = DemandLedger::new();
        let tab = FrameId::new("tab-1");
        assert_eq!(
            ledger.set(tab.clone(), demand(2, &["a"])),
            LedgerOutcome::Applied
        );
        assert_eq!(
            ledger.set(tab.clone(), demand(1, &["b"])),
            LedgerOutcome::Stale
        );
        assert_eq!(
            ledger.set(tab.clone(), demand(2, &["c"])),
            LedgerOutcome::Stale
        );
        assert_eq!(ledger.get(&tab).unwrap().layers[0].layer_id, "a");
        assert_eq!(
            ledger.set(tab.clone(), demand(3, &["d"])),
            LedgerOutcome::Applied
        );
        assert_eq!(ledger.get(&tab).unwrap().layers[0].layer_id, "d");
    }

    #[test]
    fn older_clear_cannot_remove_newer_demand() {
        let mut ledger = DemandLedger::new();
        let tab = FrameId::new("tab-1");
        ledger.set(tab.clone(), demand(5, &["a"]));
        assert_eq!(ledger.clear(&tab, Epoch(3)), LedgerOutcome::Stale);
        assert!(ledger.get(&tab).is_some());
        assert_eq!(ledger.clear(&tab, Epoch(6)), LedgerOutcome::Applied);
        assert!(ledger.get(&tab).is_none());
        // A set sent before the clear and delivered after it stays cleared.
        assert_eq!(
            ledger.set(tab.clone(), demand(4, &["a"])),
            LedgerOutcome::Stale
        );
        assert!(ledger.get(&tab).is_none());
        assert!(ledger.frames().is_empty());
    }

    #[test]
    fn epochs_are_per_frame() {
        let mut ledger = DemandLedger::new();
        ledger.set(FrameId::new("tab-1"), demand(9, &["a"]));
        assert_eq!(
            ledger.set(FrameId::new("tab-2"), demand(1, &["b"])),
            LedgerOutcome::Applied
        );
        let ids: Vec<_> = ledger.frames().iter().map(|(id, _)| id.0.clone()).collect();
        assert_eq!(ids, ["tab-1", "tab-2"]);
    }
}
