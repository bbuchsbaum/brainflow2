//! Texture residency inside the renderer: [`ResidentTextureStore`] owns the
//! GPU volume textures, their masks and per-slot generations. Binding them for
//! a draw stays in `multi_texture_manager` (R1 of
//! `docs/plans/gpu-residency-implementation-2026-11.md`).

mod encode;
mod texture_store;

pub(crate) use encode::{encode_with_policy, UploadFormat};
pub use texture_store::{
    format_bytes_per_pixel, EditableTextureHandle, LabelRegionUpdate, ResidentTextureStore,
    SlotHandle, TextureInfo, MAX_TEXTURES,
};
