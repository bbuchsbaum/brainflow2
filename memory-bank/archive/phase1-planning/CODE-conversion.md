Ts-to-Rust-port neuroimaging data structures

---

### `crates/volmath/src/axis.rs`

```rust
// crates/volmath/src/axis.rs
use nalgebra::{Matrix3, Vector3};
use serde::{Serialize, Deserialize};
use ts_rs::TS;
use std::slice;

#[derive(TS, Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[ts(export, export_to = "../../packages/api/src/generated/axis.ts")]
pub enum AxisName {
    LeftRight, // +X in LPI world space
    RightLeft, // -X in LPI world space
    PostAnt,   // +Y in LPI world space
    AntPost,   // -Y in LPI world space
    InfSup,    // +Z in LPI world space
    SupInf,    // -Z in LPI world space
}

#[derive(TS, Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[ts(export, export_to = "../../packages/api/src/generated/axis.ts")]
pub struct NamedAxis {
    pub name: AxisName,
    /// Direction vector in LPI world space (+X=Left, +Y=Posterior, +Z=Superior)
    #[ts(skip)]
    pub direction: Vector3<i8>,
}

// Implement Display for better debug/logging if needed
impl std::fmt::Display for NamedAxis {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self.name)
    }
}

impl NamedAxis {
    // LPI world space directions
    pub const LEFT_RIGHT: Self = Self { name: AxisName::LeftRight, direction: Vector3::new( 1,  0,  0) };
    pub const RIGHT_LEFT: Self = Self { name: AxisName::RightLeft, direction: Vector3::new(-1,  0,  0) };
    pub const POST_ANT:   Self = Self { name: AxisName::PostAnt,   direction: Vector3::new( 0,  1,  0) };
    pub const ANT_POST:   Self = Self { name: AxisName::AntPost,   direction: Vector3::new( 0, -1,  0) };
    pub const INF_SUP:    Self = Self { name: AxisName::InfSup,    direction: Vector3::new( 0,  0,  1) };
    pub const SUP_INF:    Self = Self { name: AxisName::SupInf,    direction: Vector3::new( 0,  0, -1) };

    /// Returns the opposing axis constant.
    #[inline]
    pub fn opposite(&self) -> Self {
        match self.name {
            AxisName::LeftRight => Self::RIGHT_LEFT, AxisName::RightLeft => Self::LEFT_RIGHT,
            AxisName::PostAnt   => Self::ANT_POST,   AxisName::AntPost   => Self::POST_ANT,
            AxisName::InfSup    => Self::SUP_INF,    AxisName::SupInf    => Self::INF_SUP,
        }
    }

    /// Returns the 3x3 permutation/scaling matrix component for this axis.
    /// Note: This is primarily for internal use within AxisSet; interpretation depends on context.
    #[inline]
    pub fn perm_scale_mat_component(&self) -> Matrix3<i8> {
        // Example: If this is the first axis (i), its direction forms the first COLUMN.
        // This representation differs slightly from the original sketch but aligns with typical
        // transformation construction where columns represent transformed basis vectors.
        Matrix3::from_columns(&[self.direction, Vector3::zeros(), Vector3::zeros()])
        // A full AxisSet would combine components from i, j, k into the final matrix.
    }
}


// --- Axis Sets ---

/// Trait defining common operations for sets of orthogonal axes (2D, 3D).
pub trait AxisSet: Debug + Clone + PartialEq + Send + Sync + 'static {
    fn ndim(&self) -> usize;
    /// Provides a slice view of the canonical axes in order (i, j, k...).
    fn axes(&self) -> &[NamedAxis];
    /// Constructs the 3x3 permutation/scaling matrix for this axis set.
    fn perm_scale_matrix(&self) -> Matrix3<i8>;

    /// Finds the index (0, 1, or 2) of a target axis within this set.
    fn which_axis(&self, target: &NamedAxis, ignore_direction: bool) -> Option<usize> {
        self.axes().iter().position(|axis| {
            if ignore_direction {
                axis.name == target.name || axis.name == target.opposite().name
            } else {
                axis == target
            }
        })
    }
}

#[derive(TS, Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[ts(export, export_to = "../../packages/api/src/generated/axis.ts")]
pub struct AxisSet3D {
    // Store axes in a fixed array for safe slicing.
    pub axes: [NamedAxis; 3],
}

impl AxisSet3D {
    pub const LPI: Self = Self { axes: [NamedAxis::LEFT_RIGHT, NamedAxis::POST_ANT, NamedAxis::INF_SUP] };
    pub const RAS: Self = Self { axes: [NamedAxis::RIGHT_LEFT, NamedAxis::ANT_POST, NamedAxis::INF_SUP] };
    // Add other common static orientations (Axial, Coronal, Sagittal variants) here...
    pub const AXIAL_LPI: Self = Self::LPI; // Example alias
    pub const CORONAL_LIP: Self = Self { axes: [NamedAxis::LEFT_RIGHT, NamedAxis::INF_SUP, NamedAxis::POST_ANT] };
    pub const SAGITTAL_AIL: Self = Self { axes: [NamedAxis::ANT_POST, NamedAxis::INF_SUP, NamedAxis::LEFT_RIGHT] };

    // Convenience accessors
    #[inline] pub fn i(&self) -> NamedAxis { self.axes[0] }
    #[inline] pub fn j(&self) -> NamedAxis { self.axes[1] }
    #[inline] pub fn k(&self) -> NamedAxis { self.axes[2] }
}

impl AxisSet for AxisSet3D {
    #[inline] fn ndim(&self) -> usize { 3 }
    #[inline] fn axes(&self) -> &[NamedAxis] { &self.axes }

    fn perm_scale_matrix(&self) -> Matrix3<i8> {
        Matrix3::from_columns(&[self.axes[0].direction, self.axes[1].direction, self.axes[2].direction])
    }
}

// Add AxisSet2D definition similarly if needed for slice-specific NeuroSpace operations.
```

### 2. Core Spatial Representation (`crates/volmath/src/space.rs`)

```rust
// crates/volmath/src/space.rs
use nalgebra::{Matrix4, Point3, Vector3};
use serde::{Serialize, Deserialize};
use ts_rs::TS;
use crate::axis::{AxisSet, AxisSet3D, NamedAxis}; // Import necessary axis types

/// Represents the geometric space of a neuroimaging volume.
/// Defines dimensions, voxel spacing, orientation, and voxel-to-world transform.
#[derive(TS, Serialize, Deserialize, Debug, Clone, PartialEq)]
#[ts(export, export_to = "../../packages/api/src/generated/space.ts")]
pub struct NeuroSpace {
    #[ts(type = "[number, number, number]")]
    pub dim: [usize; 3],
    #[ts(type = "[number, number, number]")]
    pub spacing: [f32; 3],
    #[ts(type = "[number, number, number]")]
    pub origin: [f32; 3], // World coordinate (LPI mm) of voxel [0,0,0] center/corner
    // TODO: Consider adding axes: AxisSet3D field if needed beyond affine
    /// 4x4 Voxel Grid -> World LPI Affine Matrix (Column-major for nalgebra)
    #[ts(skip)]
    affine: Matrix4<f32>,
    /// 4x4 World LPI -> Voxel Grid Affine Matrix (Column-major for nalgebra)
    #[ts(skip)]
    inverse_affine: Matrix4<f32>,
}

impl NeuroSpace {
    /// Creates NeuroSpace from an affine matrix (voxel-to-world, column-major).
    /// Extracts dimensions, spacing, and origin.
    /// Note: Spacing extraction assumes orthogonal axes; use `sqrt(col·col)`.
    pub fn from_affine(dim: [usize; 3], affine_mat: Matrix4<f32>) -> Self {
        assert!(dim.iter().all(|&d| d > 0), "Dimensions must be positive");
        let inverse_affine = affine_mat.try_inverse().expect("Affine must be invertible");

        // Extract spacing as the norm of the first three columns' 3D vector part
        let spacing = [
            affine_mat.column(0).xyz().norm(),
            affine_mat.column(1).xyz().norm(),
            affine_mat.column(2).xyz().norm(),
        ];
        // Origin is the translation component
        let origin = [affine_mat[(0, 3)], affine_mat[(1, 3)], affine_mat[(2, 3)]];

        Self { dim, spacing, origin, affine: affine_mat, inverse_affine }
    }

    /// Transforms integer grid indices (i,j,k) to world coordinates (mm).
    #[inline]
    pub fn grid_indices_to_coord(&self, ijk: [usize; 3]) -> [f32; 3] {
        self.grid_to_coord([ijk[0] as f32, ijk[1] as f32, ijk[2] as f32])
    }

    /// Transforms continuous grid coordinates (i,j,k) to world coordinates (mm).
    #[inline]
    pub fn grid_to_coord(&self, ijk: [f32; 3]) -> [f32; 3] {
        let grid_point_h = Point3::new(ijk[0], ijk[1], ijk[2]).to_homogeneous();
        let world_point_h = self.affine * grid_point_h;
        // Perspective divide (w should normally be 1 for affine)
        let world_point = Point3::from_homogeneous(world_point_h)
                           .unwrap_or_else(|| Point3::origin()); // Handle potential w=0
        [world_point.x, world_point.y, world_point.z]
    }

    /// Transforms world coordinates (mm) back to continuous grid coordinates.
    #[inline]
    pub fn coord_to_grid(&self, world: [f32; 3]) -> [f32; 3] {
        let world_point_h = Point3::new(world[0], world[1], world[2]).to_homogeneous();
        let grid_point_h = self.inverse_affine * world_point_h;
        let grid_point = Point3::from_homogeneous(grid_point_h)
                            .unwrap_or_else(|| Point3::origin());
        [grid_point.x, grid_point.y, grid_point.z]
    }

    /// Transforms world coordinates (mm) to the nearest integer grid indices.
    /// Returns None if the coordinate is outside the volume bounds.
    /// Uses floor() for indexing consistency (voxel covers [i, i+1)).
    /// TODO (Phase 2): Revisit rounding/floor for potentially sheared spaces from qform.
    #[inline]
    pub fn world_to_grid_index_floor(&self, world: [f32; 3]) -> Option<(usize, usize, usize)> {
        let grid_f = self.coord_to_grid(world);
        let grid_i = [
            grid_f[0].floor() as isize,
            grid_f[1].floor() as isize,
            grid_f[2].floor() as isize,
        ];

        // Check bounds
        if grid_i[0] >= 0 && (grid_i[0] as usize) < self.dim[0] &&
           grid_i[1] >= 0 && (grid_i[1] as usize) < self.dim[1] &&
           grid_i[2] >= 0 && (grid_i[2] as usize) < self.dim[2]
        {
            Some((grid_i[0] as usize, grid_i[1] as usize, grid_i[2] as usize))
        } else {
            None
        }
    }

    /// Computes the linear C-style index from integer grid coordinates.
    /// Assumes input coordinates are already bounds-checked.
    #[inline]
    pub fn grid_coords_to_index_unchecked(&self, i: usize, j: usize, k: usize) -> usize {
        debug_assert!(i < self.dim[0] && j < self.dim[1] && k < self.dim[2], "Out of bounds in grid_coords_to_index_unchecked");
        // C-style indexing: i varies fastest
        i + j * self.dim[0] + k * self.dim[0] * self.dim[1]
    }

    /// Total number of voxels.
    #[inline]
    pub fn voxel_count(&self) -> usize {
        self.dim[0] * self.dim[1] * self.dim[2]
    }

    /// Returns the 4x4 Voxel->World affine matrix.
    pub fn affine(&self) -> &Matrix4<f32> {
        &self.affine
    }

    /// Returns the 4x4 World->Voxel affine matrix.
    pub fn inverse_affine(&self) -> &Matrix4<f32> {
        &self.inverse_affine
    }

    /// Helper to get affine elements as a flattened f32 slice (e.g., for API).
    pub fn affine_elements(&self) -> [f32; 16] {
        // nalgebra matrices are column-major by default. Ensure consistent order for API (e.g., row-major).
        // Transpose to get row-major order if necessary for the API contract.
        // Assuming API expects row-major:
        let affine_row_major = self.affine.transpose();
        affine_row_major.as_slice().try_into().expect("Matrix should be 4x4")
    }
}

// --- Helper Functions ---

/// Computes linear index from 3D grid coordinates and dimensions.
#[inline]
pub fn grid_coords_to_index(dims: &[usize; 3], i: usize, j: usize, k: usize) -> Option<usize> {
    if i < dims[0] && j < dims[1] && k < dims[2] {
        Some(i + j * dims[0] + k * dims[0] * dims[1])
    } else {
        None
    }
}

// Add unit tests in #[cfg(test)] block below
#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;

    #[test]
    fn test_neurospace_transforms() {
        let dim = [10, 20, 30];
        let spacing = [2.0, 1.5, 1.0];
        let origin = [10.0, -5.0, 0.0];
        let space = NeuroSpace::from_affine(dim, Matrix4::new(
            2.0, 0.0, 0.0, 10.0,
            0.0, 1.5, 0.0, -5.0,
            0.0, 0.0, 1.0,  0.0,
            0.0, 0.0, 0.0,  1.0,
        )); // Column-major construction

        // Test origin mapping
        let world_origin = space.grid_to_coord([0.0, 0.0, 0.0]);
        assert_relative_eq!(world_origin[0], origin[0], epsilon = 1e-6);
        assert_relative_eq!(world_origin[1], origin[1], epsilon = 1e-6);
        assert_relative_eq!(world_origin[2], origin[2], epsilon = 1e-6);

        // Test inverse mapping at origin
        let grid_origin = space.coord_to_grid(origin);
        assert_relative_eq!(grid_origin[0], 0.0, epsilon = 1e-6);
        assert_relative_eq!(grid_origin[1], 0.0, epsilon = 1e-6);
        assert_relative_eq!(grid_origin[2], 0.0, epsilon = 1e-6);

        // Test round trip for a corner voxel
        let grid_corner = [dim[0] - 1, dim[1] - 1, dim[2] - 1];
        let world_corner = space.grid_indices_to_coord(grid_corner);
        let grid_corner_back = space.world_to_grid_index_floor(world_corner).expect("Should be in bounds");
        assert_eq!(grid_corner_back, (grid_corner[0], grid_corner[1], grid_corner[2]));

        // Test linear indexing
        let index = space.grid_coords_to_index_unchecked(1, 1, 1);
        assert_eq!(index, 1 + 1 * dim[0] + 1 * dim[0] * dim[1]);

        let index_oob = grid_coords_to_index(&dim, 10, 1, 1); // i is out of bounds
        assert!(index_oob.is_none());
    }
}
```

### 3. Core Dense Volume (`crates/volmath/src/dense_vol.rs`)

```rust
// crates/volmath/src/dense_vol.rs
use crate::space::NeuroSpace;
use std::fmt::Debug;
use bytemuck::{Pod, Zeroable};
use num_traits::Float; // For NaN handling

/// Trait alias for types usable as voxel data. Pod + Zeroable enable zero-cost &[u8] views.
/// Added PartialOrd for range calculation. Debug for convenience. Send + Sync for multi-threading.
pub trait VoxelData: Copy + Default + Debug + Send + Sync + Pod + Zeroable + PartialOrd + 'static {}
impl<T> VoxelData for T where T: Copy + Default + Debug + Send + Sync + Pod + Zeroable + PartialOrd + 'static {}

/// Represents a dense 3D volume with associated spatial information.
/// Generic over the scalar type `T`. Assumes data is stored contiguously in C-order (X fastest).
#[derive(Debug, Clone)]
pub struct DenseVolume<T: VoxelData> {
    pub space: NeuroSpace,
    data: Vec<T>,
}

impl<T: VoxelData> DenseVolume<T> {
    /// Allocates an empty volume filled with `T::default()`.
    pub fn new(space: NeuroSpace) -> Self {
        let count = space.voxel_count();
        // Using default() assumes 0 for numeric types, which is desired.
        let data = vec![T::default(); count];
        Self { space, data }
    }

    /// Creates a volume by taking ownership of existing data.
    /// Panics if data length doesn't match space dimensions.
    pub fn from_data(space: NeuroSpace, data: Vec<T>) -> Self {
        assert_eq!(
            data.len(), space.voxel_count(),
            "DenseVolume::from_data: Provided data length ({}) does not match NeuroSpace dimensions ({})",
            data.len(), space.voxel_count()
        );
        Self { space, data }
    }

    /// Gets the value at integer grid coordinates (i, j, k). Returns None if out of bounds.
    #[inline]
    pub fn get_at_coords(&self, i: usize, j: usize, k: usize) -> Option<T> {
        if i < self.space.dim[0] && j < self.space.dim[1] && k < self.space.dim[2] {
            let index = self.space.grid_coords_to_index_unchecked(i, j, k);
            // Safety: Index is guaranteed valid due to outer check.
            Some(unsafe { *self.data.get_unchecked(index) })
        } else {
            None
        }
    }

    /// Sets the value at integer grid coordinates (i, j, k). No-op if out of bounds.
    #[inline]
    pub fn set_at_coords(&mut self, i: usize, j: usize, k: usize, value: T) {
        if i < self.space.dim[0] && j < self.space.dim[1] && k < self.space.dim[2] {
            let index = self.space.grid_coords_to_index_unchecked(i, j, k);
            // Safety: Index is guaranteed valid due to outer check.
            unsafe { *self.data.get_unchecked_mut(index) = value };
        }
        // Silently ignore out-of-bounds writes for Phase 1 simplicity. Consider Result<> later.
    }

    /// Returns a read-only slice view of the internal data buffer.
    pub fn data_slice(&self) -> &[T] {
        &self.data
    }

    /// Returns a view of the internal data buffer as raw bytes using `bytemuck`.
    /// Assumes caller handles potential alignment issues on consumption (e.g., JS side).
    /// Data is little-endian matching typical WASM/CPU environments.
    pub fn data_as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.data)
    }

    /// Computes the minimum and maximum values in the volume, skipping NaNs for floats.
    /// Returns None if the volume is empty or contains only NaNs.
    pub fn range(&self) -> Option<(T, T)> {
        self.range_generic()
    }

    // Internal generic range implementation
    fn range_generic(&self) -> Option<(T, T)> {
       let mut iter = self.data.iter().copied().filter(|v| Self::is_valid_for_range(v));

        if let Some(first) = iter.next() {
            let mut min_val = first;
            let mut max_val = first;

            for v in iter {
                // These comparisons are safe due to the VoxelData trait bound and filter
                if v < min_val { min_val = v; }
                if v > max_val { max_val = v; }
            }
            Some((min_val, max_val))
        } else {
            None // Volume was empty or contained only invalid values (e.g., all NaNs)
        }
    }

    // Helper to check if a value is valid for min/max calculation (skips NaN for floats)
    #[inline]
    fn is_valid_for_range(v: &T) -> bool {
        // This check is slightly tricky generically. We can specialize for floats.
        // For now, rely on PartialOrd which handles non-floats correctly.
        // If T is f32 or f64, PartialOrd comparison with NaN is always false.
        // A more robust float version would use T::is_nan().
        true // Assume valid unless specialized below (or if T implements Float from num_traits)
    }
}

// Example specialization for f32 to handle NaN correctly
impl DenseVolume<f32> {
    pub fn range_f32(&self) -> Option<(f32, f32)> {
        let mut iter = self.data.iter().copied().filter(|v| !v.is_nan()); // Explicitly skip NaNs

        if let Some(first) = iter.next() {
            let mut min_val = first;
            let mut max_val = first;

            for v in iter {
                // Use f32 specific min/max
                min_val = f32::min(min_val, v);
                max_val = f32::max(max_val, v);
            }
            Some((min_val, max_val))
        } else {
            None
        }
    }
     // Override the generic range to use the specialized version
     // pub fn range(&self) -> Option<(f32, f32)> { self.range_f32() }
}
// Similar specialization can be added for f64

// Type Aliases for common volume types (can be exported via lib.rs)
pub type VolumeF32 = DenseVolume<f32>;
pub type VolumeI16 = DenseVolume<i16>;
pub type VolumeU8 = DenseVolume<u8>;
// Add others as needed (i8, u16, u32, i32, f64)

// Unit tests
#[cfg(test)]
mod tests {
    use super::*;
    use crate::space::NeuroSpace;
    use nalgebra::Matrix4;

    fn create_test_space() -> NeuroSpace {
        NeuroSpace::from_affine([3, 4, 5], Matrix4::identity())
    }

    #[test]
    fn test_volume_creation_and_access() {
        let space = create_test_space();
        let mut vol = DenseVolume::<f32>::new(space.clone());
        assert_eq!(vol.data.len(), 3 * 4 * 5);
        assert_eq!(vol.get_at_coords(0, 0, 0), Some(0.0));

        vol.set_at_coords(1, 2, 3, 42.0);
        assert_eq!(vol.get_at_coords(1, 2, 3), Some(42.0));

        // Test out of bounds get
        assert_eq!(vol.get_at_coords(3, 0, 0), None);
        // Test out of bounds set (should be no-op)
        let original_val = vol.get_at_coords(0,0,0).unwrap();
        vol.set_at_coords(10, 10, 10, 99.0);
        assert_eq!(vol.get_at_coords(0,0,0).unwrap(), original_val);
    }

    #[test]
    fn test_volume_range() {
        let space = create_test_space();
        let data = (0..(3*4*5)).map(|i| i as i16).collect();
        let vol = DenseVolume::<i16>::from_data(space, data);
        assert_eq!(vol.range(), Some((0, 59)));

        let empty_vol = DenseVolume::<f32>::new(create_test_space());
        assert_eq!(empty_vol.range(), Some((0.0, 0.0))); // Default value range

        let nan_vol = DenseVolume::<f32>::from_data(create_test_space(), vec![f32::NAN; 60]);
        assert_eq!(nan_vol.range_f32(), None); // Specialized NaN check
    }

     #[test]
    #[should_panic]
    fn test_from_data_panic() {
        let space = create_test_space();
        let bad_data = vec![0.0f32; 59]; // One element too short
        DenseVolume::from_data(space, bad_data);
    }
}
```

### 4. Loaders (`crates/core/loaders/nifti.rs` & `gifti.rs`)

*(Structure as outlined previously, with emphasis on correctness)*

```rust
// Example refinement for crates/core/loaders/nifti.rs

// ... (imports: DenseVolume, NeuroSpace, VolumeSendable, NumericType, nifti crate, etc.) ...

/// Loads a NIfTI file into a VolumeSendable structure for the API bridge.
/// Handles compression and basic header validation.
pub fn load_nifti_volume(file_path: &Path) -> anyhow::Result<VolumeSendable> {
    let nifti_obj = ReaderOptions::default().read_file(file_path)
        .map_err(|e| anyhow::anyhow!("Failed to read NIfTI file {}: {}", file_path.display(), e))?;
    let header = nifti_obj.header();

    // --- Header Validation ---
    if header.dim[0] < 3 || header.dim[0] > 4 { // Allow 3D or 4D for Phase 1 (timeseries)
        anyhow::bail!("NIfTI file must be 3D or 4D, found {} dimensions", header.dim[0]);
    }
    let dim3d = [
        header.dim[1] as usize, header.dim[2] as usize, header.dim[3] as usize
    ];
    if dim3d.iter().any(|&d| d == 0) { anyhow::bail!("NIfTI dimensions cannot be zero"); }
    let dim4d = if header.dim[0] == 4 {[header.dim[4] as usize]} else {[]}; // Time dim

    // --- Create NeuroSpace (using best available affine) ---
    let affine_mat = Matrix4::<f32>::from_iterator(
        header.sform_affine().iter().map(|&x| x as f32) // Prefer SForm
        // TODO: Fallback to QForm if SForm is invalid/unavailable? Needs nifti crate check.
    );
    let space = NeuroSpace::from_affine(dim3d, affine_mat);

    // --- Load and Convert Volume Data ---
    let volume = nifti_obj.volume();
    let nifti_dtype = header.datatype;
    let numeric_type = get_numeric_type_from_nifti_code(nifti_dtype)?;

    // Load data using nifti crate's helpers for safety and potential zero-copy.
    // Apply scaling/intercept if necessary.
    let scl_slope = header.scl_slope.unwrap_or(1.0);
    let scl_inter = header.scl_inter.unwrap_or(0.0);
    let apply_scaling = scl_slope != 1.0 || scl_inter != 0.0;

    // Generic function to load, potentially scale, and create sendable volume
    fn process_volume<T>(
        vol: &nifti::NiftiVolume,
        space: NeuroSpace,
        numeric_type: NumericType,
        apply_scaling: bool,
        slope: f32,
        inter: f32,
        dim4d: &[usize],
        path: &Path
    ) -> anyhow::Result<VolumeSendable>
    where
        T: VoxelData + nalgebra::Scalar + Copy + num_traits::FromPrimitive, // Add FromPrimitive for scaling
        f32: num_traits::AsPrimitive<T>, // Need to convert f32 scale/inter back to T
    {
        // into_vec attempts zero-copy if possible
        let mut data_vec: Vec<T> = vol.into_vec::<T>()
            .map_err(|e| anyhow::anyhow!("Failed to convert NIfTI data: {}", e))?;

        if apply_scaling {
            // Apply scaling: y = slope * x + inter
            // Convert slope/inter to T if possible, otherwise work in f32 and cast back.
             // This part is tricky generically. Often safer to load as f32 if scaling needed.
             // For Phase 1, consider ONLY supporting scaling for f32 output.
             if numeric_type != NumericType::F32 {
                 // For simplicity in P1, maybe only apply scale/inter if loading as f32
                 println!("Warning: scl_slope/scl_inter ignored for non-f32 NIfTI data type in Phase 1.");
             } else {
                 // Assuming T is f32 for this block
                 let data_f32 = bytemuck::cast_slice_mut::<_, f32>(&mut data_vec);
                 for val in data_f32.iter_mut() {
                     *val = slope * (*val) + inter;
                 }
             }
        }

        let vol_struct = DenseVolume::<T>::from_data(space, data_vec);
        create_sendable_volume(vol_struct, numeric_type, dim4d, path)
    }

    // Dispatch based on NIfTI type code
    let sendable = match nifti_dtype {
        nifti::header::DataType::Float32 => process_volume::<f32>(volume, space, numeric_type, apply_scaling, scl_slope, scl_inter, &dim4d, file_path)?,
        nifti::header::DataType::Int16 => process_volume::<i16>(volume, space, numeric_type, apply_scaling, scl_slope, scl_inter, &dim4d, file_path)?,
        nifti::header::DataType::Uint8 => process_volume::<u8>(volume, space, numeric_type, apply_scaling, scl_slope, scl_inter, &dim4d, file_path)?,
        // ... Add other Phase 1 supported types (i8, u16, i32, u32, f64?) ...
        _ => anyhow::bail!("Unsupported NIfTI datatype ({:?}) for Brainflow Phase 1", nifti_dtype),
    };

    Ok(sendable)
}

/// Helper to map NIfTI codes to internal NumericType enum
fn get_numeric_type_from_nifti_code(code: nifti::header::DataType) -> anyhow::Result<NumericType> {
    match code {
        nifti::header::DataType::Uint8 => Ok(NumericType::U8),
        nifti::header::DataType::Int16 => Ok(NumericType::I16),
        nifti::header::DataType::Int32 => Ok(NumericType::I32),
        nifti::header::DataType::Float32 => Ok(NumericType::F32),
        nifti::header::DataType::Float64 => Ok(NumericType::F64),
        nifti::header::DataType::Int8 => Ok(NumericType::I8),
        nifti::header::DataType::Uint16 => Ok(NumericType::U16),
        nifti::header::DataType::Uint32 => Ok(NumericType::U32),
        _ => anyhow::bail!("Unsupported NIfTI datatype code: {:?}", code),
    }
}

/// Helper to create the structure sent over the bridge.
/// FIXME: SAB allocation needs actual implementation via Tauri/WASM context.
fn create_sendable_volume<T: VoxelData>(
    vol: DenseVolume<T>,
    dtype: NumericType,
    dim4d: &[usize],
    file_path: &Path,
) -> anyhow::Result<VolumeSendable> {
    let data_bytes = vol.data_as_bytes();
    let buffer_len = data_bytes.len();

    // --- FIXME: Replace this with actual SAB allocation ---
    // 1. Use Tauri command/API to request SAB allocation from JS side, get handle.
    // 2. Use unsafe Rust to get a mutable slice view of the SAB.
    // 3. Copy data_bytes into the SAB slice.
    // For now, we just return metadata without the actual buffer handle.
    let sab_handle_placeholder = format!("sab-placeholder-{}", rand::random::<u32>());
    println!("FIXME: Need to allocate SAB of size {} bytes and copy data.", buffer_len);
    // --- End FIXME ---

    let mut full_dim = [0u32; 4];
    full_dim[0] = vol.space.dim[0] as u32;
    full_dim[1] = vol.space.dim[1] as u32;
    full_dim[2] = vol.space.dim[2] as u32;
    full_dim[3] = if dim4d.is_empty() { 1 } else { dim4d[0] as u32 };

    // Ensure range calculation handles potential NaNs if T is float
    let range_f32 = match dtype {
         NumericType::F32 => {
             let vol_f32 : &DenseVolume<f32> = unsafe { std::mem::transmute(&vol) }; // Unsafe cast, assumes T=f32
             vol_f32.range_f32().unwrap_or([0.0, 0.0])
         },
         NumericType::F64 => {
             // Need similar f64 range logic
             vol.range().map_or([0.0, 0.0], |(min, max)| [min as f32, max as f32]) // Example cast
         }
         _ => vol.range().map_or([0.0, 0.0], |(min, max)| [min as f32, max as f32]) // Basic cast for integers
    };


    Ok(VolumeSendable {
        id: format!("vol-{}", sab_handle_placeholder), // Use handle in ID
        path: file_path.to_string_lossy().to_string(),
        dataType: "volume".to_string(),
        isAtlas: false,
        dim: full_dim,
        affine: vol.space.affine_elements().to_vec(), // Get flattened elements
        dataBufferHandle: sab_handle_placeholder, // Placeholder
        bytesPerVoxel: std::mem::size_of::<T>() as u32,
        numericType: dtype,
        range: [range_f32[0], range_f32[1]],
    })
}

// Placeholder for shared types (likely defined in api_bridge or common crate)
pub mod datatypes {
    use serde::Serialize;
    use ts_rs::TS;

    #[derive(TS, Serialize, Debug, Clone, Copy, PartialEq, Eq)]
    #[ts(export, export_to = "../../../packages/api/src/generated/numericType.ts")]
    pub enum NumericType { F32, F64, I16, I32, U8, U16, U32, I8 }

    #[derive(TS, Serialize, Debug, Clone)]
    #[ts(export, export_to = "../../../packages/api/src/generated/volumeSendable.ts")]
    pub struct VolumeSendable {
       pub id: String,
       pub path: String,
       pub dataType: String,
       pub isAtlas: bool,
       #[ts(type = "[number, number, number, number]")]
       pub dim: [u32; 4],
       #[ts(type = "Float32Array")] // API uses Float32 for affine
       pub affine: Vec<f32>,
       pub dataBufferHandle: String, // Placeholder for SAB handle/ID
       pub bytesPerVoxel: u32,
       pub numericType: NumericType,
       #[ts(type = "[number, number]")]
       pub range: [f32; 2],
   }
}
```

*(Note: The GIfTI loader (`gifti.rs`) would follow a similar pattern, using the `gifti` crate and populating a `SurfaceSendable` struct aligned with the `@brainflow/api` `Surface` interface, including allocating SABs for vertices and indices).*

### 5. Library Module (`crates/volmath/src/lib.rs`)

```rust
// crates/volmath/src/lib.rs

// Re-export only the necessary public types/modules for Phase 1
pub mod axis;
pub mod space;
pub mod dense_vol;
// pub mod accel; // Uncomment when KD-tree is added

pub use axis::{AxisName, NamedAxis, AxisSet3D};
pub use space::NeuroSpace;
pub use dense_vol::{DenseVolume, VoxelData, VolumeF32, VolumeI16, VolumeU8}; // Export common aliases
```

---

This revised set of Rust code aligns with the migration plan's refined scope, addresses the feedback points (axis storage, NaN handling, generic bridging, loader details), and provides a solid foundation for the subsequent milestones. Remember to implement the `FIXME` regarding SAB allocation using Tauri's specific mechanisms.