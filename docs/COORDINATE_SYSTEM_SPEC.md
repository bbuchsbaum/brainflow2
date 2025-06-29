# Neuroimaging Coordinate System Specification

## Overview

BrainFlow2 displays all neuroimaging volumes in **LPI (Left-Posterior-Inferior)** orientation, regardless of their on-disk orientation. This specification defines how we achieve seamless visualization of heterogeneous volumes with different:
- Disk orientations (RPI, ASI, LPS, etc.)
- Voxel resolutions (1mm³, 2mm³, etc.)
- Fields of view
- Matrix dimensions (87×79×87, 109×91×109, etc.)

**Core Principle**: The NIfTI affine transformation matrix handles all conversions from disk space to world space. Co-registered volumes will align perfectly when overlaid, regardless of their individual properties.

## Coordinate System Hierarchy

### 1. Voxel Indices (i, j, k)
- **Definition**: Discrete integer coordinates into the 3D data array
- **Range**: [0, dim-1] for each axis
- **Order**: Row-major (C-order) storage: `index = i + j*dim_i + k*dim_i*dim_j`
- **Usage**: Direct array access, slice extraction

### 2. Grid Coordinates 
- **Definition**: Continuous floating-point positions in voxel space
- **Range**: [-0.5, dim-0.5] for proper voxel center alignment
- **Usage**: Interpolation, sub-voxel precision

### 3. World Coordinates (x, y, z)
- **Definition**: Physical positions in millimeters in LPI space
- **Origin**: Typically near the center of the brain
- **Axes**:
  - X: Right (-) to Left (+)
  - Y: Anterior (-) to Posterior (+)  
  - Z: Inferior (-) to Superior (+)
- **Usage**: Cross-volume alignment, crosshair positioning, measurements

## Orientation Reference

```
Common Neuroimaging Orientations:

LPI (Our Display Standard)          RPI                           ASI
      +Z (Superior)                      +Z (Superior)                +Y (Superior)
       |                                  |                             |
       |                                  |                             |
       |______ +Y (Posterior)             |______ +Y (Posterior)       |______ +Z (Inferior)
      /                                  /                            /
     /                                  /                            /
   +X (Left)                         -X (Right)                   +X (Anterior)

Other common orientations: RAS, LAS, LPS, RAI, LAI
```

## Transformation Pipeline

```mermaid
graph LR
    A[Disk Data<br/>Any Orientation] --> B[Voxel Indices<br/>i,j,k]
    B --> C[Grid Coordinates<br/>fractional]
    C --> D[World Coordinates<br/>mm in LPI]
    D --> E[GPU Texture<br/>Coordinates]
    
    B -.-> |"array[k][j][i]"| A
    C -.-> |"affine transform"| D
    D -.-> |"world_to_voxel"| C
    E -.-> |"texture sampling"| F[Display Pixels]
```

### Key Transformations

#### 1. Voxel to World (via NIfTI Affine)
```
[x]   [m00 m01 m02 m03] [i]
[y] = [m10 m11 m12 m13] [j]
[z]   [m20 m21 m22 m23] [k]
[1]   [  0   0   0   1] [1]
```

Where the affine matrix encodes:
- Voxel spacing (diagonal elements)
- Axis rotations (off-diagonal elements)
- Origin translation (last column)

#### 2. World to Voxel (Inverse Transform)
```rust
world_to_voxel = voxel_to_world.inverse()
```

## Implementation Architecture

### Rust Core (`volmath`)
```rust
// Core spatial representation
pub struct NeuroSpaceImpl<const N: usize> {
    pub dim: SVector<usize, N>,         // Volume dimensions
    pub spacing: SVector<f32, N>,       // Voxel size in mm
    pub origin: SVector<f32, N>,        // World origin
    affine_linear: SMatrix<f32, N, N>,  // Rotation/scale
    affine_offset: SVector<f32, N>,     // Translation
}

// Coordinate transformations
impl GridSpace for NeuroSpaceImpl {
    fn grid_to_coord(&self, ijk: &[f32; N]) -> [f32; N];
    fn coord_to_grid(&self, xyz: &[f32; N]) -> [f32; N];
}
```

### GPU Pipeline (`shaders`)
```wgsl
// Per-layer uniform containing world_to_voxel transform
struct LayerUBO {
    world_to_voxel: mat4x4<f32>,  // Convert world mm to voxel indices
    // ... other fields
}

// Vertex shader transforms display coordinates to world space
let world_pos = frame.origin_mm + u * frame.u_mm + v * frame.v_mm;

// Fragment shader samples volume at world position
let voxel_pos = layer.world_to_voxel * vec4(world_pos, 1.0);
```

### Data Flow (`api_bridge`)
1. **Loading**: NIfTI file → Parse header → Extract affine → Create VolumeSendable
2. **Storage**: Volume data + affine stored in registry with UUID
3. **GPU Upload**: Slice extraction with proper orientation handling
4. **Display**: World-space crosshair drives all slice views

## Heterogeneous Volume Support

### Example: Overlaying Different Volumes
```
Volume A: RPI orientation, 87×79×87 voxels, 2mm resolution
Volume B: LPI orientation, 109×91×109 voxels, 1.5mm resolution
Volume C: ASI orientation, 64×64×32 voxels, 3mm resolution

All three volumes will:
- Display in LPI orientation
- Align perfectly if co-registered
- Show correct crosshair position
- Support synchronized navigation
```

### Key Implementation Points

1. **Crosshair in World Space**
   - Store as (x,y,z) in mm, not voxel indices
   - Each volume converts world→voxel independently
   - Ensures consistent position across all volumes

2. **Slice Extraction**
   - Always extract slices in LPI orientation
   - Use world_to_voxel to find correct voxel indices
   - Handle partial volume coverage gracefully

3. **Interpolation**
   - Perform in voxel space for efficiency
   - Account for different voxel sizes when overlaying
   - Maintain sub-voxel precision

## Performance Requirements

### Transformation Operations
- Single voxel↔world transformation: < 1 microsecond
- Full slice extraction with transform: < 1 millisecond
- Multi-volume crosshair update: < 5 milliseconds

### Memory Efficiency
- Store only one copy of volume data (disk orientation)
- Cache frequently used transforms (world_to_voxel matrices)
- Use GPU texture atlas for efficient multi-volume rendering

## Validation and Testing

### Coordinate Transform Tests
```rust
#[test]
fn test_rpi_to_lpi_transform() {
    // Load RPI volume
    let rpi_volume = load_test_volume("rpi_brain.nii.gz");
    
    // Known anatomical landmark in world coordinates
    let anterior_commissure = [0.0, -24.0, -5.0]; // mm in LPI
    
    // Convert to voxel indices
    let voxel_idx = rpi_volume.world_to_voxel(anterior_commissure);
    
    // Verify correct voxel is accessed
    assert_eq!(rpi_volume.get_voxel(voxel_idx), expected_intensity);
}
```

### Multi-Volume Alignment Test
```rust
#[test]
fn test_heterogeneous_overlay() {
    let vol_a = load_test_volume("t1_rpi_2mm.nii.gz");
    let vol_b = load_test_volume("t2_lpi_1mm.nii.gz");
    
    // Same world coordinate should map to anatomically equivalent voxels
    let world_point = [10.0, 20.0, 30.0];
    
    let voxel_a = vol_a.world_to_voxel(world_point);
    let voxel_b = vol_b.world_to_voxel(world_point);
    
    // Visual inspection should show same anatomy
    assert_similar_tissue_type(vol_a[voxel_a], vol_b[voxel_b]);
}
```

## Common Pitfalls and Solutions

### 1. Orientation Confusion
**Problem**: Assuming all volumes are in LPI on disk  
**Solution**: Always use the affine transform, never make assumptions

### 2. Voxel Index Origin
**Problem**: Confusion between 0-based and 1-based indexing  
**Solution**: Always use 0-based indexing internally

### 3. Half-Voxel Shifts
**Problem**: Misalignment due to voxel corner vs. center  
**Solution**: Grid coordinates [0,0,0] map to center of first voxel

### 4. Transform Direction
**Problem**: Applying voxel_to_world when world_to_voxel needed  
**Solution**: Clear naming convention and type safety

## Future Enhancements

1. **Oblique Acquisitions**: Support for non-axis-aligned scans
2. **4D Support**: Time series with consistent spatial alignment
3. **Surface Overlays**: Project surface meshes using same transforms
4. **Registration Tools**: Real-time affine adjustment interface

## References

- [NIfTI-1 Data Format](https://nifti.nimh.nih.gov/nifti-1)
- [Coordinate Systems in Neuroimaging](https://nipy.org/nibabel/coordinate_systems.html)
- [FSL Orientation Explained](https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/Orientation)

---

**Document Version**: 1.0  
**Last Updated**: 2025-01-22  
**Status**: Living Document - Update as implementation evolves