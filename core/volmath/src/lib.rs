//! Volmath - Compatibility layer for neuroim-rs
//!
//! This crate provides compatibility types and functions for the brainflow2 project,
//! wrapping the neuroim-rs library to maintain existing APIs while migrating to
//! the more comprehensive neuroim-rs implementation.

// Re-export everything from neuroim
pub use neuroim::*;

// Import key dependencies for reuse in downstream crates
use serde::{Deserialize, Serialize};
use std::any::TypeId;
use ts_rs::TS;

// === COMPATIBILITY LAYER ===

// Type aliases for backward compatibility - now points to CompatibleVolume
pub type DenseVolume3<T> = CompatibleVolume<T>;
pub type NeuroSpace3 = NeuroSpaceWrapper;

// Re-export specific types that were previously custom
pub use neuroim::{NeuroSpace as NeuroSpace2, NeuroSpace as NeuroSpace4};

// Create compatibility modules for old imports
pub mod space {
    pub use super::NeuroSpace as NeuroSpaceImpl;
    pub use super::NeuroSpaceWrapper as GridSpace;
    pub use super::{NeuroSpace3, NeuroSpaceExt, NeuroSpaceWrapper};
}

// Wrapper to provide the old API structure that render_loop expects
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct NeuroSpaceWrapper(pub NeuroSpace);

impl NeuroSpaceWrapper {
    pub fn new(space: NeuroSpace) -> Self {
        Self(space)
    }

    pub fn dims(&self) -> &[usize] {
        &self.0.dim
    }

    pub fn spacing(&self) -> Vec<f32> {
        self.0.spacing.iter().map(|&x| x as f32).collect()
    }

    pub fn origin(&self) -> Vec<f32> {
        self.0.origin.iter().map(|&x| x as f32).collect()
    }

    // Provide access to the transformation matrices that render_loop expects
    pub fn world_to_voxel(&self) -> nalgebra::Matrix4<f32> {
        // Use the inverse transform from the NeuroSpace
        if let Some(inv) = &self.0.inverse {
            let result = inv.clone().fixed_resize::<4, 4>(0.0).cast::<f32>();
            // DEBUG: Check if this is actually the inverse
            let voxel_to_world = self.voxel_to_world();
            println!("DEBUG NeuroSpace3 world_to_voxel:");
            println!(
                "  Original trans matrix dims: {}x{}",
                self.0.trans.nrows(),
                self.0.trans.ncols()
            );
            println!("  voxel_to_world: {:?}", voxel_to_world);
            println!("  world_to_voxel (from inverse): {:?}", result);
            // Verify it's actually the inverse
            let product = voxel_to_world * result;
            println!("  voxel_to_world * world_to_voxel = {:?}", product);
            result
        } else {
            // Compute inverse if not available
            println!("DEBUG: No inverse available, computing from voxel_to_world");
            let voxel_to_world = self.voxel_to_world();
            println!("  voxel_to_world matrix: {:?}", voxel_to_world);
            let inverse = voxel_to_world.try_inverse().unwrap_or_else(|| {
                println!("  WARNING: Failed to compute inverse, using identity!");
                nalgebra::Matrix4::identity()
            });
            println!("  computed world_to_voxel: {:?}", inverse);
            inverse
        }
    }

    pub fn voxel_to_world(&self) -> nalgebra::Matrix4<f32> {
        // Use the forward transform from the NeuroSpace
        self.0.trans.clone().fixed_resize::<4, 4>(0.0).cast::<f32>()
    }
}

// Extension trait to add methods directly to NeuroSpace for render_loop compatibility
pub trait NeuroSpaceExt {
    fn dims(&self) -> &[usize];
    fn spacing(&self) -> Vec<f32>;
    fn origin(&self) -> Vec<f32>;
    fn world_to_voxel(&self) -> nalgebra::Matrix4<f32>;
    fn voxel_to_world(&self) -> nalgebra::Matrix4<f32>;
    fn from_affine_matrix4(
        dims: Vec<usize>,
        transform: nalgebra::Matrix4<f32>,
    ) -> std::result::Result<NeuroSpace, VolumeMathError>;
    fn from_dims_spacing_origin(
        dims: Vec<usize>,
        spacing: Vec<f64>,
        origin: Vec<f64>,
    ) -> std::result::Result<NeuroSpace, VolumeMathError>;
}

impl NeuroSpaceExt for NeuroSpace {
    fn dims(&self) -> &[usize] {
        &self.dim
    }

    fn spacing(&self) -> Vec<f32> {
        self.spacing.iter().map(|&x| x as f32).collect()
    }

    fn origin(&self) -> Vec<f32> {
        self.origin.iter().map(|&x| x as f32).collect()
    }

    fn world_to_voxel(&self) -> nalgebra::Matrix4<f32> {
        if let Some(inv) = &self.inverse {
            let result = inv.clone().fixed_resize::<4, 4>(0.0).cast::<f32>();
            // DEBUG: Check if this is actually the inverse
            let voxel_to_world = self.voxel_to_world();
            println!("DEBUG NeuroSpaceExt world_to_voxel:");
            println!("  voxel_to_world: {:?}", voxel_to_world);
            println!("  world_to_voxel (from inverse): {:?}", result);
            result
        } else {
            println!("DEBUG: No inverse available in NeuroSpaceExt");
            nalgebra::Matrix4::identity()
        }
    }

    fn voxel_to_world(&self) -> nalgebra::Matrix4<f32> {
        println!("DEBUG NeuroSpaceExt voxel_to_world:");
        println!(
            "  Original trans matrix size: {}x{}",
            self.trans.nrows(),
            self.trans.ncols()
        );
        println!("  Spacing: {:?}", self.spacing);
        println!("  Origin: {:?}", self.origin);
        println!("  Trans matrix:");
        for i in 0..self.trans.nrows().min(4) {
            if self.trans.ncols() >= 4 {
                println!(
                    "    [{:.3}, {:.3}, {:.3}, {:.3}]",
                    self.trans[(i, 0)],
                    self.trans[(i, 1)],
                    self.trans[(i, 2)],
                    self.trans[(i, 3)]
                );
            }
        }
        let result = self.trans.clone().fixed_resize::<4, 4>(0.0).cast::<f32>();
        println!("  Result 4x4 matrix: {:?}", result);
        result
    }

    fn from_affine_matrix4(
        dims: Vec<usize>,
        transform: nalgebra::Matrix4<f32>,
    ) -> std::result::Result<NeuroSpace, VolumeMathError> {
        // Convert f32 matrix to f64 for neuroim
        let transform_f64 = transform.cast::<f64>();
        let transform_dmatrix = nalgebra::DMatrix::from_fn(4, 4, |i, j| transform_f64[(i, j)]);

        NeuroSpace::new(
            dims,
            None, // spacing
            None, // origin
            None, // axes
            Some(transform_dmatrix),
        )
        .map_err(|e| VolumeMathError::NeuroImError(e.to_string()))
    }

    fn from_dims_spacing_origin(
        dims: Vec<usize>,
        spacing: Vec<f64>,
        origin: Vec<f64>,
    ) -> std::result::Result<NeuroSpace, VolumeMathError> {
        NeuroSpace::new(
            dims,
            Some(spacing),
            Some(origin),
            None, // axes
            None, // transform
        )
        .map_err(|e| VolumeMathError::NeuroImError(e.to_string()))
    }
}

pub mod dense_vol {
    pub use super::{CompatibleVolume, DataRange, DataRangeStruct, DenseVolume3, VoxelData};
}

pub mod traits {
    pub use super::NumericType;
    pub use super::{DynVolumeF32, Volume, VolumeHandle, VoxelData};
}

pub mod axis {
    pub use super::{AxisName, AxisSet3D, NamedAxis};
}

pub mod view_frame {
    pub use super::{calculate_field_of_view, make_frame, screen_to_world, world_to_screen};
    pub use super::{Plane, RenderLayer, ViewFrame, Viewport, VolumeMeta};
}

// Legacy volume types - now using neuroim equivalents
pub type VolumeF32_3D = DenseVolume3<f32>;
pub type VolumeI16_3D = DenseVolume3<i16>;
pub type VolumeU8_3D = DenseVolume3<u8>;

// Alias for slices
pub type DenseSlice<T> = neuroim::NeuroSlice<T>;

// Legacy trait compatibility
pub trait Volume: neuroim::NeuroVol {}
impl<T: neuroim::NeuroVol> Volume for T {}

pub trait VolumeHandle {
    type Data;
    fn get_data(&self) -> &Self::Data;
}

pub type DynVolumeF32 = Box<dyn Volume<Dtype = f32>>;

// VoxelData trait - map to neuroim's Numeric
pub trait VoxelData: neuroim::Numeric {}
impl<T: neuroim::Numeric> VoxelData for T {}

// Error types
#[derive(Debug, Serialize, Deserialize, TS, thiserror::Error)]
#[ts(export, export_to = "../../packages/api/src/generated/volmath.ts")]
pub enum VolumeMathError {
    #[error("Invalid axis specification")]
    InvalidAxis,
    #[error("Invalid dimension")]
    InvalidDimension,
    #[error("Index out of bounds")]
    OutOfBounds,
    #[error("Invalid transform matrix")]
    InvalidTransform,
    #[error("No data available")]
    NoData,
    #[error("Neuroim error: {0}")]
    NeuroImError(String),
}

impl From<neuroim::Error> for VolumeMathError {
    fn from(err: neuroim::Error) -> Self {
        VolumeMathError::NeuroImError(err.to_string())
    }
}

// Numeric type enum for TypeScript bindings
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../packages/api/src/generated/volmath.ts")]
pub enum NumericType {
    F32,
    I16,
    U8,
    I8,
    U16,
    I32,
    U32,
    F64,
}

impl NumericType {
    pub fn from_typeid<T: 'static>() -> Self {
        let type_id = TypeId::of::<T>();
        if type_id == TypeId::of::<f32>() {
            NumericType::F32
        } else if type_id == TypeId::of::<i16>() {
            NumericType::I16
        } else if type_id == TypeId::of::<u8>() {
            NumericType::U8
        } else if type_id == TypeId::of::<i8>() {
            NumericType::I8
        } else if type_id == TypeId::of::<u16>() {
            NumericType::U16
        } else if type_id == TypeId::of::<i32>() {
            NumericType::I32
        } else if type_id == TypeId::of::<u32>() {
            NumericType::U32
        } else if type_id == TypeId::of::<f64>() {
            NumericType::F64
        } else {
            panic!("Unsupported type for NumericType::from_typeid");
        }
    }
}

// Data range trait for compatibility - maintain as a trait like the original
pub trait DataRange<T> {
    fn min_value(&self) -> T;
    fn max_value(&self) -> T;
}

// Struct version for TypeScript exports
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../packages/api/src/generated/volmath.ts")]
pub struct DataRangeStruct<T> {
    pub min: T,
    pub max: T,
}

impl<T> DataRangeStruct<T> {
    pub fn new(min: T, max: T) -> Self {
        Self { min, max }
    }
}

// Implement the trait for volume types that need it
impl<T: Copy> DataRange<T> for DenseVolume3<T>
where
    T: neuroim::Numeric + PartialOrd + Serialize + PartialEq,
{
    fn min_value(&self) -> T {
        neuroim::NeuroVol::min(&self.inner).unwrap_or_else(|| T::zero())
    }

    fn max_value(&self) -> T {
        neuroim::NeuroVol::max(&self.inner).unwrap_or_else(|| T::zero())
    }
}

// Implement DataRange for individual numeric types (needed by smart_texture_manager tests)
impl DataRange<u8> for u8 {
    fn min_value(&self) -> u8 {
        *self
    }
    fn max_value(&self) -> u8 {
        *self
    }
}

impl DataRange<i8> for i8 {
    fn min_value(&self) -> i8 {
        *self
    }
    fn max_value(&self) -> i8 {
        *self
    }
}

impl DataRange<u16> for u16 {
    fn min_value(&self) -> u16 {
        *self
    }
    fn max_value(&self) -> u16 {
        *self
    }
}

impl DataRange<i16> for i16 {
    fn min_value(&self) -> i16 {
        *self
    }
    fn max_value(&self) -> i16 {
        *self
    }
}

impl DataRange<u32> for u32 {
    fn min_value(&self) -> u32 {
        *self
    }
    fn max_value(&self) -> u32 {
        *self
    }
}

impl DataRange<i32> for i32 {
    fn min_value(&self) -> i32 {
        *self
    }
    fn max_value(&self) -> i32 {
        *self
    }
}

impl DataRange<f32> for f32 {
    fn min_value(&self) -> f32 {
        *self
    }
    fn max_value(&self) -> f32 {
        *self
    }
}

impl DataRange<f64> for f64 {
    fn min_value(&self) -> f64 {
        *self
    }
    fn max_value(&self) -> f64 {
        *self
    }
}

// Point3D compatibility
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../packages/api/src/generated/volmath.ts")]
pub struct Point3D {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Point3D {
    pub fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }

    pub fn distance(&self, other: &Point3D) -> f64 {
        ((self.x - other.x).powi(2) + (self.y - other.y).powi(2) + (self.z - other.z).powi(2))
            .sqrt()
    }
}

// Axis compatibility - re-export neuroim types with legacy names
pub use neuroim::{AxisSet3D, NamedAxis};

// For backward compatibility, create AxisName enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AxisName {
    X,
    Y,
    Z,
    Time,
    Unknown,
}

// === VIEW FRAME COMPATIBILITY ===

// Re-export view frame types using neuroim equivalents where possible
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../packages/api/src/generated/volmath.ts")]
pub struct ViewFrame {
    pub viewport: Viewport,
    pub plane: Plane,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../packages/api/src/generated/volmath.ts")]
pub struct Viewport {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../packages/api/src/generated/volmath.ts")]
pub struct Plane {
    pub normal: [f64; 3],
    pub distance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../packages/api/src/generated/volmath.ts")]
pub struct VolumeMeta {
    pub dims: [usize; 3],
    pub spacing: [f64; 3],
    pub origin: [f64; 3],
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../packages/api/src/generated/volmath.ts")]
pub struct RenderLayer {
    pub id: String,
    pub opacity: f32,
    pub visible: bool,
}

// Compatibility functions
pub fn make_frame(viewport: Viewport, plane: Plane) -> ViewFrame {
    ViewFrame { viewport, plane }
}

pub fn screen_to_world(screen_coords: [f64; 2], _view_frame: &ViewFrame) -> [f64; 3] {
    // Placeholder implementation - in real version would use neuroim coordinate transforms
    [screen_coords[0], screen_coords[1], 0.0]
}

pub fn world_to_screen(world_coords: [f64; 3], _view_frame: &ViewFrame) -> [f64; 2] {
    // Placeholder implementation
    [world_coords[0], world_coords[1]]
}

pub fn calculate_field_of_view(_volume_meta: &VolumeMeta) -> f64 {
    // Placeholder implementation
    45.0
}

// Simple example function for testing
pub fn add(left: u64, right: u64) -> u64 {
    left + right
}

// === EXTENSION TRAITS ===

// Extension trait to bridge DenseNeuroVol to legacy interface
pub trait DenseVolumeExt<T> {
    fn from_data(space: NeuroSpace, data: Vec<T>) -> Self;
    fn space(&self) -> &NeuroSpace;
    fn data(&self) -> Vec<T>;
    fn range(&self) -> Option<(T, T)>;
}

impl<T: neuroim::Numeric + Serialize + PartialEq> DenseVolumeExt<T> for DenseVolume3<T> {
    fn from_data(space: NeuroSpace, data: Vec<T>) -> Self {
        Self::from_data(space, data)
    }

    fn space(&self) -> &NeuroSpace {
        self.space()
    }

    fn data(&self) -> Vec<T> {
        self.values()
    }

    fn range(&self) -> Option<(T, T)> {
        self.range()
    }
}

// Enhanced compatibility wrapper for render_loop integration
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CompatibleVolume<T: neuroim::Numeric>
where
    T: Serialize + PartialEq,
{
    pub space: NeuroSpaceWrapper,
    inner: neuroim::DenseNeuroVol<T>,
}

impl<T: neuroim::Numeric + Serialize + PartialEq> CompatibleVolume<T> {
    pub fn new(volume: neuroim::DenseNeuroVol<T>) -> Self {
        let space = NeuroSpaceWrapper::new(volume.space().clone());
        Self {
            space,
            inner: volume,
        }
    }

    pub fn range(&self) -> Option<(T, T)> {
        let min = neuroim::NeuroVol::min(&self.inner)?;
        let max = neuroim::NeuroVol::max(&self.inner)?;
        Some((min, max))
    }

    pub fn data_slice(&self, axis: usize, index: usize) -> Vec<T> {
        // Extract slice along the specified axis at the given index
        let dims = &self.inner.space().dim;
        if axis >= 3 || index >= dims[axis] {
            return Vec::new(); // Return empty vec on error for now
        }

        // Use neuroim's underlying array access
        let array = &self.inner.data;
        match axis {
            0 => {
                // Sagittal slice (YZ plane)
                let slice = array.index_axis(ndarray::Axis(0), index);
                slice.iter().cloned().collect()
            }
            1 => {
                // Coronal slice (XZ plane)
                let slice = array.index_axis(ndarray::Axis(1), index);
                slice.iter().cloned().collect()
            }
            2 => {
                // Axial slice (XY plane)
                let slice = array.index_axis(ndarray::Axis(2), index);
                slice.iter().cloned().collect()
            }
            _ => Vec::new(),
        }
    }

    pub fn voxel_type(&self) -> NumericType {
        NumericType::from_typeid::<T>()
    }

    pub fn from_data(space: NeuroSpace, data: Vec<T>) -> Self {
        // Convert Vec to Array3 with proper shape - use Fortran order to match neuroim
        let dims = space.dim.clone();

        use ndarray::ShapeBuilder;
        let array = ndarray::Array3::from_shape_vec((dims[0], dims[1], dims[2]).f(), data)
            .expect("Data shape mismatch");

        let volume =
            neuroim::DenseNeuroVol::new(array, space).expect("Failed to create DenseNeuroVol");

        Self::new(volume)
    }

    pub fn from_affine_matrix4(
        space: NeuroSpace,
        data: Vec<T>,
        _transform: nalgebra::Matrix4<f32>,
    ) -> Self {
        // For now, delegate to from_data - the transform is typically handled by the space
        Self::from_data(space, data)
    }

    // Provide access to the inner volume for compatibility
    pub fn inner(&self) -> &neuroim::DenseNeuroVol<T> {
        &self.inner
    }

    // Delegate common NeuroVol methods
    pub fn space(&self) -> &NeuroSpace {
        self.inner.space()
    }

    pub fn values(&self) -> Vec<T> {
        neuroim::NeuroVol::values(&self.inner)
    }

    // Additional methods expected by render_loop
    pub fn get_slice_as_f16_bytes(
        &self,
        axis: usize,
        index: usize,
    ) -> std::result::Result<Vec<u8>, VolumeMathError> {
        // Get slice data and convert to f16 bytes
        let slice_data = self.data_slice(axis, index);
        let mut bytes = Vec::with_capacity(slice_data.len() * 2);

        for value in slice_data {
            // Convert to f32 first, then to f16, then to bytes
            let f32_val = value.to_f32().unwrap_or(0.0);
            let f16_val = half::f16::from_f32(f32_val);
            bytes.extend_from_slice(&f16_val.to_ne_bytes());
        }

        Ok(bytes)
    }

    pub fn to_f16_bytes(&self) -> Vec<u8> {
        let data = self.values();
        let mut bytes = Vec::with_capacity(data.len() * 2);

        for value in data {
            let f32_val = value.to_f32().unwrap_or(0.0);
            let f16_val = half::f16::from_f32(f32_val);
            bytes.extend_from_slice(&f16_val.to_ne_bytes());
        }

        bytes
    }

    pub fn get_at_coords(&self, coords: &[usize]) -> Option<T> {
        // Get value at the given coordinates [x, y, z]
        if coords.len() != 3 {
            return None;
        }

        let dims = &self.inner.space().dim;
        if coords[0] >= dims[0] || coords[1] >= dims[1] || coords[2] >= dims[2] {
            return None;
        }

        // Use the neuroim API directly which handles the correct memory layout
        self.inner.get_at(coords[0], coords[1], coords[2])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_works() {
        let result = add(2, 2);
        assert_eq!(result, 4);
    }

    #[test]
    fn test_point_distance() {
        let p1 = Point3D::new(0.0, 0.0, 0.0);
        let p2 = Point3D::new(1.0, 1.0, 1.0);
        assert_eq!(p1.distance(&p2), 3.0_f64.sqrt());
    }

    #[test]
    fn test_neuroim_integration() {
        // Test that we can create a NeuroSpace using neuroim
        let space = NeuroSpace::new(
            vec![10, 10, 10],
            Some(vec![1.0, 1.0, 1.0]),
            None,
            None,
            None,
        )
        .expect("Failed to create NeuroSpace");

        assert_eq!(space.dim, vec![10, 10, 10]);
    }
}

// WASM tests remain for compatibility
#[cfg(test)]
mod wasm_tests {
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn pass() {
        assert_eq!(1 + 1, 2);
    }

    #[wasm_bindgen_test]
    fn setup_panic_hook() {
        console_error_panic_hook::set_once();
        assert!(true);
    }
}
