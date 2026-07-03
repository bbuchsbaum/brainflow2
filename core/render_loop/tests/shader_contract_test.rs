//! Structural gate for the active masked slice shaders.
//!
//! This test reflects both authoritative runtime WGSL shaders with `naga` (a
//! pure-CPU parse, no GPU adapter required) and asserts three things against the
//! Rust side:
//!
//!   1. Struct layouts: for `FrameUbo`, `LayerData` (= `LayerUboStd140`),
//!      `SliceFeatureUbo`, and `LayerMetadata`, every WGSL member's byte offset
//!      and the struct's total size match the Rust `#[repr(C)]` structs via
//!      `offset_of!`/`size_of`.
//!   2. Binding table: the full `(group, binding, address-space)` table of the
//!      shader equals the `render_loop::shader_contract` constants, including all
//!      29 group-2 texture/sampler bindings.
//!   3. Cross-shader agreement: the two shaders reflect to identical binding
//!      tables and identical struct layouts.
//!
//! Together with the `const _` size asserts in `ubo.rs` and the string-based
//! order checks in `tests/ubo.rs`, this closes the loop between the Rust structs,
//! the Rust bind-group layout builders, and the WGSL declarations.

use std::mem::{offset_of, size_of};

use render_loop::layer_storage::LayerMetadata;
use render_loop::shader_contract as sc;
use render_loop::{FrameUbo, LayerUboStd140, SliceFeatureUbo};

const MASKED: &str = include_str!("../shaders/slice_world_space_masked.wgsl");
const OPTIMIZED: &str = include_str!("../shaders/slice_world_space_optimized_masked.wgsl");

fn shaders() -> [(&'static str, &'static str); 2] {
    [
        ("slice_world_space_masked.wgsl", MASKED),
        ("slice_world_space_optimized_masked.wgsl", OPTIMIZED),
    ]
}

fn parse(name: &str, source: &str) -> naga::Module {
    naga::front::wgsl::parse_str(source)
        .unwrap_or_else(|e| panic!("{name} failed to parse with naga: {e:?}"))
}

/// Reflected layout of a named WGSL struct: member byte offsets (in declaration
/// order) and the struct's total (padded) size.
#[derive(Debug, Clone, PartialEq, Eq)]
struct StructLayout {
    offsets: Vec<u32>,
    size: u32,
}

fn struct_layout(module: &naga::Module, struct_name: &str) -> StructLayout {
    for (_, ty) in module.types.iter() {
        if ty.name.as_deref() == Some(struct_name) {
            if let naga::TypeInner::Struct { members, span } = &ty.inner {
                return StructLayout {
                    offsets: members.iter().map(|m| m.offset).collect(),
                    size: *span,
                };
            }
        }
    }
    panic!("struct {struct_name} not found in reflected module");
}

fn space_kind(space: &naga::AddressSpace) -> &'static str {
    match space {
        naga::AddressSpace::Uniform => "uniform",
        naga::AddressSpace::Storage { .. } => "storage",
        naga::AddressSpace::Handle => "handle",
        naga::AddressSpace::Private => "private",
        naga::AddressSpace::WorkGroup => "workgroup",
        naga::AddressSpace::PushConstant => "push_constant",
        naga::AddressSpace::Function => "function",
    }
}

/// The full (group, binding, address-space) table reflected from a shader,
/// sorted for order-independent comparison.
fn binding_table(module: &naga::Module) -> Vec<(u32, u32, &'static str)> {
    let mut table: Vec<(u32, u32, &'static str)> = module
        .global_variables
        .iter()
        .filter_map(|(_, var)| {
            var.binding
                .as_ref()
                .map(|rb| (rb.group, rb.binding, space_kind(&var.space)))
        })
        .collect();
    table.sort();
    table
}

// --- Expected Rust-side layouts (authoritative offsets via offset_of!) ---

fn expected_frame_layout() -> StructLayout {
    StructLayout {
        offsets: vec![
            offset_of!(FrameUbo, origin_mm) as u32,
            offset_of!(FrameUbo, u_mm) as u32,
            offset_of!(FrameUbo, v_mm) as u32,
            offset_of!(FrameUbo, atlas_dim) as u32,
            offset_of!(FrameUbo, _padding_frame) as u32,
            offset_of!(FrameUbo, target_dim) as u32,
            offset_of!(FrameUbo, _padding_target) as u32,
        ],
        size: size_of::<FrameUbo>() as u32,
    }
}

fn expected_layer_layout() -> StructLayout {
    StructLayout {
        offsets: vec![
            offset_of!(LayerUboStd140, world_to_voxel) as u32,
            offset_of!(LayerUboStd140, texture_coords) as u32,
            offset_of!(LayerUboStd140, dim) as u32,
            offset_of!(LayerUboStd140, pad_slices) as u32,
            offset_of!(LayerUboStd140, colormap_id) as u32,
            offset_of!(LayerUboStd140, blend_mode) as u32,
            offset_of!(LayerUboStd140, texture_index) as u32,
            offset_of!(LayerUboStd140, threshold_mode) as u32,
            offset_of!(LayerUboStd140, opacity) as u32,
            offset_of!(LayerUboStd140, intensity_min) as u32,
            offset_of!(LayerUboStd140, intensity_max) as u32,
            offset_of!(LayerUboStd140, thresh_low) as u32,
            offset_of!(LayerUboStd140, thresh_high) as u32,
            offset_of!(LayerUboStd140, is_mask) as u32,
            offset_of!(LayerUboStd140, has_alpha_mask) as u32,
            offset_of!(LayerUboStd140, interpolation_mode) as u32,
            offset_of!(LayerUboStd140, draw_slice_border) as u32,
            offset_of!(LayerUboStd140, border_thickness_px) as u32,
            offset_of!(LayerUboStd140, layer_mode) as u32,
            offset_of!(LayerUboStd140, _pad) as u32,
            offset_of!(LayerUboStd140, alpha_mod_mode) as u32,
            offset_of!(LayerUboStd140, alpha_gamma) as u32,
            offset_of!(LayerUboStd140, alpha_center) as u32,
            offset_of!(LayerUboStd140, _pad_alpha) as u32,
        ],
        size: size_of::<LayerUboStd140>() as u32,
    }
}

fn expected_feature_layout() -> StructLayout {
    // Rust collapses the trailing padding into `_pad1: [f32; 3]`, while WGSL
    // declares three scalar pad members (`_pad1_x/y/z`). Expand the array so the
    // expected member list matches the WGSL member count exactly.
    let pad = offset_of!(SliceFeatureUbo, _pad1) as u32;
    StructLayout {
        offsets: vec![
            offset_of!(SliceFeatureUbo, outline_enabled) as u32,
            offset_of!(SliceFeatureUbo, outline_layer_index) as u32,
            offset_of!(SliceFeatureUbo, selected_label_id) as u32,
            offset_of!(SliceFeatureUbo, outline_mode) as u32,
            offset_of!(SliceFeatureUbo, outline_color) as u32,
            offset_of!(SliceFeatureUbo, outline_thickness_px) as u32,
            pad,
            pad + 4,
            pad + 8,
        ],
        size: size_of::<SliceFeatureUbo>() as u32,
    }
}

fn expected_metadata_layout() -> StructLayout {
    // Rust stores `active_count: u32` + `_padding: [u32; 7]`; WGSL declares eight
    // scalar u32 members. Expand the padding array to eight total members.
    let pad = offset_of!(LayerMetadata, _padding) as u32;
    StructLayout {
        offsets: vec![
            offset_of!(LayerMetadata, active_count) as u32,
            pad,
            pad + 4,
            pad + 8,
            pad + 12,
            pad + 16,
            pad + 20,
            pad + 24,
        ],
        size: size_of::<LayerMetadata>() as u32,
    }
}

/// Expected `(group, binding, address-space)` table built from the shared
/// `shader_contract` constants.
fn expected_binding_table() -> Vec<(u32, u32, &'static str)> {
    let mut expected: Vec<(u32, u32, &'static str)> = vec![
        (sc::GROUP_FRAME, sc::frame::FRAME_UBO, "uniform"),
        (sc::GROUP_FRAME, sc::frame::CROSSHAIR_UBO, "uniform"),
        (sc::GROUP_LAYER, sc::layer::LAYER_DATA, "storage"),
        (sc::GROUP_LAYER, sc::layer::LAYER_METADATA, "uniform"),
        (sc::GROUP_FEATURE, sc::feature::SLICE_FEATURES, "uniform"),
    ];

    let b = sc::texture::bindings(sc::texture::MAX_TEXTURES);
    for i in 0..sc::texture::MAX_TEXTURES {
        expected.push((sc::GROUP_TEXTURE, b.volume_base + i, "handle"));
    }
    for i in 0..sc::texture::MAX_TEXTURES {
        expected.push((sc::GROUP_TEXTURE, b.mask_base + i, "handle"));
    }
    expected.push((sc::GROUP_TEXTURE, b.sampler_linear, "handle"));
    expected.push((sc::GROUP_TEXTURE, b.colormap_lut, "handle"));
    expected.push((sc::GROUP_TEXTURE, b.sampler_nearest, "handle"));

    expected.sort();
    expected
}

#[test]
fn struct_layouts_match_rust_structs() {
    let expected: [(&str, StructLayout); 4] = [
        ("FrameUbo", expected_frame_layout()),
        ("LayerData", expected_layer_layout()),
        ("SliceFeatureUbo", expected_feature_layout()),
        ("LayerMetadata", expected_metadata_layout()),
    ];

    for (name, source) in shaders() {
        let module = parse(name, source);
        for (struct_name, want) in &expected {
            let got = struct_layout(&module, struct_name);
            assert_eq!(
                got.offsets, want.offsets,
                "{name}: {struct_name} member offsets diverge from the Rust struct \
                 (WGSL {:?} vs Rust {:?})",
                got.offsets, want.offsets
            );
            assert_eq!(
                got.size, want.size,
                "{name}: {struct_name} total size {} != Rust size_of {}",
                got.size, want.size
            );
        }
    }
}

#[test]
fn binding_table_matches_shader_contract() {
    let expected = expected_binding_table();

    // Sanity: 2 (frame) + 2 (layer) + 29 (texture group) + 1 (feature) = 34.
    assert_eq!(
        expected.len(),
        2 + 2 + (2 * sc::texture::MAX_TEXTURES as usize + 3) + 1
    );

    for (name, source) in shaders() {
        let module = parse(name, source);
        let got = binding_table(&module);
        assert_eq!(
            got, expected,
            "{name}: reflected binding table diverges from shader_contract constants"
        );
    }
}

#[test]
fn shaders_agree_with_each_other() {
    let masked = parse("slice_world_space_masked.wgsl", MASKED);
    let optimized = parse("slice_world_space_optimized_masked.wgsl", OPTIMIZED);

    // Identical binding tables.
    assert_eq!(
        binding_table(&masked),
        binding_table(&optimized),
        "the two active masked shaders declare different binding tables"
    );

    // Identical struct layouts (offsets + size). Member *names* may differ for
    // padding fields (e.g. `_padMask1` vs `_padOpt1`), so compare layouts only.
    for struct_name in ["FrameUbo", "LayerData", "SliceFeatureUbo", "LayerMetadata"] {
        assert_eq!(
            struct_layout(&masked, struct_name),
            struct_layout(&optimized, struct_name),
            "{struct_name} layout differs between the two active masked shaders"
        );
    }
}
