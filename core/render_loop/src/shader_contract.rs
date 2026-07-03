//! Single source of truth for the active masked slice shaders' bind-group and
//! binding layout.
//!
//! The runtime masked WGSL path is authoritative for slice rendering (see
//! `shaders/slice_world_space_masked.wgsl` and
//! `shaders/slice_world_space_optimized_masked.wgsl`). Both shaders, the Rust
//! bind-group layout builders, and the bind-group construction code must agree
//! on which group and binding index every resource lives at. Historically those
//! numbers were duplicated as magic literals and ad-hoc `next_binding += 1`
//! arithmetic across `shaders::layouts`, `layer_storage`, and
//! `multi_texture_manager`; this module names them once so the Rust side and the
//! `shader_contract_test` reflection check share the same constants.
//!
//! Pipeline layout order (see `shaders::create_slice_pipeline_layout`):
//! group 0 = frame globals, group 1 = layer data, group 2 = textures/samplers,
//! group 3 = optional feature uniforms.

/// Per-frame globals (frame UBO + crosshair UBO).
pub const GROUP_FRAME: u32 = 0;
/// Layer data (storage buffer array + metadata uniform).
pub const GROUP_LAYER: u32 = 1;
/// Volume/mask textures, samplers, and the colormap LUT.
pub const GROUP_TEXTURE: u32 = 2;
/// Optional slice-feature uniforms (selected-label outlines, etc.).
pub const GROUP_FEATURE: u32 = 3;

/// Bindings within [`GROUP_FRAME`].
pub mod frame {
    /// `@group(0) @binding(0) var<uniform> frame: FrameUbo;`
    pub const FRAME_UBO: u32 = 0;
    /// `@group(0) @binding(1) var<uniform> crosshair: CrosshairUbo;`
    pub const CROSSHAIR_UBO: u32 = 1;
}

/// Bindings within [`GROUP_LAYER`].
pub mod layer {
    /// `@group(1) @binding(0) var<storage, read> layer_data: array<LayerData>;`
    pub const LAYER_DATA: u32 = 0;
    /// `@group(1) @binding(1) var<uniform> layer_metadata: LayerMetadata;`
    pub const LAYER_METADATA: u32 = 1;
}

/// Bindings within [`GROUP_TEXTURE`].
///
/// The texture group packs, in order:
/// `MAX_TEXTURES` volume textures, then `MAX_TEXTURES` mask textures, then the
/// linear sampler, the colormap LUT array, and the nearest sampler. The named
/// constants below reflect the canonical [`MAX_TEXTURES`] used by the active
/// shaders; the bind-group builders are allowed to run with a larger runtime
/// `max_textures` (e.g. an atlas that reserves extra slots), so they compute the
/// same offsets through [`bindings`].
pub mod texture {
    /// Canonical volume/mask texture count baked into the active masked shaders.
    pub const MAX_TEXTURES: u32 = crate::multi_texture_manager::MAX_TEXTURES as u32;

    /// First volume texture binding (`volumeTexture0`).
    pub const VOLUME_BASE: u32 = 0;
    /// First mask texture binding (`maskTexture0`).
    pub const MASK_BASE: u32 = MAX_TEXTURES;
    /// Linear filtering sampler (`samplerLinear`).
    pub const SAMPLER_LINEAR: u32 = 2 * MAX_TEXTURES;
    /// Colormap LUT texture array (`colormapLutTexture`).
    pub const COLORMAP_LUT: u32 = 2 * MAX_TEXTURES + 1;
    /// Nearest (non-filtering) sampler (`samplerNearest`).
    pub const SAMPLER_NEAREST: u32 = 2 * MAX_TEXTURES + 2;

    /// Total number of bindings in the texture group for a given texture count.
    pub const fn binding_count(max_textures: u32) -> u32 {
        // volume + mask textures, linear sampler, colormap LUT, nearest sampler.
        2 * max_textures + 3
    }

    /// Resolved binding indices for a texture group with `max_textures` slots.
    ///
    /// The builders in [`crate::multi_texture_manager`] accept a runtime texture
    /// count, so they use this helper instead of the fixed constants to keep the
    /// volume/mask/sampler offsets consistent for any capacity.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct Bindings {
        pub max_textures: u32,
        pub volume_base: u32,
        pub mask_base: u32,
        pub sampler_linear: u32,
        pub colormap_lut: u32,
        pub sampler_nearest: u32,
    }

    /// Compute the texture-group binding indices for `max_textures` slots.
    pub const fn bindings(max_textures: u32) -> Bindings {
        Bindings {
            max_textures,
            volume_base: 0,
            mask_base: max_textures,
            sampler_linear: 2 * max_textures,
            colormap_lut: 2 * max_textures + 1,
            sampler_nearest: 2 * max_textures + 2,
        }
    }
}

/// Bindings within [`GROUP_FEATURE`].
pub mod feature {
    /// `@group(3) @binding(0) var<uniform> slice_features: SliceFeatureUbo;`
    pub const SLICE_FEATURES: u32 = 0;
}
