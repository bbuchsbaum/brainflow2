// crates/volmath/src/space.rs

/*
Coordinate Systems Reference:
- Index (usize): Linear offset into the flattened voxel data array (C-order).
- Grid Coordinates ([f32; N]): Position within the N-dimensional voxel grid, potentially fractional (e.g., for interpolation). Corresponds to (i, j, k, ...) indices but as floats.
- World Coordinates / Coord ([f32; N]): Position in the physical space defined by the affine transformation, always in LPI orientation in millimeters.

LPI (Left-Posterior-Inferior) Convention:
- World coordinates are ALWAYS in LPI orientation regardless of disk orientation
- The affine transformation handles conversion from any disk orientation (RPI, ASI, etc.) to LPI
- This ensures consistent display and overlay of volumes with different native orientations
*/

use nalgebra::{
    allocator::Allocator, Const, DefaultAllocator, DimName, Matrix4, SMatrix, SVector, // Keep Matrix4 for 3D homogeneous cache
};
use serde::{Serialize, Deserialize};
use ts_rs::TS;
// Removed unused once_cell import
// Removed unused num_traits imports (casting handled differently)
use std::fmt::Debug;
use std::convert::TryInto;

// 1. Define NeuroSpaceImpl<N>
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NeuroSpaceImpl<const N: usize> {
    pub dim: SVector<usize, N>,
    pub spacing: SVector<f32, N>,
    pub origin: SVector<f32, N>,
    affine_linear: SMatrix<f32, N, N>,
    affine_offset: SVector<f32, N>,
    inverse_affine_linear: SMatrix<f32, N, N>,
    affine_homogeneous_3d: Option<Matrix4<f32>>,
    inverse_affine_homogeneous_3d: Option<Matrix4<f32>>,
}

// 2. Define GridSpace trait
pub trait GridSpace<const N: usize>
where
    Const<N>: DimName,
    DefaultAllocator: Allocator<usize, Const<N>>,
    DefaultAllocator: Allocator<f32, Const<N>> + Allocator<f32, Const<N>, Const<N>>,
{
    fn grid_to_coord(&self, ijk: &[f32; N]) -> [f32; N];
    fn coord_to_grid(&self, xyz: &[f32; N]) -> [f32; N];
    fn grid_coords_to_index_unchecked(&self, idx: &[usize; N]) -> usize;
    fn voxel_count(&self) -> usize;
    fn dims(&self) -> &[usize];
    fn spacing(&self) -> &[f32];
    fn origin(&self) -> &[f32];
    fn index_to_grid_coords(&self, index: usize) -> Option<[usize; N]>;
    fn grid_coords_to_index(&self, grid_coords: &[usize; N]) -> Option<usize>;
    fn index_to_coord(&self, index: usize) -> Option<[f32; N]>;
    fn coord_to_index(&self, world_coords: &[f32; N]) -> Option<usize>;
}

// Add method to get affine transforms for 3D spaces
impl NeuroSpaceImpl<3> {
    /// Get the world-to-voxel transform (inverse of voxel-to-world)
    pub fn world_to_voxel(&self) -> Matrix4<f32> {
        self.inverse_affine_homogeneous_3d.unwrap_or_else(Matrix4::identity)
    }
    
    /// Get the voxel-to-world transform
    pub fn voxel_to_world(&self) -> Matrix4<f32> {
        self.affine_homogeneous_3d.unwrap_or_else(Matrix4::identity)
    }
}

// 3. Implement GridSpace for NeuroSpaceImpl<N> (N=2, 3, 4)
impl GridSpace<2> for NeuroSpaceImpl<2> {
    #[inline]
    fn grid_to_coord(&self, ijk: &[f32; 2]) -> [f32; 2] {
        let grid_vec = SVector::<f32, 2>::from_column_slice(ijk);
        let world_vec = self.affine_linear * grid_vec + self.affine_offset;
        world_vec.as_slice().try_into().unwrap()
    }
    #[inline]
    fn coord_to_grid(&self, xyz: &[f32; 2]) -> [f32; 2] {
        let world_vec = SVector::<f32, 2>::from_column_slice(xyz);
        let grid_vec = self.inverse_affine_linear * (world_vec - self.affine_offset);
        grid_vec.as_slice().try_into().unwrap()
    }
    #[inline(always)]
    fn grid_coords_to_index_unchecked(&self, idx: &[usize; 2]) -> usize {
        debug_assert!(idx.iter().zip(self.dims().iter()).all(|(&i, &d)| i < d), "Out of bounds");
        let mut linear_index = 0usize;
        let mut stride = 1usize;
        for i in 0..2 {
            linear_index += idx[i] * stride;
            stride *= self.dim[i];
        }
        linear_index
    }
    #[inline] fn voxel_count(&self) -> usize { self.dim.iter().product() }
    #[inline] fn dims(&self) -> &[usize] { self.dim.as_slice() }
    #[inline] fn spacing(&self) -> &[f32] { self.spacing.as_slice() }
    #[inline] fn origin(&self) -> &[f32] { self.origin.as_slice() }
    fn index_to_grid_coords(&self, index: usize) -> Option<[usize; 2]> {
        if index >= self.voxel_count() { return None; }
        let mut grid_coords = [0usize; 2];
        let mut current_index = index;
        let dims = self.dims();
        let mut stride = self.voxel_count();
        for i in (0..2).rev() {
            if dims[i] == 0 { return None; } stride /= dims[i];
            grid_coords[i] = current_index / stride;
            current_index %= stride;
        }
        Some(grid_coords)
    }
    fn grid_coords_to_index(&self, grid_coords: &[usize; 2]) -> Option<usize> {
        let dims = self.dims();
        if grid_coords.iter().zip(dims.iter()).any(|(&gc, &d)| gc >= d) { return None; }
        Some(self.grid_coords_to_index_unchecked(grid_coords))
    }
    fn index_to_coord(&self, index: usize) -> Option<[f32; 2]> {
        self.index_to_grid_coords(index).map(|grid_usize| {
            let mut grid_f32 = [0.0f32; 2];
            for i in 0..2 { grid_f32[i] = grid_usize[i] as f32; }
            self.grid_to_coord(&grid_f32)
        })
    }
    fn coord_to_index(&self, world_coords: &[f32; 2]) -> Option<usize> {
        let grid_f32 = self.coord_to_grid(world_coords);
        let mut grid_usize = [0usize; 2];
        let dims = self.dims();
        for i in 0..2 {
            let coord_usize = grid_f32[i].floor() as isize;
            if coord_usize < 0 || coord_usize >= (dims[i] as isize) { return None; }
            grid_usize[i] = coord_usize as usize;
        }
        self.grid_coords_to_index(&grid_usize)
    }
}

impl GridSpace<3> for NeuroSpaceImpl<3> {
    /// Transforms grid coordinates to world coordinates in LPI orientation.
    /// Grid coords are in voxel space [0, dim-1], world coords are in mm.
    /// 
    /// LPI (Left-Posterior-Inferior) orientation:
    /// - X axis: Right (-) to Left (+)
    /// - Y axis: Anterior (-) to Posterior (+)
    /// - Z axis: Inferior (-) to Superior (+)
    #[inline]
    fn grid_to_coord(&self, ijk: &[f32; 3]) -> [f32; 3] {
        let grid_vec = SVector::<f32, 3>::from_column_slice(ijk);
        let world_vec = self.affine_linear * grid_vec + self.affine_offset;
        world_vec.as_slice().try_into().unwrap()
    }
    /// Transforms world coordinates (LPI mm) to grid coordinates (voxel indices).
    /// Inverse of grid_to_coord. Handles any disk orientation by using the
    /// inverse affine transformation.
    #[inline]
    fn coord_to_grid(&self, xyz: &[f32; 3]) -> [f32; 3] {
        let world_vec = SVector::<f32, 3>::from_column_slice(xyz);
        let grid_vec = self.inverse_affine_linear * (world_vec - self.affine_offset);
        grid_vec.as_slice().try_into().unwrap()
    }
    #[inline(always)]
    fn grid_coords_to_index_unchecked(&self, idx: &[usize; 3]) -> usize {
        debug_assert!(idx.iter().zip(self.dims().iter()).all(|(&i, &d)| i < d), "Out of bounds");
        // Row-major (C-order) indexing to match how NIfTI data is loaded
        // index = z * (dim_x * dim_y) + y * dim_x + x
        idx[2] * (self.dim[0] * self.dim[1]) + idx[1] * self.dim[0] + idx[0]
    }
    #[inline] fn voxel_count(&self) -> usize { self.dim.iter().product() }
    #[inline] fn dims(&self) -> &[usize] { self.dim.as_slice() }
    #[inline] fn spacing(&self) -> &[f32] { self.spacing.as_slice() }
    #[inline] fn origin(&self) -> &[f32] { self.origin.as_slice() }
    fn index_to_grid_coords(&self, index: usize) -> Option<[usize; 3]> {
        if index >= self.voxel_count() { return None; }
        let dims = self.dims();
        if dims[0] == 0 || dims[1] == 0 || dims[2] == 0 { return None; }
        
        // Row-major (C-order) indexing
        // index = z * (dim_x * dim_y) + y * dim_x + x
        let z = index / (dims[0] * dims[1]);
        let remainder = index % (dims[0] * dims[1]);
        let y = remainder / dims[0];
        let x = remainder % dims[0];
        
        Some([x, y, z])
    }
    fn grid_coords_to_index(&self, grid_coords: &[usize; 3]) -> Option<usize> {
        let dims = self.dims();
        if grid_coords.iter().zip(dims.iter()).any(|(&gc, &d)| gc >= d) { return None; }
        Some(self.grid_coords_to_index_unchecked(grid_coords))
    }
    fn index_to_coord(&self, index: usize) -> Option<[f32; 3]> {
        self.index_to_grid_coords(index).map(|grid_usize| {
            let mut grid_f32 = [0.0f32; 3];
            for i in 0..3 { grid_f32[i] = grid_usize[i] as f32; }
            self.grid_to_coord(&grid_f32)
        })
    }
    fn coord_to_index(&self, world_coords: &[f32; 3]) -> Option<usize> {
        let grid_f32 = self.coord_to_grid(world_coords);
        let mut grid_usize = [0usize; 3];
        let dims = self.dims();
        for i in 0..3 {
            let coord_usize = grid_f32[i].floor() as isize;
            if coord_usize < 0 || coord_usize >= (dims[i] as isize) { return None; }
            grid_usize[i] = coord_usize as usize;
        }
        self.grid_coords_to_index(&grid_usize)
    }
}

impl GridSpace<4> for NeuroSpaceImpl<4> {
    #[inline]
    fn grid_to_coord(&self, ijk: &[f32; 4]) -> [f32; 4] {
        let grid_vec3 = SVector::<f32, 3>::from_column_slice(&ijk[0..3]);
        let affine_linear3 = self.affine_linear.fixed_view::<3, 3>(0, 0);
        let affine_offset3 = self.affine_offset.fixed_view::<3, 1>(0, 0);
        let world_vec3 = affine_linear3 * grid_vec3 + affine_offset3;
        let world_t = ijk[3] * self.spacing[3] + self.origin[3];
        [world_vec3[0], world_vec3[1], world_vec3[2], world_t]
    }
    #[inline]
    fn coord_to_grid(&self, xyz: &[f32; 4]) -> [f32; 4] {
        let world_vec3 = SVector::<f32, 3>::from_column_slice(&xyz[0..3]);
        let affine_offset3 = self.affine_offset.fixed_view::<3, 1>(0, 0);
        let inverse_affine_linear3 = self.inverse_affine_linear.fixed_view::<3, 3>(0, 0);
        let grid_vec3 = inverse_affine_linear3 * (world_vec3 - affine_offset3);
        let grid_t = if self.spacing[3].abs() > 1e-9 { (xyz[3] - self.origin[3]) / self.spacing[3] } else { 0.0 };
        [grid_vec3[0], grid_vec3[1], grid_vec3[2], grid_t]
    }
    #[inline(always)]
    fn grid_coords_to_index_unchecked(&self, idx: &[usize; 4]) -> usize {
        debug_assert!(idx.iter().zip(self.dims().iter()).all(|(&i, &d)| i < d), "Out of bounds");
        let mut linear_index = 0usize;
        let mut stride = 1usize;
        for i in 0..4 {
            linear_index += idx[i] * stride;
            stride *= self.dim[i];
        }
        linear_index
    }
    #[inline] fn voxel_count(&self) -> usize { self.dim.iter().product() }
    #[inline] fn dims(&self) -> &[usize] { self.dim.as_slice() }
    #[inline] fn spacing(&self) -> &[f32] { self.spacing.as_slice() }
    #[inline] fn origin(&self) -> &[f32] { self.origin.as_slice() }
    fn index_to_grid_coords(&self, index: usize) -> Option<[usize; 4]> {
        if index >= self.voxel_count() { return None; }
        let mut grid_coords = [0usize; 4];
        let mut current_index = index;
        let dims = self.dims();
        let mut stride = self.voxel_count();
        for i in (0..4).rev() {
            if dims[i] == 0 { return None; } stride /= dims[i];
            grid_coords[i] = current_index / stride;
            current_index %= stride;
        }
        Some(grid_coords)
    }
    fn grid_coords_to_index(&self, grid_coords: &[usize; 4]) -> Option<usize> {
        let dims = self.dims();
        if grid_coords.iter().zip(dims.iter()).any(|(&gc, &d)| gc >= d) { return None; }
        Some(self.grid_coords_to_index_unchecked(grid_coords))
    }
    fn index_to_coord(&self, index: usize) -> Option<[f32; 4]> {
        self.index_to_grid_coords(index).map(|grid_usize| {
            let mut grid_f32 = [0.0f32; 4];
            for i in 0..4 { grid_f32[i] = grid_usize[i] as f32; }
            self.grid_to_coord(&grid_f32)
        })
    }
    fn coord_to_index(&self, world_coords: &[f32; 4]) -> Option<usize> {
        let grid_f32 = self.coord_to_grid(world_coords);
        let mut grid_usize = [0usize; 4];
        let dims = self.dims();
        for i in 0..4 {
            let coord_usize = grid_f32[i].floor() as isize;
            if coord_usize < 0 || coord_usize >= (dims[i] as isize) { return None; }
            grid_usize[i] = coord_usize as usize;
        }
        self.grid_coords_to_index(&grid_usize)
    }
}

// 4. Define the newtype wrappers
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NeuroSpace2(pub NeuroSpaceImpl<2>);
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NeuroSpace3(pub NeuroSpaceImpl<3>);
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NeuroSpace4(pub NeuroSpaceImpl<4>);

// 5. Implement GridSpace for Newtype Wrappers via Delegation
impl GridSpace<2> for NeuroSpace2 {
    fn grid_to_coord(&self, ijk: &[f32; 2]) -> [f32; 2] { self.0.grid_to_coord(ijk) }
    fn coord_to_grid(&self, xyz: &[f32; 2]) -> [f32; 2] { self.0.coord_to_grid(xyz) }
    fn grid_coords_to_index_unchecked(&self, idx: &[usize; 2]) -> usize { self.0.grid_coords_to_index_unchecked(idx) }
    fn voxel_count(&self) -> usize { self.0.voxel_count() }
    fn dims(&self) -> &[usize] { self.0.dims() }
    fn spacing(&self) -> &[f32] { self.0.spacing() }
    fn origin(&self) -> &[f32] { self.0.origin() }
    fn index_to_grid_coords(&self, index: usize) -> Option<[usize; 2]> { self.0.index_to_grid_coords(index) }
    fn grid_coords_to_index(&self, grid_coords: &[usize; 2]) -> Option<usize> { self.0.grid_coords_to_index(grid_coords) }
    fn index_to_coord(&self, index: usize) -> Option<[f32; 2]> { self.0.index_to_coord(index) }
    fn coord_to_index(&self, world_coords: &[f32; 2]) -> Option<usize> { self.0.coord_to_index(world_coords) }
}

impl GridSpace<3> for NeuroSpace3 {
    fn grid_to_coord(&self, ijk: &[f32; 3]) -> [f32; 3] { self.0.grid_to_coord(ijk) }
    fn coord_to_grid(&self, xyz: &[f32; 3]) -> [f32; 3] { self.0.coord_to_grid(xyz) }
    fn grid_coords_to_index_unchecked(&self, idx: &[usize; 3]) -> usize { self.0.grid_coords_to_index_unchecked(idx) }
    fn voxel_count(&self) -> usize { self.0.voxel_count() }
    fn dims(&self) -> &[usize] { self.0.dims() }
    fn spacing(&self) -> &[f32] { self.0.spacing() }
    fn origin(&self) -> &[f32] { self.0.origin() }
    fn index_to_grid_coords(&self, index: usize) -> Option<[usize; 3]> { self.0.index_to_grid_coords(index) }
    fn grid_coords_to_index(&self, grid_coords: &[usize; 3]) -> Option<usize> { self.0.grid_coords_to_index(grid_coords) }
    fn index_to_coord(&self, index: usize) -> Option<[f32; 3]> { self.0.index_to_coord(index) }
    fn coord_to_index(&self, world_coords: &[f32; 3]) -> Option<usize> { self.0.coord_to_index(world_coords) }
}

impl GridSpace<4> for NeuroSpace4 {
    fn grid_to_coord(&self, ijk: &[f32; 4]) -> [f32; 4] { self.0.grid_to_coord(ijk) }
    fn coord_to_grid(&self, xyz: &[f32; 4]) -> [f32; 4] { self.0.coord_to_grid(xyz) }
    fn grid_coords_to_index_unchecked(&self, idx: &[usize; 4]) -> usize { self.0.grid_coords_to_index_unchecked(idx) }
    fn voxel_count(&self) -> usize { self.0.voxel_count() }
    fn dims(&self) -> &[usize] { self.0.dims() }
    fn spacing(&self) -> &[f32] { self.0.spacing() }
    fn origin(&self) -> &[f32] { self.0.origin() }
    fn index_to_grid_coords(&self, index: usize) -> Option<[usize; 4]> { self.0.index_to_grid_coords(index) }
    fn grid_coords_to_index(&self, grid_coords: &[usize; 4]) -> Option<usize> { self.0.grid_coords_to_index(grid_coords) }
    fn index_to_coord(&self, index: usize) -> Option<[f32; 4]> { self.0.index_to_coord(index) }
    fn coord_to_index(&self, world_coords: &[f32; 4]) -> Option<usize> { self.0.coord_to_index(world_coords) }
}

// 6. Define TS export structs and From impls
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../packages/api/src/generated/space.ts")]
pub struct NeuroSpace2D {
    #[ts(type = "[number, number]")] pub dim: [usize; 2],
    #[ts(type = "[number, number]")] pub spacing: [f32; 2],
    #[ts(type = "[number, number]")] pub origin: [f32; 2],
    // No affine exposed directly in TS for 2D Phase 1
}
impl From<&NeuroSpaceImpl<2>> for NeuroSpace2D {
    fn from(ns: &NeuroSpaceImpl<2>) -> Self {
        Self {
            dim: ns.dim.as_slice().try_into().unwrap(),
            spacing: ns.spacing.as_slice().try_into().unwrap(),
            origin: ns.origin.as_slice().try_into().unwrap(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../packages/api/src/generated/space.ts")]
pub struct NeuroSpace3D {
    #[ts(type = "[number, number, number]")] pub dim: [usize; 3],
    #[ts(type = "[number, number, number]")] pub spacing: [f32; 3],
    #[ts(type = "[number, number, number]")] pub origin: [f32; 3],
    /// Affine elements ROW-MAJOR [16]. /// NOTE: Transposed from internal column-major storage.
    #[ts(type = "[number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]")] pub affine_row_major: [f32; 16],
}
impl From<&NeuroSpaceImpl<3>> for NeuroSpace3D {
    fn from(ns: &NeuroSpaceImpl<3>) -> Self {
        Self {
            dim: ns.dim.as_slice().try_into().unwrap(),
            spacing: ns.spacing.as_slice().try_into().unwrap(),
            origin: ns.origin.as_slice().try_into().unwrap(),
            affine_row_major: ns.affine_elements_row_major(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../packages/api/src/generated/space.ts")]
pub struct NeuroSpace4D {
    #[ts(type = "[number, number, number, number]")] pub dim: [usize; 4],
    #[ts(type = "[number, number, number, number]")] pub spacing: [f32; 4],
    #[ts(type = "[number, number, number, number]")] pub origin: [f32; 4],
    // No affine exposed directly in TS for 4D Phase 1
}
impl From<&NeuroSpaceImpl<4>> for NeuroSpace4D {
    fn from(ns: &NeuroSpaceImpl<4>) -> Self {
        Self {
            dim: ns.dim.as_slice().try_into().unwrap(),
            spacing: ns.spacing.as_slice().try_into().unwrap(),
            origin: ns.origin.as_slice().try_into().unwrap(),
        }
    }
}

// 7. Define inherent methods for NeuroSpaceImpl<N> (constructors etc.)
impl NeuroSpaceImpl<2> {
    pub fn from_components(dim_arr: [usize; 2], affine_linear: SMatrix<f32, 2, 2>, affine_offset: SVector<f32, 2>) -> Self {
        assert!(dim_arr.iter().all(|&d| d > 0), "Dimensions must be positive");
        let inverse_affine_linear = affine_linear.try_inverse().expect("Affine linear part must be invertible");
        let dim_vec = SVector::<usize, 2>::from_fn(|i, _| dim_arr[i]);
        let origin_vec = affine_offset;
        let spacing_vec: SVector<f32, 2> = SVector::from_fn(|r, _| affine_linear.column(r).norm());
        assert!(spacing_vec.iter().all(|&s| s > 1e-9), "Derived spacing must be positive");
        Self {
            dim: dim_vec, spacing: spacing_vec, origin: origin_vec, affine_linear,
            affine_offset, inverse_affine_linear, affine_homogeneous_3d: None,
            inverse_affine_homogeneous_3d: None,
        }
    }
    pub fn from_dims_spacing_origin(dim: [usize; 2], spacing: [f32; 2], origin: [f32; 2]) -> Self {
        let scale_mat = SMatrix::<f32, 2, 2>::from_fn(|i, j| if i == j { spacing[i] } else { 0.0 });
        let translation_vec = SVector::<f32, 2>::from_fn(|i, _| origin[i]);
        Self::from_components(dim, scale_mat, translation_vec)
    }
}

impl NeuroSpaceImpl<3> {
    /// Creates a NeuroSpace from affine components.
    /// The affine transformation should map voxel indices to LPI world coordinates.
    /// For non-LPI disk orientations, the affine must include the necessary
    /// transformations to convert to LPI display coordinates.
    pub fn from_components(dim_arr: [usize; 3], affine_linear: SMatrix<f32, 3, 3>, affine_offset: SVector<f32, 3>) -> Self {
        assert!(dim_arr.iter().all(|&d| d > 0), "Dimensions must be positive");
        let inverse_affine_linear = affine_linear.try_inverse().expect("Affine linear part must be invertible");
        let dim_vec = SVector::<usize, 3>::from_fn(|i, _| dim_arr[i]);
        let origin_vec = affine_offset;
        let spacing_vec: SVector<f32, 3> = SVector::from_fn(|r, _| affine_linear.column(r).norm());
        assert!(spacing_vec.iter().all(|&s| s > 1e-9), "Derived spacing must be positive");
        let mut affine_h = Matrix4::<f32>::identity();
        affine_h.fixed_view_mut::<3, 3>(0, 0).copy_from(&affine_linear);
        affine_h.fixed_view_mut::<3, 1>(0, 3).copy_from(&affine_offset);
        let inv_affine_h = affine_h.try_inverse().expect("Homogeneous affine must be invertible");
        Self {
            dim: dim_vec, spacing: spacing_vec, origin: origin_vec, affine_linear,
            affine_offset, inverse_affine_linear, affine_homogeneous_3d: Some(affine_h),
            inverse_affine_homogeneous_3d: Some(inv_affine_h),
        }
    }
    /// Creates a NeuroSpace from a 4x4 affine matrix (as used in NIfTI format).
    /// The affine should transform voxel indices to LPI world coordinates in mm.
    pub fn from_affine_matrix4(dim: [usize; 3], affine_mat4: Matrix4<f32>) -> NeuroSpaceImpl<3> {
        let linear_part = affine_mat4.fixed_view::<3, 3>(0, 0).into_owned();
        let offset_part = affine_mat4.fixed_view::<3, 1>(0, 3).into_owned();
        Self::from_components(dim, linear_part, offset_part)
    }
    pub fn from_dims_spacing_origin(dim: [usize; 3], spacing: [f32; 3], origin: [f32; 3]) -> Self {
        let scale_mat = SMatrix::<f32, 3, 3>::from_fn(|i, j| if i == j { spacing[i] } else { 0.0 });
        let translation_vec = SVector::<f32, 3>::from_fn(|i, _| origin[i]);
        Self::from_components(dim, scale_mat, translation_vec)
    }
}

impl NeuroSpaceImpl<4> {
    pub fn from_components(dim_arr: [usize; 4], affine_linear: SMatrix<f32, 4, 4>, affine_offset: SVector<f32, 4>) -> Self {
        assert!(dim_arr.iter().all(|&d| d > 0), "Dimensions must be positive");
        let inverse_affine_linear = affine_linear.try_inverse().expect("Affine linear part must be invertible");
        let dim_vec = SVector::<usize, 4>::from_fn(|i, _| dim_arr[i]);
        let origin_vec = affine_offset;
        let spacing_vec: SVector<f32, 4> = SVector::from_fn(|r, _| affine_linear.column(r).norm());
        assert!(spacing_vec.iter().all(|&s| s > 1e-9), "Derived spacing must be positive");
        Self {
            dim: dim_vec, spacing: spacing_vec, origin: origin_vec, affine_linear,
            affine_offset, inverse_affine_linear, affine_homogeneous_3d: None,
            inverse_affine_homogeneous_3d: None,
        }
    }
    pub fn from_dims_spacing_origin(dim: [usize; 4], spacing: [f32; 4], origin: [f32; 4]) -> Self {
        let scale_mat = SMatrix::<f32, 4, 4>::from_fn(|i, j| if i == j { spacing[i] } else { 0.0 });
        let translation_vec = SVector::<f32, 4>::from_fn(|i, _| origin[i]);
        Self::from_components(dim, scale_mat, translation_vec)
    }
}

// --- 3D Specific Trait & Implementation ---
pub trait NeuroSpaceSpatialOps: GridSpace<3> {
    fn affine_elements_row_major(&self) -> [f32; 16];
}

impl NeuroSpaceSpatialOps for NeuroSpaceImpl<3> {
    #[inline]
    fn affine_elements_row_major(&self) -> [f32; 16] {
        let mat = self.affine_homogeneous_3d.expect("3D homogeneous matrix should exist");
        let transposed = mat.transpose();
        transposed.as_slice().try_into().unwrap()
    }
}

// Unit Tests
#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;
    use nalgebra::{SMatrix, SVector}; // Remove Matrix4 from imports

    #[test]
    fn test_from_components_and_coord_transforms() {
        let dim = [10usize, 20, 30];
        let linear = SMatrix::<f32, 3, 3>::new(2.0, 0.0, 0.0, 0.0, 1.5, 0.0, 0.0, 0.0, 1.0);
        let offset = SVector::<f32, 3>::new(10.0, -5.0, 0.0);
        let space = NeuroSpaceImpl::<3>::from_components(dim, linear, offset);

        assert_eq!(space.dims(), &dim); // Compare slices
        assert_relative_eq!(space.spacing()[0], 2.0);
        assert_relative_eq!(space.origin()[0], 10.0);

        let world_123 = space.grid_to_coord(&[1.0, 2.0, 3.0]);
        assert_relative_eq!(world_123[0], 12.0);
        assert_relative_eq!(world_123[1], -2.0);
        assert_relative_eq!(world_123[2], 3.0);

        let grid_back = space.coord_to_grid(&[12.0, -2.0, 3.0]);
        assert_relative_eq!(grid_back[0], 1.0);
        assert_relative_eq!(grid_back[1], 2.0);
        assert_relative_eq!(grid_back[2], 3.0);
    }

    #[test]
    fn test_affine_elements_row_major_impl() {
         let space = NeuroSpaceImpl::<3>::from_dims_spacing_origin([1,1,1],[2.0,3.0,4.0],[10.0,20.0,30.0]);
         // Use the trait method directly on NeuroSpace<3>
         let row_major_elements = space.affine_elements_row_major();
         let expected = [
             2.0, 0.0, 0.0, 10.0,
             0.0, 3.0, 0.0, 20.0,
             0.0, 0.0, 4.0, 30.0,
             0.0, 0.0, 0.0, 1.0,
         ];
         assert_eq!(row_major_elements, expected);
     }

    #[test]
    fn test_coord_conversions() {
        let dim = [10usize, 20, 30];
        let spacing = [2.0, 1.5, 1.0];
        let origin = [10.0, -5.0, 0.0];
        let space = NeuroSpaceImpl::<3>::from_dims_spacing_origin(dim, spacing, origin);
        let voxel_count = 10 * 20 * 30;

        // Test index <-> grid_coords
        let index1 = 0;
        let grid1 = [0, 0, 0];
        assert_eq!(space.index_to_grid_coords(index1), Some(grid1));
        assert_eq!(space.grid_coords_to_index(&grid1), Some(index1));

        let index2 = 10 * 20 * 5 + 10 * 3 + 2; // Corresponds to grid [2, 3, 5]
        let grid2 = [2, 3, 5];
        assert_eq!(space.index_to_grid_coords(index2), Some(grid2));
        assert_eq!(space.grid_coords_to_index(&grid2), Some(index2));

        let last_index = voxel_count - 1;
        let last_grid = [9, 19, 29];
        assert_eq!(space.index_to_grid_coords(last_index), Some(last_grid));
        assert_eq!(space.grid_coords_to_index(&last_grid), Some(last_index));

        // Test out of bounds
        assert_eq!(space.index_to_grid_coords(voxel_count), None);
        assert_eq!(space.grid_coords_to_index(&[10, 0, 0]), None);
        assert_eq!(space.grid_coords_to_index(&[0, 20, 0]), None);
        assert_eq!(space.grid_coords_to_index(&[0, 0, 30]), None);

        // Test index <-> coord (using grid1 and grid2)
        let coord1 = space.grid_to_coord(&[0.0, 0.0, 0.0]); // Corner of first voxel
        assert_eq!(space.index_to_coord(index1), Some(coord1));
        // Coordinate exactly at corner should map to this index
        assert_eq!(space.coord_to_index(&coord1), Some(index1));

        let coord2_corner = space.grid_to_coord(&[2.0, 3.0, 5.0]);
        assert_eq!(space.index_to_coord(index2), Some(coord2_corner));

        // Test coord slightly inside voxel 2 should map to index2
        let coord2_inside = space.grid_to_coord(&[2.1, 3.7, 5.9]);
        assert_eq!(space.coord_to_index(&coord2_inside), Some(index2));

        // Test coord mapping outside
        let coord_outside = space.grid_to_coord(&[-0.1, 0.0, 0.0]);
        assert_eq!(space.coord_to_index(&coord_outside), None);
        let coord_far_outside = space.grid_to_coord(&[100.0, 100.0, 100.0]);
        assert_eq!(space.coord_to_index(&coord_far_outside), None);
    }

    #[test]
    fn test_3d_coordinate_transforms() {
        // Create a 3D space with dimensions 4x4x4, spacing 2.0x2.0x2.0, and origin at [10.0, 20.0, 30.0]
        let dim = [4, 4, 4];
        let spacing = [2.0, 2.0, 2.0];
        let origin = [10.0, 20.0, 30.0];
        let space = NeuroSpaceImpl::<3>::from_dims_spacing_origin(dim, spacing, origin);
        
        // PART 1: Test index <-> grid coordinate transformations
        let grid_coords_to_test = [1, 2, 3];
        let index = space.grid_coords_to_index(&grid_coords_to_test).unwrap();
        
        // Verify index calculation
        let expected_index = grid_coords_to_test[0] + 
                            grid_coords_to_test[1] * dim[0] + 
                            grid_coords_to_test[2] * dim[0] * dim[1];
        assert_eq!(index, expected_index);
        
        // Test index -> grid coords
        let grid_from_index = space.index_to_grid_coords(index).unwrap();
        assert_eq!(grid_from_index, grid_coords_to_test);
        
        // PART 2: Test grid <-> world coordinate transformations
        let grid_f32 = [1.0, 2.0, 3.0];
        let world_coords = space.grid_to_coord(&grid_f32);
        
        // Check that the world coordinates are correct
        assert_relative_eq!(world_coords[0], origin[0] + grid_f32[0] * spacing[0]);
        assert_relative_eq!(world_coords[1], origin[1] + grid_f32[1] * spacing[1]);
        assert_relative_eq!(world_coords[2], origin[2] + grid_f32[2] * spacing[2]);
        
        // Test world -> grid coords
        let grid_back = space.coord_to_grid(&world_coords);
        assert_relative_eq!(grid_back[0], grid_f32[0], epsilon = 1e-6);
        assert_relative_eq!(grid_back[1], grid_f32[1], epsilon = 1e-6);
        assert_relative_eq!(grid_back[2], grid_f32[2], epsilon = 1e-6);
        
        // PART 3: Test index -> world and world -> index
        let world_from_index = space.index_to_coord(index).unwrap();
        assert_relative_eq!(world_from_index[0], world_coords[0], epsilon = 1e-6);
        assert_relative_eq!(world_from_index[1], world_coords[1], epsilon = 1e-6);
        assert_relative_eq!(world_from_index[2], world_coords[2], epsilon = 1e-6);
        
        // Test world -> index
        let index_from_world = space.coord_to_index(&world_coords).unwrap();
        assert_eq!(index_from_world, index);
        
        // Test edge cases - coordinates slightly inside a voxel (adding a small offset to stay in the same voxel)
        let inside_coords = [
            world_coords[0] + 0.01, 
            world_coords[1] + 0.01, 
            world_coords[2] + 0.01
        ];
        println!("Original grid coords: {:?}", grid_f32);
        println!("World coords: {:?}", world_coords);
        println!("Inside coords: {:?}", inside_coords);
        
        // Debug the grid coordinates calculated from inside_coords
        let grid_from_inside = space.coord_to_grid(&inside_coords);
        println!("Grid coords from inside: {:?}", grid_from_inside);
        
        let index_inside = space.coord_to_index(&inside_coords).unwrap();
        println!("Index from inside coords: {}", index_inside);
        println!("Expected index: {}", index);
        
        // Calculate grid coords from the index
        let grid_from_index_inside = space.index_to_grid_coords(index_inside).unwrap();
        println!("Grid coords from index_inside: {:?}", grid_from_index_inside);
        
        assert_eq!(index_inside, index, "Slightly inside voxel should map to same index");
        
        // Test edge cases - coordinates at voxel boundaries
        let boundary_coords = [
            world_coords[0] + spacing[0] / 2.0 - 1e-6, 
            world_coords[1] + spacing[1] / 2.0 - 1e-6, 
            world_coords[2] + spacing[2] / 2.0 - 1e-6
        ];
        let index_boundary = space.coord_to_index(&boundary_coords).unwrap();
        assert_eq!(index_boundary, index, "Coordinates at voxel boundary should map to same index");
    }
    
    #[test]
    fn test_3d_coord_to_index() {
        // This focused test verifies that coord_to_index correctly maps world coordinates to indices
        let dim = [4, 4, 4];
        let spacing = [2.0, 2.0, 2.0];
        let origin = [10.0, 20.0, 30.0];
        let space = NeuroSpaceImpl::<3>::from_dims_spacing_origin(dim, spacing, origin);
        
        // Test with multiple grid coordinates to ensure consistency
        for i in 0..3 {
            for j in 0..3 {
                for k in 0..3 {
                    // Create test grid coordinates and convert to world
                    let grid_coords = [i, j, k];
                    let grid_coords_f32 = [i as f32, j as f32, k as f32];
                    let world_coords = space.grid_to_coord(&grid_coords_f32);
                    
                    // Test both direct and via-world paths
                    let index_direct = space.grid_coords_to_index(&grid_coords).unwrap();
                    let index_via_world = space.coord_to_index(&world_coords).unwrap();
                    
                    // They should match
                    assert_eq!(
                        index_direct, 
                        index_via_world, 
                        "coord_to_index failed for grid coords {:?}", 
                        grid_coords
                    );
                    
                    // Also test the reverse: index -> world -> grid -> index
                    let world_from_index = space.index_to_coord(index_direct).unwrap();
                    let grid_from_world = space.coord_to_grid(&world_from_index);
                    let grid_usize = [
                        grid_from_world[0] as usize, 
                        grid_from_world[1] as usize, 
                        grid_from_world[2] as usize
                    ];
                    let index_back = space.grid_coords_to_index(&grid_usize).unwrap();
                    
                    assert_eq!(
                        index_direct, 
                        index_back, 
                        "Round-trip conversion failed for grid coords {:?}", 
                        grid_coords
                    );
                }
            }
        }
    }
}