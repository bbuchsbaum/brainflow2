# GPU Slice Extraction Enhancement

## Overview

The enhanced slice extraction functionality in `request_layer_gpu_resources` provides dynamic slice selection capabilities for volume rendering. This allows users to specify which slice to extract and upload to the GPU based on various criteria.

## New Types

### SliceAxis

Represents the anatomical axis along which to extract a slice:

```rust
pub enum SliceAxis {
    Sagittal = 0,  // X axis (YZ plane)
    Coronal = 1,   // Y axis (XZ plane)
    Axial = 2,     // Z axis (XY plane)
}
```

Default: `SliceAxis::Axial`

### SliceIndex

Specifies how to determine which slice to extract:

```rust
pub enum SliceIndex {
    Fixed(usize),         // Specific slice index (0-based)
    Middle,               // Middle slice (default)
    Relative(f32),        // Relative position (0.0 = first, 1.0 = last)
    WorldCoordinate(f32), // Slice at specific world coordinate
}
```

Default: `SliceIndex::Middle`

## Enhanced VolumeLayerSpec

The `VolumeLayerSpec` now includes optional slice selection parameters:

```rust
pub struct VolumeLayerSpec {
    pub id: String,
    pub source_resource_id: String,
    pub colormap: String,
    pub slice_axis: Option<SliceAxis>,   // Optional: defaults to Axial
    pub slice_index: Option<SliceIndex>, // Optional: defaults to Middle
}
```

## Usage Examples

### Basic Usage (Defaults)

```rust
// Uses default Axial axis and Middle slice
let spec = LayerSpec::Volume(VolumeLayerSpec {
    id: "layer1".to_string(),
    source_resource_id: "volume1".to_string(),
    colormap: "grayscale".to_string(),
    slice_axis: None,
    slice_index: None,
});
```

### Specific Slice Selection

```rust
// Extract sagittal slice at index 64
let spec = LayerSpec::Volume(VolumeLayerSpec {
    id: "layer2".to_string(),
    source_resource_id: "volume1".to_string(),
    colormap: "viridis".to_string(),
    slice_axis: Some(SliceAxis::Sagittal),
    slice_index: Some(SliceIndex::Fixed(64)),
});
```

### Relative Position

```rust
// Extract coronal slice at 75% position
let spec = LayerSpec::Volume(VolumeLayerSpec {
    id: "layer3".to_string(),
    source_resource_id: "volume1".to_string(),
    colormap: "hot".to_string(),
    slice_axis: Some(SliceAxis::Coronal),
    slice_index: Some(SliceIndex::Relative(0.75)),
});
```

### World Coordinate

```rust
// Extract axial slice at world coordinate z=10.5mm
let spec = LayerSpec::Volume(VolumeLayerSpec {
    id: "layer4".to_string(),
    source_resource_id: "volume1".to_string(),
    colormap: "cool".to_string(),
    slice_axis: Some(SliceAxis::Axial),
    slice_index: Some(SliceIndex::WorldCoordinate(10.5)),
});
```

## Error Handling

The enhanced functionality includes comprehensive error handling for edge cases:

### Error Codes

- **2002**: Volume has zero size along the specified axis
- **2003**: Fixed slice index out of bounds
- **2004**: Relative position not between 0.0 and 1.0
- **2005**: World coordinate maps to invalid voxel index
- **5007**: Failed to invert affine transformation matrix

### Example Error Handling

```rust
match request_layer_gpu_resources(spec, state).await {
    Ok(gpu_info) => {
        println!("Successfully uploaded slice to GPU");
    },
    Err(BridgeError::Input { code: 2003, details }) => {
        eprintln!("Slice index out of bounds: {}", details);
    },
    Err(e) => {
        eprintln!("GPU upload failed: {}", e);
    }
}
```

## Implementation Details

### Slice Index Calculation

The `calculate_slice_index` function handles the conversion from `SliceIndex` specification to actual array index:

1. **Fixed**: Direct index with bounds checking
2. **Middle**: `max_index / 2`
3. **Relative**: `floor((max_index - 1) * position)`
4. **WorldCoordinate**: Uses affine transformation to convert world coordinates to voxel indices

### GPU Upload Process

1. Extract slice parameters from `VolumeLayerSpec`
2. Calculate actual slice index based on volume dimensions
3. Upload slice to GPU texture atlas
4. Store layer mapping for resource management
5. Return GPU info with texture coordinates and transformation matrices

## Resource Management

### Tracking

GPU resources are tracked using a mapping from UI layer IDs to texture atlas indices:

```rust
layer_to_atlas_map: HashMap<String, u32>
```

### Cleanup

Use `release_layer_gpu_resources` to properly clean up GPU resources:

```rust
let result = release_layer_gpu_resources(layer_id, state).await?;
if result.success {
    println!("GPU resources released: {}", result.message);
}
```

## Testing

The implementation includes comprehensive unit tests:

- Default value tests
- Slice index calculation for all modes
- Boundary condition tests
- Error case validation
- Serialization/deserialization tests

Run tests with:
```bash
cargo test -p api_bridge
```

## Future Enhancements

1. **Multi-slice extraction**: Support extracting multiple slices at once
2. **Oblique slices**: Support arbitrary slice orientations
3. **Dynamic updates**: Update slice without full re-upload
4. **Slice caching**: Cache frequently used slices
5. **Compression**: Support compressed texture formats