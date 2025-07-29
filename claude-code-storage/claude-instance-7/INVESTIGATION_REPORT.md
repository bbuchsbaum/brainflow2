# Investigation Report: Same Image File Loaded Twice as Separate Layers

## Summary
The issue where loading the same image file twice as separate layers doesn't work properly is caused by a combination of layer ID management and GPU resource allocation issues. While the backend correctly generates unique volume IDs for each load, there are problems with how layers are tracked and rendered.

## Key Findings

### 1. Layer ID Generation
- **Backend behavior**: When `load_file` is called, it generates a unique UUID for each volume (line 428 in lib.rs)
- **Frontend behavior**: Uses the volumeId as the layer ID (LayerApiImpl.ts line 22)
- **Result**: Each loaded file gets a unique volume ID and layer ID, which is correct

### 2. Layer-to-Atlas Mapping
The backend maintains a `layer_to_atlas_map` that maps UI layer IDs to GPU texture atlas indices:
```rust
pub layer_to_atlas_map: Arc<Mutex<HashMap<String, u32>>>,
```

When GPU resources are allocated:
- The volume is uploaded to GPU and gets an atlas index
- This mapping is stored: `layer_map.insert(ui_layer_id.clone(), atlas_layer_idx)`

### 3. GPU Resource Allocation
When `request_layer_gpu_resources` is called:
1. Volume data is retrieved from the registry
2. Volume is uploaded to GPU via `upload_volume_3d`
3. Atlas index is assigned and stored in the mapping
4. Layer is added to render state with `add_layer_3d`

### 4. Rendering Pipeline
The shader (`slice_world_space_optimized.wgsl`) properly implements layer compositing:
- Uses src-over alpha blending (mode 0)
- Iterates through all active layers
- Composites them correctly with the formula:
```wgsl
let out_alpha = src.a + dst.a * (1.0 - src.a);
let out_rgb = src.rgb * src.a + dst.rgb * dst.a * (1.0 - src.a);
```

### 5. ViewState Synchronization
When rendering via `render_to_buffer_rgba`:
1. Frontend ViewState is received with layer configurations
2. Backend looks up atlas indices using both `layer.id` and `layer.volume_id` as keys
3. Creates backend layer configs with intensity windows and other parameters
4. Renders all visible layers with proper compositing

## Root Cause Analysis

The issue appears to be related to how the second layer's render properties are being applied. While the investigation shows that:

1. **Unique IDs are correctly generated** - Each file load creates a unique volume and layer
2. **GPU resources are properly allocated** - Each layer gets its own atlas index
3. **Compositing logic is correct** - The shader implements proper alpha blending
4. **Layer mapping is maintained** - The layer_to_atlas_map tracks each layer separately

The problem likely lies in one of these areas:

### Potential Issue 1: Render Property Updates Not Reaching GPU
When `patch_layer` is called to update intensity/alpha:
- It looks up the atlas index from layer_to_atlas_map
- Calls service methods like `update_layer_intensity` and `update_layer`
- However, these updates might not be properly propagated to the GPU uniforms

### Potential Issue 2: Layer Storage Buffer Synchronization
The GPU uses a storage buffer for layer data:
```wgsl
@group(1) @binding(0) var<storage, read> layer_data: array<LayerData>;
```
If this buffer isn't properly updated when render properties change, the second layer would render with default values.

### Potential Issue 3: Texture Binding Conflicts
While each layer should have its own atlas index, there might be an issue with how textures are bound or sampled, causing the second layer to sample from the wrong texture or with wrong parameters.

## Recommendations

1. **Add debug logging** in `patch_layer` to verify:
   - The correct atlas index is retrieved
   - GPU update methods are called with correct parameters
   - The layer storage buffer is properly synchronized

2. **Verify texture atlas management**:
   - Ensure each volume upload gets a unique texture slot
   - Check that texture indices are correctly passed to the shader

3. **Test render property propagation**:
   - Add logging in `update_layer_intensity` to confirm values reach the GPU
   - Verify the layer uniforms buffer is updated before rendering

4. **Check ViewState layer lookup**:
   - The backend tries both `layer.id` and `layer.volume_id` as keys
   - Ensure this fallback logic works correctly for all layers

## Conclusion

While the architecture supports loading the same file multiple times with proper layer separation, there's likely a bug in how render property updates (intensity, alpha) are propagated to the GPU for subsequent layers. The compositing logic itself is correct, but the second layer isn't receiving or applying the updated render parameters.