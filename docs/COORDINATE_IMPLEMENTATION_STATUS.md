# Coordinate System Implementation Status

## Current Implementation Review

### ✅ Implemented Correctly

1. **NIfTI Affine Loading** (`core/loaders/nifti/src/lib.rs`)
   - Correctly reads sform/qform from NIfTI header
   - Falls back to pixdim-based affine when needed
   - Preserves affine through entire pipeline

2. **Coordinate Transformations** (`core/volmath/src/space.rs`)
   - `NeuroSpaceImpl` stores affine components
   - `grid_to_coord()` and `coord_to_grid()` methods implemented
   - Supports 2D, 3D, and 4D volumes

3. **GPU Pipeline** (`core/api_bridge/src/lib.rs`)
   - Passes both `world_to_voxel` and `voxel_to_world` matrices to GPU
   - Stores transforms in `VolumeLayerGpuInfo`
   - Includes origin and spacing metadata

4. **World Coordinate API** (`api_bridge::world_to_voxel`)
   - Correctly transforms world coordinates to voxel indices
   - Handles boundary checking

### ⚠️ Needs Verification

1. **LPI Enforcement**
   - Need to verify that world coordinates are consistently in LPI
   - Check if any orientation correction is needed post-affine

2. **Crosshair Synchronization**
   - Verify crosshair store uses world coordinates (mm)
   - Ensure all views update from world position

3. **Multi-Volume Overlay**
   - Test overlaying volumes with different orientations
   - Verify alignment of co-registered data

### ❌ Missing/Incomplete

1. **Documentation**
   - No inline comments explaining LPI convention
   - Missing examples of coordinate usage

2. **Testing**
   - No unit tests for RPI→LPI transformation
   - No integration tests for multi-volume overlay
   - Missing tests for edge cases (oblique, non-standard orientations)

3. **Shader Implementation**
   - Need to verify `slice.wgsl` correctly uses transforms
   - Check interpolation in world vs. voxel space

## Action Items

### Immediate (Critical Path)

1. **Add Coordinate System Tests**
```rust
// In core/volmath/tests/coordinate_tests.rs
#[test]
fn test_lpi_world_coordinates() {
    // Test that world coordinates follow LPI convention
}

#[test] 
fn test_rpi_to_lpi_transform() {
    // Load RPI test data and verify correct display
}
```

2. **Document Key Functions**
```rust
// In core/volmath/src/space.rs
/// Transforms grid coordinates to world coordinates in LPI orientation.
/// Grid coords are in voxel space [0, dim-1], world coords are in mm.
fn grid_to_coord(&self, ijk: &[f32; N]) -> [f32; N] {
    // ... existing implementation
}
```

3. **Verify Shader Usage**
   - Review `slice.wgsl` transformation pipeline
   - Ensure world coordinates are used for slice positioning

### Short Term (Next Sprint)

1. **Multi-Volume Test Suite**
   - Create test volumes with known orientations
   - Verify overlay alignment
   - Test crosshair synchronization

2. **Performance Benchmarks**
   - Measure transformation overhead
   - Optimize hot paths if needed

3. **Developer Documentation**
   - Add coordinate system guide to developer docs
   - Include common troubleshooting scenarios

### Long Term (Future Enhancement)

1. **Oblique Support**
   - Extend to handle non-axis-aligned acquisitions
   - Update shader interpolation

2. **Coordinate System Indicators**
   - Add visual orientation markers to UI
   - Show current orientation in metadata panel

3. **Registration Verification**
   - Tool to verify/visualize volume alignment
   - Highlight misregistration issues

## Code Locations Reference

| Component | File | Purpose |
|-----------|------|---------|
| NIfTI Loading | `core/loaders/nifti/src/lib.rs` | Reads affine from file |
| Coordinate Math | `core/volmath/src/space.rs` | Core transformations |
| GPU Interface | `core/api_bridge/src/lib.rs` | Passes transforms to GPU |
| Shader Pipeline | `core/render_loop/shaders/slice.wgsl` | GPU-side transforms |
| Type Definitions | `core/bridge_types/src/lib.rs` | Transform data structures |

## Testing Strategy

### Unit Tests
- Transform accuracy (voxel ↔ world)
- Orientation conversions
- Edge cases (identity affine, extreme rotations)

### Integration Tests  
- Load and display test volumes
- Multi-volume alignment
- Crosshair accuracy

### Visual Tests
- Screenshot comparison
- Alignment verification
- Performance benchmarks

---

**Status**: In Progress  
**Last Updated**: 2025-01-22  
**Next Review**: After implementing immediate action items