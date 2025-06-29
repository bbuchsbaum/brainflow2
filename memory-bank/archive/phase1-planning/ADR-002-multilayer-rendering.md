docs/ADR-002-multilayer-rendering.md
(Added clarification to texFormat description and added Section 9 cross-reference)
# ADR-002: Brainflow Multilayer Volume Rendering (WebGPU)

**Version:** 1.4 (integrates Layer data model and LayerStack concept)
**Status:** Adopted
**Context:** Defines the architecture and shader contracts for rendering multiple volumetric layers using WebGPU within Brainflow Phase 1. References the `Volume<D>` trait for abstract data access.

## 0. Core Principle

The Brainflow WebGPU slice renderer operates in a **canonical LPI world-millimetre space**. Each layer (any Rust type implementing the `Volume<D>` trait) exposes a `space()` method that yields an affine matrix transforming **voxel -> world**.
The inverse is stored in the UBO (*world -> voxel*) so that shaders can sample data irrespective of disk orientation.

**Why that matters**
*   A file stored RPI, ASR, oblique, cropped, etc. still maps into the common frame – no per-layer exceptions in the shader.
*   CPU code (scroll, pick) manipulates world Z/Y/X only; the per-layer inverse matrix takes care of flips and swaps.

## 1. Layer Data Model (TypeScript ⇄ ts-rs ⇄ Rust)

/** Pure data — loaded once, never mutated after SAB upload */
export interface VolumeHandle {
  id: string;                     // registry / SAB key
  dim: [number, number, number];  // native voxel grid
  worldToVoxel: Float32Array;     // affine; immutable
  texFormat: GpuTextureFormat;    // chosen by loader policy
}

/** Per-layer *display* knobs — edited every frame */
export interface DisplayProps {
  colormapId : string;            // LUT layer in atlas
  opacity    : number;            // 0-1
  windowMin  : number;            // value mapped to LUT 0
  windowMax  : number;            // value mapped to LUT 1
  threshLow  : number;            // < low  → alpha = 0
  threshHigh : number;            // > high → alpha = 0
  blendMode  : "alpha" | "add" | "max" | "min";
}

/** A *Layer* = immutable data + mutable style */
export interface Layer {
  id         : string;            // UUID (UI scope)
  volume     : VolumeHandle;      // reference, not copy
  display    : DisplayProps;      // shallow-copy on edit
}

// ts-rs derives the mirror Rust structs:
/*
#[derive(TS, Serialize, Clone)]
pub struct VolumeHandle { /* … */ }

#[derive(TS, Serialize, Clone)]
pub struct DisplayProps  { /* … */ }

#[derive(TS, Serialize, Clone)]
pub struct Layer        { /* … */ }
*/

## 2. Data Loading & GPU Upload Path

1.  UI triggers `CoreApi.loadFile(path)`.
2.  `TauriCommands` uses `LoaderRegistry` to find appropriate `Loader` (e.g., `NiftiLoader`).
3.  The `Loader` (trait defined in `core/bridge_types`) loads the file, potentially performing I/O and decompression.
4.  The `Loader` parses the file, extracts metadata and voxel data, and constructs an implementation of the `Volume<D>` trait (e.g., `DenseVolume3<f32>`), wrapping it in the `VolumeSendable` enum (defined in `core/bridge_types`).
5.  A handle (e.g., `VolumeHandle`) representing the loaded `Volume<D>` object (now stored in a Rust-side registry, likely as `VolumeSendable`) is returned to the UI.
6.  UI uses the handle to request GPU resources via `CoreApi.requestLayerGpuResources(spec)`.
7.  `TauriCommands` retrieves the corresponding `VolumeSendable` object from the registry and potentially unwraps the inner `Volume<D>` implementor.
8.  **GPU Upload Check:** The command checks if the `Volume<D>` implementation supports direct buffer access by calling `.as_bytes()`. If `Some(bytes)`, the bytes are uploaded to the GPU texture atlas (potentially via `RenderLoopService`). If `None` (e.g., for sparse or procedural volumes), an error (`GpuUploadError::NotDense` or similar) is returned, as direct upload isn't possible.
9.  On successful upload, `VolumeLayerGPU` metadata (including `worldToVoxel` matrix derived from `Volume<D>::space()`) is returned to the UI.

**Step 2 bis – determining storage layout**
`NiftiLoader` binds the NIfTI-header orientation (`qform`/`sform`) to `Volume<D>::space()` so that:
```text
space().affine == Voxel->LPI-world 4x4
```
No assumptions are made about slice order or sign.

## 3. GPU Resources

This section details the key GPU resources managed by the `RenderLoopService`.

### 3.A. Frame Uniform Buffer Object (FrameUbo) - *New*

This UBO provides per-frame information necessary to position and orient the view slice correctly in world space without requiring matrix inversions on the GPU.

```wgsl
struct FrameUbo {
    origin_mm : vec4<f32>,   // Plane center in world mm (homogeneous, w = 1)
    u_mm      : vec4<f32>,   // World vector mapping to clip space +X (vector, w = 0)
    v_mm      : vec4<f32>,   // World vector mapping to clip space +Y (vector, w = 0)
    // Total size: 3 * vec4<f32> = 48 bytes
};
```

*   **Population:** Calculated in TypeScript based on the current view plane (Axial/Coronal/Sagittal) and crosshair position. `origin_mm` is the crosshair world coordinate. `u_mm` and `v_mm` are the orthogonal world-space basis vectors for the current view plane (e.g., +X and +Y world vectors for an Axial view).
*   **Binding:** Bound at `@group(0) @binding(0)`.

### 3.B. Crosshair Uniform Buffer Object (CrosshairUbo) - *New*

Stores the precise world-millimeter coordinates of the crosshair, updated via the `set_crosshair` command.

```rust
// In Rust (e.g., core/render_loop/src/ubo.rs)
#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
pub struct CrosshairUbo {
    pub world_position: [f32; 3],
    _padding: f32, // Align to 16 bytes
}
```

```wgsl
// In WGSL
struct CrosshairUbo {
    world_position : vec3<f32>,
    // Implicit padding to 16 bytes
};
```

*   **Size:** 16 bytes.
*   **Binding:** Bound at `@group(0) @binding(1)`.

### 3.C. View Plane Uniform Buffer Object (ViewPlaneUbo) - *New*

A small UBO indicating the current orthogonal view plane.

```rust
// In Rust (e.g., core/render_loop/src/ubo.rs)
#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
pub struct ViewPlaneUbo {
    pub plane_id: u32, // 0=Axial, 1=Coronal, 2=Sagittal
    // Requires explicit std140 padding if used alone,
    // but wgsl treats u32 as aligned to 4 bytes within a struct/buffer.
    // If bound alone, min_binding_size should reflect required padding (e.g. 16).
}
```

```wgsl
// In WGSL
struct ViewPlaneUbo {
    plane_id : u32,
};
```

*   **Size:** 4 bytes (potentially padded to 16 bytes by `wgpu` depending on layout rules if bound alone, but typically requires `min_binding_size=4` when bound alongside other UBOs in a group).
*   **Binding:** Bound at `@group(0) @binding(2)`.

### 3.D. Per-Layer Uniform Buffer Objects (LayerUbo Array)

Contains display properties specific to each volume layer.

```wgsl
// WGSL Definition (matches previous spec)
struct LayerUBO {
    world_to_voxel : mat4x4<f32>,
    colormap_id    : u32,
    blend_mode     : u32,        // 0=alpha, 1=add, 2=max, 3=min
    layer_index    : u32,        // original logical index
    dim            : vec3<u32>,
    padSlices      : u32,        // Padding for texture atlas alignment
    opacity        : f32,
    intensity_min  : f32,
    intensity_max  : f32,
    thresh_low     : f32,
    thresh_high    : f32,
};
// Total size: 80 bytes per layer
```

*   **Binding:** Bound as an array at `@group(1) @binding(0)`. An additional uniform `activeLayerCount: u32` at `@group(1) @binding(1)` indicates how many entries in the array are valid.

### 3.E. Volume Texture Atlas

(Content unchanged from previous version: Primarily R16Float, 2D Array or 3D, Linear filtering, multi-resolution packing description)
// ... existing content for Volume Texture Atlas ...

### 3.F. Colormap Look-Up Texture (LUT)

(Content unchanged from previous version: 2D Array, RGBA8Unorm, colormap_id selects layer)
// ... existing content for Colormap LUT ...

### 3.G. Bind Group Layout Summary

*   **`@group(0)` (Global/Frame):** Contains UBOs updated frequently, related to view parameters.
    *   `@binding(0)`: `FrameUbo` (origin, basis vectors)
    *   `@binding(1)`: `CrosshairUbo` (world position)
    *   `@binding(2)`: `ViewPlaneUbo` (plane ID)
*   **`@group(1)` (Layer Data):** Contains per-layer display settings.
    *   `@binding(0)`: `array<LayerUBO, MAX_LAYERS>`
    *   `@binding(1)`: `activeLayerCount: u32`
*   **`@group(2)` (Textures/Samplers):** Contains large, less frequently changed resources.
    *   `@binding(0)`: `volumeAtlasTexture: texture_2d_array<f32>` (or appropriate format)
    *   `@binding(1)`: `samplerLinear: sampler`
    *   `@binding(2)`: `colormapLutTexture: texture_2d_array<f32>`
    *   `@binding(3)`: `cmSampler: sampler`

## 4. Shader Contract (WGSL Fragment Shader Logic)

(Updated vertex shader signature and added slice_index helper)

// --- Bindings ---
@group(0) @binding(0) var<uniform> frame: FrameUbo;
@group(0) @binding(1) var<uniform> crosshair: CrosshairUbo; // Not directly used in core sampling, but available
@group(0) @binding(2) var<uniform> viewPlane: ViewPlaneUbo;
@group(1) @binding(0) var<uniform> layerUBOs : array<LayerUBO, 8>; // MAX_LAYERS = 8 example
@group(1) @binding(1) var<uniform> activeLayerCount : u32;
@group(2) @binding(0) var volumeAtlasTexture: texture_2d_array<f32>;
@group(2) @binding(1) var samplerLinear: sampler;
@group(2) @binding(2) var colormapLutTexture: texture_2d_array<f32>;
@group(2) @binding(3) var cmSampler: sampler;

// --- Vertex Shader ---
struct VsOut {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_mm: vec3<f32>, // Pass world coords to fragment shader
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VsOut {
    // Generate simple full-screen quad vertices in clip space (-1 to +1)
    let pos = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
        vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0)
    );
    let clip_uv = pos[vid]; // Clip space XY for this vertex

    // Calculate world position using FrameUbo (no matrix math needed here)
    let world_pos_h = frame.origin_mm + clip_uv.x * frame.u_mm + clip_uv.y * frame.v_mm;

    var output : VsOut;
    output.clip_position = vec4<f32>(clip_uv, 0.0, 1.0); // Z=0, W=1 standard clip space quad
    output.world_mm = world_pos_h.xyz;                  // Pass calculated world coords
    return output;
}


// --- Helper: slice_index --- *New*
// Calculates the integer slice index within a layer's grid for a given world coordinate and view plane.
fn slice_index(world_mm: vec3<f32>, layer: LayerUBO, plane_id: u32) -> i32 {
    // Transform world coordinate to this layer's native voxel coordinate
    let voxel_coord_h = layer.world_to_voxel * vec4<f32>(world_mm, 1.0);
    let voxel_coord = voxel_coord_h.xyz / voxel_coord_h.w; // Handle perspective divide if matrix wasn't affine (usually is)

    // Select the component corresponding to the view plane's normal axis in the layer's grid
    let k_voxel : f32 = switch plane_id {
        case 0u: { voxel_coord.z } // Axial view plane -> Z voxel axis
        case 1u: { voxel_coord.y } // Coronal view plane -> Y voxel axis
        case 2u: { voxel_coord.x } // Sagittal view plane -> X voxel axis
        default: { voxel_coord.z } // Default to Axial
    };

    // Round to nearest integer slice index
    return i32(floor(k_voxel + 0.5));
}

// --- Helper: sampleLayer ---
// (Updated to use slice_index helper)
fn sampleLayer(layer: LayerUBO, world_mm: vec3<f32>, plane_id: u32) -> vec4<f32> {
    // 1. Map World -> Voxel -> Atlas Coord (using layer.world_to_voxel)
    let voxel_coord_h = layer.world_to_voxel * vec4<f32>(world_mm, 1.0);
    // Check if behind the homogeneous clip plane (optional, depends on matrix)
    if (voxel_coord_h.w <= 0.0) { return vec4<f32>(0.0); }
    let voxel_coord = voxel_coord_h.xyz / voxel_coord_h.w;

    // 2. Check Voxel Bounds (using layer.dim)
    if (any(voxel_coord < vec3<f32>(0.0)) || any(voxel_coord >= vec3<f32>(layer.dim))) {
        return vec4<f32>(0.0); // Outside layer bounds -> transparent black
    }

    // 3. Sample Texture using calculated slice index
    let k_slice = slice_index(world_mm, layer, plane_id); // *** Use the helper ***
    let atlas_uvw = vec3<f32>(voxel_coord.xy, f32(k_slice)); // Assuming atlas uses voxel XY directly for now

    // TODO: Incorporate actual atlas mapping logic here if voxel_coord.xy isn't direct UV
    // Need logic based on layer.padSlices and atlas layout if complex packing is used.
    // For now, assume simple direct mapping for sampling:
    let raw_value = textureSample(volumeAtlasTexture, samplerLinear, atlas_uvw).r; // Sample appropriate channel

    // 4. Window/Level/Threshold (using layer.intensity_*, layer.thresh_*) -> intensity_norm, alpha
    let intensity_delta = max(layer.intensity_max - layer.intensity_min, 1e-6); // Avoid div by zero
    let intensity_norm = clamp((raw_value - layer.intensity_min) / intensity_delta, 0.0, 1.0);

    var alpha = layer.opacity;
    if (raw_value < layer.thresh_low || raw_value > layer.thresh_high) {
        alpha = 0.0;
    }

    // 5. Apply Colormap LUT (using layer.colormap_id, intensity_norm) -> rgb_color
    // Assuming colormapLutTexture is 2D Array, [0..255]x1 per layer
    let lut_coord = vec2<f32>(intensity_norm, 0.5); // Sample center of 1px high texture
    let rgb_color = textureSample(colormapLutTexture, cmSampler, lut_coord, layer.colormap_id).rgb;

    return vec4<f32>(rgb_color, alpha * intensity_norm); // Modulate alpha by normalized intensity? Or just use alpha? Needs decision. Let's use alpha.
    // return vec4<f32>(rgb_color, alpha);
}

// --- Helper: composite ---
fn composite(dst: vec4<f32>, src: vec4<f32>, mode: u32) -> vec4<f32> {
    if (src.a <= 0.0) { return dst; }
    switch(mode) {
        case 1u { /* Additive */ return vec4<f32>(clamp(dst.rgb + src.rgb * src.a, vec3(0.0), vec3(1.0)), max(dst.a, src.a)); }
        case 2u { /* Max */ return vec4<f32>(max(dst.rgb, src.rgb), max(dst.a, src.a)); }
        case 3u { /* Min */ return vec4<f32>(min(dst.rgb, src.rgb), max(dst.a, src.a)); }
        // Default: Alpha Blending (Over) - Assumes premultiplied alpha for src color
        default { let out_alpha = src.a + dst.a * (1.0 - src.a); return vec4<f32>((src.rgb * src.a + dst.rgb * dst.a * (1.0 - src.a)) / out_alpha , out_alpha); } // Correct non-premultiplied OVER
        // Alternative simplified OVER (if inputs are considered non-premultiplied):
        // default { return vec4<f32>(src.rgb * src.a + dst.rgb * (1.0 - src.a), src.a + dst.a * (1.0 - src.a)); }
    }
}

// --- Main Fragment Shader ---
@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> { // Input now struct VsOut
    var final_color = vec4<f32>(0.0, 0.0, 0.0, 0.0); // Start transparent black
    let current_world_mm = input.world_mm;          // Get world coords from vertex shader

    for (var i: u32 = 0u; i < activeLayerCount; i = i + 1u) {
        let layer_ubo = layerUBOs[i];
        // Pass viewPlane.plane_id to sampleLayer
        let layer_color = sampleLayer(layer_ubo, current_world_mm, viewPlane.plane_id);
        final_color = composite(final_color, layer_color, layer_ubo.blend_mode);
    }
    // Optional: Apply gamma correction or other post-processing
    return final_color;
}

// ... rest of ADR-002 ...

// Add update to Section 11.3 Crosshair Synchronization Details

### 11.3 Crosshair Synchronization Details

*   **Single source of truth:** A shared `CrosshairUbo` (holding `vec3<f32> world_mm`) is bound at `@group(0) @binding(1)`. Pointer-down *or slider interaction* on any panel triggers the `set_crosshair` command, which writes the new world-millimeter coordinate into this UBO via `queue.write_buffer`.
*   **Per-panel slice selection:** The active view plane is determined by the `ViewPlaneUbo` (`u32 plane_id`) bound at `@group(0) @binding(2)`. The fragment shader uses the `slice_index` helper function, taking the interpolated `world_mm` (calculated in the vertex shader using `FrameUbo`), the current `LayerUBO`, and the `plane_id` to determine the correct integer slice index `k` for sampling the texture atlas. This inherently handles orientation differences via the `LayerUBO.world_to_voxel` matrix.
*   **Zero-latency visual feedback:** The `set_crosshair` command writes directly into the UBO buffer using the shared `wgpu::Queue`. The visible update happens on the very next GPU frame (<16 ms), keeping interaction crisp. The `FrameUbo` (containing origin and basis vectors) is also updated per frame, potentially based on the crosshair position and view plane, ensuring the vertex shader correctly calculates world positions for the fragment shader.
*   **Programmatic API:** TS helper `coreApi.set_crosshair(world_mm: [number,number,number])` wraps the Tauri command, enabling plugins to drive the crosshair. Similarly, `coreApi.set_view_plane(plane_id: number)` updates the `ViewPlaneUbo`.

// ... rest of ADR-002 ...

5. Rust Implementation Details
5.A. **Voxel Data Type (`Volume<D>::Scalar`) to GPU Texture Format Policy (v0.1.1)**
Source Voxel Type	Target GPU Format	Upload Rule (Rust)
uint8 / int8	R8Unorm	Upload directly.
int16 / uint16	R16Float	Cast to f16 CPU-side.
float32 / float64	R16Float / R32Float	Heuristic: R16F if range fits, else R32F.
RGB(A) u8 (Future)	RGBA8Unorm	Pack directly.
5.B. `world_to_voxel` Matrix Calculation
Calculated in Rust when preparing `VolumeLayerGPU`. Combines the inverse of the affine matrix obtained from `Volume<D>::space()` with the necessary scaling/offset transformations required to map voxel coordinates to the specific location within the GPU texture atlas where the volume's data was uploaded.

**Clarification:** The inverse affine component correctly maps LPI world coordinates to the volume's native grid coordinates (axes 0, 1, 2), inherently handling the volume's orientation. The subsequent atlas transformations map these grid coordinates to the appropriate (u, v, slice_index) within the texture. Therefore, the shader correctly samples the texture data using this matrix, regardless of which grid axis (0, 1, or 2) was used by helper functions like `get_slice` to initially extract and upload the data to the atlas.

When a volume is cropped (e.g. brain-only FoV), its affine already contains the offset. The atlas packing then appends scaling/translation to map voxel **indices** into `(u,v,slice)` texel space.
```text
W2V = inverse(voxel_to_world) · texTransform
```
No additional FoV uniform is required — out-of-bounds checks in the shader simply discard fragments if any component is < 0 or >= dim.

5.C. Colormap Management
(No changes from previous description - Rust service manages LUT texture array)
5.D. Role of `Volume<D>` Trait**
The `Volume<D>` trait provides a unified interface for accessing volumetric data, regardless of its underlying storage (dense, sparse, procedural). The rendering system interacts with this trait:
*   `space()`: Provides the dimensions and affine transform needed to calculate the `world_to_voxel` matrix for the UBO.
*   `get()`: Could be used for CPU-based sampling or data extraction (though GPU sampling is preferred for rendering).
*   `as_bytes()`: Enables optimized GPU texture uploads for dense volumes. Implementations that return `None` cannot be directly uploaded via this path.
*   `slice_fast_axis()`: Optional optimization for certain access patterns.
5.E **Orthogonal slice extraction in RenderLoopService**
*(new — solves the "axial/coronal/sagittal for RPI files" question)*

1.  UI declares the desired *world* plane normal (**+Z**, **+Y**, **+X**) and millimetre offset.
2.  For each layer we pick the voxel axis whose affine column has the largest |dot| with that normal.
    *Axis flips* come for free from the column sign.
3.  Index along that axis is computed by transforming the world-mm plane point through `W2V` and rounding.
4.  A tight 2-D `Vec<T>` slice is copied into the staging buffer — reversed in-CPU if the axis sign is negative.

Because the choice is per-layer we can mix RPI, LAS, oblique & anisotropic volumes in the same viewer; all show the correct anatomical orientation.

5.F **Handling different voxel sizes** 
*(new)*
The shader works in world millimetres, so high-resolution and low-resolution layers are simply oversampled / undersampled.
If an ROI lies outside a low-res FoV, the bounds-check in `sampleLayer` yields `alpha = 0`, so the composite transparently shows only the available data.

6. TypeScript Orchestration
(No changes from previous description - UI updates store, Rust reads store for UBOs)
7. Error Handling Contract
(Added GpuUploadError::NotDense)
Rust Error Enum (GpuUploadError):
#[derive(serde::Serialize, Debug, thiserror::Error)]
#[serde(tag = "code", content = "detail")]
pub enum GpuUploadError {
    #[error("GPU Out of Memory: Needed {needed_mb:.1} MB, Limit ~{limit_mb:.1} MB")]
    OutOfMemory { needed_mb: f32, limit_mb: f32 },
    #[error("Texture dimensions exceed limits: Dim {dim:?}, Max Size {max_dim}")]
    TextureTooLarge { dim: [u32; 3], max_dim: u32 },
    #[error("Unsupported source volume format/dtype: {dtype}")]
    UnsupportedFormat { dtype: String }, // Based on Volume<D>::Scalar
    #[error("Volume not found in registry: {volume_id}")]
    VolumeNotFound { volume_id: String }, // volume_id likely comes from VolumeHandle
    #[error("Volume data is not stored densely and cannot be directly uploaded to GPU: {volume_id}")]
    NotDense { volume_id: String }, // When as_bytes() returns None
    #[error("WGPU Error: {message}")]
    WgpuError { message: String },
}
Use code with caution.
Rust
TypeScript Error Handling: .catch() block parses the structured error.
8. Design Rationale
(No changes from previous description)

<!-- ─────────────────────────────────────────────────────────────── -->
## 9 · Slice-navigation contract 📐 🖱️ (orthogonal viewer)

> *"One slider, one space."*  
> The axial/coronal/sagittal sliders operate **exclusively in canonical world
> millimetres (LPI)**.  Every active volume layer converts that single
> world-Z (or world-X/Y) value to its own integer slice index via its
> `worldToVoxel` matrix.

### 9.1  Why world-mm is the only robust unit

| Candidate slider unit | Works until … | Fails when … | Breakage |
| :-- | :-- | :-- | :-- |
| Bottom-layer voxel index | overlay ≙ template | overlay uses different grid/FOV | Overlay jumps or vanishes |
| Top-overlay voxel index | single overlay | user re-orders layers | Semantics change mid-session |
| Per-layer pick list | — | user forgets to switch | UX complexity |
| **World Z (mm)** | **never** | — | Deterministic for all layers ✔︎ |

All maths in ADR-002 already assumes LPI world mm, so reuse it for UI
navigation.

### 9.2  Implementation recipe

1. **Slider range**  
   `minZ_world = min(layer_i.world_bbox.z_min)`  
   `maxZ_world = max(layer_i.world_bbox.z_max)`

2. **Default step** = **1 mm**  
   Provide ×2/×5 accelerator keys for fast scrolling.

3. **FrameState ABI** (extends guard-rail §8)  
   ```rust
   struct FrameState {
       slice_k_mm : f32,        // world millimetres along view axis
       crosshair  : vec3<f32>,
       num_layers : u32,
       …
   }

	4.	Per-layer slice index (CPU or WGSL):

let voxel = layer.world_to_voxel * vec4<f32>(world_mm, 1.0);
let k     = round(voxel.z);        // integer slice in layer grid


	5.	Out-of-FOV behaviour – If k is outside 0..layer.dim.z, shader
returns alpha = 0 (layer vanishes gracefully).
	6.	Snap-to-native shortcut – ⇧+scroll (or S) snaps
slice_k_mm to the nearest native slice of the selected layer.

9.3  Edge cases
	•	Anisotropic data (e.g. 3×3×7 mm): quantise the slider to the
smallest Z-spacing among active layers to avoid requesting sub-slice
interpolation on very thick slices.
	•	Missing template – Overlay-only stacks still work; range derives
from overlay bounding box.

⸻

This contract ensures that orthogonal slice navigation stays perfectly
in sync across heterogeneous layers differing in resolution, FOV or
on-disk orientation, while keeping the hot path (one mat-mul) trivial
and GPU-friendly.

---


## 10. Relation to Data APIs
This rendering specification is independent of the data extraction APIs like getTimeseriesMatrix. While the renderer displays layers, data extraction for analysis operates on the underlying Volume data buffers directly via the Core API, potentially returning richer DataFrame structures.

## 11 · Orthogonal viewer default & cross-view synchronisation
*(new)*

### 11.1 Default Viewer
*   **Default on launch** `OrthogonalViewer` (three-panel axial | coronal | sagittal) is instantiated immediately after `RenderLoopService` is ready and *before* any dock-layout is restored. This guarantees that the user always sees a brain image even if the saved layout is corrupt.
*   The `VolumeView.svelte` component implements this 3-panel view internally.

### 11.2 Interaction Loop Example
1.  **Initial layout (App start):** `LayerStack` store is initialized with a base anatomical layer:
    ```typescript
    stack.order = ["anat"]; // template bottom layer
    stack.map.anat = {
        id:"anat", volume: anatVolumeHandle,
        display: { colormapId:"gray", opacity:1,
                   windowMin: 0, windowMax: 1000, // Example window
                   threshLow:-Infinity, threshHigh:+Infinity,
                   blendMode:"alpha" }
    }
    ```
2.  **User clicks axial view →** Panel emits `cursorPick(world_mm)` event or updates store.
    *   **Alternative:** User drags a slider associated with the axial view. The slider position is mapped to a world Z coordinate based on the current view extents and the volume bounds.
3.  **Voxel lookup (optional):** `coreApi.worldToVoxel(anatVolumeHandle.id, world_mm)` can return `[i,j,k]` for status bar display.
4.  **Store update:** `LayerStack` store's `crosshair` state is updated with the new `world_mm` (either from click or slider).
5.  **Reactive update:** Svelte components for sagittal & coronal views react to the `crosshair` change.
6.  **Slice update:** Each view calculates its required slice `k` based on its view axis and the new `crosshair` world coordinate (as described in §5.E) and tells the `RenderLoopService` to prioritize rendering that slice index (e.g., via UBO update or dedicated command).

### 11.3 Crosshair Synchronization Details
*   **Single source of truth** A shared `CrosshairState` (struct `[f32;3] world_mm`) lives in the frame UBO. Pointer-down *or slider interaction* on any panel writes the new world-millimetre coordinate; the render loop's next tick broadcasts it to all panels via the mapped buffer.
*   **Per-panel slice selection** For each view-axis `A∈{X,Y,Z}` the slice index is `round( (world_mm · axis_A) – origin_A ) / spacing_A ).clamp(0, dim_A-1)` in the panel's local grid. This uses exactly the same `grid_to_coord ↔ coord_to_grid` functions already documented in § 5.E, so orientation flips and sub-voxel precision are handled automatically.
*   **Zero-latency visual feedback** The click-setter *or slider update* writes directly into the mapped buffer; no async Tauri round-trip is required. The visible update therefore happens on the very next GPU frame (<16 ms), keeping interaction feel crisp.
*   **Programmatic API** TS helper `viewer.setCrosshair(world_mm: [number,number,number])` wraps the same write, enabling plugins (e.g. atlas-pick) to drive the crosshair.

## 12. Summary - Handling Data Variations (New)

| Issue                             | Where it is solved                                                                                                |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------- | 
| Different Resolutions             | `VolumeHandle.dim` and `worldToVoxel` affine encode spacing; shader samples layers in common world space.       |
| Different FOV / Offsets           | Affine matrix includes translation; out-of-FOV fragments get alpha=0 via shader bounds check using `dim`.         |
| Different On-Disk Orientation (RPI etc.) | Loader computes correct `Voxel->LPIWorld` affine from header; inverse `World->Voxel` matrix is put in UBO. Shader uses this matrix, correctly sampling the texture regardless of original orientation. (See §5.B, §5.E) |

## 13. Blending Semantics (New)

*   The `blendMode` in `DisplayProps` directly maps to `LayerUBO.blend_mode`.
*   The fragment shader's `composite()` function (see §4) implements the different blend modes (alpha, add, max, min) based on this UBO field.
*   Changing colormap, window, thresholds, or blend mode only affects the `DisplayProps` within the `LayerStack` store. Updating a layer's style is therefore a lightweight store mutation and results in only the small UBO data being sent to the GPU per frame.

## 14. Design Summary (New)

*   **Modularity:** Volumes (`VolumeHandle`) are immutable data references managed by Rust registries and the GPU texture atlas. Display styles (`DisplayProps`) live in a small, reactive TypeScript store (`LayerStack`).
*   **Extensibility:** Adding new layers (e.g., statistical maps, annotations) involves adding a new `Layer` entry to the `LayerStack` with its own `VolumeHandle` and `DisplayProps`. The core rendering logic doesn't need modification.
*   **Performance:** Only immutable handles (`VolumeHandle.id`) cross the Rust/TS boundary after initial load. Per-frame UBO updates are minimal (≤ few hundred bytes), ensuring smooth interaction even with many layers.

## 15. Surface Data Loading and Rendering

This section defines the architecture for loading and rendering triangle-mesh surfaces (GIfTI, FreeSurfer) alongside volumetric layers, using the same zero-copy principles and rendering infrastructure.

### 15.1 Surface Format Support

| Format | Crate | Status | Capabilities | Notes |
| :--- | :--- | :--- | :--- | :--- |
| GIFTI (*.gii) | `gifti` | Actively maintained (0.7+) | Binary-safe read/write of data arrays<br>Handles ASCII and base64-encoded payloads<br>Exposes vertex/triangle arrays as `Vec<f32>`/`Vec<u32>` | No in-crate spatial orientation helpers (we derive from the header's `Matrix_*` or fall back to MNI LPI) |
| FreeSurfer binary (surf, pial, white, ...) | `neuroformats::fs_surface` | Stable (0.3+) | `read_surf()`/`write_surf()` give vertices & faces<br>Also supports FreeSurfer-MGH volumes & annotation tables | Only the binary surface format; ASCII "*.asc" needs a wrapper |
| FreeSurfer ASCII (*.asc) | Not in a crate | N/A | Parsing is trivial (header + two space-separated tables) | ASCII lacks normals; compute them or read from *.curv |

Example usage from `neuroformats`:
```rust
use neuroformats::fs_surface::read_surf;
let (vtx, tri) = read_surf("lh.pial")?;  // vtx: Vec<[f32;3]>, tri: Vec<[i32;3]>
```

### 15.2 Triangle Mesh Data Model

Similar to our `VolumeSendable` enum, we introduce a `SurfaceSendable` enum for surfaces:

```rust
// core/geom/src/tri_mesh.rs
use bytemuck::{Pod, Zeroable};
use nalgebra::{Vector3, Matrix4};
use serde::Serialize;

/// POD bound identical to VoxelData, kept separate for clarity
pub trait VertexScalar: Copy + Pod + Zeroable + 'static {}
impl<T: Copy + Pod + Zeroable + 'static> VertexScalar for T {}

#[derive(Debug, Clone, Serialize)]
pub struct TriMesh<T: VertexScalar = f32> {
    /// Vertex positions interleaved as [x0,y0,z0, x1,y1,z1, ...]
    pub vertices: Vec<T>,
    /// Face indices (triangle list) as [i0,j0,k0, i1,j1,k1, ...]
    pub indices: Vec<u32>,
    /// Optional per-vertex normals (same stride as vertices)
    pub normals: Option<Vec<T>>,
    /// Optional per-vertex values (e.g. curvature / label)
    pub scalars: Option<Vec<T>>,
    /// World-space transform (e.g. GIFTI's Matrix_*)
    pub world_from_vertex: Matrix4<f32>,
}

impl<T: VertexScalar> TriMesh<T> {
    #[inline] pub fn vertex_count(&self) -> usize { self.vertices.len() / 3 }
    #[inline] pub fn triangle_count(&self) -> usize { self.indices.len() / 3 }

    /// Borrow as raw bytes – enables zero-copy SAB transfer & GPU upload
    #[inline] pub fn vertices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.vertices)
    }
    #[inline] pub fn indices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.indices)
    }
}

// core/bridge_types/src/surface_sendable.rs
#[derive(Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../packages/api/src/generated/surface.ts")]
pub enum SurfaceSendable {
    MeshF32(TriMesh<f32>),
    MeshF64(TriMesh<f64>),
}

impl SurfaceSendable {
    pub fn as_bytes(&self) -> (&[u8], &[u8]) {
        match self {
            Self::MeshF32(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
            Self::MeshF64(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
        }
    }
}
```

The TypeScript mirror (auto-generated):

```typescript
// packages/api/generated/surface.ts (generated by ts-rs)
export type SurfaceSendable =
  | { MeshF32: TriMeshF32 }
  | { MeshF64: TriMeshF64 };

export interface TriMeshF32 {
  vertices: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  scalars?: Float32Array;
  world_from_vertex: Float32Array; // length 16, row-major
}
```

### 15.3 Integration Path

1. **Add loaders under `core/loaders/`:**
   ```
   core/
     loaders/
       gifti/
         lib.rs   // re-export gifti::*, add Into<Surface> conversion
       freesurfer/
         lib.rs   // use neuroformats::fs_surface; if asc needed, embed parser
   ```

2. **Loader Implementation**
   Each loader implements the existing async `Loader` trait, returning `(id, SurfaceSendable)`. The existing `api_bridge::load_file` already supports polymorphic return, requiring only the switch/enum arm addition.

3. **Rendering Path**
   Triangle meshes follow the same `request_layer_gpu_resources` flow but map to the reserved `SurfaceLayerSpec`/`SurfaceLayerGPU` variants. The render loop creates `wgpu::Buffer` resources for vertices/indices and binds them in the surface pipeline.

4. **Surface GPU Resources**
   ```rust
   struct SurfaceLayerGPU {
       vertex_buffer_id: u32,
       index_buffer_id: u32,
       index_count: u32,
       world_from_vertex: [[f32;4];4],
   }
   ```

5. **Unit Testing**
   Add an `fs_testdata/` folder with small sample surface files (`.pial`, `.asc`, `.gii`) for unit tests that verify round-trip through the loaders.

### 15.4 TypeScript Data Access

The same dual-representation pattern used for volumes applies to surfaces:
1. Rust loader handles the heavy payload parsing
2. For lightweight TypeScript algorithms (e.g., coloring by curvature), pass metadata and a SharedArrayBuffer view to the worker without copying
3. Binary parsers remain in Rust - no TS reimplementation

### 15.5 Implementation Effort

* No show-stoppers: both GIFTI and FreeSurfer surfaces have working Rust crates
* Estimated effort:
  * Wire loaders: ~1 day
  * Optional ASCII parser: ~0.25 day
* Alignment: Fits with Phase-1 plan - surfaces land in Sprint 2 without derailing volume work

**See also:** The UI-side contract for real-time layer editing, including LayerUBO field updates and the patch_layer command, is detailed in GUIDE-ui-layout-phase1.md Section 11.

## 16. Summary - Handling Data Variations (New)

| Issue                             | Where it is solved                                                                                                |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------- | 
| Different Resolutions             | `VolumeHandle.dim` and `worldToVoxel` affine encode spacing; shader samples layers in common world space.       |
| Different FOV / Offsets           | Affine matrix includes translation; out-of-FOV fragments get alpha=0 via shader bounds check using `dim`.         |
| Different On-Disk Orientation (RPI etc.) | Loader computes correct `Voxel->LPIWorld` affine from header; inverse `World->Voxel` matrix is put in UBO. Shader uses this matrix, correctly sampling the texture regardless of original orientation. (See §5.B, §5.E) |

## 17. Blending Semantics (New)

*   The `blendMode` in `DisplayProps` directly maps to `LayerUBO.blend_mode`.
*   The fragment shader's `composite()` function (see §4) implements the different blend modes (alpha, add, max, min) based on this UBO field.
*   Changing colormap, window, thresholds, or blend mode only affects the `DisplayProps` within the `LayerStack` store. Updating a layer's style is therefore a lightweight store mutation and results in only the small UBO data being sent to the GPU per frame.

## 18. Design Summary (New)

*   **Modularity:** Volumes (`VolumeHandle`) are immutable data references managed by Rust registries and the GPU texture atlas. Display styles (`DisplayProps`) live in a small, reactive TypeScript store (`LayerStack`).
*   **Extensibility:** Adding new layers (e.g., statistical maps, annotations) involves adding a new `Layer` entry to the `LayerStack` with its own `VolumeHandle` and `DisplayProps`. The core rendering logic doesn't need modification.
*   **Performance:** Only immutable handles (`VolumeHandle.id`) cross the Rust/TS boundary after initial load. Per-frame UBO updates are minimal (≤ few hundred bytes), ensuring smooth interaction even with many layers.

## 19. Surface Data Loading and Rendering

This section defines the architecture for loading and rendering triangle-mesh surfaces (GIfTI, FreeSurfer) alongside volumetric layers, using the same zero-copy principles and rendering infrastructure.

### 19.1 Surface Format Support

| Format | Crate | Status | Capabilities | Notes |
| :--- | :--- | :--- | :--- | :--- |
| GIFTI (*.gii) | `gifti` | Actively maintained (0.7+) | Binary-safe read/write of data arrays<br>Handles ASCII and base64-encoded payloads<br>Exposes vertex/triangle arrays as `Vec<f32>`/`Vec<u32>` | No in-crate spatial orientation helpers (we derive from the header's `Matrix_*` or fall back to MNI LPI) |
| FreeSurfer binary (surf, pial, white, ...) | `neuroformats::fs_surface` | Stable (0.3+) | `read_surf()`/`write_surf()` give vertices & faces<br>Also supports FreeSurfer-MGH volumes & annotation tables | Only the binary surface format; ASCII "*.asc" needs a wrapper |
| FreeSurfer ASCII (*.asc) | Not in a crate | N/A | Parsing is trivial (header + two space-separated tables) | ASCII lacks normals; compute them or read from *.curv |

Example usage from `neuroformats`:
```rust
use neuroformats::fs_surface::read_surf;
let (vtx, tri) = read_surf("lh.pial")?;  // vtx: Vec<[f32;3]>, tri: Vec<[i32;3]>
```

### 19.2 Triangle Mesh Data Model

Similar to our `VolumeSendable` enum, we introduce a `SurfaceSendable` enum for surfaces:

```rust
// core/geom/src/tri_mesh.rs
use bytemuck::{Pod, Zeroable};
use nalgebra::{Vector3, Matrix4};
use serde::Serialize;

/// POD bound identical to VoxelData, kept separate for clarity
pub trait VertexScalar: Copy + Pod + Zeroable + 'static {}
impl<T: Copy + Pod + Zeroable + 'static> VertexScalar for T {}

#[derive(Debug, Clone, Serialize)]
pub struct TriMesh<T: VertexScalar = f32> {
    /// Vertex positions interleaved as [x0,y0,z0, x1,y1,z1, ...]
    pub vertices: Vec<T>,
    /// Face indices (triangle list) as [i0,j0,k0, i1,j1,k1, ...]
    pub indices: Vec<u32>,
    /// Optional per-vertex normals (same stride as vertices)
    pub normals: Option<Vec<T>>,
    /// Optional per-vertex values (e.g. curvature / label)
    pub scalars: Option<Vec<T>>,
    /// World-space transform (e.g. GIFTI's Matrix_*)
    pub world_from_vertex: Matrix4<f32>,
}

impl<T: VertexScalar> TriMesh<T> {
    #[inline] pub fn vertex_count(&self) -> usize { self.vertices.len() / 3 }
    #[inline] pub fn triangle_count(&self) -> usize { self.indices.len() / 3 }

    /// Borrow as raw bytes – enables zero-copy SAB transfer & GPU upload
    #[inline] pub fn vertices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.vertices)
    }
    #[inline] pub fn indices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.indices)
    }
}

// core/bridge_types/src/surface_sendable.rs
#[derive(Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../packages/api/src/generated/surface.ts")]
pub enum SurfaceSendable {
    MeshF32(TriMesh<f32>),
    MeshF64(TriMesh<f64>),
}

impl SurfaceSendable {
    pub fn as_bytes(&self) -> (&[u8], &[u8]) {
        match self {
            Self::MeshF32(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
            Self::MeshF64(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
        }
    }
}
```

The TypeScript mirror (auto-generated):

```typescript
// packages/api/generated/surface.ts (generated by ts-rs)
export type SurfaceSendable =
  | { MeshF32: TriMeshF32 }
  | { MeshF64: TriMeshF64 };

export interface TriMeshF32 {
  vertices: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  scalars?: Float32Array;
  world_from_vertex: Float32Array; // length 16, row-major
}
```

### 19.3 Integration Path

1. **Add loaders under `core/loaders/`:**
   ```
   core/
     loaders/
       gifti/
         lib.rs   // re-export gifti::*, add Into<Surface> conversion
       freesurfer/
         lib.rs   // use neuroformats::fs_surface; if asc needed, embed parser
   ```

2. **Loader Implementation**
   Each loader implements the existing async `Loader` trait, returning `(id, SurfaceSendable)`. The existing `api_bridge::load_file` already supports polymorphic return, requiring only the switch/enum arm addition.

3. **Rendering Path**
   Triangle meshes follow the same `request_layer_gpu_resources` flow but map to the reserved `SurfaceLayerSpec`/`SurfaceLayerGPU` variants. The render loop creates `wgpu::Buffer` resources for vertices/indices and binds them in the surface pipeline.

4. **Surface GPU Resources**
   ```rust
   struct SurfaceLayerGPU {
       vertex_buffer_id: u32,
       index_buffer_id: u32,
       index_count: u32,
       world_from_vertex: [[f32;4];4],
   }
   ```

5. **Unit Testing**
   Add an `fs_testdata/` folder with small sample surface files (`.pial`, `.asc`, `.gii`) for unit tests that verify round-trip through the loaders.

### 19.4 TypeScript Data Access

The same dual-representation pattern used for volumes applies to surfaces:
1. Rust loader handles the heavy payload parsing
2. For lightweight TypeScript algorithms (e.g., coloring by curvature), pass metadata and a SharedArrayBuffer view to the worker without copying
3. Binary parsers remain in Rust - no TS reimplementation

### 19.5 Implementation Effort

* No show-stoppers: both GIFTI and FreeSurfer surfaces have working Rust crates
* Estimated effort:
  * Wire loaders: ~1 day
  * Optional ASCII parser: ~0.25 day
* Alignment: Fits with Phase-1 plan - surfaces land in Sprint 2 without derailing volume work

**See also:** The UI-side contract for real-time layer editing, including LayerUBO field updates and the patch_layer command, is detailed in GUIDE-ui-layout-phase1.md Section 11.

## 20. Summary - Handling Data Variations (New)

| Issue                             | Where it is solved                                                                                                |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------- | 
| Different Resolutions             | `VolumeHandle.dim` and `worldToVoxel` affine encode spacing; shader samples layers in common world space.       |
| Different FOV / Offsets           | Affine matrix includes translation; out-of-FOV fragments get alpha=0 via shader bounds check using `dim`.         |
| Different On-Disk Orientation (RPI etc.) | Loader computes correct `Voxel->LPIWorld` affine from header; inverse `World->Voxel` matrix is put in UBO. Shader uses this matrix, correctly sampling the texture regardless of original orientation. (See §5.B, §5.E) |

## 21. Blending Semantics (New)

*   The `blendMode` in `DisplayProps` directly maps to `LayerUBO.blend_mode`.
*   The fragment shader's `composite()` function (see §4) implements the different blend modes (alpha, add, max, min) based on this UBO field.
*   Changing colormap, window, thresholds, or blend mode only affects the `DisplayProps` within the `LayerStack` store. Updating a layer's style is therefore a lightweight store mutation and results in only the small UBO data being sent to the GPU per frame.

## 22. Design Summary (New)

*   **Modularity:** Volumes (`VolumeHandle`) are immutable data references managed by Rust registries and the GPU texture atlas. Display styles (`DisplayProps`) live in a small, reactive TypeScript store (`LayerStack`).
*   **Extensibility:** Adding new layers (e.g., statistical maps, annotations) involves adding a new `Layer` entry to the `LayerStack` with its own `VolumeHandle` and `DisplayProps`. The core rendering logic doesn't need modification.
*   **Performance:** Only immutable handles (`VolumeHandle.id`) cross the Rust/TS boundary after initial load. Per-frame UBO updates are minimal (≤ few hundred bytes), ensuring smooth interaction even with many layers.

## 23. Surface Data Loading and Rendering

This section defines the architecture for loading and rendering triangle-mesh surfaces (GIfTI, FreeSurfer) alongside volumetric layers, using the same zero-copy principles and rendering infrastructure.

### 23.1 Surface Format Support

| Format | Crate | Status | Capabilities | Notes |
| :--- | :--- | :--- | :--- | :--- |
| GIFTI (*.gii) | `gifti` | Actively maintained (0.7+) | Binary-safe read/write of data arrays<br>Handles ASCII and base64-encoded payloads<br>Exposes vertex/triangle arrays as `Vec<f32>`/`Vec<u32>` | No in-crate spatial orientation helpers (we derive from the header's `Matrix_*` or fall back to MNI LPI) |
| FreeSurfer binary (surf, pial, white, ...) | `neuroformats::fs_surface` | Stable (0.3+) | `read_surf()`/`write_surf()` give vertices & faces<br>Also supports FreeSurfer-MGH volumes & annotation tables | Only the binary surface format; ASCII "*.asc" needs a wrapper |
| FreeSurfer ASCII (*.asc) | Not in a crate | N/A | Parsing is trivial (header + two space-separated tables) | ASCII lacks normals; compute them or read from *.curv |

Example usage from `neuroformats`:
```rust
use neuroformats::fs_surface::read_surf;
let (vtx, tri) = read_surf("lh.pial")?;  // vtx: Vec<[f32;3]>, tri: Vec<[i32;3]>
```

### 23.2 Triangle Mesh Data Model

Similar to our `VolumeSendable` enum, we introduce a `SurfaceSendable` enum for surfaces:

```rust
// core/geom/src/tri_mesh.rs
use bytemuck::{Pod, Zeroable};
use nalgebra::{Vector3, Matrix4};
use serde::Serialize;

/// POD bound identical to VoxelData, kept separate for clarity
pub trait VertexScalar: Copy + Pod + Zeroable + 'static {}
impl<T: Copy + Pod + Zeroable + 'static> VertexScalar for T {}

#[derive(Debug, Clone, Serialize)]
pub struct TriMesh<T: VertexScalar = f32> {
    /// Vertex positions interleaved as [x0,y0,z0, x1,y1,z1, ...]
    pub vertices: Vec<T>,
    /// Face indices (triangle list) as [i0,j0,k0, i1,j1,k1, ...]
    pub indices: Vec<u32>,
    /// Optional per-vertex normals (same stride as vertices)
    pub normals: Option<Vec<T>>,
    /// Optional per-vertex values (e.g. curvature / label)
    pub scalars: Option<Vec<T>>,
    /// World-space transform (e.g. GIFTI's Matrix_*)
    pub world_from_vertex: Matrix4<f32>,
}

impl<T: VertexScalar> TriMesh<T> {
    #[inline] pub fn vertex_count(&self) -> usize { self.vertices.len() / 3 }
    #[inline] pub fn triangle_count(&self) -> usize { self.indices.len() / 3 }

    /// Borrow as raw bytes – enables zero-copy SAB transfer & GPU upload
    #[inline] pub fn vertices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.vertices)
    }
    #[inline] pub fn indices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.indices)
    }
}

// core/bridge_types/src/surface_sendable.rs
#[derive(Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../packages/api/src/generated/surface.ts")]
pub enum SurfaceSendable {
    MeshF32(TriMesh<f32>),
    MeshF64(TriMesh<f64>),
}

impl SurfaceSendable {
    pub fn as_bytes(&self) -> (&[u8], &[u8]) {
        match self {
            Self::MeshF32(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
            Self::MeshF64(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
        }
    }
}
```

The TypeScript mirror (auto-generated):

```typescript
// packages/api/generated/surface.ts (generated by ts-rs)
export type SurfaceSendable =
  | { MeshF32: TriMeshF32 }
  | { MeshF64: TriMeshF64 };

export interface TriMeshF32 {
  vertices: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  scalars?: Float32Array;
  world_from_vertex: Float32Array; // length 16, row-major
}
```

### 23.3 Integration Path

1. **Add loaders under `core/loaders/`:**
   ```
   core/
     loaders/
       gifti/
         lib.rs   // re-export gifti::*, add Into<Surface> conversion
       freesurfer/
         lib.rs   // use neuroformats::fs_surface; if asc needed, embed parser
   ```

2. **Loader Implementation**
   Each loader implements the existing async `Loader` trait, returning `(id, SurfaceSendable)`. The existing `api_bridge::load_file` already supports polymorphic return, requiring only the switch/enum arm addition.

3. **Rendering Path**
   Triangle meshes follow the same `request_layer_gpu_resources` flow but map to the reserved `SurfaceLayerSpec`/`SurfaceLayerGPU` variants. The render loop creates `wgpu::Buffer` resources for vertices/indices and binds them in the surface pipeline.

4. **Surface GPU Resources**
   ```rust
   struct SurfaceLayerGPU {
       vertex_buffer_id: u32,
       index_buffer_id: u32,
       index_count: u32,
       world_from_vertex: [[f32;4];4],
   }
   ```

5. **Unit Testing**
   Add an `fs_testdata/` folder with small sample surface files (`.pial`, `.asc`, `.gii`) for unit tests that verify round-trip through the loaders.

### 23.4 TypeScript Data Access

The same dual-representation pattern used for volumes applies to surfaces:
1. Rust loader handles the heavy payload parsing
2. For lightweight TypeScript algorithms (e.g., coloring by curvature), pass metadata and a SharedArrayBuffer view to the worker without copying
3. Binary parsers remain in Rust - no TS reimplementation

### 23.5 Implementation Effort

* No show-stoppers: both GIFTI and FreeSurfer surfaces have working Rust crates
* Estimated effort:
  * Wire loaders: ~1 day
  * Optional ASCII parser: ~0.25 day
* Alignment: Fits with Phase-1 plan - surfaces land in Sprint 2 without derailing volume work

**See also:** The UI-side contract for real-time layer editing, including LayerUBO field updates and the patch_layer command, is detailed in GUIDE-ui-layout-phase1.md Section 11.

## 24. Summary - Handling Data Variations (New)

| Issue                             | Where it is solved                                                                                                |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------- | 
| Different Resolutions             | `VolumeHandle.dim` and `worldToVoxel` affine encode spacing; shader samples layers in common world space.       |
| Different FOV / Offsets           | Affine matrix includes translation; out-of-FOV fragments get alpha=0 via shader bounds check using `dim`.         |
| Different On-Disk Orientation (RPI etc.) | Loader computes correct `Voxel->LPIWorld` affine from header; inverse `World->Voxel` matrix is put in UBO. Shader uses this matrix, correctly sampling the texture regardless of original orientation. (See §5.B, §5.E) |

## 25. Blending Semantics (New)

*   The `blendMode` in `DisplayProps` directly maps to `LayerUBO.blend_mode`.
*   The fragment shader's `composite()` function (see §4) implements the different blend modes (alpha, add, max, min) based on this UBO field.
*   Changing colormap, window, thresholds, or blend mode only affects the `DisplayProps` within the `LayerStack` store. Updating a layer's style is therefore a lightweight store mutation and results in only the small UBO data being sent to the GPU per frame.

## 26. Design Summary (New)

*   **Modularity:** Volumes (`VolumeHandle`) are immutable data references managed by Rust registries and the GPU texture atlas. Display styles (`DisplayProps`) live in a small, reactive TypeScript store (`LayerStack`).
*   **Extensibility:** Adding new layers (e.g., statistical maps, annotations) involves adding a new `Layer` entry to the `LayerStack` with its own `VolumeHandle` and `DisplayProps`. The core rendering logic doesn't need modification.
*   **Performance:** Only immutable handles (`VolumeHandle.id`) cross the Rust/TS boundary after initial load. Per-frame UBO updates are minimal (≤ few hundred bytes), ensuring smooth interaction even with many layers.

## 27. Surface Data Loading and Rendering

This section defines the architecture for loading and rendering triangle-mesh surfaces (GIfTI, FreeSurfer) alongside volumetric layers, using the same zero-copy principles and rendering infrastructure.

### 27.1 Surface Format Support

| Format | Crate | Status | Capabilities | Notes |
| :--- | :--- | :--- | :--- | :--- |
| GIFTI (*.gii) | `gifti` | Actively maintained (0.7+) | Binary-safe read/write of data arrays<br>Handles ASCII and base64-encoded payloads<br>Exposes vertex/triangle arrays as `Vec<f32>`/`Vec<u32>` | No in-crate spatial orientation helpers (we derive from the header's `Matrix_*` or fall back to MNI LPI) |
| FreeSurfer binary (surf, pial, white, ...) | `neuroformats::fs_surface` | Stable (0.3+) | `read_surf()`/`write_surf()` give vertices & faces<br>Also supports FreeSurfer-MGH volumes & annotation tables | Only the binary surface format; ASCII "*.asc" needs a wrapper |
| FreeSurfer ASCII (*.asc) | Not in a crate | N/A | Parsing is trivial (header + two space-separated tables) | ASCII lacks normals; compute them or read from *.curv |

Example usage from `neuroformats`:
```rust
use neuroformats::fs_surface::read_surf;
let (vtx, tri) = read_surf("lh.pial")?;  // vtx: Vec<[f32;3]>, tri: Vec<[i32;3]>
```

### 27.2 Triangle Mesh Data Model

Similar to our `VolumeSendable` enum, we introduce a `SurfaceSendable` enum for surfaces:

```rust
// core/geom/src/tri_mesh.rs
use bytemuck::{Pod, Zeroable};
use nalgebra::{Vector3, Matrix4};
use serde::Serialize;

/// POD bound identical to VoxelData, kept separate for clarity
pub trait VertexScalar: Copy + Pod + Zeroable + 'static {}
impl<T: Copy + Pod + Zeroable + 'static> VertexScalar for T {}

#[derive(Debug, Clone, Serialize)]
pub struct TriMesh<T: VertexScalar = f32> {
    /// Vertex positions interleaved as [x0,y0,z0, x1,y1,z1, ...]
    pub vertices: Vec<T>,
    /// Face indices (triangle list) as [i0,j0,k0, i1,j1,k1, ...]
    pub indices: Vec<u32>,
    /// Optional per-vertex normals (same stride as vertices)
    pub normals: Option<Vec<T>>,
    /// Optional per-vertex values (e.g. curvature / label)
    pub scalars: Option<Vec<T>>,
    /// World-space transform (e.g. GIFTI's Matrix_*)
    pub world_from_vertex: Matrix4<f32>,
}

impl<T: VertexScalar> TriMesh<T> {
    #[inline] pub fn vertex_count(&self) -> usize { self.vertices.len() / 3 }
    #[inline] pub fn triangle_count(&self) -> usize { self.indices.len() / 3 }

    /// Borrow as raw bytes – enables zero-copy SAB transfer & GPU upload
    #[inline] pub fn vertices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.vertices)
    }
    #[inline] pub fn indices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.indices)
    }
}

// core/bridge_types/src/surface_sendable.rs
#[derive(Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../packages/api/src/generated/surface.ts")]
pub enum SurfaceSendable {
    MeshF32(TriMesh<f32>),
    MeshF64(TriMesh<f64>),
}

impl SurfaceSendable {
    pub fn as_bytes(&self) -> (&[u8], &[u8]) {
        match self {
            Self::MeshF32(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
            Self::MeshF64(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
        }
    }
}
```

The TypeScript mirror (auto-generated):

```typescript
// packages/api/generated/surface.ts (generated by ts-rs)
export type SurfaceSendable =
  | { MeshF32: TriMeshF32 }
  | { MeshF64: TriMeshF64 };

export interface TriMeshF32 {
  vertices: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  scalars?: Float32Array;
  world_from_vertex: Float32Array; // length 16, row-major
}
```

### 27.3 Integration Path

1. **Add loaders under `core/loaders/`:**
   ```
   core/
     loaders/
       gifti/
         lib.rs   // re-export gifti::*, add Into<Surface> conversion
       freesurfer/
         lib.rs   // use neuroformats::fs_surface; if asc needed, embed parser
   ```

2. **Loader Implementation**
   Each loader implements the existing async `Loader` trait, returning `(id, SurfaceSendable)`. The existing `api_bridge::load_file` already supports polymorphic return, requiring only the switch/enum arm addition.

3. **Rendering Path**
   Triangle meshes follow the same `request_layer_gpu_resources` flow but map to the reserved `SurfaceLayerSpec`/`SurfaceLayerGPU` variants. The render loop creates `wgpu::Buffer` resources for vertices/indices and binds them in the surface pipeline.

4. **Surface GPU Resources**
   ```rust
   struct SurfaceLayerGPU {
       vertex_buffer_id: u32,
       index_buffer_id: u32,
       index_count: u32,
       world_from_vertex: [[f32;4];4],
   }
   ```

5. **Unit Testing**
   Add an `fs_testdata/` folder with small sample surface files (`.pial`, `.asc`, `.gii`) for unit tests that verify round-trip through the loaders.

### 27.4 TypeScript Data Access

The same dual-representation pattern used for volumes applies to surfaces:
1. Rust loader handles the heavy payload parsing
2. For lightweight TypeScript algorithms (e.g., coloring by curvature), pass metadata and a SharedArrayBuffer view to the worker without copying
3. Binary parsers remain in Rust - no TS reimplementation

### 27.5 Implementation Effort

* No show-stoppers: both GIFTI and FreeSurfer surfaces have working Rust crates
* Estimated effort:
  * Wire loaders: ~1 day
  * Optional ASCII parser: ~0.25 day
* Alignment: Fits with Phase-1 plan - surfaces land in Sprint 2 without derailing volume work

**See also:** The UI-side contract for real-time layer editing, including LayerUBO field updates and the patch_layer command, is detailed in GUIDE-ui-layout-phase1.md Section 11.

## 28. Summary - Handling Data Variations (New)

| Issue                             | Where it is solved                                                                                                |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------- | 
| Different Resolutions             | `VolumeHandle.dim` and `worldToVoxel` affine encode spacing; shader samples layers in common world space.       |
| Different FOV / Offsets           | Affine matrix includes translation; out-of-FOV fragments get alpha=0 via shader bounds check using `dim`.         |
| Different On-Disk Orientation (RPI etc.) | Loader computes correct `Voxel->LPIWorld` affine from header; inverse `World->Voxel` matrix is put in UBO. Shader uses this matrix, correctly sampling the texture regardless of original orientation. (See §5.B, §5.E) |

## 29. Blending Semantics (New)

*   The `blendMode` in `DisplayProps` directly maps to `LayerUBO.blend_mode`.
*   The fragment shader's `composite()` function (see §4) implements the different blend modes (alpha, add, max, min) based on this UBO field.
*   Changing colormap, window, thresholds, or blend mode only affects the `DisplayProps` within the `LayerStack` store. Updating a layer's style is therefore a lightweight store mutation and results in only the small UBO data being sent to the GPU per frame.

## 30. Design Summary (New)

*   **Modularity:** Volumes (`VolumeHandle`) are immutable data references managed by Rust registries and the GPU texture atlas. Display styles (`DisplayProps`) live in a small, reactive TypeScript store (`LayerStack`).
*   **Extensibility:** Adding new layers (e.g., statistical maps, annotations) involves adding a new `Layer` entry to the `LayerStack` with its own `VolumeHandle` and `DisplayProps`. The core rendering logic doesn't need modification.
*   **Performance:** Only immutable handles (`VolumeHandle.id`) cross the Rust/TS boundary after initial load. Per-frame UBO updates are minimal (≤ few hundred bytes), ensuring smooth interaction even with many layers.

## 31. Surface Data Loading and Rendering

This section defines the architecture for loading and rendering triangle-mesh surfaces (GIfTI, FreeSurfer) alongside volumetric layers, using the same zero-copy principles and rendering infrastructure.

### 31.1 Surface Format Support

| Format | Crate | Status | Capabilities | Notes |
| :--- | :--- | :--- | :--- | :--- |
| GIFTI (*.gii) | `gifti` | Actively maintained (0.7+) | Binary-safe read/write of data arrays<br>Handles ASCII and base64-encoded payloads<br>Exposes vertex/triangle arrays as `Vec<f32>`/`Vec<u32>` | No in-crate spatial orientation helpers (we derive from the header's `Matrix_*` or fall back to MNI LPI) |
| FreeSurfer binary (surf, pial, white, ...) | `neuroformats::fs_surface` | Stable (0.3+) | `read_surf()`/`write_surf()` give vertices & faces<br>Also supports FreeSurfer-MGH volumes & annotation tables | Only the binary surface format; ASCII "*.asc" needs a wrapper |
| FreeSurfer ASCII (*.asc) | Not in a crate | N/A | Parsing is trivial (header + two space-separated tables) | ASCII lacks normals; compute them or read from *.curv |

Example usage from `neuroformats`:
```rust
use neuroformats::fs_surface::read_surf;
let (vtx, tri) = read_surf("lh.pial")?;  // vtx: Vec<[f32;3]>, tri: Vec<[i32;3]>
```

### 31.2 Triangle Mesh Data Model

Similar to our `VolumeSendable` enum, we introduce a `SurfaceSendable` enum for surfaces:

```rust
// core/geom/src/tri_mesh.rs
use bytemuck::{Pod, Zeroable};
use nalgebra::{Vector3, Matrix4};
use serde::Serialize;

/// POD bound identical to VoxelData, kept separate for clarity
pub trait VertexScalar: Copy + Pod + Zeroable + 'static {}
impl<T: Copy + Pod + Zeroable + 'static> VertexScalar for T {}

#[derive(Debug, Clone, Serialize)]
pub struct TriMesh<T: VertexScalar = f32> {
    /// Vertex positions interleaved as [x0,y0,z0, x1,y1,z1, ...]
    pub vertices: Vec<T>,
    /// Face indices (triangle list) as [i0,j0,k0, i1,j1,k1, ...]
    pub indices: Vec<u32>,
    /// Optional per-vertex normals (same stride as vertices)
    pub normals: Option<Vec<T>>,
    /// Optional per-vertex values (e.g. curvature / label)
    pub scalars: Option<Vec<T>>,
    /// World-space transform (e.g. GIFTI's Matrix_*)
    pub world_from_vertex: Matrix4<f32>,
}

impl<T: VertexScalar> TriMesh<T> {
    #[inline] pub fn vertex_count(&self) -> usize { self.vertices.len() / 3 }
    #[inline] pub fn triangle_count(&self) -> usize { self.indices.len() / 3 }

    /// Borrow as raw bytes – enables zero-copy SAB transfer & GPU upload
    #[inline] pub fn vertices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.vertices)
    }
    #[inline] pub fn indices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.indices)
    }
}

// core/bridge_types/src/surface_sendable.rs
#[derive(Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../packages/api/src/generated/surface.ts")]
pub enum SurfaceSendable {
    MeshF32(TriMesh<f32>),
    MeshF64(TriMesh<f64>),
}

impl SurfaceSendable {
    pub fn as_bytes(&self) -> (&[u8], &[u8]) {
        match self {
            Self::MeshF32(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
            Self::MeshF64(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
        }
    }
}
```

The TypeScript mirror (auto-generated):

```typescript
// packages/api/generated/surface.ts (generated by ts-rs)
export type SurfaceSendable =
  | { MeshF32: TriMeshF32 }
  | { MeshF64: TriMeshF64 };

export interface TriMeshF32 {
  vertices: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  scalars?: Float32Array;
  world_from_vertex: Float32Array; // length 16, row-major
}
```

### 31.3 Integration Path

1. **Add loaders under `core/loaders/`:**
   ```
   core/
     loaders/
       gifti/
         lib.rs   // re-export gifti::*, add Into<Surface> conversion
       freesurfer/
         lib.rs   // use neuroformats::fs_surface; if asc needed, embed parser
   ```

2. **Loader Implementation**
   Each loader implements the existing async `Loader` trait, returning `(id, SurfaceSendable)`. The existing `api_bridge::load_file` already supports polymorphic return, requiring only the switch/enum arm addition.

3. **Rendering Path**
   Triangle meshes follow the same `request_layer_gpu_resources` flow but map to the reserved `SurfaceLayerSpec`/`SurfaceLayerGPU` variants. The render loop creates `wgpu::Buffer` resources for vertices/indices and binds them in the surface pipeline.

4. **Surface GPU Resources**
   ```rust
   struct SurfaceLayerGPU {
       vertex_buffer_id: u32,
       index_buffer_id: u32,
       index_count: u32,
       world_from_vertex: [[f32;4];4],
   }
   ```

5. **Unit Testing**
   Add an `fs_testdata/` folder with small sample surface files (`.pial`, `.asc`, `.gii`) for unit tests that verify round-trip through the loaders.

### 31.4 TypeScript Data Access

The same dual-representation pattern used for volumes applies to surfaces:
1. Rust loader handles the heavy payload parsing
2. For lightweight TypeScript algorithms (e.g., coloring by curvature), pass metadata and a SharedArrayBuffer view to the worker without copying
3. Binary parsers remain in Rust - no TS reimplementation

### 31.5 Implementation Effort

* No show-stoppers: both GIFTI and FreeSurfer surfaces have working Rust crates
* Estimated effort:
  * Wire loaders: ~1 day
  * Optional ASCII parser: ~0.25 day
* Alignment: Fits with Phase-1 plan - surfaces land in Sprint 2 without derailing volume work

**See also:** The UI-side contract for real-time layer editing, including LayerUBO field updates and the patch_layer command, is detailed in GUIDE-ui-layout-phase1.md Section 11.

## 32. Summary - Handling Data Variations (New)

| Issue                             | Where it is solved                                                                                                |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------- | 
| Different Resolutions             | `VolumeHandle.dim` and `worldToVoxel` affine encode spacing; shader samples layers in common world space.       |
| Different FOV / Offsets           | Affine matrix includes translation; out-of-FOV fragments get alpha=0 via shader bounds check using `dim`.         |
| Different On-Disk Orientation (RPI etc.) | Loader computes correct `Voxel->LPIWorld` affine from header; inverse `World->Voxel` matrix is put in UBO. Shader uses this matrix, correctly sampling the texture regardless of original orientation. (See §5.B, §5.E) |

## 33. Blending Semantics (New)

*   The `blendMode` in `DisplayProps` directly maps to `LayerUBO.blend_mode`.
*   The fragment shader's `composite()` function (see §4) implements the different blend modes (alpha, add, max, min) based on this UBO field.
*   Changing colormap, window, thresholds, or blend mode only affects the `DisplayProps` within the `LayerStack` store. Updating a layer's style is therefore a lightweight store mutation and results in only the small UBO data being sent to the GPU per frame.

## 34. Design Summary (New)

*   **Modularity:** Volumes (`VolumeHandle`) are immutable data references managed by Rust registries and the GPU texture atlas. Display styles (`DisplayProps`) live in a small, reactive TypeScript store (`LayerStack`).
*   **Extensibility:** Adding new layers (e.g., statistical maps, annotations) involves adding a new `Layer` entry to the `LayerStack` with its own `VolumeHandle` and `DisplayProps`. The core rendering logic doesn't need modification.
*   **Performance:** Only immutable handles (`VolumeHandle.id`) cross the Rust/TS boundary after initial load. Per-frame UBO updates are minimal (≤ few hundred bytes), ensuring smooth interaction even with many layers.

## 35. Surface Data Loading and Rendering

This section defines the architecture for loading and rendering triangle-mesh surfaces (GIfTI, FreeSurfer) alongside volumetric layers, using the same zero-copy principles and rendering infrastructure.

### 35.1 Surface Format Support

| Format | Crate | Status | Capabilities | Notes |
| :--- | :--- | :--- | :--- | :--- |
| GIFTI (*.gii) | `gifti` | Actively maintained (0.7+) | Binary-safe read/write of data arrays<br>Handles ASCII and base64-encoded payloads<br>Exposes vertex/triangle arrays as `Vec<f32>`/`Vec<u32>` | No in-crate spatial orientation helpers (we derive from the header's `Matrix_*` or fall back to MNI LPI) |
| FreeSurfer binary (surf, pial, white, ...) | `neuroformats::fs_surface` | Stable (0.3+) | `read_surf()`/`write_surf()` give vertices & faces<br>Also supports FreeSurfer-MGH volumes & annotation tables | Only the binary surface format; ASCII "*.asc" needs a wrapper |
| FreeSurfer ASCII (*.asc) | Not in a crate | N/A | Parsing is trivial (header + two space-separated tables) | ASCII lacks normals; compute them or read from *.curv |

Example usage from `neuroformats`:
```rust
use neuroformats::fs_surface::read_surf;
let (vtx, tri) = read_surf("lh.pial")?;  // vtx: Vec<[f32;3]>, tri: Vec<[i32;3]>
```

### 35.2 Triangle Mesh Data Model

Similar to our `VolumeSendable` enum, we introduce a `SurfaceSendable` enum for surfaces:

```rust
// core/geom/src/tri_mesh.rs
use bytemuck::{Pod, Zeroable};
use nalgebra::{Vector3, Matrix4};
use serde::Serialize;

/// POD bound identical to VoxelData, kept separate for clarity
pub trait VertexScalar: Copy + Pod + Zeroable + 'static {}
impl<T: Copy + Pod + Zeroable + 'static> VertexScalar for T {}

#[derive(Debug, Clone, Serialize)]
pub struct TriMesh<T: VertexScalar = f32> {
    /// Vertex positions interleaved as [x0,y0,z0, x1,y1,z1, ...]
    pub vertices: Vec<T>,
    /// Face indices (triangle list) as [i0,j0,k0, i1,j1,k1, ...]
    pub indices: Vec<u32>,
    /// Optional per-vertex normals (same stride as vertices)
    pub normals: Option<Vec<T>>,
    /// Optional per-vertex values (e.g. curvature / label)
    pub scalars: Option<Vec<T>>,
    /// World-space transform (e.g. GIFTI's Matrix_*)
    pub world_from_vertex: Matrix4<f32>,
}

impl<T: VertexScalar> TriMesh<T> {
    #[inline] pub fn vertex_count(&self) -> usize { self.vertices.len() / 3 }
    #[inline] pub fn triangle_count(&self) -> usize { self.indices.len() / 3 }

    /// Borrow as raw bytes – enables zero-copy SAB transfer & GPU upload
    #[inline] pub fn vertices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.vertices)
    }
    #[inline] pub fn indices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.indices)
    }
}

// core/bridge_types/src/surface_sendable.rs
#[derive(Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../packages/api/src/generated/surface.ts")]
pub enum SurfaceSendable {
    MeshF32(TriMesh<f32>),
    MeshF64(TriMesh<f64>),
}

impl SurfaceSendable {
    pub fn as_bytes(&self) -> (&[u8], &[u8]) {
        match self {
            Self::MeshF32(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
            Self::MeshF64(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
        }
    }
}
```

The TypeScript mirror (auto-generated):

```typescript
// packages/api/generated/surface.ts (generated by ts-rs)
export type SurfaceSendable =
  | { MeshF32: TriMeshF32 }
  | { MeshF64: TriMeshF64 };

export interface TriMeshF32 {
  vertices: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  scalars?: Float32Array;
  world_from_vertex: Float32Array; // length 16, row-major
}
```

### 35.3 Integration Path

1. **Add loaders under `core/loaders/`:**
   ```
   core/
     loaders/
       gifti/
         lib.rs   // re-export gifti::*, add Into<Surface> conversion
       freesurfer/
         lib.rs   // use neuroformats::fs_surface; if asc needed, embed parser
   ```

2. **Loader Implementation**
   Each loader implements the existing async `Loader` trait, returning `(id, SurfaceSendable)`. The existing `api_bridge::load_file` already supports polymorphic return, requiring only the switch/enum arm addition.

3. **Rendering Path**
   Triangle meshes follow the same `request_layer_gpu_resources` flow but map to the reserved `SurfaceLayerSpec`/`SurfaceLayerGPU` variants. The render loop creates `wgpu::Buffer` resources for vertices/indices and binds them in the surface pipeline.

4. **Surface GPU Resources**
   ```rust
   struct SurfaceLayerGPU {
       vertex_buffer_id: u32,
       index_buffer_id: u32,
       index_count: u32,
       world_from_vertex: [[f32;4];4],
   }
   ```

5. **Unit Testing**
   Add an `fs_testdata/` folder with small sample surface files (`.pial`, `.asc`, `.gii`) for unit tests that verify round-trip through the loaders.

### 35.4 TypeScript Data Access

The same dual-representation pattern used for volumes applies to surfaces:
1. Rust loader handles the heavy payload parsing
2. For lightweight TypeScript algorithms (e.g., coloring by curvature), pass metadata and a SharedArrayBuffer view to the worker without copying
3. Binary parsers remain in Rust - no TS reimplementation

### 35.5 Implementation Effort

* No show-stoppers: both GIFTI and FreeSurfer surfaces have working Rust crates
* Estimated effort:
  * Wire loaders: ~1 day
  * Optional ASCII parser: ~0.25 day
* Alignment: Fits with Phase-1 plan - surfaces land in Sprint 2 without derailing volume work

**See also:** The UI-side contract for real-time layer editing, including LayerUBO field updates and the patch_layer command, is detailed in GUIDE-ui-layout-phase1.md Section 11.

## 36. Summary - Handling Data Variations (New)

| Issue                             | Where it is solved                                                                                                |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------- | 
| Different Resolutions             | `VolumeHandle.dim` and `worldToVoxel` affine encode spacing; shader samples layers in common world space.       |
| Different FOV / Offsets           | Affine matrix includes translation; out-of-FOV fragments get alpha=0 via shader bounds check using `dim`.         |
| Different On-Disk Orientation (RPI etc.) | Loader computes correct `Voxel->LPIWorld` affine from header; inverse `World->Voxel` matrix is put in UBO. Shader uses this matrix, correctly sampling the texture regardless of original orientation. (See §5.B, §5.E) |

## 37. Blending Semantics (New)

*   The `blendMode` in `DisplayProps` directly maps to `LayerUBO.blend_mode`.
*   The fragment shader's `composite()` function (see §4) implements the different blend modes (alpha, add, max, min) based on this UBO field.
*   Changing colormap, window, thresholds, or blend mode only affects the `DisplayProps` within the `LayerStack` store. Updating a layer's style is therefore a lightweight store mutation and results in only the small UBO data being sent to the GPU per frame.

## 38. Design Summary (New)

*   **Modularity:** Volumes (`VolumeHandle`) are immutable data references managed by Rust registries and the GPU texture atlas. Display styles (`DisplayProps`) live in a small, reactive TypeScript store (`LayerStack`).
*   **Extensibility:** Adding new layers (e.g., statistical maps, annotations) involves adding a new `Layer` entry to the `LayerStack` with its own `VolumeHandle` and `DisplayProps`. The core rendering logic doesn't need modification.
*   **Performance:** Only immutable handles (`VolumeHandle.id`) cross the Rust/TS boundary after initial load. Per-frame UBO updates are minimal (≤ few hundred bytes), ensuring smooth interaction even with many layers.

## 39. Surface Data Loading and Rendering

This section defines the architecture for loading and rendering triangle-mesh surfaces (GIfTI, FreeSurfer) alongside volumetric layers, using the same zero-copy principles and rendering infrastructure.

### 39.1 Surface Format Support

| Format | Crate | Status | Capabilities | Notes |
| :--- | :--- | :--- | :--- | :--- |
| GIFTI (*.gii) | `gifti` | Actively maintained (0.7+) | Binary-safe read/write of data arrays<br>Handles ASCII and base64-encoded payloads<br>Exposes vertex/triangle arrays as `Vec<f32>`/`Vec<u32>` | No in-crate spatial orientation helpers (we derive from the header's `Matrix_*` or fall back to MNI LPI) |
| FreeSurfer binary (surf, pial, white, ...) | `neuroformats::fs_surface` | Stable (0.3+) | `read_surf()`/`write_surf()` give vertices & faces<br>Also supports FreeSurfer-MGH volumes & annotation tables | Only the binary surface format; ASCII "*.asc" needs a wrapper |
| FreeSurfer ASCII (*.asc) | Not in a crate | N/A | Parsing is trivial (header + two space-separated tables) | ASCII lacks normals; compute them or read from *.curv |

Example usage from `neuroformats`:
```rust
use neuroformats::fs_surface::read_surf;
let (vtx, tri) = read_surf("lh.pial")?;  // vtx: Vec<[f32;3]>, tri: Vec<[i32;3]>
```

### 39.2 Triangle Mesh Data Model

Similar to our `VolumeSendable` enum, we introduce a `SurfaceSendable` enum for surfaces:

```rust
// core/geom/src/tri_mesh.rs
use bytemuck::{Pod, Zeroable};
use nalgebra::{Vector3, Matrix4};
use serde::Serialize;

/// POD bound identical to VoxelData, kept separate for clarity
pub trait VertexScalar: Copy + Pod + Zeroable + 'static {}
impl<T: Copy + Pod + Zeroable + 'static> VertexScalar for T {}

#[derive(Debug, Clone, Serialize)]
pub struct TriMesh<T: VertexScalar = f32> {
    /// Vertex positions interleaved as [x0,y0,z0, x1,y1,z1, ...]
    pub vertices: Vec<T>,
    /// Face indices (triangle list) as [i0,j0,k0, i1,j1,k1, ...]
    pub indices: Vec<u32>,
    /// Optional per-vertex normals (same stride as vertices)
    pub normals: Option<Vec<T>>,
    /// Optional per-vertex values (e.g. curvature / label)
    pub scalars: Option<Vec<T>>,
    /// World-space transform (e.g. GIFTI's Matrix_*)
    pub world_from_vertex: Matrix4<f32>,
}

impl<T: VertexScalar> TriMesh<T> {
    #[inline] pub fn vertex_count(&self) -> usize { self.vertices.len() / 3 }
    #[inline] pub fn triangle_count(&self) -> usize { self.indices.len() / 3 }

    /// Borrow as raw bytes – enables zero-copy SAB transfer & GPU upload
    #[inline] pub fn vertices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.vertices)
    }
    #[inline] pub fn indices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.indices)
    }
}

// core/bridge_types/src/surface_sendable.rs
#[derive(Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../packages/api/src/generated/surface.ts")]
pub enum SurfaceSendable {
    MeshF32(TriMesh<f32>),
    MeshF64(TriMesh<f64>),
}

impl SurfaceSendable {
    pub fn as_bytes(&self) -> (&[u8], &[u8]) {
        match self {
            Self::MeshF32(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
            Self::MeshF64(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
        }
    }
}
```

The TypeScript mirror (auto-generated):

```typescript
// packages/api/generated/surface.ts (generated by ts-rs)
export type SurfaceSendable =
  | { MeshF32: TriMeshF32 }
  | { MeshF64: TriMeshF64 };

export interface TriMeshF32 {
  vertices: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  scalars?: Float32Array;
  world_from_vertex: Float32Array; // length 16, row-major
}
```

### 39.3 Integration Path

1. **Add loaders under `core/loaders/`:**
   ```
   core/
     loaders/
       gifti/
         lib.rs   // re-export gifti::*, add Into<Surface> conversion
       freesurfer/
         lib.rs   // use neuroformats::fs_surface; if asc needed, embed parser
   ```

2. **Loader Implementation**
   Each loader implements the existing async `Loader` trait, returning `(id, SurfaceSendable)`. The existing `api_bridge::load_file` already supports polymorphic return, requiring only the switch/enum arm addition.

3. **Rendering Path**
   Triangle meshes follow the same `request_layer_gpu_resources` flow but map to the reserved `SurfaceLayerSpec`/`SurfaceLayerGPU` variants. The render loop creates `wgpu::Buffer` resources for vertices/indices and binds them in the surface pipeline.

4. **Surface GPU Resources**
   ```rust
   struct SurfaceLayerGPU {
       vertex_buffer_id: u32,
       index_buffer_id: u32,
       index_count: u32,
       world_from_vertex: [[f32;4];4],
   }
   ```

5. **Unit Testing**
   Add an `fs_testdata/` folder with small sample surface files (`.pial`, `.asc`, `.gii`) for unit tests that verify round-trip through the loaders.

### 39.4 TypeScript Data Access

The same dual-representation pattern used for volumes applies to surfaces:
1. Rust loader handles the heavy payload parsing
2. For lightweight TypeScript algorithms (e.g., coloring by curvature), pass metadata and a SharedArrayBuffer view to the worker without copying
3. Binary parsers remain in Rust - no TS reimplementation

### 39.5 Implementation Effort

* No show-stoppers: both GIFTI and FreeSurfer surfaces have working Rust crates
* Estimated effort:
  * Wire loaders: ~1 day
  * Optional ASCII parser: ~0.25 day
* Alignment: Fits with Phase-1 plan - surfaces land in Sprint 2 without derailing volume work

**See also:** The UI-side contract for real-time layer editing, including LayerUBO field updates and the patch_layer command, is detailed in GUIDE-ui-layout-phase1.md Section 11.

## 40. Summary - Handling Data Variations (New)

| Issue                             | Where it is solved                                                                                                |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------- | 
| Different Resolutions             | `VolumeHandle.dim` and `worldToVoxel` affine encode spacing; shader samples layers in common world space.       |
| Different FOV / Offsets           | Affine matrix includes translation; out-of-FOV fragments get alpha=0 via shader bounds check using `dim`.         |
| Different On-Disk Orientation (RPI etc.) | Loader computes correct `Voxel->LPIWorld` affine from header; inverse `World->Voxel` matrix is put in UBO. Shader uses this matrix, correctly sampling the texture regardless of original orientation. (See §5.B, §5.E) |

## 41. Blending Semantics (New)

*   The `blendMode` in `DisplayProps` directly maps to `LayerUBO.blend_mode`.
*   The fragment shader's `composite()` function (see §4) implements the different blend modes (alpha, add, max, min) based on this UBO field.
*   Changing colormap, window, thresholds, or blend mode only affects the `DisplayProps` within the `LayerStack` store. Updating a layer's style is therefore a lightweight store mutation and results in only the small UBO data being sent to the GPU per frame.

## 42. Design Summary (New)

*   **Modularity:** Volumes (`VolumeHandle`) are immutable data references managed by Rust registries and the GPU texture atlas. Display styles (`DisplayProps`) live in a small, reactive TypeScript store (`LayerStack`).
*   **Extensibility:** Adding new layers (e.g., statistical maps, annotations) involves adding a new `Layer` entry to the `LayerStack` with its own `VolumeHandle` and `DisplayProps`. The core rendering logic doesn't need modification.
*   **Performance:** Only immutable handles (`VolumeHandle.id`) cross the Rust/TS boundary after initial load. Per-frame UBO updates are minimal (≤ few hundred bytes), ensuring smooth interaction even with many layers.

## 43. Surface Data Loading and Rendering

This section defines the architecture for loading and rendering triangle-mesh surfaces (GIfTI, FreeSurfer) alongside volumetric layers, using the same zero-copy principles and rendering infrastructure.

### 43.1 Surface Format Support

| Format | Crate | Status | Capabilities | Notes |
| :--- | :--- | :--- | :--- | :--- |
| GIFTI (*.gii) | `gifti` | Actively maintained (0.7+) | Binary-safe read/write of data arrays<br>Handles ASCII and base64-encoded payloads<br>Exposes vertex/triangle arrays as `Vec<f32>`/`Vec<u32>` | No in-crate spatial orientation helpers (we derive from the header's `Matrix_*` or fall back to MNI LPI) |
| FreeSurfer binary (surf, pial, white, ...) | `neuroformats::fs_surface` | Stable (0.3+) | `read_surf()`/`write_surf()` give vertices & faces<br>Also supports FreeSurfer-MGH volumes & annotation tables | Only the binary surface format; ASCII "*.asc" needs a wrapper |
| FreeSurfer ASCII (*.asc) | Not in a crate | N/A | Parsing is trivial (header + two space-separated tables) | ASCII lacks normals; compute them or read from *.curv |

Example usage from `neuroformats`:
```rust
use neuroformats::fs_surface::read_surf;
let (vtx, tri) = read_surf("lh.pial")?;  // vtx: Vec<[f32;3]>, tri: Vec<[i32;3]>
```

### 43.2 Triangle Mesh Data Model

Similar to our `VolumeSendable` enum, we introduce a `SurfaceSendable` enum for surfaces:

```rust
// core/geom/src/tri_mesh.rs
use bytemuck::{Pod, Zeroable};
use nalgebra::{Vector3, Matrix4};
use serde::Serialize;

/// POD bound identical to VoxelData, kept separate for clarity
pub trait VertexScalar: Copy + Pod + Zeroable + 'static {}
impl<T: Copy + Pod + Zeroable + 'static> VertexScalar for T {}

#[derive(Debug, Clone, Serialize)]
pub struct TriMesh<T: VertexScalar = f32> {
    /// Vertex positions interleaved as [x0,y0,z0, x1,y1,z1, ...]
    pub vertices: Vec<T>,
    /// Face indices (triangle list) as [i0,j0,k0, i1,j1,k1, ...]
    pub indices: Vec<u32>,
    /// Optional per-vertex normals (same stride as vertices)
    pub normals: Option<Vec<T>>,
    /// Optional per-vertex values (e.g. curvature / label)
    pub scalars: Option<Vec<T>>,
    /// World-space transform (e.g. GIFTI's Matrix_*)
    pub world_from_vertex: Matrix4<f32>,
}

impl<T: VertexScalar> TriMesh<T> {
    #[inline] pub fn vertex_count(&self) -> usize { self.vertices.len() / 3 }
    #[inline] pub fn triangle_count(&self) -> usize { self.indices.len() / 3 }

    /// Borrow as raw bytes – enables zero-copy SAB transfer & GPU upload
    #[inline] pub fn vertices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.vertices)
    }
    #[inline] pub fn indices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.indices)
    }
}

// core/bridge_types/src/surface_sendable.rs
#[derive(Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../packages/api/src/generated/surface.ts")]
pub enum SurfaceSendable {
    MeshF32(TriMesh<f32>),
    MeshF64(TriMesh<f64>),
}

impl SurfaceSendable {
    pub fn as_bytes(&self) -> (&[u8], &[u8]) {
        match self {
            Self::MeshF32(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
            Self::MeshF64(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
        }
    }
}
```

The TypeScript mirror (auto-generated):

```typescript
// packages/api/generated/surface.ts (generated by ts-rs)
export type SurfaceSendable =
  | { MeshF32: TriMeshF32 }
  | { MeshF64: TriMeshF64 };

export interface TriMeshF32 {
  vertices: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  scalars?: Float32Array;
  world_from_vertex: Float32Array; // length 16, row-major
}
```

### 43.3 Integration Path

1. **Add loaders under `core/loaders/`:**
   ```
   core/
     loaders/
       gifti/
         lib.rs   // re-export gifti::*, add Into<Surface> conversion
       freesurfer/
         lib.rs   // use neuroformats::fs_surface; if asc needed, embed parser
   ```

2. **Loader Implementation**
   Each loader implements the existing async `Loader` trait, returning `(id, SurfaceSendable)`. The existing `api_bridge::load_file` already supports polymorphic return, requiring only the switch/enum arm addition.

3. **Rendering Path**
   Triangle meshes follow the same `request_layer_gpu_resources` flow but map to the reserved `SurfaceLayerSpec`/`SurfaceLayerGPU` variants. The render loop creates `wgpu::Buffer` resources for vertices/indices and binds them in the surface pipeline.

4. **Surface GPU Resources**
   ```rust
   struct SurfaceLayerGPU {
       vertex_buffer_id: u32,
       index_buffer_id: u32,
       index_count: u32,
       world_from_vertex: [[f32;4];4],
   }
   ```

5. **Unit Testing**
   Add an `fs_testdata/` folder with small sample surface files (`.pial`, `.asc`, `.gii`) for unit tests that verify round-trip through the loaders.

### 43.4 TypeScript Data Access

The same dual-representation pattern used for volumes applies to surfaces:
1. Rust loader handles the heavy payload parsing
2. For lightweight TypeScript algorithms (e.g., coloring by curvature), pass metadata and a SharedArrayBuffer view to the worker without copying
3. Binary parsers remain in Rust - no TS reimplementation

### 43.5 Implementation Effort

* No show-stoppers: both GIFTI and FreeSurfer surfaces have working Rust crates
* Estimated effort:
  * Wire loaders: ~1 day
  * Optional ASCII parser: ~0.25 day
* Alignment: Fits with Phase-1 plan - surfaces land in Sprint 2 without derailing volume work

**See also:** The UI-side contract for real-time layer editing, including LayerUBO field updates and the patch_layer command, is detailed in GUIDE-ui-layout-phase1.md Section 11.

## 44. Summary - Handling Data Variations (New)

| Issue                             | Where it is solved                                                                                                |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------- | 
| Different Resolutions             | `VolumeHandle.dim` and `worldToVoxel` affine encode spacing; shader samples layers in common world space.       |
| Different FOV / Offsets           | Affine matrix includes translation; out-of-FOV fragments get alpha=0 via shader bounds check using `dim`.         |
| Different On-Disk Orientation (RPI etc.) | Loader computes correct `Voxel->LPIWorld` affine from header; inverse `World->Voxel` matrix is put in UBO. Shader uses this matrix, correctly sampling the texture regardless of original orientation. (See §5.B, §5.E) |

## 45. Blending Semantics (New)

*   The `blendMode` in `DisplayProps` directly maps to `LayerUBO.blend_mode`.
*   The fragment shader's `composite()` function (see §4) implements the different blend modes (alpha, add, max, min) based on this UBO field.
*   Changing colormap, window, thresholds, or blend mode only affects the `DisplayProps` within the `LayerStack` store. Updating a layer's style is therefore a lightweight store mutation and results in only the small UBO data being sent to the GPU per frame.

## 46. Design Summary (New)

*   **Modularity:** Volumes (`VolumeHandle`) are immutable data references managed by Rust registries and the GPU texture atlas. Display styles (`DisplayProps`) live in a small, reactive TypeScript store (`LayerStack`).
*   **Extensibility:** Adding new layers (e.g., statistical maps, annotations) involves adding a new `Layer` entry to the `LayerStack` with its own `VolumeHandle` and `DisplayProps`. The core rendering logic doesn't need modification.
*   **Performance:** Only immutable handles (`VolumeHandle.id`) cross the Rust/TS boundary after initial load. Per-frame UBO updates are minimal (≤ few hundred bytes), ensuring smooth interaction even with many layers.

## 47. Surface Data Loading and Rendering

This section defines the architecture for loading and rendering triangle-mesh surfaces (GIfTI, FreeSurfer) alongside volumetric layers, using the same zero-copy principles and rendering infrastructure.

### 47.1 Surface Format Support

| Format | Crate | Status | Capabilities | Notes |
| :--- | :--- | :--- | :--- | :--- |
| GIFTI (*.gii) | `gifti` | Actively maintained (0.7+) | Binary-safe read/write of data arrays<br>Handles ASCII and base64-encoded payloads<br>Exposes vertex/triangle arrays as `Vec<f32>`/`Vec<u32>` | No in-crate spatial orientation helpers (we derive from the header's `Matrix_*` or fall back to MNI LPI) |
| FreeSurfer binary (surf, pial, white, ...) | `neuroformats::fs_surface` | Stable (0.3+) | `read_surf()`/`write_surf()` give vertices & faces<br>Also supports FreeSurfer-MGH volumes & annotation tables | Only the binary surface format; ASCII "*.asc" needs a wrapper |
| FreeSurfer ASCII (*.asc) | Not in a crate | N/A | Parsing is trivial (header + two space-separated tables) | ASCII lacks normals; compute them or read from *.curv |

Example usage from `neuroformats`:
```rust
use neuroformats::fs_surface::read_surf;
let (vtx, tri) = read_surf("lh.pial")?;  // vtx: Vec<[f32;3]>, tri: Vec<[i32;3]>
```

### 47.2 Triangle Mesh Data Model

Similar to our `VolumeSendable` enum, we introduce a `SurfaceSendable` enum for surfaces:

```rust
// core/geom/src/tri_mesh.rs
use bytemuck::{Pod, Zeroable};
use nalgebra::{Vector3, Matrix4};
use serde::Serialize;

/// POD bound identical to VoxelData, kept separate for clarity
pub trait VertexScalar: Copy + Pod + Zeroable + 'static {}
impl<T: Copy + Pod + Zeroable + 'static> VertexScalar for T {}

#[derive(Debug, Clone, Serialize)]
pub struct TriMesh<T: VertexScalar = f32> {
    /// Vertex positions interleaved as [x0,y0,z0, x1,y1,z1, ...]
    pub vertices: Vec<T>,
    /// Face indices (triangle list) as [i0,j0,k0, i1,j1,k1, ...]
    pub indices: Vec<u32>,
    /// Optional per-vertex normals (same stride as vertices)
    pub normals: Option<Vec<T>>,
    /// Optional per-vertex values (e.g. curvature / label)
    pub scalars: Option<Vec<T>>,
    /// World-space transform (e.g. GIFTI's Matrix_*)
    pub world_from_vertex: Matrix4<f32>,
}

impl<T: VertexScalar> TriMesh<T> {
    #[inline] pub fn vertex_count(&self) -> usize { self.vertices.len() / 3 }
    #[inline] pub fn triangle_count(&self) -> usize { self.indices.len() / 3 }

    /// Borrow as raw bytes – enables zero-copy SAB transfer & GPU upload
    #[inline] pub fn vertices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.vertices)
    }
    #[inline] pub fn indices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.indices)
    }
}

// core/bridge_types/src/surface_sendable.rs
#[derive(Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../packages/api/src/generated/surface.ts")]
pub enum SurfaceSendable {
    MeshF32(TriMesh<f32>),
    MeshF64(TriMesh<f64>),
}

impl SurfaceSendable {
    pub fn as_bytes(&self) -> (&[u8], &[u8]) {
        match self {
            Self::MeshF32(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
            Self::MeshF64(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
        }
    }
}
```

The TypeScript mirror (auto-generated):

```typescript
// packages/api/generated/surface.ts (generated by ts-rs)
export type SurfaceSendable =
  | { MeshF32: TriMeshF32 }
  | { MeshF64: TriMeshF64 };

export interface TriMeshF32 {
  vertices: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  scalars?: Float32Array;
  world_from_vertex: Float32Array; // length 16, row-major
}
```

### 47.3 Integration Path

1. **Add loaders under `core/loaders/`:**
   ```
   core/
     loaders/
       gifti/
         lib.rs   // re-export gifti::*, add Into<Surface> conversion
       freesurfer/
         lib.rs   // use neuroformats::fs_surface; if asc needed, embed parser
   ```

2. **Loader Implementation**
   Each loader implements the existing async `Loader` trait, returning `(id, SurfaceSendable)`. The existing `api_bridge::load_file` already supports polymorphic return, requiring only the switch/enum arm addition.

3. **Rendering Path**
   Triangle meshes follow the same `request_layer_gpu_resources` flow but map to the reserved `SurfaceLayerSpec`/`SurfaceLayerGPU` variants. The render loop creates `wgpu::Buffer` resources for vertices/indices and binds them in the surface pipeline.

4. **Surface GPU Resources**
   ```rust
   struct SurfaceLayerGPU {
       vertex_buffer_id: u32,
       index_buffer_id: u32,
       index_count: u32,
       world_from_vertex: [[f32;4];4],
   }
   ```

5. **Unit Testing**
   Add an `fs_testdata/` folder with small sample surface files (`.pial`, `.asc`, `.gii`) for unit tests that verify round-trip through the loaders.

### 47.4 TypeScript Data Access

The same dual-representation pattern used for volumes applies to surfaces:
1. Rust loader handles the heavy payload parsing
2. For lightweight TypeScript algorithms (e.g., coloring by curvature), pass metadata and a SharedArrayBuffer view to the worker without copying
3. Binary parsers remain in Rust - no TS reimplementation

### 47.5 Implementation Effort

* No show-stoppers: both GIFTI and FreeSurfer surfaces have working Rust crates
* Estimated effort:
  * Wire loaders: ~1 day
  * Optional ASCII parser: ~0.25 day
* Alignment: Fits with Phase-1 plan - surfaces land in Sprint 2 without derailing volume work

**See also:** The UI-side contract for real-time layer editing, including LayerUBO field updates and the patch_layer command, is detailed in GUIDE-ui-layout-phase1.md Section 11.

## 48. Summary - Handling Data Variations (New)

| Issue                             | Where it is solved                                                                                                |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------- | 
| Different Resolutions             | `VolumeHandle.dim` and `worldToVoxel` affine encode spacing; shader samples layers in common world space.       |
| Different FOV / Offsets           | Affine matrix includes translation; out-of-FOV fragments get alpha=0 via shader bounds check using `dim`.         |
| Different On-Disk Orientation (RPI etc.) | Loader computes correct `Voxel->LPIWorld` affine from header; inverse `World->Voxel` matrix is put in UBO. Shader uses this matrix, correctly sampling the texture regardless of original orientation. (See §5.B, §5.E) |

## 49. Blending Semantics (New)

*   The `blendMode` in `DisplayProps` directly maps to `LayerUBO.blend_mode`.
*   The fragment shader's `composite()` function (see §4) implements the different blend modes (alpha, add, max, min) based on this UBO field.
*   Changing colormap, window, thresholds, or blend mode only affects the `DisplayProps` within the `LayerStack` store. Updating a layer's style is therefore a lightweight store mutation and results in only the small UBO data being sent to the GPU per frame.

## 50. Design Summary (New)

*   **Modularity:** Volumes (`VolumeHandle`) are immutable data references managed by Rust registries and the GPU texture atlas. Display styles (`DisplayProps`) live in a small, reactive TypeScript store (`LayerStack`).
*   **Extensibility:** Adding new layers (e.g., statistical maps, annotations) involves adding a new `Layer` entry to the `LayerStack` with its own `VolumeHandle` and `DisplayProps`. The core rendering logic doesn't need modification.
*   **Performance:** Only immutable handles (`VolumeHandle.id`) cross the Rust/TS boundary after initial load. Per-frame UBO updates are minimal (≤ few hundred bytes), ensuring smooth interaction even with many layers.

## 51. Surface Data Loading and Rendering

This section defines the architecture for loading and rendering triangle-mesh surfaces (GIfTI, FreeSurfer) alongside volumetric layers, using the same zero-copy principles and rendering infrastructure.

### 51.1 Surface Format Support

| Format | Crate | Status | Capabilities | Notes |
| :--- | :--- | :--- | :--- | :--- |
| GIFTI (*.gii) | `gifti` | Actively maintained (0.7+) | Binary-safe read/write of data arrays<br>Handles ASCII and base64-encoded payloads<br>Exposes vertex/triangle arrays as `Vec<f32>`/`Vec<u32>` | No in-crate spatial orientation helpers (we derive from the header's `Matrix_*` or fall back to MNI LPI) |
| FreeSurfer binary (surf, pial, white, ...) | `neuroformats::fs_surface` | Stable (0.3+) | `read_surf()`/`write_surf()` give vertices & faces<br>Also supports FreeSurfer-MGH volumes & annotation tables | Only the binary surface format; ASCII "*.asc" needs a wrapper |
| FreeSurfer ASCII (*.asc) | Not in a crate | N/A | Parsing is trivial (header + two space-separated tables) | ASCII lacks normals; compute them or read from *.curv |

Example usage from `neuroformats`:
```rust
use neuroformats::fs_surface::read_surf;
let (vtx, tri) = read_surf("lh.pial")?;  // vtx: Vec<[f32;3]>, tri: Vec<[i32;3]>
```

### 51.2 Triangle Mesh Data Model

Similar to our `VolumeSendable` enum, we introduce a `SurfaceSendable` enum for surfaces:

```rust
// core/geom/src/tri_mesh.rs
use bytemuck::{Pod, Zeroable};
use nalgebra::{Vector3, Matrix4};
use serde::Serialize;

/// POD bound identical to VoxelData, kept separate for clarity
pub trait VertexScalar: Copy + Pod + Zeroable + 'static {}
impl<T: Copy + Pod + Zeroable + 'static> VertexScalar for T {}

#[derive(Debug, Clone, Serialize)]
pub struct TriMesh<T: VertexScalar = f32> {
    /// Vertex positions interleaved as [x0,y0,z0, x1,y1,z1, ...]
    pub vertices: Vec<T>,
    /// Face indices (triangle list) as [i0,j0,k0, i1,j1,k1, ...]
    pub indices: Vec<u32>,
    /// Optional per-vertex normals (same stride as vertices)
    pub normals: Option<Vec<T>>,
    /// Optional per-vertex values (e.g. curvature / label)
    pub scalars: Option<Vec<T>>,
    /// World-space transform (e.g. GIFTI's Matrix_*)
    pub world_from_vertex: Matrix4<f32>,
}

impl<T: VertexScalar> TriMesh<T> {
    #[inline] pub fn vertex_count(&self) -> usize { self.vertices.len() / 3 }
    #[inline] pub fn triangle_count(&self) -> usize { self.indices.len() / 3 }

    /// Borrow as raw bytes – enables zero-copy SAB transfer & GPU upload
    #[inline] pub fn vertices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.vertices)
    }
    #[inline] pub fn indices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.indices)
    }
}

// core/bridge_types/src/surface_sendable.rs
#[derive(Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../packages/api/src/generated/surface.ts")]
pub enum SurfaceSendable {
    MeshF32(TriMesh<f32>),
    MeshF64(TriMesh<f64>),
}

impl SurfaceSendable {
    pub fn as_bytes(&self) -> (&[u8], &[u8]) {
        match self {
            Self::MeshF32(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
            Self::MeshF64(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
        }
    }
}
```

The TypeScript mirror (auto-generated):

```typescript
// packages/api/generated/surface.ts (generated by ts-rs)
export type SurfaceSendable =
  | { MeshF32: TriMeshF32 }
  | { MeshF64: TriMeshF64 };

export interface TriMeshF32 {
  vertices: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  scalars?: Float32Array;
  world_from_vertex: Float32Array; // length 16, row-major
}
```

### 51.3 Integration Path

1. **Add loaders under `core/loaders/`:**
   ```
   core/
     loaders/
       gifti/
         lib.rs   // re-export gifti::*, add Into<Surface> conversion
       freesurfer/
         lib.rs   // use neuroformats::fs_surface; if asc needed, embed parser
   ```

2. **Loader Implementation**
   Each loader implements the existing async `Loader` trait, returning `(id, SurfaceSendable)`. The existing `api_bridge::load_file` already supports polymorphic return, requiring only the switch/enum arm addition.

3. **Rendering Path**
   Triangle meshes follow the same `request_layer_gpu_resources` flow but map to the reserved `SurfaceLayerSpec`/`SurfaceLayerGPU` variants. The render loop creates `wgpu::Buffer` resources for vertices/indices and binds them in the surface pipeline.

4. **Surface GPU Resources**
   ```rust
   struct SurfaceLayerGPU {
       vertex_buffer_id: u32,
       index_buffer_id: u32,
       index_count: u32,
       world_from_vertex: [[f32;4];4],
   }
   ```

5. **Unit Testing**
   Add an `fs_testdata/` folder with small sample surface files (`.pial`, `.asc`, `.gii`) for unit tests that verify round-trip through the loaders.

### 51.4 TypeScript Data Access

The same dual-representation pattern used for volumes applies to surfaces:
1. Rust loader handles the heavy payload parsing
2. For lightweight TypeScript algorithms (e.g., coloring by curvature), pass metadata and a SharedArrayBuffer view to the worker without copying
3. Binary parsers remain in Rust - no TS reimplementation

### 51.5 Implementation Effort

* No show-stoppers: both GIFTI and FreeSurfer surfaces have working Rust crates
* Estimated effort:
  * Wire loaders: ~1 day
  * Optional ASCII parser: ~0.25 day
* Alignment: Fits with Phase-1 plan - surfaces land in Sprint 2 without derailing volume work

**See also:** The UI-side contract for real-time layer editing, including LayerUBO field updates and the patch_layer command, is detailed in GUIDE-ui-layout-phase1.md Section 11.

## 52. Summary - Handling Data Variations (New)

| Issue                             | Where it is solved                                                                                                |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------- | 
| Different Resolutions             | `VolumeHandle.dim` and `worldToVoxel` affine encode spacing; shader samples layers in common world space.       |
| Different FOV / Offsets           | Affine matrix includes translation; out-of-FOV fragments get alpha=0 via shader bounds check using `dim`.         |
| Different On-Disk Orientation (RPI etc.) | Loader computes correct `Voxel->LPIWorld` affine from header; inverse `World->Voxel` matrix is put in UBO. Shader uses this matrix, correctly sampling the texture regardless of original orientation. (See §5.B, §5.E) |

## 53. Blending Semantics (New)

*   The `blendMode` in `DisplayProps` directly maps to `LayerUBO.blend_mode`.
*   The fragment shader's `composite()` function (see §4) implements the different blend modes (alpha, add, max, min) based on this UBO field.
*   Changing colormap, window, thresholds, or blend mode only affects the `DisplayProps` within the `LayerStack` store. Updating a layer's style is therefore a lightweight store mutation and results in only the small UBO data being sent to the GPU per frame.

## 54. Design Summary (New)

*   **Modularity:** Volumes (`VolumeHandle`) are immutable data references managed by Rust registries and the GPU texture atlas. Display styles (`DisplayProps`) live in a small, reactive TypeScript store (`LayerStack`).
*   **Extensibility:** Adding new layers (e.g., statistical maps, annotations) involves adding a new `Layer` entry to the `LayerStack` with its own `VolumeHandle` and `DisplayProps`. The core rendering logic doesn't need modification.
*   **Performance:** Only immutable handles (`VolumeHandle.id`) cross the Rust/TS boundary after initial load. Per-frame UBO updates are minimal (≤ few hundred bytes), ensuring smooth interaction even with many layers.

## 55. Surface Data Loading and Rendering

This section defines the architecture for loading and rendering triangle-mesh surfaces (GIfTI, FreeSurfer) alongside volumetric layers, using the same zero-copy principles and rendering infrastructure.

### 55.1 Surface Format Support

| Format | Crate | Status | Capabilities | Notes |
| :--- | :--- | :--- | :--- | :--- |
| GIFTI (*.gii) | `gifti` | Actively maintained (0.7+) | Binary-safe read/write of data arrays<br>Handles ASCII and base64-encoded payloads<br>Exposes vertex/triangle arrays as `Vec<f32>`/`Vec<u32>` | No in-crate spatial orientation helpers (we derive from the header's `Matrix_*` or fall back to MNI LPI) |
| FreeSurfer binary (surf, pial, white, ...) | `neuroformats::fs_surface` | Stable (0.3+) | `read_surf()`/`write_surf()` give vertices & faces<br>Also supports FreeSurfer-MGH volumes & annotation tables | Only the binary surface format; ASCII "*.asc" needs a wrapper |
| FreeSurfer ASCII (*.asc) | Not in a crate | N/A | Parsing is trivial (header + two space-separated tables) | ASCII lacks normals; compute them or read from *.curv |

Example usage from `neuroformats`:
```rust
use neuroformats::fs_surface::read_surf;
let (vtx, tri) = read_surf("lh.pial")?;  // vtx: Vec<[f32;3]>, tri: Vec<[i32;3]>
```

### 55.2 Triangle Mesh Data Model

Similar to our `VolumeSendable` enum, we introduce a `SurfaceSendable` enum for surfaces:

```rust
// core/geom/src/tri_mesh.rs
use bytemuck::{Pod, Zeroable};
use nalgebra::{Vector3, Matrix4};
use serde::Serialize;

/// POD bound identical to VoxelData, kept separate for clarity
pub trait VertexScalar: Copy + Pod + Zeroable + 'static {}
impl<T: Copy + Pod + Zeroable + 'static> VertexScalar for T {}

#[derive(Debug, Clone, Serialize)]
pub struct TriMesh<T: VertexScalar = f32> {
    /// Vertex positions interleaved as [x0,y0,z0, x1,y1,z1, ...]
    pub vertices: Vec<T>,
    /// Face indices (triangle list) as [i0,j0,k0, i1,j1,k1, ...]
    pub indices: Vec<u32>,
    /// Optional per-vertex normals (same stride as vertices)
    pub normals: Option<Vec<T>>,
    /// Optional per-vertex values (e.g. curvature / label)
    pub scalars: Option<Vec<T>>,
    /// World-space transform (e.g. GIFTI's Matrix_*)
    pub world_from_vertex: Matrix4<f32>,
}

impl<T: VertexScalar> TriMesh<T> {
    #[inline] pub fn vertex_count(&self) -> usize { self.vertices.len() / 3 }
    #[inline] pub fn triangle_count(&self) -> usize { self.indices.len() / 3 }

    /// Borrow as raw bytes – enables zero-copy SAB transfer & GPU upload
    #[inline] pub fn vertices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.vertices)
    }
    #[inline] pub fn indices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.indices)
    }
}

// core/bridge_types/src/surface_sendable.rs
#[derive(Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../packages/api/src/generated/surface.ts")]
pub enum SurfaceSendable {
    MeshF32(TriMesh<f32>),
    MeshF64(TriMesh<f64>),
}

impl SurfaceSendable {
    pub fn as_bytes(&self) -> (&[u8], &[u8]) {
        match self {
            Self::MeshF32(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
            Self::MeshF64(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
        }
    }
}
```

The TypeScript mirror (auto-generated):

```typescript
// packages/api/generated/surface.ts (generated by ts-rs)
export type SurfaceSendable =
  | { MeshF32: TriMeshF32 }
  | { MeshF64: TriMeshF64 };

export interface TriMeshF32 {
  vertices: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  scalars?: Float32Array;
  world_from_vertex: Float32Array; // length 16, row-major
}
```

### 55.3 Integration Path

1. **Add loaders under `core/loaders/`:**
   ```
   core/
     loaders/
       gifti/
         lib.rs   // re-export gifti::*, add Into<Surface> conversion
       freesurfer/
         lib.rs   // use neuroformats::fs_surface; if asc needed, embed parser
   ```

2. **Loader Implementation**
   Each loader implements the existing async `Loader` trait, returning `(id, SurfaceSendable)`. The existing `api_bridge::load_file` already supports polymorphic return, requiring only the switch/enum arm addition.

3. **Rendering Path**
   Triangle meshes follow the same `request_layer_gpu_resources` flow but map to the reserved `SurfaceLayerSpec`/`SurfaceLayerGPU` variants. The render loop creates `wgpu::Buffer` resources for vertices/indices and binds them in the surface pipeline.

4. **Surface GPU Resources**
   ```rust
   struct SurfaceLayerGPU {
       vertex_buffer_id: u32,
       index_buffer_id: u32,
       index_count: u32,
       world_from_vertex: [[f32;4];4],
   }
   ```

5. **Unit Testing**
   Add an `fs_testdata/` folder with small sample surface files (`.pial`, `.asc`, `.gii`) for unit tests that verify round-trip through the loaders.

### 55.4 TypeScript Data Access

The same dual-representation pattern used for volumes applies to surfaces:
1. Rust loader handles the heavy payload parsing
2. For lightweight TypeScript algorithms (e.g., coloring by curvature), pass metadata and a SharedArrayBuffer view to the worker without copying
3. Binary parsers remain in Rust - no TS reimplementation

### 55.5 Implementation Effort

* No show-stoppers: both GIFTI and FreeSurfer surfaces have working Rust crates
* Estimated effort:
  * Wire loaders: ~1 day
  * Optional ASCII parser: ~0.25 day
* Alignment: Fits with Phase-1 plan - surfaces land in Sprint 2 without derailing volume work

**See also:** The UI-side contract for real-time layer editing, including LayerUBO field updates and the patch_layer command, is detailed in GUIDE-ui-layout-phase1.md Section 11.

## 56. Summary - Handling Data Variations (New)

| Issue                             | Where it is solved                                                                                                |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------- | 
| Different Resolutions             | `VolumeHandle.dim` and `worldToVoxel` affine encode spacing; shader samples layers in common world space.       |
| Different FOV / Offsets           | Affine matrix includes translation; out-of-FOV fragments get alpha=0 via shader bounds check using `dim`.         |
| Different On-Disk Orientation (RPI etc.) | Loader computes correct `Voxel->LPIWorld` affine from header; inverse `World->Voxel` matrix is put in UBO. Shader uses this matrix, correctly sampling the texture regardless of original orientation. (See §5.B, §5.E) |

## 57. Blending Semantics (New)

*   The `blendMode` in `DisplayProps` directly maps to `LayerUBO.blend_mode`.
*   The fragment shader's `composite()` function (see §4) implements the different blend modes (alpha, add, max, min) based on this UBO field.
*   Changing colormap, window, thresholds, or blend mode only affects the `DisplayProps` within the `LayerStack` store. Updating a layer's style is therefore a lightweight store mutation and results in only the small UBO data being sent to the GPU per frame.

## 58. Design Summary (New)

*   **Modularity:** Volumes (`VolumeHandle`) are immutable data references managed by Rust registries and the GPU texture atlas. Display styles (`DisplayProps`) live in a small, reactive TypeScript store (`LayerStack`).
*   **Extensibility:** Adding new layers (e.g., statistical maps, annotations) involves adding a new `Layer` entry to the `LayerStack` with its own `VolumeHandle` and `DisplayProps`. The core rendering logic doesn't need modification.
*   **Performance:** Only immutable handles (`VolumeHandle.id`) cross the Rust/TS boundary after initial load. Per-frame UBO updates are minimal (≤ few hundred bytes), ensuring smooth interaction even with many layers.

## 59. Surface Data Loading and Rendering

This section defines the architecture for loading and rendering triangle-mesh surfaces (GIfTI, FreeSurfer) alongside volumetric layers, using the same zero-copy principles and rendering infrastructure.

### 59.1 Surface Format Support

| Format | Crate | Status | Capabilities | Notes |
| :--- | :--- | :--- | :--- | :--- |
| GIFTI (*.gii) | `gifti` | Actively maintained (0.7+) | Binary-safe read/write of data arrays<br>Handles ASCII and base64-encoded payloads<br>Exposes vertex/triangle arrays as `Vec<f32>`/`Vec<u32>` | No in-crate spatial orientation helpers (we derive from the header's `Matrix_*` or fall back to MNI LPI) |
| FreeSurfer binary (surf, pial, white, ...) | `neuroformats::fs_surface` | Stable (0.3+) | `read_surf()`/`write_surf()` give vertices & faces<br>Also supports FreeSurfer-MGH volumes & annotation tables | Only the binary surface format; ASCII "*.asc" needs a wrapper |
| FreeSurfer ASCII (*.asc) | Not in a crate | N/A | Parsing is trivial (header + two space-separated tables) | ASCII lacks normals; compute them or read from *.curv |

Example usage from `neuroformats`:
```rust
use neuroformats::fs_surface::read_surf;
let (vtx, tri) = read_surf("lh.pial")?;  // vtx: Vec<[f32;3]>, tri: Vec<[i32;3]>
```

### 59.2 Triangle Mesh Data Model

Similar to our `VolumeSendable` enum, we introduce a `SurfaceSendable` enum for surfaces:

```rust
// core/geom/src/tri_mesh.rs
use bytemuck::{Pod, Zeroable};
use nalgebra::{Vector3, Matrix4};
use serde::Serialize;

/// POD bound identical to VoxelData, kept separate for clarity
pub trait VertexScalar: Copy + Pod + Zeroable + 'static {}
impl<T: Copy + Pod + Zeroable + 'static> VertexScalar for T {}

#[derive(Debug, Clone, Serialize)]
pub struct TriMesh<T: VertexScalar = f32> {
    /// Vertex positions interleaved as [x0,y0,z0, x1,y1,z1, ...]
    pub vertices: Vec<T>,
    /// Face indices (triangle list) as [i0,j0,k0, i1,j1,k1, ...]
    pub indices: Vec<u32>,
    /// Optional per-vertex normals (same stride as vertices)
    pub normals: Option<Vec<T>>,
    /// Optional per-vertex values (e.g. curvature / label)
    pub scalars: Option<Vec<T>>,
    /// World-space transform (e.g. GIFTI's Matrix_*)
    pub world_from_vertex: Matrix4<f32>,
}

impl<T: VertexScalar> TriMesh<T> {
    #[inline] pub fn vertex_count(&self) -> usize { self.vertices.len() / 3 }
    #[inline] pub fn triangle_count(&self) -> usize { self.indices.len() / 3 }

    /// Borrow as raw bytes – enables zero-copy SAB transfer & GPU upload
    #[inline] pub fn vertices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.vertices)
    }
    #[inline] pub fn indices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.indices)
    }
}

// core/bridge_types/src/surface_sendable.rs
#[derive(Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../packages/api/src/generated/surface.ts")]
pub enum SurfaceSendable {
    MeshF32(TriMesh<f32>),
    MeshF64(TriMesh<f64>),
}

impl SurfaceSendable {
    pub fn as_bytes(&self) -> (&[u8], &[u8]) {
        match self {
            Self::MeshF32(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
            Self::MeshF64(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
        }
    }
}
```

The TypeScript mirror (auto-generated):

```typescript
// packages/api/generated/surface.ts (generated by ts-rs)
export type SurfaceSendable =
  | { MeshF32: TriMeshF32 }
  | { MeshF64: TriMeshF64 };

export interface TriMeshF32 {
  vertices: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  scalars?: Float32Array;
  world_from_vertex: Float32Array; // length 16, row-major
}
```

### 59.3 Integration Path

1. **Add loaders under `core/loaders/`:**
   ```
   core/
     loaders/
       gifti/
         lib.rs   // re-export gifti::*, add Into<Surface> conversion
       freesurfer/
         lib.rs   // use neuroformats::fs_surface; if asc needed, embed parser
   ```

2. **Loader Implementation**
   Each loader implements the existing async `Loader` trait, returning `(id, SurfaceSendable)`. The existing `api_bridge::load_file` already supports polymorphic return, requiring only the switch/enum arm addition.

3. **Rendering Path**
   Triangle meshes follow the same `request_layer_gpu_resources` flow but map to the reserved `SurfaceLayerSpec`/`SurfaceLayerGPU` variants. The render loop creates `wgpu::Buffer` resources for vertices/indices and binds them in the surface pipeline.

4. **Surface GPU Resources**
   ```rust
   struct SurfaceLayerGPU {
       vertex_buffer_id: u32,
       index_buffer_id: u32,
       index_count: u32,
       world_from_vertex: [[f32;4];4],
   }
   ```

5. **Unit Testing**
   Add an `fs_testdata/` folder with small sample surface files (`.pial`, `.asc`, `.gii`) for unit tests that verify round-trip through the loaders.

### 59.4 TypeScript Data Access

The same dual-representation pattern used for volumes applies to surfaces:
1. Rust loader handles the heavy payload parsing
2. For lightweight TypeScript algorithms (e.g., coloring by curvature), pass metadata and a SharedArrayBuffer view to the worker without copying
3. Binary parsers remain in Rust - no TS reimplementation

### 59.5 Implementation Effort

* No show-stoppers: both GIFTI and FreeSurfer surfaces have working Rust crates
* Estimated effort:
  * Wire loaders: ~1 day
  * Optional ASCII parser: ~0.25 day
* Alignment: Fits with Phase-1 plan - surfaces land in Sprint 2 without derailing volume work

**See also:** The UI-side contract for real-time layer editing, including LayerUBO field updates and the patch_layer command, is detailed in GUIDE-ui-layout-phase1.md Section 11.

## 60. Summary - Handling Data Variations (New)

| Issue                             | Where it is solved                                                                                                |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------- | 
| Different Resolutions             | `VolumeHandle.dim` and `worldToVoxel` affine encode spacing; shader samples layers in common world space.       |
| Different FOV / Offsets           | Affine matrix includes translation; out-of-FOV fragments get alpha=0 via shader bounds check using `dim`.         |
| Different On-Disk Orientation (RPI etc.) | Loader computes correct `Voxel->LPIWorld` affine from header; inverse `World->Voxel` matrix is put in UBO. Shader uses this matrix, correctly sampling the texture regardless of original orientation. (See §5.B, §5.E) |

## 61. Blending Semantics (New)

*   The `blendMode` in `DisplayProps` directly maps to `LayerUBO.blend_mode`.
*   The fragment shader's `composite()` function (see §4) implements the different blend modes (alpha, add, max, min) based on this UBO field.
*   Changing colormap, window, thresholds, or blend mode only affects the `DisplayProps` within the `LayerStack` store. Updating a layer's style is therefore a lightweight store mutation and results in only the small UBO data being sent to the GPU per frame.

## 62. Design Summary (New)

*   **Modularity:** Volumes (`VolumeHandle`) are immutable data references managed by Rust registries and the GPU texture atlas. Display styles (`DisplayProps`) live in a small, reactive TypeScript store (`LayerStack`).
*   **Extensibility:** Adding new layers (e.g., statistical maps, annotations) involves adding a new `Layer` entry to the `LayerStack` with its own `VolumeHandle` and `DisplayProps`. The core rendering logic doesn't need modification.
*   **Performance:** Only immutable handles (`VolumeHandle.id`) cross the Rust/TS boundary after initial load. Per-frame UBO updates are minimal (≤ few hundred bytes), ensuring smooth interaction even with many layers.

## 63. Surface Data Loading and Rendering

This section defines the architecture for loading and rendering triangle-mesh surfaces (GIfTI, FreeSurfer) alongside volumetric layers, using the same zero-copy principles and rendering infrastructure.

### 63.1 Surface Format Support

| Format | Crate | Status | Capabilities | Notes |
| :--- | :--- | :--- | :--- | :--- |
| GIFTI (*.gii) | `gifti` | Actively maintained (0.7+) | Binary-safe read/write of data arrays<br>Handles ASCII and base64-encoded payloads<br>Exposes vertex/triangle arrays as `Vec<f32>`/`Vec<u32>` | No in-crate spatial orientation helpers (we derive from the header's `Matrix_*` or fall back to MNI LPI) |
| FreeSurfer binary (surf, pial, white, ...) | `neuroformats::fs_surface` | Stable (0.3+) | `read_surf()`/`write_surf()` give vertices & faces<br>Also supports FreeSurfer-MGH volumes & annotation tables | Only the binary surface format; ASCII "*.asc" needs a wrapper |
| FreeSurfer ASCII (*.asc) | Not in a crate | N/A | Parsing is trivial (header + two space-separated tables) | ASCII lacks normals; compute them or read from *.curv |

Example usage from `neuroformats`:
```rust
use neuroformats::fs_surface::read_surf;
let (vtx, tri) = read_surf("lh.pial")?;  // vtx: Vec<[f32;3]>, tri: Vec<[i32;3]>
```

### 63.2 Triangle Mesh Data Model

Similar to our `VolumeSendable` enum, we introduce a `SurfaceSendable` enum for surfaces:

```rust
// core/geom/src/tri_mesh.rs
use bytemuck::{Pod, Zeroable};
use nalgebra::{Vector3, Matrix4};
use serde::Serialize;

/// POD bound identical to VoxelData, kept separate for clarity
pub trait VertexScalar: Copy + Pod + Zeroable + 'static {}
impl<T: Copy + Pod + Zeroable + 'static> VertexScalar for T {}

#[derive(Debug, Clone, Serialize)]
pub struct TriMesh<T: VertexScalar = f32> {
    /// Vertex positions interleaved as [x0,y0,z0, x1,y1,z1, ...]
    pub vertices: Vec<T>,
    /// Face indices (triangle list) as [i0,j0,k0, i1,j1,k1, ...]
    pub indices: Vec<u32>,
    /// Optional per-vertex normals (same stride as vertices)
    pub normals: Option<Vec<T>>,
    /// Optional per-vertex values (e.g. curvature / label)
    pub scalars: Option<Vec<T>>,
    /// World-space transform (e.g. GIFTI's Matrix_*)
    pub world_from_vertex: Matrix4<f32>,
}

impl<T: VertexScalar> TriMesh<T> {
    #[inline] pub fn vertex_count(&self) -> usize { self.vertices.len() / 3 }
    #[inline] pub fn triangle_count(&self) -> usize { self.indices.len() / 3 }

    /// Borrow as raw bytes – enables zero-copy SAB transfer & GPU upload
    #[inline] pub fn vertices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.vertices)
    }
    #[inline] pub fn indices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.indices)
    }
}

// core/bridge_types/src/surface_sendable.rs
#[derive(Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../packages/api/src/generated/surface.ts")]
pub enum SurfaceSendable {
    MeshF32(TriMesh<f32>),
    MeshF64(TriMesh<f64>),
}

impl SurfaceSendable {
    pub fn as_bytes(&self) -> (&[u8], &[u8]) {
        match self {
            Self::MeshF32(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
            Self::MeshF64(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
        }
    }
}
```

The TypeScript mirror (auto-generated):

```typescript
// packages/api/generated/surface.ts (generated by ts-rs)
export type SurfaceSendable =
  | { MeshF32: TriMeshF32 }
  | { MeshF64: TriMeshF64 };

export interface TriMeshF32 {
  vertices: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  scalars?: Float32Array;
  world_from_vertex: Float32Array; // length 16, row-major
}
```

### 63.3 Integration Path

1. **Add loaders under `core/loaders/`:**
   ```
   core/
     loaders/
       gifti/
         lib.rs   // re-export gifti::*, add Into<Surface> conversion
       freesurfer/
         lib.rs   // use neuroformats::fs_surface; if asc needed, embed parser
   ```

2. **Loader Implementation**
   Each loader implements the existing async `Loader` trait, returning `(id, SurfaceSendable)`. The existing `api_bridge::load_file` already supports polymorphic return, requiring only the switch/enum arm addition.

3. **Rendering Path**
   Triangle meshes follow the same `request_layer_gpu_resources` flow but map to the reserved `SurfaceLayerSpec`/`SurfaceLayerGPU` variants. The render loop creates `wgpu::Buffer` resources for vertices/indices and binds them in the surface pipeline.

4. **Surface GPU Resources**
   ```rust
   struct SurfaceLayerGPU {
       vertex_buffer_id: u32,
       index_buffer_id: u32,
       index_count: u32,
       world_from_vertex: [[f32;4];4],
   }
   ```

5. **Unit Testing**
   Add an `fs_testdata/` folder with small sample surface files (`.pial`, `.asc`, `.gii`) for unit tests that verify round-trip through the loaders.

### 63.4 TypeScript Data Access

The same dual-representation pattern used for volumes applies to surfaces:
1. Rust loader handles the heavy payload parsing
2. For lightweight TypeScript algorithms (e.g., coloring by curvature), pass metadata and a SharedArrayBuffer view to the worker without copying
3. Binary parsers remain in Rust - no TS reimplementation

### 63.5 Implementation Effort

* No show-stoppers: both GIFTI and FreeSurfer surfaces have working Rust crates
* Estimated effort:
  * Wire loaders: ~1 day
  * Optional ASCII parser: ~0.25 day
* Alignment: Fits with Phase-1 plan - surfaces land in Sprint 2 without derailing volume work

**See also:** The UI-side contract for real-time layer editing, including LayerUBO field updates and the patch_layer command, is detailed in GUIDE-ui-layout-phase1.md Section 11.

## 64. Summary - Handling Data Variations (New)

| Issue                             | Where it is solved                                                                                                |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------- | 
| Different Resolutions             | `VolumeHandle.dim` and `worldToVoxel` affine encode spacing; shader samples layers in common world space.       |
| Different FOV / Offsets           | Affine matrix includes translation; out-of-FOV fragments get alpha=0 via shader bounds check using `dim`.         |
| Different On-Disk Orientation (RPI etc.) | Loader computes correct `Voxel->LPIWorld` affine from header; inverse `World->Voxel` matrix is put in UBO. Shader uses this matrix, correctly sampling the texture regardless of original orientation. (See §5.B, §5.E) |

## 65. Blending Semantics (New)

*   The `blendMode` in `DisplayProps` directly maps to `LayerUBO.blend_mode`.
*   The fragment shader's `composite()` function (see §4) implements the different blend modes (alpha, add, max, min) based on this UBO field.
*   Changing colormap, window, thresholds, or blend mode only affects the `DisplayProps` within the `LayerStack` store. Updating a layer's style is therefore a lightweight store mutation and results in only the small UBO data being sent to the GPU per frame.

## 66. Design Summary (New)

*   **Modularity:** Volumes (`VolumeHandle`) are immutable data references managed by Rust registries and the GPU texture atlas. Display styles (`DisplayProps`) live in a small, reactive TypeScript store (`LayerStack`).
*   **Extensibility:** Adding new layers (e.g., statistical maps, annotations) involves adding a new `Layer` entry to the `LayerStack` with its own `VolumeHandle` and `DisplayProps`. The core rendering logic doesn't need modification.
*   **Performance:** Only immutable handles (`VolumeHandle.id`) cross the Rust/TS boundary after initial load. Per-frame UBO updates are minimal (≤ few hundred bytes), ensuring smooth interaction even with many layers.

## 67. Surface Data Loading and Rendering

This section defines the architecture for loading and rendering triangle-mesh surfaces (GIfTI, FreeSurfer) alongside volumetric layers, using the same zero-copy principles and rendering infrastructure.

### 67.1 Surface Format Support

| Format | Crate | Status | Capabilities | Notes |
| :--- | :--- | :--- | :--- | :--- |
| GIFTI (*.gii) | `gifti` | Actively maintained (0.7+) | Binary-safe read/write of data arrays<br>Handles ASCII and base64-encoded payloads<br>Exposes vertex/triangle arrays as `Vec<f32>`/`Vec<u32>` | No in-crate spatial orientation helpers (we derive from the header's `Matrix_*` or fall back to MNI LPI) |
| FreeSurfer binary (surf, pial, white, ...) | `neuroformats::fs_surface` | Stable (0.3+) | `read_surf()`/`write_surf()` give vertices & faces<br>Also supports FreeSurfer-MGH volumes & annotation tables | Only the binary surface format; ASCII "*.asc" needs a wrapper |
| FreeSurfer ASCII (*.asc) | Not in a crate | N/A | Parsing is trivial (header + two space-separated tables) | ASCII lacks normals; compute them or read from *.curv |

Example usage from `neuroformats`:
```rust
use neuroformats::fs_surface::read_surf;
let (vtx, tri) = read_surf("lh.pial")?;  // vtx: Vec<[f32;3]>, tri: Vec<[i32;3]>
```

### 67.2 Triangle Mesh Data Model

Similar to our `VolumeSendable` enum, we introduce a `SurfaceSendable` enum for surfaces:

```rust
// core/geom/src/tri_mesh.rs
use bytemuck::{Pod, Zeroable};
use nalgebra::{Vector3, Matrix4};
use serde::Serialize;

/// POD bound identical to VoxelData, kept separate for clarity
pub trait VertexScalar: Copy + Pod + Zeroable + 'static {}
impl<T: Copy + Pod + Zeroable + 'static> VertexScalar for T {}

#[derive(Debug, Clone, Serialize)]
pub struct TriMesh<T: VertexScalar = f32> {
    /// Vertex positions interleaved as [x0,y0,z0, x1,y1,z1, ...]
    pub vertices: Vec<T>,
    /// Face indices (triangle list) as [i0,j0,k0, i1,j1,k1, ...]
    pub indices: Vec<u32>,
    /// Optional per-vertex normals (same stride as vertices)
    pub normals: Option<Vec<T>>,
    /// Optional per-vertex values (e.g. curvature / label)
    pub scalars: Option<Vec<T>>,
    /// World-space transform (e.g. GIFTI's Matrix_*)
    pub world_from_vertex: Matrix4<f32>,
}

impl<T: VertexScalar> TriMesh<T> {
    #[inline] pub fn vertex_count(&self) -> usize { self.vertices.len() / 3 }
    #[inline] pub fn triangle_count(&self) -> usize { self.indices.len() / 3 }

    /// Borrow as raw bytes – enables zero-copy SAB transfer & GPU upload
    #[inline] pub fn vertices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.vertices)
    }
    #[inline] pub fn indices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.indices)
    }
}

// core/bridge_types/src/surface_sendable.rs
#[derive(Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../packages/api/src/generated/surface.ts")]
pub enum SurfaceSendable {
    MeshF32(TriMesh<f32>),
    MeshF64(TriMesh<f64>),
}

impl SurfaceSendable {
    pub fn as_bytes(&self) -> (&[u8], &[u8]) {
        match self {
            Self::MeshF32(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
            Self::MeshF64(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
        }
    }
}
```

The TypeScript mirror (auto-generated):

```typescript
// packages/api/generated/surface.ts (generated by ts-rs)
export type SurfaceSendable =
  | { MeshF32: TriMeshF32 }
  | { MeshF64: TriMeshF64 };

export interface TriMeshF32 {
  vertices: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  scalars?: Float32Array;
  world_from_vertex: Float32Array; // length 16, row-major
}
```

### 67.3 Integration Path

1. **Add loaders under `core/loaders/`:**
   ```
   core/
     loaders/
       gifti/
         lib.rs   // re-export gifti::*, add Into<Surface> conversion
       freesurfer/
         lib.rs   // use neuroformats::fs_surface; if asc needed, embed parser
   ```

2. **Loader Implementation**
   Each loader implements the existing async `Loader` trait, returning `(id, SurfaceSendable)`. The existing `api_bridge::load_file` already supports polymorphic return, requiring only the switch/enum arm addition.

3. **Rendering Path**
   Triangle meshes follow the same `request_layer_gpu_resources` flow but map to the reserved `SurfaceLayerSpec`/`SurfaceLayerGPU` variants. The render loop creates `wgpu::Buffer` resources for vertices/indices and binds them in the surface pipeline.

4. **Surface GPU Resources**
   ```rust
   struct SurfaceLayerGPU {
       vertex_buffer_id: u32,
       index_buffer_id: u32,
       index_count: u32,
       world_from_vertex: [[f32;4];4],
   }
   ```

5. **Unit Testing**
   Add an `fs_testdata/` folder with small sample surface files (`.pial`, `.asc`, `.gii`) for unit tests that verify round-trip through the loaders.

### 67.4 TypeScript Data Access

The same dual-representation pattern used for volumes applies to surfaces:
1. Rust loader handles the heavy payload parsing
2. For lightweight TypeScript algorithms (e.g., coloring by curvature), pass metadata and a SharedArrayBuffer view to the worker without copying
3. Binary parsers remain in Rust - no TS reimplementation

### 67.5 Implementation Effort

* No show-stoppers: both GIFTI and FreeSurfer surfaces have working Rust crates
* Estimated effort:
  * Wire loaders: ~1 day
  * Optional ASCII parser: ~0.25 day
* Alignment: Fits with Phase-1 plan - surfaces land in Sprint 2 without derailing volume work

**See also:** The UI-side contract for real-time layer editing, including LayerUBO field updates and the patch_layer command, is detailed in GUIDE-ui-layout-phase1.md Section 11.

## 68. Summary - Handling Data Variations (New)

| Issue                             | Where it is solved                                                                                                |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------- | 
| Different Resolutions             | `VolumeHandle.dim` and `worldToVoxel` affine encode spacing; shader samples layers in common world space.       |
| Different FOV / Offsets           | Affine matrix includes translation; out-of-FOV fragments get alpha=0 via shader bounds check using `dim`.         |
| Different On-Disk Orientation (RPI etc.) | Loader computes correct `Voxel->LPIWorld` affine from header; inverse `World->Voxel` matrix is put in UBO. Shader uses this matrix, correctly sampling the texture regardless of original orientation. (See §5.B, §5.E) |

## 69. Blending Semantics (New)

*   The `blendMode` in `DisplayProps` directly maps to `LayerUBO.blend_mode`.
*   The fragment shader's `composite()` function (see §4) implements the different blend modes (alpha, add, max, min) based on this UBO field.
*   Changing colormap, window, thresholds, or blend mode only affects the `DisplayProps` within the `LayerStack` store. Updating a layer's style is therefore a lightweight store mutation and results in only the small UBO data being sent to the GPU per frame.

## 70. Design Summary (New)

*   **Modularity:** Volumes (`VolumeHandle`) are immutable data references managed by Rust registries and the GPU texture atlas. Display styles (`DisplayProps`) live in a small, reactive TypeScript store (`LayerStack`).
*   **Extensibility:** Adding new layers (e.g., statistical maps, annotations) involves adding a new `Layer` entry to the `LayerStack` with its own `VolumeHandle` and `DisplayProps`. The core rendering logic doesn't need modification.
*   **Performance:** Only immutable handles (`VolumeHandle.id`) cross the Rust/TS boundary after initial load. Per-frame UBO updates are minimal (≤ few hundred bytes), ensuring smooth interaction even with many layers.

## 71. Surface Data Loading and Rendering

This section defines the architecture for loading and rendering triangle-mesh surfaces (GIfTI, FreeSurfer) alongside volumetric layers, using the same zero-copy principles and rendering infrastructure.

### 71.1 Surface Format Support

| Format | Crate | Status | Capabilities | Notes |
| :--- | :--- | :--- | :--- | :--- |
| GIFTI (*.gii) | `gifti` | Actively maintained (0.7+) | Binary-safe read/write of data arrays<br>Handles ASCII and base64-encoded payloads<br>Exposes vertex/triangle arrays as `Vec<f32>`/`Vec<u32>` | No in-crate spatial orientation helpers (we derive from the header's `Matrix_*` or fall back to MNI LPI) |
| FreeSurfer binary (surf, pial, white, ...) | `neuroformats::fs_surface` | Stable (0.3+) | `read_surf()`/`write_surf()` give vertices & faces<br>Also supports FreeSurfer-MGH volumes & annotation tables | Only the binary surface format; ASCII "*.asc" needs a wrapper |
| FreeSurfer ASCII (*.asc) | Not in a crate | N/A | Parsing is trivial (header + two space-separated tables) | ASCII lacks normals; compute them or read from *.curv |

Example usage from `neuroformats`:
```rust
use neuroformats::fs_surface::read_surf;
let (vtx, tri) = read_surf("lh.pial")?;  // vtx: Vec<[f32;3]>, tri: Vec<[i32;3]>
```

### 71.2 Triangle Mesh Data Model

Similar to our `VolumeSendable` enum, we introduce a `SurfaceSendable` enum for surfaces:

```rust
// core/geom/src/tri_mesh.rs
use bytemuck::{Pod, Zeroable};
use nalgebra::{Vector3, Matrix4};
use serde::Serialize;

/// POD bound identical to VoxelData, kept separate for clarity
pub trait VertexScalar: Copy + Pod + Zeroable + 'static {}
impl<T: Copy + Pod + Zeroable + 'static> VertexScalar for T {}

#[derive(Debug, Clone, Serialize)]
pub struct TriMesh<T: VertexScalar = f32> {
    /// Vertex positions interleaved as [x0,y0,z0, x1,y1,z1, ...]
    pub vertices: Vec<T>,
    /// Face indices (triangle list) as [i0,j0,k0, i1,j1,k1, ...]
    pub indices: Vec<u32>,
    /// Optional per-vertex normals (same stride as vertices)
    pub normals: Option<Vec<T>>,
    /// Optional per-vertex values (e.g. curvature / label)
    pub scalars: Option<Vec<T>>,
    /// World-space transform (e.g. GIFTI's Matrix_*)
    pub world_from_vertex: Matrix4<f32>,
}

impl<T: VertexScalar> TriMesh<T> {
    #[inline] pub fn vertex_count(&self) -> usize { self.vertices.len() / 3 }
    #[inline] pub fn triangle_count(&self) -> usize { self.indices.len() / 3 }

    /// Borrow as raw bytes – enables zero-copy SAB transfer & GPU upload
    #[inline] pub fn vertices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.vertices)
    }
    #[inline] pub fn indices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.indices)
    }
}

// core/bridge_types/src/surface_sendable.rs
#[derive(Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../packages/api/src/generated/surface.ts")]
pub enum SurfaceSendable {
    MeshF32(TriMesh<f32>),
    MeshF64(TriMesh<f64>),
}

impl SurfaceSendable {
    pub fn as_bytes(&self) -> (&[u8], &[u8]) {
        match self {
            Self::MeshF32(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
            Self::MeshF64(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
        }
    }
}
```

The TypeScript mirror (auto-generated):

```typescript
// packages/api/generated/surface.ts (generated by ts-rs)
export type SurfaceSendable =
  | { MeshF32: TriMeshF32 }
  | { MeshF64: TriMeshF64 };

export interface TriMeshF32 {
  vertices: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  scalars?: Float32Array;
  world_from_vertex: Float32Array; // length 16, row-major
}
```

### 71.3 Integration Path

1. **Add loaders under `core/loaders/`:**
   ```
   core/
     loaders/
       gifti/
         lib.rs   // re-export gifti::*, add Into<Surface> conversion
       freesurfer/
         lib.rs   // use neuroformats::fs_surface; if asc needed, embed parser
   ```

2. **Loader Implementation**
   Each loader implements the existing async `Loader` trait, returning `(id, SurfaceSendable)`. The existing `api_bridge::load_file` already supports polymorphic return, requiring only the switch/enum arm addition.

3. **Rendering Path**
   Triangle meshes follow the same `request_layer_gpu_resources` flow but map to the reserved `SurfaceLayerSpec`/`SurfaceLayerGPU` variants. The render loop creates `wgpu::Buffer` resources for vertices/indices and binds them in the surface pipeline.

4. **Surface GPU Resources**
   ```rust
   struct SurfaceLayerGPU {
       vertex_buffer_id: u32,
       index_buffer_id: u32,
       index_count: u32,
       world_from_vertex: [[f32;4];4],
   }
   ```

5. **Unit Testing**
   Add an `fs_testdata/` folder with small sample surface files (`.pial`, `.asc`, `.gii`) for unit tests that verify round-trip through the loaders.

### 71.4 TypeScript Data Access

The same dual-representation pattern used for volumes applies to surfaces:
1. Rust loader handles the heavy payload parsing
2. For lightweight TypeScript algorithms (e.g., coloring by curvature), pass metadata and a SharedArrayBuffer view to the worker without copying
3. Binary parsers remain in Rust - no TS reimplementation

### 71.5 Implementation Effort

* No show-stoppers: both GIFTI and FreeSurfer surfaces have working Rust crates
* Estimated effort:
  * Wire loaders: ~1 day
  * Optional ASCII parser: ~0.25 day
* Alignment: Fits with Phase-1 plan - surfaces land in Sprint 2 without derailing volume work

**See also:** The UI-side contract for real-time layer editing, including LayerUBO field updates and the patch_layer command, is detailed in GUIDE-ui-layout-phase1.md Section 11.

## 72. Summary - Handling Data Variations (New)

| Issue                             | Where it is solved                                                                                                |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------- | 
| Different Resolutions             | `VolumeHandle.dim` and `worldToVoxel` affine encode spacing; shader samples layers in common world space.       |
| Different FOV / Offsets           | Affine matrix includes translation; out-of-FOV fragments get alpha=0 via shader bounds check using `dim`.         |
| Different On-Disk Orientation (RPI etc.) | Loader computes correct `Voxel->LPIWorld` affine from header; inverse `World->Voxel` matrix is put in UBO. Shader uses this matrix, correctly sampling the texture regardless of original orientation. (See §5.B, §5.E) |

## 73. Blending Semantics (New)

*   The `blendMode` in `DisplayProps` directly maps to `LayerUBO.blend_mode`.
*   The fragment shader's `composite()` function (see §4) implements the different blend modes (alpha, add, max, min) based on this UBO field.
*   Changing colormap, window, thresholds, or blend mode only affects the `DisplayProps` within the `LayerStack` store. Updating a layer's style is therefore a lightweight store mutation and results in only the small UBO data being sent to the GPU per frame.

## 74. Design Summary (New)

*   **Modularity:** Volumes (`VolumeHandle`) are immutable data references managed by Rust registries and the GPU texture atlas. Display styles (`DisplayProps`) live in a small, reactive TypeScript store (`LayerStack`).
*   **Extensibility:** Adding new layers (e.g., statistical maps, annotations) involves adding a new `Layer` entry to the `LayerStack` with its own `VolumeHandle` and `DisplayProps`. The core rendering logic doesn't need modification.
*   **Performance:** Only immutable handles (`VolumeHandle.id`) cross the Rust/TS boundary after initial load. Per-frame UBO updates are minimal (≤ few hundred bytes), ensuring smooth interaction even with many layers.

## 75. Surface Data Loading and Rendering

This section defines the architecture for loading and rendering triangle-mesh surfaces (GIfTI, FreeSurfer) alongside volumetric layers, using the same zero-copy principles and rendering infrastructure.

### 75.1 Surface Format Support

| Format | Crate | Status | Capabilities | Notes |
| :--- | :--- | :--- | :--- | :--- |
| GIFTI (*.gii) | `gifti` | Actively maintained (0.7+) | Binary-safe read/write of data arrays<br>Handles ASCII and base64-encoded payloads<br>Exposes vertex/triangle arrays as `Vec<f32>`/`Vec<u32>` | No in-crate spatial orientation helpers (we derive from the header's `Matrix_*` or fall back to MNI LPI) |
| FreeSurfer binary (surf, pial, white, ...) | `neuroformats::fs_surface` | Stable (0.3+) | `read_surf()`/`write_surf()` give vertices & faces<br>Also supports FreeSurfer-MGH volumes & annotation tables | Only the binary surface format; ASCII "*.asc" needs a wrapper |
| FreeSurfer ASCII (*.asc) | Not in a crate | N/A | Parsing is trivial (header + two space-separated tables) | ASCII lacks normals; compute them or read from *.curv |

Example usage from `neuroformats`:
```rust
use neuroformats::fs_surface::read_surf;
let (vtx, tri) = read_surf("lh.pial")?;  // vtx: Vec<[f32;3]>, tri: Vec<[i32;3]>
```

### 75.2 Triangle Mesh Data Model

Similar to our `VolumeSendable` enum, we introduce a `SurfaceSendable` enum for surfaces:

```rust
// core/geom/src/tri_mesh.rs
use bytemuck::{Pod, Zeroable};
use nalgebra::{Vector3, Matrix4};
use serde::Serialize;

/// POD bound identical to VoxelData, kept separate for clarity
pub trait VertexScalar: Copy + Pod + Zeroable + 'static {}
impl<T: Copy + Pod + Zeroable + 'static> VertexScalar for T {}

#[derive(Debug, Clone, Serialize)]
pub struct TriMesh<T: VertexScalar = f32> {
    /// Vertex positions interleaved as [x0,y0,z0, x1,y1,z1, ...]
    pub vertices: Vec<T>,
    /// Face indices (triangle list) as [i0,j0,k0, i1,j1,k1, ...]
    pub indices: Vec<u32>,
    /// Optional per-vertex normals (same stride as vertices)
    pub normals: Option<Vec<T>>,
    /// Optional per-vertex values (e.g. curvature / label)
    pub scalars: Option<Vec<T>>,
    /// World-space transform (e.g. GIFTI's Matrix_*)
    pub world_from_vertex: Matrix4<f32>,
}

impl<T: VertexScalar> TriMesh<T> {
    #[inline] pub fn vertex_count(&self) -> usize { self.vertices.len() / 3 }
    #[inline] pub fn triangle_count(&self) -> usize { self.indices.len() / 3 }

    /// Borrow as raw bytes – enables zero-copy SAB transfer & GPU upload
    #[inline] pub fn vertices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.vertices)
    }
    #[inline] pub fn indices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.indices)
    }
}

// core/bridge_types/src/surface_sendable.rs
#[derive(Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../packages/api/src/generated/surface.ts")]
pub enum SurfaceSendable {
    MeshF32(TriMesh<f32>),
    MeshF64(TriMesh<f64>),
}

impl SurfaceSendable {
    pub fn as_bytes(&self) -> (&[u8], &[u8]) {
        match self {
            Self::MeshF32(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
            Self::MeshF64(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
        }
    }
}
```

The TypeScript mirror (auto-generated):

```typescript
// packages/api/generated/surface.ts (generated by ts-rs)
export type SurfaceSendable =
  | { MeshF32: TriMeshF32 }
  | { MeshF64: TriMeshF64 };

export interface TriMeshF32 {
  vertices: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  scalars?: Float32Array;
  world_from_vertex: Float32Array; // length 16, row-major
}
```

### 75.3 Integration Path

1. **Add loaders under `core/loaders/`:**
   ```
   core/
     loaders/
       gifti/
         lib.rs   // re-export gifti::*, add Into<Surface> conversion
       freesurfer/
         lib.rs   // use neuroformats::fs_surface; if asc needed, embed parser
   ```

2. **Loader Implementation**
   Each loader implements the existing async `Loader` trait, returning `(id, SurfaceSendable)`. The existing `api_bridge::load_file` already supports polymorphic return, requiring only the switch/enum arm addition.

3. **Rendering Path**
   Triangle meshes follow the same `request_layer_gpu_resources` flow but map to the reserved `SurfaceLayerSpec`/`SurfaceLayerGPU` variants. The render loop creates `wgpu::Buffer` resources for vertices/indices and binds them in the surface pipeline.

4. **Surface GPU Resources**
   ```rust
   struct SurfaceLayerGPU {
       vertex_buffer_id: u32,
       index_buffer_id: u32,
       index_count: u32,
       world_from_vertex: [[f32;4];4],
   }
   ```

5. **Unit Testing**
   Add an `fs_testdata/` folder with small sample surface files (`.pial`, `.asc`, `.gii`) for unit tests that verify round-trip through the loaders.

### 75.4 TypeScript Data Access

The same dual-representation pattern used for volumes applies to surfaces:
1. Rust loader handles the heavy payload parsing
2. For lightweight TypeScript algorithms (e.g., coloring by curvature), pass metadata and a SharedArrayBuffer view to the worker without copying
3. Binary parsers remain in Rust - no TS reimplementation

### 75.5 Implementation Effort

* No show-stoppers: both GIFTI and FreeSurfer surfaces have working Rust crates
* Estimated effort:
  * Wire loaders: ~1 day
  * Optional ASCII parser: ~0.25 day
* Alignment: Fits with Phase-1 plan - surfaces land in Sprint 2 without derailing volume work

**See also:** The UI-side contract for real-time layer editing, including LayerUBO field updates and the patch_layer command, is detailed in GUIDE-ui-layout-phase1.md Section 11.

## 76. Summary - Handling Data Variations (New)

| Issue                             | Where it is solved                                                                                                |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------- | 
| Different Resolutions             | `VolumeHandle.dim` and `worldToVoxel` affine encode spacing; shader samples layers in common world space.       |
| Different FOV / Offsets           | Affine matrix includes translation; out-of-FOV fragments get alpha=0 via shader bounds check using `dim`.         |
| Different On-Disk Orientation (RPI etc.) | Loader computes correct `Voxel->LPIWorld` affine from header; inverse `World->Voxel` matrix is put in UBO. Shader uses this matrix, correctly sampling the texture regardless of original orientation. (See §5.B, §5.E) |

## 77. Blending Semantics (New)

*   The `blendMode` in `DisplayProps` directly maps to `LayerUBO.blend_mode`.
*   The fragment shader's `composite()` function (see §4) implements the different blend modes (alpha, add, max, min) based on this UBO field.
*   Changing colormap, window, thresholds, or blend mode only affects the `DisplayProps` within the `LayerStack` store. Updating a layer's style is therefore a lightweight store mutation and results in only the small UBO data being sent to the GPU per frame.

## 78. Design Summary (New)

*   **Modularity:** Volumes (`VolumeHandle`) are immutable data references managed by Rust registries and the GPU texture atlas. Display styles (`DisplayProps`) live in a small, reactive TypeScript store (`LayerStack`).
*   **Extensibility:** Adding new layers (e.g., statistical maps, annotations) involves adding a new `Layer` entry to the `LayerStack` with its own `VolumeHandle` and `DisplayProps`. The core rendering logic doesn't need modification.
*   **Performance:** Only immutable handles (`VolumeHandle.id`) cross the Rust/TS boundary after initial load. Per-frame UBO updates are minimal (≤ few hundred bytes), ensuring smooth interaction even with many layers.

## 79. Surface Data Loading and Rendering

This section defines the architecture for loading and rendering triangle-mesh surfaces (GIfTI, FreeSurfer) alongside volumetric layers, using the same zero-copy principles and rendering infrastructure.

### 79.1 Surface Format Support

| Format | Crate | Status | Capabilities | Notes |
| :--- | :--- | :--- | :--- | :--- |
| GIFTI (*.gii) | `gifti` | Actively maintained (0.7+) | Binary-safe read/write of data arrays<br>Handles ASCII and base64-encoded payloads<br>Exposes vertex/triangle arrays as `Vec<f32>`/`Vec<u32>` | No in-crate spatial orientation helpers (we derive from the header's `Matrix_*` or fall back to MNI LPI) |
| FreeSurfer binary (surf, pial, white, ...) | `neuroformats::fs_surface` | Stable (0.3+) | `read_surf()`/`write_surf()` give vertices & faces<br>Also supports FreeSurfer-MGH volumes & annotation tables | Only the binary surface format; ASCII "*.asc" needs a wrapper |
| FreeSurfer ASCII (*.asc) | Not in a crate | N/A | Parsing is trivial (header + two space-separated tables) | ASCII lacks normals; compute them or read from *.curv |

Example usage from `neuroformats`:
```rust
use neuroformats::fs_surface::read_surf;
let (vtx, tri) = read_surf("lh.pial")?;  // vtx: Vec<[f32;3]>, tri: Vec<[i32;3]>
```

### 79.2 Triangle Mesh Data Model

Similar to our `VolumeSendable` enum, we introduce a `SurfaceSendable` enum for surfaces:

```rust
// core/geom/src/tri_mesh.rs
use bytemuck::{Pod, Zeroable};
use nalgebra::{Vector3, Matrix4};
use serde::Serialize;

/// POD bound identical to VoxelData, kept separate for clarity
pub trait VertexScalar: Copy + Pod + Zeroable + 'static {}
impl<T: Copy + Pod + Zeroable + 'static> VertexScalar for T {}

#[derive(Debug, Clone, Serialize)]
pub struct TriMesh<T: VertexScalar = f32> {
    /// Vertex positions interleaved as [x0,y0,z0, x1,y1,z1, ...]
    pub vertices: Vec<T>,
    /// Face indices (triangle list) as [i0,j0,k0, i1,j1,k1, ...]
    pub indices: Vec<u32>,
    /// Optional per-vertex normals (same stride as vertices)
    pub normals: Option<Vec<T>>,
    /// Optional per-vertex values (e.g. curvature / label)
    pub scalars: Option<Vec<T>>,
    /// World-space transform (e.g. GIFTI's Matrix_*)
    pub world_from_vertex: Matrix4<f32>,
}

impl<T: VertexScalar> TriMesh<T> {
    #[inline] pub fn vertex_count(&self) -> usize { self.vertices.len() / 3 }
    #[inline] pub fn triangle_count(&self) -> usize { self.indices.len() / 3 }

    /// Borrow as raw bytes – enables zero-copy SAB transfer & GPU upload
    #[inline] pub fn vertices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.vertices)
    }
    #[inline] pub fn indices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.indices)
    }
}

// core/bridge_types/src/surface_sendable.rs
#[derive(Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../packages/api/src/generated/surface.ts")]
pub enum SurfaceSendable {
    MeshF32(TriMesh<f32>),
    MeshF64(TriMesh<f64>),
}

impl SurfaceSendable {
    pub fn as_bytes(&self) -> (&[u8], &[u8]) {
        match self {
            Self::MeshF32(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
            Self::MeshF64(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
        }
    }
}
```

The TypeScript mirror (auto-generated):

```typescript
// packages/api/generated/surface.ts (generated by ts-rs)
export type SurfaceSendable =
  | { MeshF32: TriMeshF32 }
  | { MeshF64: TriMeshF64 };

export interface TriMeshF32 {
  vertices: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  scalars?: Float32Array;
  world_from_vertex: Float32Array; // length 16, row-major
}
```

### 79.3 Integration Path

1. **Add loaders under `core/loaders/`:**
   ```
   core/
     loaders/
       gifti/
         lib.rs   // re-export gifti::*, add Into<Surface> conversion
       freesurfer/
         lib.rs   // use neuroformats::fs_surface; if asc needed, embed parser
   ```

2. **Loader Implementation**
   Each loader implements the existing async `Loader` trait, returning `(id, SurfaceSendable)`. The existing `api_bridge::load_file` already supports polymorphic return, requiring only the switch/enum arm addition.

3. **Rendering Path**
   Triangle meshes follow the same `request_layer_gpu_resources` flow but map to the reserved `SurfaceLayerSpec`/`SurfaceLayerGPU` variants. The render loop creates `wgpu::Buffer` resources for vertices/indices and binds them in the surface pipeline.

4. **Surface GPU Resources**
   ```rust
   struct SurfaceLayerGPU {
       vertex_buffer_id: u32,
       index_buffer_id: u32,
       index_count: u32,
       world_from_vertex: [[f32;4];4],
   }
   ```

5. **Unit Testing**
   Add an `fs_testdata/` folder with small sample surface files (`.pial`, `.asc`, `.gii`) for unit tests that verify round-trip through the loaders.

### 79.4 TypeScript Data Access

The same dual-representation pattern used for volumes applies to surfaces:
1. Rust loader handles the heavy payload parsing
2. For lightweight TypeScript algorithms (e.g., coloring by curvature), pass metadata and a SharedArrayBuffer view to the worker without copying
3. Binary parsers remain in Rust - no TS reimplementation

### 79.5 Implementation Effort

* No show-stoppers: both GIFTI and FreeSurfer surfaces have working Rust crates
* Estimated effort:
  * Wire loaders: ~1 day
  * Optional ASCII parser: ~0.25 day
* Alignment: Fits with Phase-1 plan - surfaces land in Sprint 2 without derailing volume work

**See also:** The UI-side contract for real-time layer editing, including LayerUBO field updates and the patch_layer command, is detailed in GUIDE-ui-layout-phase1.md Section 11.

## 80. Summary - Handling Data Variations (New)

| Issue                             | Where it is solved                                                                                                |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------- | 
| Different Resolutions             | `VolumeHandle.dim` and `worldToVoxel` affine encode spacing; shader samples layers in common world space.       |
| Different FOV / Offsets           | Affine matrix includes translation; out-of-FOV fragments get alpha=0 via shader bounds check using `dim`.         |
| Different On-Disk Orientation (RPI etc.) | Loader computes correct `Voxel->LPIWorld` affine from header; inverse `World->Voxel` matrix is put in UBO. Shader uses this matrix, correctly sampling the texture regardless of original orientation. (See §5.B, §5.E) |

## 81. Blending Semantics (New)

*   The `blendMode` in `DisplayProps` directly maps to `LayerUBO.blend_mode`.
*   The fragment shader's `composite()` function (see §4) implements the different blend modes (alpha, add, max, min) based on this UBO field.
*   Changing colormap, window, thresholds, or blend mode only affects the `DisplayProps` within the `LayerStack` store. Updating a layer's style is therefore a lightweight store mutation and results in only the small UBO data being sent to the GPU per frame.

## 82. Design Summary (New)

*   **Modularity:** Volumes (`VolumeHandle`) are immutable data references managed by Rust registries and the GPU texture atlas. Display styles (`DisplayProps`) live in a small, reactive TypeScript store (`LayerStack`).
*   **Extensibility:** Adding new layers (e.g., statistical maps, annotations) involves adding a new `Layer` entry to the `LayerStack` with its own `VolumeHandle` and `DisplayProps`. The core rendering logic doesn't need modification.
*   **Performance:** Only immutable handles (`VolumeHandle.id`) cross the Rust/TS boundary after initial load. Per-frame UBO updates are minimal (≤ few hundred bytes), ensuring smooth interaction even with many layers.

## 83. Surface Data Loading and Rendering

This section defines the architecture for loading and rendering triangle-mesh surfaces (GIfTI, FreeSurfer) alongside volumetric layers, using the same zero-copy principles and rendering infrastructure.

### 83.1 Surface Format Support

| Format | Crate | Status | Capabilities | Notes |
| :--- | :--- | :--- | :--- | :--- |
| GIFTI (*.gii) | `gifti` | Actively maintained (0.7+) | Binary-safe read/write of data arrays<br>Handles ASCII and base64-encoded payloads<br>Exposes vertex/triangle arrays as `Vec<f32>`/`Vec<u32>` | No in-crate spatial orientation helpers (we derive from the header's `Matrix_*` or fall back to MNI LPI) |
| FreeSurfer binary (surf, pial, white, ...) | `neuroformats::fs_surface` | Stable (0.3+) | `read_surf()`/`write_surf()` give vertices & faces<br>Also supports FreeSurfer-MGH volumes & annotation tables | Only the binary surface format; ASCII "*.asc" needs a wrapper |
| FreeSurfer ASCII (*.asc) | Not in a crate | N/A | Parsing is trivial (header + two space-separated tables) | ASCII lacks normals; compute them or read from *.curv |

Example usage from `neuroformats`:
```rust
use neuroformats::fs_surface::read_surf;
let (vtx, tri) = read_surf("lh.pial")?;  // vtx: Vec<[f32;3]>, tri: Vec<[i32;3]>
```

### 83.2 Triangle Mesh Data Model

Similar to our `VolumeSendable` enum, we introduce a `SurfaceSendable` enum for surfaces:

```rust
// core/geom/src/tri_mesh.rs
use bytemuck::{Pod, Zeroable};
use nalgebra::{Vector3, Matrix4};
use serde::Serialize;

/// POD bound identical to VoxelData, kept separate for clarity
pub trait VertexScalar: Copy + Pod + Zeroable + 'static {}
impl<T: Copy + Pod + Zeroable + 'static> VertexScalar for T {}

#[derive(Debug, Clone, Serialize)]
pub struct TriMesh<T: VertexScalar = f32> {
    /// Vertex positions interleaved as [x0,y0,z0, x1,y1,z1, ...]
    pub vertices: Vec<T>,
    /// Face indices (triangle list) as [i0,j0,k0, i1,j1,k1, ...]
    pub indices: Vec<u32>,
    /// Optional per-vertex normals (same stride as vertices)
    pub normals: Option<Vec<T>>,
    /// Optional per-vertex values (e.g. curvature / label)
    pub scalars: Option<Vec<T>>,
    /// World-space transform (e.g. GIFTI's Matrix_*)
    pub world_from_vertex: Matrix4<f32>,
}

impl<T: VertexScalar> TriMesh<T> {
    #[inline] pub fn vertex_count(&self) -> usize { self.vertices.len() / 3 }
    #[inline] pub fn triangle_count(&self) -> usize { self.indices.len() / 3 }

    /// Borrow as raw bytes – enables zero-copy SAB transfer & GPU upload
    #[inline] pub fn vertices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.vertices)
    }
    #[inline] pub fn indices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.indices)
    }
}

// core/bridge_types/src/surface_sendable.rs
#[derive(Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../packages/api/src/generated/surface.ts")]
pub enum SurfaceSendable {
    MeshF32(TriMesh<f32>),
    MeshF64(TriMesh<f64>),
}

impl SurfaceSendable {
    pub fn as_bytes(&self) -> (&[u8], &[u8]) {
        match self {
            Self::MeshF32(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
            Self::MeshF64(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
        }
    }
}
```

The TypeScript mirror (auto-generated):

```typescript
// packages/api/generated/surface.ts (generated by ts-rs)
export type SurfaceSendable =
  | { MeshF32: TriMeshF32 }
  | { MeshF64: TriMeshF64 };

export interface TriMeshF32 {
  vertices: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  scalars?: Float32Array;
  world_from_vertex: Float32Array; // length 16, row-major
}
```

### 83.3 Integration Path

1. **Add loaders under `core/loaders/`:**
   ```
   core/
     loaders/
       gifti/
         lib.rs   // re-export gifti::*, add Into<Surface> conversion
       freesurfer/
         lib.rs   // use neuroformats::fs_surface; if asc needed, embed parser
   ```

2. **Loader Implementation**
   Each loader implements the existing async `Loader` trait, returning `(id, SurfaceSendable)`. The existing `api_bridge::load_file` already supports polymorphic return, requiring only the switch/enum arm addition.

3. **Rendering Path**
   Triangle meshes follow the same `request_layer_gpu_resources` flow but map to the reserved `SurfaceLayerSpec`/`SurfaceLayerGPU` variants. The render loop creates `wgpu::Buffer` resources for vertices/indices and binds them in the surface pipeline.

4. **Surface GPU Resources**
   ```rust
   struct SurfaceLayerGPU {
       vertex_buffer_id: u32,
       index_buffer_id: u32,
       index_count: u32,
       world_from_vertex: [[f32;4];4],
   }
   ```

5. **Unit Testing**
   Add an `fs_testdata/` folder with small sample surface files (`.pial`, `.asc`, `.gii`) for unit tests that verify round-trip through the loaders.

### 83.4 TypeScript Data Access

The same dual-representation pattern used for volumes applies to surfaces:
1. Rust loader handles the heavy payload parsing
2. For lightweight TypeScript algorithms (e.g., coloring by curvature), pass metadata and a SharedArrayBuffer view to the worker without copying
3. Binary parsers remain in Rust - no TS reimplementation

### 83.5 Implementation Effort

* No show-stoppers: both GIFTI and FreeSurfer surfaces have working Rust crates
* Estimated effort:
  * Wire loaders: ~1 day
  * Optional ASCII parser: ~0.25 day
* Alignment: Fits with Phase-1 plan - surfaces land in Sprint 2 without derailing volume work

**See also:** The UI-side contract for real-time layer editing, including LayerUBO field updates and the patch_layer command, is detailed in GUIDE-ui-layout-phase1.md Section 11.

## 84. Summary - Handling Data Variations (New)

| Issue                             | Where it is solved                                                                                                |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------- | 
| Different Resolutions             | `VolumeHandle.dim` and `worldToVoxel` affine encode spacing; shader samples layers in common world space.       |
| Different FOV / Offsets           | Affine matrix includes translation; out-of-FOV fragments get alpha=0 via shader bounds check using `dim`.         |
| Different On-Disk Orientation (RPI etc.) | Loader computes correct `Voxel->LPIWorld` affine from header; inverse `World->Voxel` matrix is put in UBO. Shader uses this matrix, correctly sampling the texture regardless of original orientation. (See §5.B, §5.E) |

## 85. Blending Semantics (New)

*   The `blendMode` in `DisplayProps` directly maps to `LayerUBO.blend_mode`.
*   The fragment shader's `composite()` function (see §4) implements the different blend modes (alpha, add, max, min) based on this UBO field.
*   Changing colormap, window, thresholds, or blend mode only affects the `DisplayProps` within the `LayerStack` store. Updating a layer's style is therefore a lightweight store mutation and results in only the small UBO data being sent to the GPU per frame.

## 86. Design Summary (New)

*   **Modularity:** Volumes (`VolumeHandle`) are immutable data references managed by Rust registries and the GPU texture atlas. Display styles (`DisplayProps`) live in a small, reactive TypeScript store (`LayerStack`).
*   **Extensibility:** Adding new layers (e.g., statistical maps, annotations) involves adding a new `Layer` entry to the `LayerStack` with its own `VolumeHandle` and `DisplayProps`. The core rendering logic doesn't need modification.
*   **Performance:** Only immutable handles (`VolumeHandle.id`) cross the Rust/TS boundary after initial load. Per-frame UBO updates are minimal (≤ few hundred bytes), ensuring smooth interaction even with many layers.

## 87. Surface Data Loading and Rendering

This section defines the architecture for loading and rendering triangle-mesh surfaces (GIfTI, FreeSurfer) alongside volumetric layers, using the same zero-copy principles and rendering infrastructure.

### 87.1 Surface Format Support

| Format | Crate | Status | Capabilities | Notes |
| :--- | :--- | :--- | :--- | :--- |
| GIFTI (*.gii) | `gifti` | Actively maintained (0.7+) | Binary-safe read/write of data arrays<br>Handles ASCII and base64-encoded payloads<br>Exposes vertex/triangle arrays as `Vec<f32>`/`Vec<u32>` | No in-crate spatial orientation helpers (we derive from the header's `Matrix_*` or fall back to MNI LPI) |
| FreeSurfer binary (surf, pial, white, ...) | `neuroformats::fs_surface` | Stable (0.3+) | `read_surf()`/`write_surf()` give vertices & faces<br>Also supports FreeSurfer-MGH volumes & annotation tables | Only the binary surface format; ASCII "*.asc" needs a wrapper |
| FreeSurfer ASCII (*.asc) | Not in a crate | N/A | Parsing is trivial (header + two space-separated tables) | ASCII lacks normals; compute them or read from *.curv |

Example usage from `neuroformats`:
```rust
use neuroformats::fs_surface::read_surf;
let (vtx, tri) = read_surf("lh.pial")?;  // vtx: Vec<[f32;3]>, tri: Vec<[i32;3]>
```

### 87.2 Triangle Mesh Data Model

Similar to our `VolumeSendable` enum, we introduce a `SurfaceSendable` enum for surfaces:

```rust
// core/geom/src/tri_mesh.rs
use bytemuck::{Pod, Zeroable};
use nalgebra::{Vector3, Matrix4};
use serde::Serialize;

/// POD bound identical to VoxelData, kept separate for clarity
pub trait VertexScalar: Copy + Pod + Zeroable + 'static {}
impl<T: Copy + Pod + Zeroable + 'static> VertexScalar for T {}

#[derive(Debug, Clone, Serialize)]
pub struct TriMesh<T: VertexScalar = f32> {
    /// Vertex positions interleaved as [x0,y0,z0, x1,y1,z1, ...]
    pub vertices: Vec<T>,
    /// Face indices (triangle list) as [i0,j0,k0, i1,j1,k1, ...]
    pub indices: Vec<u32>,
    /// Optional per-vertex normals (same stride as vertices)
    pub normals: Option<Vec<T>>,
    /// Optional per-vertex values (e.g. curvature / label)
    pub scalars: Option<Vec<T>>,
    /// World-space transform (e.g. GIFTI's Matrix_*)
    pub world_from_vertex: Matrix4<f32>,
}

impl<T: VertexScalar> TriMesh<T> {
    #[inline] pub fn vertex_count(&self) -> usize { self.vertices.len() / 3 }
    #[inline] pub fn triangle_count(&self) -> usize { self.indices.len() / 3 }

    /// Borrow as raw bytes – enables zero-copy SAB transfer & GPU upload
    #[inline] pub fn vertices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.vertices)
    }
    #[inline] pub fn indices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.indices)
    }
}

// core/bridge_types/src/surface_sendable.rs
#[derive(Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../packages/api/src/generated/surface.ts")]
pub enum SurfaceSendable {
    MeshF32(TriMesh<f32>),
    MeshF64(TriMesh<f64>),
}

impl SurfaceSendable {
    pub fn as_bytes(&self) -> (&[u8], &[u8]) {
        match self {
            Self::MeshF32(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
            Self::MeshF64(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
        }
    }
}
```

The TypeScript mirror (auto-generated):

```typescript
// packages/api/generated/surface.ts (generated by ts-rs)
export type SurfaceSendable =
  | { MeshF32: TriMeshF32 }
  | { MeshF64: TriMeshF64 };

export interface TriMeshF32 {
  vertices: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  scalars?: Float32Array;
  world_from_vertex: Float32Array; // length 16, row-major
}
```

### 87.3 Integration Path

1. **Add loaders under `core/loaders/`:**
   ```
   core/
     loaders/
       gifti/
         lib.rs   // re-export gifti::*, add Into<Surface> conversion
       freesurfer/
         lib.rs   // use neuroformats::fs_surface; if asc needed, embed parser
   ```

2. **Loader Implementation**
   Each loader implements the existing async `Loader` trait, returning `(id, SurfaceSendable)`. The existing `api_bridge::load_file` already supports polymorphic return, requiring only the switch/enum arm addition.

3. **Rendering Path**
   Triangle meshes follow the same `request_layer_gpu_resources` flow but map to the reserved `SurfaceLayerSpec`/`SurfaceLayerGPU` variants. The render loop creates `wgpu::Buffer` resources for vertices/indices and binds them in the surface pipeline.

4. **Surface GPU Resources**
   ```rust
   struct SurfaceLayerGPU {
       vertex_buffer_id: u32,
       index_buffer_id: u32,
       index_count: u32,
       world_from_vertex: [[f32;4];4],
   }
   ```

5. **Unit Testing**
   Add an `fs_testdata/` folder with small sample surface files (`.pial`, `.asc`, `.gii`) for unit tests that verify round-trip through the loaders.

### 87.4 TypeScript Data Access

The same dual-representation pattern used for volumes applies to surfaces:
1. Rust loader handles the heavy payload parsing
2. For lightweight TypeScript algorithms (e.g., coloring by curvature), pass metadata and a SharedArrayBuffer view to the worker without copying
3. Binary parsers remain in Rust - no TS reimplementation

### 87.5 Implementation Effort

* No show-stoppers: both GIFTI and FreeSurfer surfaces have working Rust crates
* Estimated effort:
  * Wire loaders: ~1 day
  * Optional ASCII parser: ~0.25 day
* Alignment: Fits with Phase-1 plan - surfaces land in Sprint 2 without derailing volume work

**See also:** The UI-side contract for real-time layer editing, including LayerUBO field updates and the patch_layer command, is detailed in GUIDE-ui-layout-phase1.md Section 11.

## 88. Summary - Handling Data Variations (New)

| Issue                             | Where it is solved                                                                                                |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------- | 
| Different Resolutions             | `VolumeHandle.dim` and `worldToVoxel` affine encode spacing; shader samples layers in common world space.       |
| Different FOV / Offsets           | Affine matrix includes translation; out-of-FOV fragments get alpha=0 via shader bounds check using `dim`.         |
| Different On-Disk Orientation (RPI etc.) | Loader computes correct `Voxel->LPIWorld` affine from header; inverse `World->Voxel` matrix is put in UBO. Shader uses this matrix, correctly sampling the texture regardless of original orientation. (See §5.B, §5.E) |

## 89. Blending Semantics (New)

*   The `blendMode` in `DisplayProps` directly maps to `LayerUBO.blend_mode`.
*   The fragment shader's `composite()` function (see §4) implements the different blend modes (alpha, add, max, min) based on this UBO field.
*   Changing colormap, window, thresholds, or blend mode only affects the `DisplayProps` within the `LayerStack` store. Updating a layer's style is therefore a lightweight store mutation and results in only the small UBO data being sent to the GPU per frame.

## 90. Design Summary (New)

*   **Modularity:** Volumes (`VolumeHandle`) are immutable data references managed by Rust registries and the GPU texture atlas. Display styles (`DisplayProps`) live in a small, reactive TypeScript store (`LayerStack`).
*   **Extensibility:** Adding new layers (e.g., statistical maps, annotations) involves adding a new `Layer` entry to the `LayerStack` with its own `VolumeHandle` and `DisplayProps`. The core rendering logic doesn't need modification.
*   **Performance:** Only immutable handles (`VolumeHandle.id`) cross the Rust/TS boundary after initial load. Per-frame UBO updates are minimal (≤ few hundred bytes), ensuring smooth interaction even with many layers.

## 91. Surface Data Loading and Rendering

This section defines the architecture for loading and rendering triangle-mesh surfaces (GIfTI, FreeSurfer) alongside volumetric layers, using the same zero-copy principles and rendering infrastructure.

### 91.1 Surface Format Support

| Format | Crate | Status | Capabilities | Notes |
| :--- | :--- | :--- | :--- | :--- |
| GIFTI (*.gii) | `gifti` | Actively maintained (0.7+) | Binary-safe read/write of data arrays<br>Handles ASCII and base64-encoded payloads<br>Exposes vertex/triangle arrays as `Vec<f32>`/`Vec<u32>` | No in-crate spatial orientation helpers (we derive from the header's `Matrix_*` or fall back to MNI LPI) |
| FreeSurfer binary (surf, pial, white, ...) | `neuroformats::fs_surface` | Stable (0.3+) | `read_surf()`/`write_surf()` give vertices & faces<br>Also supports FreeSurfer-MGH volumes & annotation tables | Only the binary surface format; ASCII "*.asc" needs a wrapper |
| FreeSurfer ASCII (*.asc) | Not in a crate | N/A | Parsing is trivial (header + two space-separated tables) | ASCII lacks normals; compute them or read from *.curv |

Example usage from `neuroformats`:
```rust
use neuroformats::fs_surface::read_surf;
let (vtx, tri) = read_surf("lh.pial")?;  // vtx: Vec<[f32;3]>, tri: Vec<[i32;3]>
```

### 91.2 Triangle Mesh Data Model

Similar to our `VolumeSendable` enum, we introduce a `SurfaceSendable` enum for surfaces:

```rust
// core/geom/src/tri_mesh.rs
use bytemuck::{Pod, Zeroable};
use nalgebra::{Vector3, Matrix4};
use serde::Serialize;

/// POD bound identical to VoxelData, kept separate for clarity
pub trait VertexScalar: Copy + Pod + Zeroable + 'static {}
impl<T: Copy + Pod + Zeroable + 'static> VertexScalar for T {}

#[derive(Debug, Clone, Serialize)]
pub struct TriMesh<T: VertexScalar = f32> {
    /// Vertex positions interleaved as [x0,y0,z0, x1,y1,z1, ...]
    pub vertices: Vec<T>,
    /// Face indices (triangle list) as [i0,j0,k0, i1,j1,k1, ...]
    pub indices: Vec<u32>,
    /// Optional per-vertex normals (same stride as vertices)
    pub normals: Option<Vec<T>>,
    /// Optional per-vertex values (e.g. curvature / label)
    pub scalars: Option<Vec<T>>,
    /// World-space transform (e.g. GIFTI's Matrix_*)
    pub world_from_vertex: Matrix4<f32>,
}

impl<T: VertexScalar> TriMesh<T> {
    #[inline] pub fn vertex_count(&self) -> usize { self.vertices.len() / 3 }
    #[inline] pub fn triangle_count(&self) -> usize { self.indices.len() / 3 }

    /// Borrow as raw bytes – enables zero-copy SAB transfer & GPU upload
    #[inline] pub fn vertices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.vertices)
    }
    #[inline] pub fn indices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.indices)
    }
}

// core/bridge_types/src/surface_sendable.rs
#[derive(Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../packages/api/src/generated/surface.ts")]
pub enum SurfaceSendable {
    MeshF32(TriMesh<f32>),
    MeshF64(TriMesh<f64>),
}

impl SurfaceSendable {
    pub fn as_bytes(&self) -> (&[u8], &[u8]) {
        match self {
            Self::MeshF32(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
            Self::MeshF64(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
        }
    }
}
```

The TypeScript mirror (auto-generated):

```typescript
// packages/api/generated/surface.ts (generated by ts-rs)
export type SurfaceSendable =
  | { MeshF32: TriMeshF32 }
  | { MeshF64: TriMeshF64 };

export interface TriMeshF32 {
  vertices: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  scalars?: Float32Array;
  world_from_vertex: Float32Array; // length 16, row-major
}
```

### 91.3 Integration Path

1. **Add loaders under `core/loaders/`:**
   ```
   core/
     loaders/
       gifti/
         lib.rs   // re-export gifti::*, add Into<Surface> conversion
       freesurfer/
         lib.rs   // use neuroformats::fs_surface; if asc needed, embed parser
   ```

2. **Loader Implementation**
   Each loader implements the existing async `Loader` trait, returning `(id, SurfaceSendable)`. The existing `api_bridge::load_file` already supports polymorphic return, requiring only the switch/enum arm addition.

3. **Rendering Path**
   Triangle meshes follow the same `request_layer_gpu_resources` flow but map to the reserved `SurfaceLayerSpec`/`SurfaceLayerGPU` variants. The render loop creates `wgpu::Buffer` resources for vertices/indices and binds them in the surface pipeline.

4. **Surface GPU Resources**
   ```rust
   struct SurfaceLayerGPU {
       vertex_buffer_id: u32,
       index_buffer_id: u32,
       index_count: u32,
       world_from_vertex: [[f32;4];4],
   }
   ```

5. **Unit Testing**
   Add an `fs_testdata/` folder with small sample surface files (`.pial`, `.asc`, `.gii`) for unit tests that verify round-trip through the loaders.

### 91.4 TypeScript Data Access

The same dual-representation pattern used for volumes applies to surfaces:
1. Rust loader handles the heavy payload parsing
2. For lightweight TypeScript algorithms (e.g., coloring by curvature), pass metadata and a SharedArrayBuffer view to the worker without copying
3. Binary parsers remain in Rust - no TS reimplementation

### 91.5 Implementation Effort

* No show-stoppers: both GIFTI and FreeSurfer surfaces have working Rust crates
* Estimated effort:
  * Wire loaders: ~1 day
  * Optional ASCII parser: ~0.25 day
* Alignment: Fits with Phase-1 plan - surfaces land in Sprint 2 without derailing volume work

**See also:** The UI-side contract for real-time layer editing, including LayerUBO field updates and the patch_layer command, is detailed in GUIDE-ui-layout-phase1.md Section 11.

## 92. Summary - Handling Data Variations (New)

| Issue                             | Where it is solved                                                                                                |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------- | 
| Different Resolutions             | `VolumeHandle.dim` and `worldToVoxel` affine encode spacing; shader samples layers in common world space.       |
| Different FOV / Offsets           | Affine matrix includes translation; out-of-FOV fragments get alpha=0 via shader bounds check using `dim`.         |
| Different On-Disk Orientation (RPI etc.) | Loader computes correct `Voxel->LPIWorld` affine from header; inverse `World->Voxel` matrix is put in UBO. Shader uses this matrix, correctly sampling the texture regardless of original orientation. (See §5.B, §5.E) |

## 93. Blending Semantics (New)

*   The `blendMode` in `DisplayProps` directly maps to `LayerUBO.blend_mode`.
*   The fragment shader's `composite()` function (see §4) implements the different blend modes (alpha, add, max, min) based on this UBO field.
*   Changing colormap, window, thresholds, or blend mode only affects the `DisplayProps` within the `LayerStack` store. Updating a layer's style is therefore a lightweight store mutation and results in only the small UBO data being sent to the GPU per frame.

## 94. Design Summary (New)

*   **Modularity:** Volumes (`VolumeHandle`) are immutable data references managed by Rust registries and the GPU texture atlas. Display styles (`DisplayProps`) live in a small, reactive TypeScript store (`LayerStack`).
*   **Extensibility:** Adding new layers (e.g., statistical maps, annotations) involves adding a new `Layer` entry to the `LayerStack` with its own `VolumeHandle` and `DisplayProps`. The core rendering logic doesn't need modification.
*   **Performance:** Only immutable handles (`VolumeHandle.id`) cross the Rust/TS boundary after initial load. Per-frame UBO updates are minimal (≤ few hundred bytes), ensuring smooth interaction even with many layers.

## 95. Surface Data Loading and Rendering

This section defines the architecture for loading and rendering triangle-mesh surfaces (GIfTI, FreeSurfer) alongside volumetric layers, using the same zero-copy principles and rendering infrastructure.

### 95.1 Surface Format Support

| Format | Crate | Status | Capabilities | Notes |
| :--- | :--- | :--- | :--- | :--- |
| GIFTI (*.gii) | `gifti` | Actively maintained (0.7+) | Binary-safe read/write of data arrays<br>Handles ASCII and base64-encoded payloads<br>Exposes vertex/triangle arrays as `Vec<f32>`/`Vec<u32>` | No in-crate spatial orientation helpers (we derive from the header's `Matrix_*` or fall back to MNI LPI) |
| FreeSurfer binary (surf, pial, white, ...) | `neuroformats::fs_surface` | Stable (0.3+) | `read_surf()`/`write_surf()` give vertices & faces<br>Also supports FreeSurfer-MGH volumes & annotation tables | Only the binary surface format; ASCII "*.asc" needs a wrapper |
| FreeSurfer ASCII (*.asc) | Not in a crate | N/A | Parsing is trivial (header + two space-separated tables) | ASCII lacks normals; compute them or read from *.curv |

Example usage from `neuroformats`:
```rust
use neuroformats::fs_surface::read_surf;
let (vtx, tri) = read_surf("lh.pial")?;  // vtx: Vec<[f32;3]>, tri: Vec<[i32;3]>
```

### 95.2 Triangle Mesh Data Model

Similar to our `VolumeSendable` enum, we introduce a `SurfaceSendable` enum for surfaces:

```rust
// core/geom/src/tri_mesh.rs
use bytemuck::{Pod, Zeroable};
use nalgebra::{Vector3, Matrix4};
use serde::Serialize;

/// POD bound identical to VoxelData, kept separate for clarity
pub trait VertexScalar: Copy + Pod + Zeroable + 'static {}
impl<T: Copy + Pod + Zeroable + 'static> VertexScalar for T {}

#[derive(Debug, Clone, Serialize)]
pub struct TriMesh<T: VertexScalar = f32> {
    /// Vertex positions interleaved as [x0,y0,z0, x1,y1,z1, ...]
    pub vertices: Vec<T>,
    /// Face indices (triangle list) as [i0,j0,k0, i1,j1,k1, ...]
    pub indices: Vec<u32>,
    /// Optional per-vertex normals (same stride as vertices)
    pub normals: Option<Vec<T>>,
    /// Optional per-vertex values (e.g. curvature / label)
    pub scalars: Option<Vec<T>>,
    /// World-space transform (e.g. GIFTI's Matrix_*)
    pub world_from_vertex: Matrix4<f32>,
}

impl<T: VertexScalar> TriMesh<T> {
    #[inline] pub fn vertex_count(&self) -> usize { self.vertices.len() / 3 }
    #[inline] pub fn triangle_count(&self) -> usize { self.indices.len() / 3 }

    /// Borrow as raw bytes – enables zero-copy SAB transfer & GPU upload
    #[inline] pub fn vertices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.vertices)
    }
    #[inline] pub fn indices_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.indices)
    }
}

// core/bridge_types/src/surface_sendable.rs
#[derive(Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../packages/api/src/generated/surface.ts")]
pub enum SurfaceSendable {
    MeshF32(TriMesh<f32>),
    MeshF64(TriMesh<f64>),
}

impl SurfaceSendable {
    pub fn as_bytes(&self) -> (&[u8], &[u8]) {
        match self {
            Self::MeshF32(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
            Self::MeshF64(m) => (m.vertices_as_bytes(), m.indices_as_bytes()),
        }
    }
}
```

The TypeScript mirror (auto-generated):

```typescript
// packages/api/generated/surface.ts (generated by ts-rs)
export type SurfaceSendable =
  | { MeshF32: TriMeshF32 }
  | { MeshF64: TriMeshF64 };

export interface TriMeshF32 {
  vertices: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  scalars?: Float32Array;
  world_from_vertex: Float32Array; // length 16, row-major
}
```

### 95.3 Integration Path

1. **Add loaders under `core/loaders/`:**
   ```
   core/
     loaders/
       gifti/
         lib.rs   // re-export gifti::*, add Into<Surface> conversion
       freesurfer/
         lib.rs  