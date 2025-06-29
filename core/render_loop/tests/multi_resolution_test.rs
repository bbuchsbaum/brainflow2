// Tests for multi-resolution volume rendering

use render_loop::test_fixtures::{TestVolumeSet, create_test_pattern_volume};
use render_loop::{RenderLoopService, RenderLoopError};
use volmath::DenseVolume3;
use nalgebra::{Matrix4, Vector3};
use pollster;

/// Test that we can render multiple volumes with different resolutions
#[test]
fn test_multi_resolution_overlay() {
    pollster::block_on(async {
        // Create test volumes
        let volumes = TestVolumeSet::create_aligned();
        
        // Initialize render service
        let mut service = RenderLoopService::new().await
            .expect("Failed to create render service");
        
        // Upload volumes to GPU
        let (anat_id, _anat_transform) = service.upload_volume_3d(&volumes.anatomical)
            .expect("Failed to upload anatomical");
        
        let (func_id, _func_transform) = service.upload_volume_3d(&volumes.functional)
            .expect("Failed to upload functional");
        
        // TODO: Set up layers with proper world-to-voxel transforms
        // TODO: Render at world point (0,0,0)
        // TODO: Verify both layers visible in output
        
        // For now, just verify uploads succeeded
        // Note: With multi-texture system, IDs start from 0
        assert!(anat_id == 0);  // First texture gets ID 0
        assert!(func_id == 1);  // Second texture gets ID 1
    });
}

/// Test that different FOVs render correctly without black regions
#[test]
fn test_partial_fov_rendering() {
    pollster::block_on(async {
        // Create anatomical covering full FOV
        let full_brain = create_full_fov_volume();
        
        // Create functional with smaller FOV
        let partial_fov = create_partial_fov_volume();
        
        let mut service = RenderLoopService::new().await
            .expect("Failed to create render service");
        
        // Upload both volumes
        let (full_id, _full_transform) = service.upload_volume_3d(&full_brain)
            .expect("Failed to upload full FOV");
        
        let (partial_id, _partial_transform) = service.upload_volume_3d(&partial_fov)
            .expect("Failed to upload partial FOV");
        
        // TODO: Render and verify no black regions outside partial FOV
        
        // With multi-texture system, IDs start from 0
        assert!(full_id == 0);     // First texture gets ID 0
        assert!(partial_id == 1);  // Second texture gets ID 1
    });
}

/// Test pixel-perfect alignment between different resolution volumes
#[test]
fn test_world_space_alignment() {
    pollster::block_on(async {
        let volumes = TestVolumeSet::create_aligned();
        let (anat_tfm, func_tfm, _) = volumes.get_transforms();
        
        // World point that should be visible in both volumes
        let test_point = Vector3::new(0.0, 0.0, 0.0);
        
        // Transform to voxel space for each volume
        let anat_voxel = anat_tfm.transform_point(&test_point.into());
        let func_voxel = func_tfm.transform_point(&test_point.into());
        
        // Verify transformations are correct
        assert_eq!(anat_voxel.coords, Vector3::new(128.0, 128.0, 128.0));
        assert_eq!(func_voxel.coords, Vector3::new(64.0, 64.0, 16.0));
        
        // TODO: Actually render and verify pixel alignment
    });
}

/// Test that binary masks render correctly at different resolutions
#[test]
fn test_binary_mask_rendering() {
    pollster::block_on(async {
        let mask = create_test_pattern_volume();
        
        let mut service = RenderLoopService::new().await
            .expect("Failed to create render service");
        
        // Upload mask
        let (mask_id, _mask_transform) = service.upload_volume_3d(&mask)
            .expect("Failed to upload mask");
        
        // TODO: Configure as binary mask (intensity range 0-1)
        // TODO: Render and verify binary appearance
        
        // With multi-texture system, IDs start from 0
        assert!(mask_id == 0);  // First texture gets ID 0
    });
}

// Helper functions to create test volumes

fn create_full_fov_volume() -> DenseVolume3<u8> {
    // 256x256x256 at 1mm, covers -128 to +128mm
    let dims = [256, 256, 256];
    let mut data = vec![50u8; 256 * 256 * 256]; // Gray background
    
    // Add some structure
    for z in 100..156 {
        for y in 100..156 {
            for x in 100..156 {
                data[z * 256 * 256 + y * 256 + x] = 200;
            }
        }
    }
    
    use volmath::space::{NeuroSpace3, NeuroSpaceImpl};
    let space_impl = NeuroSpaceImpl::from_affine_matrix4(dims, Matrix4::identity());
    let space = NeuroSpace3(space_impl);
    DenseVolume3::from_data(space, data)
}

fn create_partial_fov_volume() -> DenseVolume3<f32> {
    // 64x64x32 at 2mm, covers -64 to +64mm in X/Y, -32 to +32mm in Z
    let dims = [64, 64, 32];
    let mut data = vec![0.0f32; 64 * 64 * 32];
    
    // Add activation in center
    for z in 12..20 {
        for y in 24..40 {
            for x in 24..40 {
                data[z * 64 * 64 + y * 64 + x] = 0.8;
            }
        }
    }
    
    use volmath::space::{NeuroSpace3, NeuroSpaceImpl};
    let space_impl = NeuroSpaceImpl::from_affine_matrix4(dims, Matrix4::identity());
    let space = NeuroSpace3(space_impl);
    DenseVolume3::from_data(space, data)
}

/// Test helper to verify a rendered image has no black pixels
fn assert_no_black_pixels(image_data: &[u8], width: u32, height: u32) {
    for y in 0..height {
        for x in 0..width {
            let idx = ((y * width + x) * 4) as usize;
            let r = image_data[idx];
            let g = image_data[idx + 1];
            let b = image_data[idx + 2];
            
            if r == 0 && g == 0 && b == 0 {
                panic!("Found black pixel at ({}, {})", x, y);
            }
        }
    }
}

/// Test helper to check if center pixel is not black
fn assert_center_pixel_not_black(image_data: &[u8], width: u32, height: u32) {
    let cx = width / 2;
    let cy = height / 2;
    let idx = ((cy * width + cx) * 4) as usize;
    
    let r = image_data[idx];
    let g = image_data[idx + 1];
    let b = image_data[idx + 2];
    
    assert!(r > 0 || g > 0 || b > 0, 
            "Center pixel is black! RGB = ({}, {}, {})", r, g, b);
}

/// Test helper to verify two layers are visible
fn assert_shows_both_layers(image_data: &[u8], width: u32, height: u32) {
    // TODO: Implement more sophisticated check for layer visibility
    // For now, just check that we have variation in the image
    
    let first_pixel = (image_data[0], image_data[1], image_data[2]);
    let mut has_variation = false;
    
    for y in 0..height {
        for x in 0..width {
            let idx = ((y * width + x) * 4) as usize;
            let pixel = (image_data[idx], image_data[idx + 1], image_data[idx + 2]);
            
            if pixel != first_pixel {
                has_variation = true;
                break;
            }
        }
        if has_variation { break; }
    }
    
    assert!(has_variation, "Image has no variation - likely only showing one layer");
}