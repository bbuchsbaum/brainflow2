use bytemuck::{Pod, Zeroable};
use nalgebra::Matrix4; // Assuming nalgebra is used for matrices/vectors

// Frame uniform buffer object - matches slice.wgsl
#[repr(C)]
#[derive(Debug, Copy, Clone, Pod, Zeroable)]
pub struct FrameUbo {
    pub origin_mm: [f32; 4],  // Plane center in world mm (homogeneous, w = 1)
    pub u_mm: [f32; 4],       // World vector mapping to clip space +X (vector, w = 0)
    pub v_mm: [f32; 4],       // World vector mapping to clip space +Y (vector, w = 0)
    pub atlas_dim: [u32; 3],  // Dimensions of the 3D texture atlas
    pub _padding_frame: u32,  // Padding to maintain alignment
    pub target_dim: [u32; 2], // Dimensions of the render target
    pub _padding_target: [u32; 2], // Padding to maintain 16-byte alignment
}

impl Default for FrameUbo {
    fn default() -> Self {
        Self {
            origin_mm: [0.0, 0.0, 0.0, 1.0], // Default origin at world center
            u_mm: [1.0, 0.0, 0.0, 0.0],      // Default to X axis
            v_mm: [0.0, 1.0, 0.0, 0.0],      // Default to Y axis
            atlas_dim: [256, 256, 256],      // Default atlas dimensions
            _padding_frame: 0,
            target_dim: [512, 512], // Default render target dimensions
            _padding_target: [0, 0],
        }
    }
}

// Ensure this matches the WGSL definition and std140 layout rules.
// vec3 followed by f32 is correctly aligned to 16 bytes.
#[repr(C)]
#[derive(Debug, Copy, Clone, Pod, Zeroable)]
pub struct CrosshairUbo {
    /// World position [x, y, z]
    pub world_position: [f32; 3],
    /// Padding to 16 bytes
    pub _padding: f32,
}

impl Default for CrosshairUbo {
    fn default() -> Self {
        Self {
            world_position: [0.0; 3],
            _padding: 0.0,
        }
    }
}

// ViewPlane uniform buffer object - needs 16-byte minimum size
#[repr(C)]
#[derive(Debug, Copy, Clone, Pod, Zeroable)]
pub struct ViewPlaneUbo {
    /// 0=Axial, 1=Coronal, 2=Sagittal
    pub plane_id: u32,
    /// Padding to meet 16-byte minimum for UBO bindings
    pub _padding: [u32; 3],
}

impl Default for ViewPlaneUbo {
    fn default() -> Self {
        Self {
            plane_id: 0, // Default to Axial
            _padding: [0; 3],
        }
    }
}

// Verify this matches the WGSL definition (80 bytes total assumed).
#[repr(C)]
#[derive(Debug, Copy, Clone, Pod, Zeroable)]
pub struct LayerUbo {
    // Using nalgebra Matrix4 which is repr(C) and compatible with mat4x4<f32>
    pub world_to_voxel: [[f32; 4]; 4],
    pub colormap_id: u32,
    pub blend_mode: u32,
    pub layer_index: u32,
    // Using nalgebra Vector3<u32> - needs checking for alignment/Pod compatibility
    // Explicit array is safer for bytemuck unless Vector3<u32> is repr(C) and Pod
    // pub dim: Vector3<u32>, // Potential issue: nalgebra Vector3 might not be Pod/repr(C)
    pub dim: [u32; 3],   // Safer alternative
    pub pad_slices: u32, // Explicit u32 for padding after dim
    pub opacity: f32,
    pub intensity_min: f32,
    pub intensity_max: f32,
    pub thresh_low: f32,
    pub thresh_high: f32,
    // Check total size and alignment. Matrix4<f32> = 64 bytes.
    // 4 * u32 = 16 bytes.
    // [u32; 3] = 12 bytes + pad_slices (u32) = 16 bytes.
    // 5 * f32 = 20 bytes. Needs padding.
    // Let's adjust layout for std140 alignment (vec4 alignment for f32 group)

    // Revised Layout attempt for std140 (Check carefully):
    // world_to_voxel: mat4x4<f32>  (64 bytes, align 16) - OK
    // --- vec4 boundary ---
    // opacity: f32                (4 bytes)
    // intensity_min: f32          (4 bytes)
    // intensity_max: f32          (4 bytes)
    // thresh_low: f32             (4 bytes) - Total 16 bytes - OK
    // --- vec4 boundary ---
    // thresh_high: f32            (4 bytes)
    // colormap_id: u32            (4 bytes)
    // blend_mode: u32             (4 bytes)
    // layer_index: u32            (4 bytes) - Total 16 bytes - OK
    // --- vec4 boundary ---
    // dim: vec3<u32>              (12 bytes) - Needs 4 bytes padding before next element
    // pad_slices: u32             (4 bytes) - Uses the padding - Total 16 bytes - OK
    // Total: 64 + 16 + 16 + 16 = 112 bytes? - Recheck WGSL struct size assumption.

    // Let's stick to the WGSL layout from ADR-002 and assume wgpu handles packing.
    // We define the fields in Rust matching WGSL order. Bytemuck requires careful alignment.
}

// Updated CrosshairUbo to include show_crosshair flag and color
#[repr(C)]
#[derive(Debug, Copy, Clone, Pod, Zeroable)]
pub struct CrosshairUboUpdated {
    /// World position [x, y, z]
    pub world_position: [f32; 3],
    /// 0 = hide, 1 = show
    pub show_crosshair: u32,
    /// RGBA color [r, g, b, a] in 0.0-1.0 range
    pub crosshair_color: [f32; 4],
}

impl Default for CrosshairUboUpdated {
    fn default() -> Self {
        Self {
            world_position: [0.0; 3],
            show_crosshair: 1,                     // Show by default
            crosshair_color: [0.0, 1.0, 0.0, 0.8], // Default green
        }
    }
}

// --- std140-compliant layout ---
// std140 rules:
// - vec4 types must be 16-byte aligned
// - mat4x4 is 16-byte aligned
// - arrays of scalars/vectors are rounded up to vec4 alignment
#[repr(C)]
#[derive(Debug, Copy, Clone, Pod, Zeroable)]
pub struct LayerUboStd140 {
    // --- 16-byte aligned types first ---
    pub world_to_voxel: [[f32; 4]; 4], // 64 bytes, offset 0
    pub texture_coords: [f32; 4],      // 16 bytes, offset 64 (vec4<f32>)

    // --- Pack scalars and vec3 carefully ---
    pub dim: [u32; 3],   // 12 bytes, offset 80
    pub pad_slices: u32, // 4 bytes, offset 92 (completes 16-byte block)

    pub colormap_id: u32,    // 4 bytes, offset 96
    pub blend_mode: u32,     // 4 bytes, offset 100
    pub texture_index: u32,  // 4 bytes, offset 104 (matches WGSL field name)
    pub threshold_mode: u32, // 4 bytes, offset 108 (completes 16-byte block)

    pub opacity: f32,       // 4 bytes, offset 112
    pub intensity_min: f32, // 4 bytes, offset 116
    pub intensity_max: f32, // 4 bytes, offset 120
    pub thresh_low: f32,    // 4 bytes, offset 124 (completes 16-byte block)

    pub thresh_high: f32,         // 4 bytes
    pub is_mask: u32,             // 4 bytes
    pub has_alpha_mask: u32,      // 4 bytes
    pub interpolation_mode: u32,  // 4 bytes (0=nearest, 1=linear, 2=cubic)
    pub draw_slice_border: u32,   // 4 bytes, offset 144 (0/1)
    pub border_thickness_px: f32, // 4 bytes, offset 148
    pub layer_mode: u32,          // 4 bytes, offset 152 (0=scalar, 1=label, 2=mask)
    pub _pad: u32,                // 4 bytes, offset 156 (completes 16-byte block)

    // --- Intensity-modulated alpha (transparent thresholding) --- next 16-byte block
    pub alpha_mod_mode: u32, // 4 bytes, offset 160 (0=off, 1=linear, 2=gamma)
    pub alpha_gamma: f32,    // 4 bytes, offset 164 (gamma exponent for the ramp)
    pub alpha_center: f32,   // 4 bytes, offset 168 (two-sided magnitude center)
    pub _pad_alpha: f32,     // 4 bytes, offset 172 (reserved: soft-knee / alpha-floor)
                             // Total size: 176 bytes (must match WGSL LayerData)
}

impl Default for LayerUboStd140 {
    fn default() -> Self {
        Self {
            world_to_voxel: crate::matrix_to_cols_array(&Matrix4::identity()),
            texture_coords: [0.0, 0.0, 1.0, 1.0], // Default to full texture
            dim: [0; 3],
            pad_slices: 0,
            colormap_id: 0,
            blend_mode: 0, // Default to alpha
            texture_index: 0,
            threshold_mode: 0, // Default to range thresholding
            opacity: 1.0,
            intensity_min: 0.0,
            intensity_max: 1.0,
            thresh_low: -f32::INFINITY,
            thresh_high: f32::INFINITY,
            is_mask: 0,
            has_alpha_mask: 0,
            interpolation_mode: 1, // Default to linear
            draw_slice_border: 0,
            border_thickness_px: 1.0,
            layer_mode: 0,
            _pad: 0,
            alpha_mod_mode: 0, // Default: off (byte-identical to pre-feature rendering)
            alpha_gamma: 1.0,  // Linear when enabled
            alpha_center: 0.0, // Two-sided magnitude measured from 0
            _pad_alpha: 0.0,
        }
    }
}

// IMPORTANT: Keep LayerUboStd140 in byte-for-byte sync with the WGSL LayerData
// structs in the active masked slice shaders. The runtime storage buffer expects
// a 176-byte stride. If you add or reorder fields here or in WGSL, adjust both
// and update this check.
const _: [(); 176] = [(); std::mem::size_of::<LayerUboStd140>()];

/// Sidecar feature uniforms for slice rendering.
///
/// This is intentionally separate from `LayerUboStd140`: optional rendering
/// capabilities such as selected-label outlines should not grow every layer's
/// hot-path layout. Group 3 is the stable feature-uniform slot for the active
/// runtime slice shaders.
#[repr(C)]
#[derive(Debug, Copy, Clone, Pod, Zeroable)]
pub struct SliceFeatureUbo {
    pub outline_enabled: u32,
    pub outline_layer_index: u32,
    pub selected_label_id: u32,
    pub _pad0: u32,
    pub outline_color: [f32; 4],
    pub outline_thickness_px: f32,
    pub _pad1: [f32; 3],
}

impl Default for SliceFeatureUbo {
    fn default() -> Self {
        Self {
            outline_enabled: 0,
            outline_layer_index: 0,
            selected_label_id: 0,
            _pad0: 0,
            outline_color: [1.0, 1.0, 0.0, 1.0],
            outline_thickness_px: 1.0,
            _pad1: [0.0; 3],
        }
    }
}

const _: [(); 48] = [(); std::mem::size_of::<SliceFeatureUbo>()];

// --- Optimized layer data struct for performance shader ---
// This struct includes precomputed values to reduce per-pixel calculations
#[repr(C)]
#[derive(Debug, Copy, Clone, Pod, Zeroable)]
pub struct LayerDataOptimized {
    // --- 16-byte aligned types first ---
    pub world_to_voxel: [[f32; 4]; 4], // 64 bytes, offset 0

    // --- Volume info ---
    pub dim: [u32; 3],      // 12 bytes, offset 64
    pub texture_index: u32, // 4 bytes, offset 76 (completes 16-byte block)

    // --- Rendering parameters ---
    pub colormap_id: u32,    // 4 bytes, offset 80
    pub blend_mode: u32,     // 4 bytes, offset 84
    pub threshold_mode: u32, // 4 bytes, offset 88
    pub is_mask: u32,        // 4 bytes, offset 92 (completes 16-byte block)

    pub opacity: f32,       // 4 bytes, offset 96
    pub intensity_min: f32, // 4 bytes, offset 100
    pub intensity_max: f32, // 4 bytes, offset 104
    pub thresh_low: f32,    // 4 bytes, offset 108 (completes 16-byte block)

    pub thresh_high: f32,         // 4 bytes, offset 112
    pub has_alpha_mask: u32,      // 4 bytes, offset 116
    pub inv_intensity_delta: f32, // 4 bytes, offset 120
    pub voxel_size_estimate: f32, // 4 bytes, offset 124
    pub _padding: f32,            // 4 bytes, offset 128
                                  // Total size: 64 + 16 + 16 + 16 + 16 = 128 bytes (8 * 16-byte blocks)
}

impl Default for LayerDataOptimized {
    fn default() -> Self {
        Self {
            world_to_voxel: crate::matrix_to_cols_array(&Matrix4::identity()),
            dim: [0; 3],
            texture_index: 0,
            colormap_id: 0,
            blend_mode: 0,     // Default to alpha
            threshold_mode: 0, // Default to range thresholding
            is_mask: 0,
            opacity: 1.0,
            intensity_min: 0.0,
            intensity_max: 1.0,
            thresh_low: -f32::INFINITY,
            thresh_high: f32::INFINITY,
            has_alpha_mask: 0,
            inv_intensity_delta: 1.0, // 1.0 / (1.0 - 0.0)
            voxel_size_estimate: 1.0,
            _padding: 0.0,
        }
    }
}
