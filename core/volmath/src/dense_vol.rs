// crates/volmath/src/dense_vol.rs
use crate::space::{GridSpace, NeuroSpace2, NeuroSpace3, NeuroSpace4}; // Use newtype wrappers
use std::fmt::Debug;
use bytemuck::{Pod, Zeroable};
use num_traits::NumCast; // Removed Float as it was unused
use serde::{Serialize}; // Only Serialize needed for wrappers sent to TS
use ts_rs::TS; // Only for concrete type wrappers
use crate::traits::Volume; // Import the Volume trait
use crate::NumericType; // Import NumericType from lib.rs
use half::f16; // Import f16 type

/// Trait alias for types usable as voxel data.
pub trait VoxelData: Copy + Default + Debug + Send + Sync + Pod + Zeroable + PartialOrd + 'static {}
impl<T> VoxelData for T where T: Copy + Default + Debug + Send + Sync + Pod + Zeroable + PartialOrd + 'static {}

/// Represents a dense 2-dimensional slice or image. Data stored contiguously (C-order).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DenseSlice<T: VoxelData + Serialize> {
    pub space: NeuroSpace2,
    data: Vec<T>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DenseVolume3<T: VoxelData + Serialize> {
    pub space: NeuroSpace3,
    data: Vec<T>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DenseVolume4<T: VoxelData + Serialize> {
    pub space: NeuroSpace4,
    data: Vec<T>,
}

// --- Concrete Type Aliases & TS Export Wrappers ---
// Define aliases for common use cases. Export wrappers if direct TS interaction is needed.

// 3D Aliases
pub type Volume3D<T> = DenseVolume3<T>;
#[derive(Debug, Clone, PartialEq, Serialize, TS)] // Wrapper for TS export
#[ts(export, export_to = "../../packages/api/src/generated/volume.ts")]
pub struct VolumeF32_3D(#[ts(skip)] pub Volume3D<f32>);
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../packages/api/src/generated/volume.ts")]
pub struct VolumeI16_3D(#[ts(skip)] pub Volume3D<i16>);
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../packages/api/src/generated/volume.ts")]
pub struct VolumeU8_3D(#[ts(skip)] pub Volume3D<u8>);
// Add other 3D wrappers (I8, U16, U32, I32, F64) as needed

// 4D Aliases (Example - if needed for representing 4D data internally)
pub type Volume4D<T> = DenseVolume4<T>;
// No direct TS export for 4D generic planned for Phase 1 API, but alias is useful.

// --- Implementation ---

impl<T: VoxelData + Serialize> DenseSlice<T> {
    /// Creates new slice filled with `T::default()`.
    pub fn new(space: NeuroSpace2) -> Self {
        let count = space.0.voxel_count();
        Self { space, data: vec![T::default(); count] }
    }

    /// Creates slice from existing data. Panics on length mismatch.
    pub fn from_data(space: NeuroSpace2, data: Vec<T>) -> Self {
        assert_eq!(data.len(), space.0.voxel_count(), "Data length mismatch");
        Self { space, data }
    }

    /// Gets value at 2D integer grid coords. Returns `None` if out of bounds.
    #[inline]
    pub fn get_at_coords(&self, idx: &[usize; 2]) -> Option<T> {
        if idx.iter().zip(self.space.0.dims().iter()).all(|(&i, &d)| i < d) {
            let linear_index = self.space.0.grid_coords_to_index_unchecked(idx);
            Some(unsafe { *self.data.get_unchecked(linear_index) })
        } else {
            None
        }
    }

    /// Read-only slice of the entire flattened data buffer.
    pub fn data_slice(&self) -> &[T] { &self.data }

    /// Raw byte view of data using `bytemuck`.
    pub fn data_as_bytes(&self) -> &[u8] { bytemuck::cast_slice(&self.data) }

    /// Computes the min/max range via `DataRange` trait.
    pub fn range(&self) -> Option<(T, T)> where T: DataRange<T> {
        T::calculate_range(&self.data)
    }
}

impl<T: VoxelData + Serialize> DenseVolume3<T> {
    /// Creates new volume filled with `T::default()`.
    pub fn new(space: NeuroSpace3) -> Self {
        let count = space.0.voxel_count();
        Self { space, data: vec![T::default(); count] }
    }

    /// Creates volume from existing data. Panics on length mismatch.
    pub fn from_data(space: NeuroSpace3, data: Vec<T>) -> Self {
        assert_eq!(data.len(), space.0.voxel_count(), "Data length mismatch");
        Self { space, data }
    }

    /// Gets value at N-dimensional integer grid coords. Returns `None` if out of bounds.
    /// Accepts a fixed-size array `[usize; N]`.
    #[inline]
    pub fn get_at_coords(&self, idx: &[usize; 3]) -> Option<T> {
        if idx.iter().zip(self.space.0.dims().iter()).all(|(&i, &d)| i < d) {
            let linear_index = self.space.0.grid_coords_to_index_unchecked(idx);
            Some(unsafe { *self.data.get_unchecked(linear_index) })
        } else {
            None
        }
    }

     /// Gets value at N-dimensional integer grid coords. Returns `None` if out of bounds.
     /// Accepts a slice `&[usize]` of length N.
     #[inline]
     pub fn get_at_coords_slice(&self, idx_slice: &[usize]) -> Option<T> {
         if idx_slice.len() != 3 { return None; } // Ensure correct dimensionality
         let idx_arr: [usize; 3] = idx_slice.try_into().expect("Slice length must match 3");
         if idx_arr.iter().zip(self.space.0.dims().iter()).all(|(&i, &d)| i < d) {
             let linear_index = self.space.0.grid_coords_to_index_unchecked(&idx_arr);
             Some(unsafe { *self.data.get_unchecked(linear_index) })
         } else {
             None
         }
     }

    /// Read-only slice of the entire flattened data buffer.
    pub fn data_slice(&self) -> &[T] { &self.data }

    /// Raw byte view of data using `bytemuck`.
    pub fn data_as_bytes(&self) -> &[u8] { bytemuck::cast_slice(&self.data) }

    /// Computes the min/max range via `DataRange` trait.
    pub fn range(&self) -> Option<(T, T)> where T: DataRange<T> {
        T::calculate_range(&self.data)
    }

    /// Extracts a 2D slice along the specified axis at the given index.
    ///
    /// Args:
    /// * `axis`: The axis *perpendicular* to the desired slice (0=X, 1=Y, 2=Z).
    /// * `index`: The grid index along the specified `axis`.
    ///
    /// Returns:
    /// * `Some(Vec<T>)` containing the slice data in C-order (fastest changing dimension last).
    /// * `None` if the index is out of bounds for the given axis.
    ///
    /// Panics:
    /// * If `axis` is not 0, 1, or 2.
    pub fn get_slice(&self, axis: usize, index: usize) -> Option<Vec<T>> {
        let dims = self.space.0.dims();
        assert!(axis < 3, "Axis must be 0, 1, or 2");

        if index >= dims[axis] {
            return None; // Index out of bounds
        }

        let mut slice_data = Vec::new();
        let mut current_coords = [0; 3];
        current_coords[axis] = index; // Fix the coordinate along the slice axis

        match axis {
            0 => { // YZ slice (fixed X)
                slice_data.reserve(dims[1] * dims[2]);
                for k in 0..dims[2] { // Iterate Z (slowest)
                    current_coords[2] = k;
                    for j in 0..dims[1] { // Iterate Y (fastest)
                        current_coords[1] = j;
                        // Safety: Bounds checked initially, inner loops respect dims
                        let linear_index = self.space.0.grid_coords_to_index_unchecked(&current_coords);
                        slice_data.push(unsafe { *self.data.get_unchecked(linear_index) });
                    }
                }
            },
            1 => { // XZ slice (fixed Y)
                slice_data.reserve(dims[0] * dims[2]);
                for k in 0..dims[2] { // Iterate Z (slowest)
                    current_coords[2] = k;
                    for i in 0..dims[0] { // Iterate X (fastest)
                        current_coords[0] = i;
                        let linear_index = self.space.0.grid_coords_to_index_unchecked(&current_coords);
                        slice_data.push(unsafe { *self.data.get_unchecked(linear_index) });
                    }
                }
            },
            2 => { // XY slice (fixed Z)
                slice_data.reserve(dims[0] * dims[1]);
                for j in 0..dims[1] { // Iterate Y (slowest)
                    current_coords[1] = j;
                    for i in 0..dims[0] { // Iterate X (fastest)
                        current_coords[0] = i;
                        let linear_index = self.space.0.grid_coords_to_index_unchecked(&current_coords);
                        slice_data.push(unsafe { *self.data.get_unchecked(linear_index) });
                    }
                }
            },
            _ => unreachable!(), // Already asserted axis < 3
        }

        Some(slice_data)
    }

    /// Extracts a 2D slice and returns it as a byte vector representing f16 values.
    ///
    /// Requires `T` to be castable to `f32` via `num_traits::cast`.
    /// This is suitable for uploading to GPU textures with formats like `R16Float`.
    ///
    /// Args:
    /// * `axis`: The axis *perpendicular* to the desired slice (0=X, 1=Y, 2=Z).
    /// * `index`: The grid index along the specified `axis`.
    ///
    /// Returns:
    /// * `Some(Vec<u8>)` containing the slice data as bytes (each pair represents one f16).
    /// * `None` if the index is out of bounds or if conversion from `T` to `f32` fails.
    ///
    /// Panics:
    /// * If `axis` is not 0, 1, or 2.
    pub fn get_slice_as_f16_bytes(&self, axis: usize, index: usize) -> Option<Vec<u8>> 
        where T: num_traits::NumCast // Add bound for casting T to f32
    {
        // Get the slice data as Vec<T>
        let slice_vec_t = self.get_slice(axis, index)?;

        // Convert Vec<T> to Vec<f16>
        let mut slice_vec_f16: Vec<f16> = Vec::with_capacity(slice_vec_t.len());
        for val_t in slice_vec_t {
            // Attempt to cast T -> f32 -> f16
            if let Some(val_f32) = num_traits::cast::<T, f32>(val_t) {
                slice_vec_f16.push(f16::from_f32(val_f32));
            } else {
                // Handle casting failure - return None or use a default (e.g., f16::ZERO)?
                // Returning None is safer to signal potential data issues.
                eprintln!("Warning: Failed to cast value {:?} to f32 during f16 conversion.", val_t);
                return None; 
            }
        }

        // Convert Vec<f16> to Vec<u8> using bytemuck
        let slice_bytes: Vec<u8> = bytemuck::cast_slice(&slice_vec_f16).to_vec();
        
        Some(slice_bytes)
    }

    /// Converts the entire volume data to f16 bytes for GPU upload.
    /// Returns a Vec<u8> where each pair of bytes represents an f16 value.
    pub fn to_f16_bytes(&self) -> Vec<u8>
        where T: num_traits::NumCast
    {
        // Debug: Sample some source values
        println!("DEBUG: to_f16_bytes - converting {} values", self.data.len());
        
        // Sample first few values
        if self.data.len() > 0 {
            println!("DEBUG: First 10 source values:");
            for (i, &val) in self.data.iter().take(10).enumerate() {
                if let Some(val_f32) = num_traits::cast::<T, f32>(val) {
                    println!("  [{}] = {}", i, val_f32);
                }
            }
        }
        
        // Convert entire volume data to f16
        let mut volume_f16: Vec<f16> = Vec::with_capacity(self.data.len());
        let mut non_zero_count = 0;
        let mut min_val = f32::INFINITY;
        let mut max_val = f32::NEG_INFINITY;
        
        for &val in &self.data {
            if let Some(val_f32) = num_traits::cast::<T, f32>(val) {
                if val_f32 != 0.0 {
                    non_zero_count += 1;
                }
                min_val = min_val.min(val_f32);
                max_val = max_val.max(val_f32);
                volume_f16.push(f16::from_f32(val_f32));
            } else {
                // Use zero for failed conversions
                eprintln!("Warning: Failed to cast value to f32 during f16 conversion.");
                volume_f16.push(f16::ZERO);
            }
        }
        
        println!("DEBUG: Non-zero values found: {}/{}", non_zero_count, self.data.len());
        println!("DEBUG: Value range: {} to {}", min_val, max_val);
        
        // Sample some f16 values to verify conversion
        if volume_f16.len() >= 10 {
            println!("DEBUG: First 10 f16 values:");
            for i in 0..10 {
                let f16_val = volume_f16[i];
                let f32_val = f16_val.to_f32();
                println!("  [{}] f16: {:?} -> f32: {}", i, f16_val, f32_val);
            }
        }

        // Convert Vec<f16> to Vec<u8> using bytemuck
        bytemuck::cast_slice(&volume_f16).to_vec()
    }
}

impl<T: VoxelData + Serialize> DenseVolume4<T> {
    /// Creates new volume filled with `T::default()`.
    pub fn new(space: NeuroSpace4) -> Self {
        let count = space.0.voxel_count();
        Self { space, data: vec![T::default(); count] }
    }

    /// Creates volume from existing data. Panics on length mismatch.
    pub fn from_data(space: NeuroSpace4, data: Vec<T>) -> Self {
        assert_eq!(data.len(), space.0.voxel_count(), "Data length mismatch");
        Self { space, data }
    }

    /// Gets value at N-dimensional integer grid coords. Returns `None` if out of bounds.
    /// Accepts a fixed-size array `[usize; N]`.
    #[inline]
    pub fn get_at_coords(&self, idx: &[usize; 4]) -> Option<T> {
        if idx.iter().zip(self.space.0.dims().iter()).all(|(&i, &d)| i < d) {
            let linear_index = self.space.0.grid_coords_to_index_unchecked(idx);
            Some(unsafe { *self.data.get_unchecked(linear_index) })
        } else {
            None
        }
    }

    /// Read-only slice of the entire flattened data buffer.
    pub fn data_slice(&self) -> &[T] { &self.data }

    /// Raw byte view of data using `bytemuck`.
    pub fn data_as_bytes(&self) -> &[u8] { bytemuck::cast_slice(&self.data) }

    /// Computes the min/max range via `DataRange` trait.
    pub fn range(&self) -> Option<(T, T)> where T: DataRange<T> {
        T::calculate_range(&self.data)
    }
}

// --- Trait for specialized range calculation ---
// Make the trait public
pub trait DataRange<T>: VoxelData + NumCast + Copy {
    fn calculate_range(data: &[Self]) -> Option<(Self, Self)>;

    /// Helper to safely cast range to f32 for API.
    fn range_as_f32(data: &[Self]) -> [f32; 2] {
        Self::calculate_range(data)
            .map_or([0.0, 0.0], |(min, max)| {
                let min_f32 = num_traits::cast::<Self, f32>(min).unwrap_or(f32::NAN);
                let max_f32 = num_traits::cast::<Self, f32>(max).unwrap_or(f32::NAN);
                if min_f32.is_nan() || max_f32.is_nan() { [0.0, 0.0] } else { [min_f32, max_f32] }
            })
    }
}

impl DataRange<f32> for f32 {
    fn calculate_range(data: &[Self]) -> Option<(Self, Self)> {
        if data.is_empty() { return None; }
        let mut min = data[0];
        let mut max = data[0];
        for &value in data.iter().skip(1) {
            if value < min { min = value; }
            if value > max { max = value; }
        }
        Some((min, max))
    }
}

impl DataRange<f64> for f64 {
    fn calculate_range(data: &[Self]) -> Option<(Self, Self)> {
        if data.is_empty() { return None; }
        let mut min = data[0];
        let mut max = data[0];
        for &value in data.iter().skip(1) {
            if value < min { min = value; }
            if value > max { max = value; }
        }
        Some((min, max))
    }
}

macro_rules! impl_integer_range { 
    ($($t:ty),*) => { 
        $(
            impl DataRange<$t> for $t { 
                fn calculate_range(data: &[Self]) -> Option<(Self, Self)> {
                    if data.is_empty() { return None; }
                    let mut min = data[0];
                    let mut max = data[0];
                    for &value in data.iter().skip(1) {
                        if value < min { min = value; }
                        if value > max { max = value; }
                    }
                    Some((min, max))
                }
            }
        )*
    }; 
}
impl_integer_range!(u8, i8, u16, i16, u32, i32);

// --- Implement Volume Trait for DenseVolume3 ---
impl<T> Volume<3> for DenseVolume3<T>
where
    T: VoxelData + DataRange<T> + Serialize, // Inherit bounds from struct + DataRange
{
    type Scalar = T;
    type Space  = NeuroSpace3;

    #[inline]
    fn space(&self) -> &Self::Space {
        &self.space
    }

    #[inline]
    fn voxel_type(&self) -> NumericType {
        // Requires NumericType::from_typeid::<T>() or similar
        NumericType::from_typeid::<T>()
    }

    #[inline]
    fn get(&self, ijk: &[usize; 3]) -> Option<T> {
        self.get_at_coords(ijk) // Reuse existing method
    }

    #[inline]
    fn as_bytes(&self) -> Option<&[u8]> {
        Some(self.data_as_bytes()) // Reuse existing method
    }

    /// Efficient dense slice access.
    fn slice_fast_axis(&self, fixed: &[usize], out: &mut [T]) -> bool {
        // Check fixed coordinates length (runtime check is now necessary)
        if fixed.len() != 2 { 
            return false;
        }

        let dims = self.space.dims();
        let y = fixed[0]; // Assuming fixed[0] is y
        let z = fixed[1]; // Assuming fixed[1] is z

        // Check output buffer length first
        if dims[0] != out.len() { return false; }

        // Check bounds for fixed dimensions
        if y >= dims[1] || z >= dims[2] { return false; }

        // Calculate start index (safe because bounds are checked)
        // Assuming C-order: index = k * (nx * ny) + j * nx + i
        // For slice at fixed j, k: start = k * (nx * ny) + j * nx + 0
        // Stride = 1
        // nx = dims[0], ny = dims[1], nz = dims[2]
        let start = self.space.0.grid_coords_to_index_unchecked(&[0, y, z]);

        // Check if calculated range is valid within the data Vec
        // This should theoretically always be true if bounds checks passed,
        // but adds safety.
        if start + dims[0] > self.data.len() { return false; }

        // Perform the slice copy
        out.copy_from_slice(&self.data[start .. start + dims[0]]);
        true
    }
}

// --- Unit Tests ---
#[cfg(test)]
mod tests {
    use super::*;
    use crate::space::{NeuroSpaceImpl, NeuroSpace3, GridSpace}; // Import GridSpace trait

    #[test]
    fn test_generic_volume3d_access() {
        // Construct NeuroSpaceImpl first, then wrap it
        let space_impl = NeuroSpaceImpl::<3>::from_dims_spacing_origin([3,4,5], [1.0; 3], [0.0; 3]); // Use turbofish
        let space3d = NeuroSpace3(space_impl);
        let mut vol = DenseVolume3::<i16>::new(space3d.clone()); // Clone space for volume
        assert_eq!(vol.data.len(), 60);
        // Call GridSpace methods on the wrapper (or its inner value)
        assert_eq!(vol.space.voxel_count(), 60); // Call on wrapper
        assert_eq!(vol.get_at_coords(&[0,0,0]), Some(0));

        // Note: No set methods exposed for Phase 1 volmath core
        // vol.set_at_coords(&[1, 2, 3], 42i16);
        // assert_eq!(vol.get_at_coords(&[1, 2, 3]), Some(42));

        assert_eq!(vol.get_at_coords(&[3, 0, 0]), None); // Out of bounds i
    }

    #[test]
    fn test_generic_volume_range() {
         let space_impl = NeuroSpaceImpl::<3>::from_dims_spacing_origin([2,2,1], [1.0; 3], [0.0; 3]); // Use turbofish
         let space = NeuroSpace3(space_impl);
         let data = vec![1i16, -3, 10, 5];
         let vol = DenseVolume3::<i16>::from_data(space, data);
         assert_eq!(vol.range(), Some((-3, 10)));
    }

     #[test]
    #[should_panic]
    fn test_from_data_panic_generic() {
        let space_impl = NeuroSpaceImpl::<3>::from_dims_spacing_origin([2,2,1], [1.0; 3], [0.0; 3]); // Use turbofish
        let space = NeuroSpace3(space_impl);
        let bad_data = vec![0.0f32; 3]; // Too short
        DenseVolume3::<f32>::from_data(space, bad_data);
    }
}
