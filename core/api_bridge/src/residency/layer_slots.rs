//! `LayerSlotMap`: which texture residency each UI layer draws.
//!
//! The map records a generation-checked [`SlotHandle`] per layer, never a bare
//! texture index. Numeric indices are reused after a release, so an index alone
//! cannot say whether the texture there is still the layer's. Every question
//! about the layer's own texture (does it have one, release it, edit it) goes
//! through [`LayerSlotMap::current`], which treats a handle whose residency
//! has gone (released, or its index refilled by another upload) as unmapped.
//! Code that only needs a binding position calls `.index()` on a current handle
//! at the renderer boundary.

use std::collections::HashMap;

use render_loop::{RenderLoopService, SlotHandle};

/// UI layer id → the residency the layer draws.
#[derive(Debug, Clone, Default)]
pub struct LayerSlotMap {
    slots: HashMap<String, SlotHandle>,
}

impl LayerSlotMap {
    pub fn new() -> Self {
        Self::default()
    }

    /// Map `layer_id` to `slot`, returning the residency it named before.
    pub fn insert(&mut self, layer_id: impl Into<String>, slot: SlotHandle) -> Option<SlotHandle> {
        self.slots.insert(layer_id.into(), slot)
    }

    pub fn remove(&mut self, layer_id: &str) -> Option<SlotHandle> {
        self.slots.remove(layer_id)
    }

    /// The residency recorded for `layer_id`, without asking the renderer
    /// whether it still holds it. Use [`Self::current`] to draw, edit or test
    /// liveness; this is for bookkeeping that compares handles.
    pub fn recorded(&self, layer_id: &str) -> Option<SlotHandle> {
        self.slots.get(layer_id).copied()
    }

    /// The layer's residency while `service` still holds it. A stale handle
    /// (released, or its index refilled by another upload) reads as unmapped,
    /// so the layer is allocated again rather than drawing another texture.
    pub fn current(&self, layer_id: &str, service: &RenderLoopService) -> Option<SlotHandle> {
        self.recorded(layer_id)
            .filter(|&slot| service.is_slot_current(slot))
    }

    /// Whether `layer_id` has a recorded residency, current or not.
    pub fn contains(&self, layer_id: &str) -> bool {
        self.slots.contains_key(layer_id)
    }

    pub fn len(&self) -> usize {
        self.slots.len()
    }

    pub fn is_empty(&self) -> bool {
        self.slots.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, SlotHandle)> {
        self.slots.iter().map(|(id, &slot)| (id.as_str(), slot))
    }

    /// Whether the release of `released` should drop `layer_id`'s mapping:
    /// the layer still maps to that residency, or to one that is gone (whose
    /// index another upload may have refilled: the layer must not draw it).
    /// A layer mapped to another live residency keeps its mapping: a newer
    /// allocation of the layer owns it. Without a renderer only the first
    /// test applies.
    pub(crate) fn is_released_by(
        &self,
        layer_id: &str,
        released: SlotHandle,
        service: Option<&RenderLoopService>,
    ) -> bool {
        self.recorded(layer_id).is_some_and(|mapped| {
            mapped == released || service.is_some_and(|service| !service.is_slot_current(mapped))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use volmath::{DenseVolume3, NeuroSpaceExt};

    fn volume(value: f32) -> DenseVolume3<f32> {
        let space = volmath::NeuroSpace::from_dims_spacing_origin(
            vec![3, 2, 2],
            vec![1.0; 3],
            vec![0.0; 3],
        )
        .unwrap();
        DenseVolume3::from_data(space, vec![value; 12])
    }

    async fn renderer() -> RenderLoopService {
        let mut service = RenderLoopService::new()
            .await
            .expect("GPU adapter required");
        service.enable_world_space_rendering().unwrap();
        service
    }

    fn upload(service: &mut RenderLoopService, value: f32) -> SlotHandle {
        let (index, _) = service.upload_volume_3d(&volume(value)).unwrap();
        service.slot_handle(index).unwrap()
    }

    #[tokio::test]
    async fn a_current_handle_resolves_and_a_stale_one_reads_as_unmapped() {
        let mut service = renderer().await;
        let mut map = LayerSlotMap::new();
        let mine = upload(&mut service, 1.0);
        map.insert("layer", mine);
        assert_eq!(map.current("layer", &service), Some(mine));

        // Freed behind the layer, then refilled by another volume.
        assert!(service.release_slot(mine).unwrap());
        assert_eq!(map.current("layer", &service), None, "released");
        let other = upload(&mut service, 7.0);
        assert_eq!(other.index(), mine.index(), "the index is reused");
        assert_eq!(
            map.current("layer", &service),
            None,
            "the refilled index is another volume's, not the layer's"
        );
        assert_eq!(map.recorded("layer"), Some(mine), "still recorded");
        assert!(map.contains("layer"));
        assert_eq!(map.current("missing", &service), None);
    }

    #[tokio::test]
    async fn a_release_drops_only_mappings_it_owns_or_that_are_gone() {
        let mut service = renderer().await;
        let old = upload(&mut service, 1.0);
        let newer = upload(&mut service, 2.0);
        let mut map = LayerSlotMap::new();

        map.insert("layer", old);
        assert!(map.is_released_by("layer", old, Some(&service)));
        assert!(map.is_released_by("layer", old, None));

        // A newer live allocation of the layer survives the old lease's release.
        map.insert("layer", newer);
        assert!(!map.is_released_by("layer", old, Some(&service)));
        assert!(!map.is_released_by("layer", old, None));

        // A mapping whose residency is gone goes with any release of the layer.
        service.release_slot(newer).unwrap();
        upload(&mut service, 9.0);
        assert!(map.is_released_by("layer", old, Some(&service)));
        assert!(!map.is_released_by("missing", old, Some(&service)));
    }
}
