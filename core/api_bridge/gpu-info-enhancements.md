# GPU Resource Information Enhancements

## Summary

Enhanced the `VolumeLayerGpuInfo` structure returned by `request_layer_gpu_resources` to include comprehensive metadata that will be useful for the frontend.

## Enhanced Fields Added

### 1. **GPU Atlas Information**
- `atlas_layer_index: u32` - Which layer in the GPU texture array this slice occupies
- `texture_coords: TextureCoordinates` - UV coordinates within the atlas layer (u_min, v_min, u_max, v_max)

### 2. **Slice-Specific Information**
- `slice_info: SliceInfo` - Detailed information about the uploaded slice:
  - `axis: u8` - Axis along which the slice was taken (0=Sagittal, 1=Coronal, 2=Axial)
  - `index: u32` - Index of the slice along the axis
  - `axis_name: String` - Human-readable axis name ("Sagittal", "Coronal", "Axial")
  - `dimensions: [u32; 2]` - Slice dimensions [width, height]

### 3. **Transform and Coordinate System Information**
- `voxel_to_world: [f32; 16]` - Voxel to world transformation matrix (row-major)
- `origin: [f32; 3]` - Volume origin in world coordinates
- `spacing: [f32; 3]` - Voxel spacing in mm

### 4. **Additional Metadata**
- `source_volume_id: String` - ID of the source volume this layer was created from
- `allocated_at: u64` - Unix timestamp when this GPU resource was allocated
- `data_range: Option<DataRange>` - Optional min/max values in the slice (placeholder for future implementation)

## New Type Definitions

Three new structures were added to support the enhanced metadata:

1. **SliceInfo** - Contains all slice-specific information
2. **TextureCoordinates** - Normalized UV coordinates for texture mapping
3. **DataRange** - Min/max values for dynamic range adjustment (future use)

## Benefits for Frontend

1. **Precise Rendering**: Texture coordinates allow exact mapping of the slice within the atlas
2. **Coordinate Transformations**: Both world-to-voxel and voxel-to-world matrices enable proper spatial transformations
3. **UI Display**: Human-readable axis names and slice information for user interface
4. **Resource Tracking**: Timestamp and source volume ID help with resource management
5. **Dimension Awareness**: Slice dimensions help with aspect ratio and layout calculations

## Implementation Notes

- All fields are properly serialized with `serde` and exported to TypeScript using `ts-rs`
- The implementation extracts space information (origin, spacing) directly from the volume's spatial metadata
- Texture coordinates are calculated based on the slice size relative to the atlas dimensions
- The slice axis enum provides both numeric and string representations for flexibility

## Future Enhancements

- Calculate actual data range (min/max) from slice data for dynamic range adjustment
- Add quality metrics or statistics about the uploaded slice
- Include compression or encoding information if applicable