// Test fixtures for multi-resolution volume rendering

use volmath::DenseVolume3;
use nalgebra::{Matrix4, Vector3};

/// A set of test volumes with different resolutions but aligned in world space
pub struct TestVolumeSet {
    /// 1mm³ T1 anatomical: 256x256x256
    pub anatomical: DenseVolume3<u8>,
    /// 2x2x4mm³ fMRI: 128x128x32, smaller FOV
    pub functional: DenseVolume3<f32>,
    /// 0.5mm³ high-res patch: 128x128x64, covers small region
    pub detail_patch: DenseVolume3<u16>,
}

impl TestVolumeSet {
    /// Create aligned test volumes sharing world coordinate system
    pub fn create_aligned() -> Self {
        // Create anatomical volume - 1mm isotropic, centered at origin
        let anatomical = create_anatomical_volume();
        
        // Create functional volume - 2x2x4mm, smaller FOV but same world center
        let functional = create_functional_volume();
        
        // Create detail patch - 0.5mm isotropic, covers small region around origin
        let detail_patch = create_detail_patch();
        
        Self {
            anatomical,
            functional,
            detail_patch,
        }
    }
    
    /// Get world-to-voxel transforms for each volume
    pub fn get_transforms(&self) -> (Matrix4<f32>, Matrix4<f32>, Matrix4<f32>) {
        (
            anatomical_world_to_voxel(),
            functional_world_to_voxel(),
            detail_world_to_voxel(),
        )
    }
}

/// Create a 256x256x256 anatomical volume at 1mm resolution
fn create_anatomical_volume() -> DenseVolume3<u8> {
    let dims = [256, 256, 256];
    let mut data = vec![0u8; 256 * 256 * 256];
    
    // Create a simple brain-like structure
    let center = Vector3::new(128.0, 128.0, 128.0);
    
    for z in 0..256 {
        for y in 0..256 {
            for x in 0..256 {
                let pos = Vector3::new(x as f32, y as f32, z as f32);
                let dist = (pos - center).norm();
                
                // Brain tissue in sphere
                if dist < 100.0 {
                    data[z * 256 * 256 + y * 256 + x] = 180;
                }
                // Add CSF layer
                else if dist < 110.0 {
                    data[z * 256 * 256 + y * 256 + x] = 40;
                }
                
                // Add a marker at world origin (voxel 128,128,128)
                if x == 128 && y == 128 && z == 128 {
                    data[z * 256 * 256 + y * 256 + x] = 255;
                }
            }
        }
    }
    
    use volmath::space::{NeuroSpace3, NeuroSpaceImpl};
    // Create with voxel-to-world transform (inverse of world-to-voxel)
    let voxel_to_world = anatomical_world_to_voxel().try_inverse().unwrap();
    let space_impl = NeuroSpaceImpl::from_affine_matrix4(dims, voxel_to_world);
    let space = NeuroSpace3(space_impl);
    DenseVolume3::from_data(space, data)
}

/// Create a 128x128x32 functional volume at 2x2x4mm resolution
fn create_functional_volume() -> DenseVolume3<f32> {
    let dims = [128, 128, 32];
    let mut data = vec![0.0f32; 128 * 128 * 32];
    
    // Functional activation blob at world origin
    // World origin maps to voxel (64, 64, 16) in this volume
    let center = Vector3::new(64.0, 64.0, 16.0);
    
    for z in 0..32 {
        for y in 0..128 {
            for x in 0..128 {
                let pos = Vector3::new(x as f32, y as f32, z as f32);
                let dist = (pos - center).norm();
                
                // Gaussian activation
                if dist < 20.0 {
                    let intensity = (-dist * dist / 50.0).exp();
                    data[z * 128 * 128 + y * 128 + x] = intensity;
                }
            }
        }
    }
    
    use volmath::space::{NeuroSpace3, NeuroSpaceImpl};
    // Create with voxel-to-world transform (inverse of world-to-voxel)
    let voxel_to_world = functional_world_to_voxel().try_inverse().unwrap();
    let space_impl = NeuroSpaceImpl::from_affine_matrix4(dims, voxel_to_world);
    let space = NeuroSpace3(space_impl);
    DenseVolume3::from_data(space, data)
}

/// Create a 128x128x64 detail patch at 0.5mm resolution
fn create_detail_patch() -> DenseVolume3<u16> {
    let dims = [128, 128, 64];
    let mut data = vec![0u16; 128 * 128 * 64];
    
    // Create fine detail structure around world origin
    // This covers a 64x64x32mm region centered at origin
    
    for z in 0..64 {
        for y in 0..128 {
            for x in 0..128 {
                // Create a fine grid pattern
                if x % 4 == 0 || y % 4 == 0 || z % 4 == 0 {
                    data[z * 128 * 128 + y * 128 + x] = 30000;
                }
                
                // Mark center voxel
                if x == 64 && y == 64 && z == 32 {
                    data[z * 128 * 128 + y * 128 + x] = 65535;
                }
            }
        }
    }
    
    use volmath::space::{NeuroSpace3, NeuroSpaceImpl};
    // Create with voxel-to-world transform (inverse of world-to-voxel)
    let voxel_to_world = detail_world_to_voxel().try_inverse().unwrap();
    let space_impl = NeuroSpaceImpl::from_affine_matrix4(dims, voxel_to_world);
    let space = NeuroSpace3(space_impl);
    DenseVolume3::from_data(space, data)
}

/// Transform for 1mm anatomical volume centered at world origin
fn anatomical_world_to_voxel() -> Matrix4<f32> {
    // World origin (0,0,0) maps to voxel (128,128,128)
    // 1mm voxels, no rotation
    Matrix4::new(
        1.0, 0.0, 0.0, 128.0,
        0.0, 1.0, 0.0, 128.0,
        0.0, 0.0, 1.0, 128.0,
        0.0, 0.0, 0.0, 1.0,
    )
}

/// Transform for 2x2x4mm functional volume
fn functional_world_to_voxel() -> Matrix4<f32> {
    // World origin (0,0,0) maps to voxel (64,64,16)
    // 2mm voxels in X/Y, 4mm in Z
    Matrix4::new(
        0.5, 0.0, 0.0, 64.0,
        0.0, 0.5, 0.0, 64.0,
        0.0, 0.0, 0.25, 16.0,
        0.0, 0.0, 0.0, 1.0,
    )
}

/// Transform for 0.5mm detail patch
fn detail_world_to_voxel() -> Matrix4<f32> {
    // World origin (0,0,0) maps to voxel (64,64,32)
    // 0.5mm voxels, covers -32 to +32mm in X/Y, -16 to +16mm in Z
    Matrix4::new(
        2.0, 0.0, 0.0, 64.0,
        0.0, 2.0, 0.0, 64.0,
        0.0, 0.0, 2.0, 32.0,
        0.0, 0.0, 0.0, 1.0,
    )
}

/// Create a known test pattern for validation
pub fn create_test_pattern_volume() -> DenseVolume3<u8> {
    let dims = [64, 64, 25];
    let mut data = vec![0u8; 64 * 64 * 25];
    
    // Create a binary mask with known pattern
    // Center voxel = 255
    let center_idx = 12 * 64 * 64 + 32 * 64 + 32;
    data[center_idx] = 255;
    
    // Corners = 128
    data[0] = 128; // (0,0,0)
    data[63] = 128; // (63,0,0)
    data[64 * 63] = 128; // (0,63,0)
    data[64 * 63 + 63] = 128; // (63,63,0)
    
    // Create plus sign in center slice
    let z = 12;
    for i in 0..64 {
        data[z * 64 * 64 + 32 * 64 + i] = 100; // Horizontal line
        data[z * 64 * 64 + i * 64 + 32] = 100; // Vertical line
    }
    
    // Re-set center voxel to be brightest (after plus sign overwrote it)
    data[center_idx] = 255;
    
    use volmath::space::{NeuroSpace3, NeuroSpaceImpl};
    let space_impl = NeuroSpaceImpl::from_affine_matrix4(dims, Matrix4::identity());
    let space = NeuroSpace3(space_impl);
    DenseVolume3::from_data(space, data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use volmath::space::GridSpace;
    
    #[test]
    fn test_volume_creation() {
        let volumes = TestVolumeSet::create_aligned();
        
        // Check dimensions
        assert_eq!(volumes.anatomical.space.0.dims(), &[256, 256, 256]);
        assert_eq!(volumes.functional.space.0.dims(), &[128, 128, 32]);
        assert_eq!(volumes.detail_patch.space.0.dims(), &[128, 128, 64]);
    }
    
    #[test]
    fn test_world_alignment() {
        let volumes = TestVolumeSet::create_aligned();
        let (anat_tfm, func_tfm, detail_tfm) = volumes.get_transforms();
        
        // World origin should map to center of each volume
        let world_origin = Vector3::new(0.0, 0.0, 0.0);
        
        // Anatomical: world (0,0,0) -> voxel (128,128,128)
        let anat_voxel = anat_tfm.transform_point(&world_origin.into());
        assert_eq!(anat_voxel.coords, Vector3::new(128.0, 128.0, 128.0));
        
        // Functional: world (0,0,0) -> voxel (64,64,16)
        let func_voxel = func_tfm.transform_point(&world_origin.into());
        assert_eq!(func_voxel.coords, Vector3::new(64.0, 64.0, 16.0));
        
        // Detail: world (0,0,0) -> voxel (64,64,32)
        let detail_voxel = detail_tfm.transform_point(&world_origin.into());
        assert_eq!(detail_voxel.coords, Vector3::new(64.0, 64.0, 32.0));
    }
    
    #[test]
    fn test_pattern_volume() {
        let volume = create_test_pattern_volume();
        
        // Check center voxel
        let center_value = volume.get_at_coords(&[32, 32, 12]).unwrap();
        assert_eq!(center_value, 255);
        
        // Check corners
        assert_eq!(volume.get_at_coords(&[0, 0, 0]).unwrap(), 128);
        assert_eq!(volume.get_at_coords(&[63, 0, 0]).unwrap(), 128);
    }
}