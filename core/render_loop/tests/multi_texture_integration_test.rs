// Test multi-texture integration with RenderLoopService

use render_loop::RenderLoopService;
use render_loop::test_fixtures::TestVolumeSet;
use pollster;

#[test]
fn test_multi_texture_upload_integration() {
    pollster::block_on(async {
        // Create render loop service
        let mut service = RenderLoopService::new()
            .await
            .expect("Failed to create RenderLoopService");
        
        // Enable world-space rendering
        service.enable_world_space_rendering()
            .expect("Failed to enable world-space rendering");
        
        // Create test volumes
        let volumes = TestVolumeSet::create_aligned();
        
        // Upload anatomical volume
        let (anat_idx, anat_tfm) = service.upload_volume_multi_texture(
            &volumes.anatomical,
            wgpu::TextureFormat::R8Unorm,
        ).expect("Failed to upload anatomical volume");
        
        println!("Uploaded anatomical volume to texture index {}", anat_idx);
        assert_eq!(anat_idx, 0);
        
        // Upload functional volume
        let (func_idx, func_tfm) = service.upload_volume_multi_texture(
            &volumes.functional,
            wgpu::TextureFormat::R32Float,
        ).expect("Failed to upload functional volume");
        
        println!("Uploaded functional volume to texture index {}", func_idx);
        assert_eq!(func_idx, 1);
        
        // Upload detail patch
        let (detail_idx, detail_tfm) = service.upload_volume_multi_texture(
            &volumes.detail_patch,
            wgpu::TextureFormat::R16Float,
        ).expect("Failed to upload detail patch");
        
        println!("Uploaded detail patch to texture index {}", detail_idx);
        assert_eq!(detail_idx, 2);
        
        // Verify transforms match expected
        let expected_transforms = volumes.get_transforms();
        assert_eq!(anat_tfm, expected_transforms.0);
        assert_eq!(func_tfm, expected_transforms.1);
        assert_eq!(detail_tfm, expected_transforms.2);
    });
}

#[test]
fn test_world_space_rendering_initialization() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new()
            .await
            .expect("Failed to create RenderLoopService");
        
        // World-space rendering is now enabled by default
        // The service initializes with world-space rendering components
        
        // Try to upload a test volume to verify world-space rendering works
        let test_volumes = TestVolumeSet::create_aligned();
        let (idx, _tfm) = service.upload_volume_3d(&test_volumes.anatomical)
            .expect("Should be able to upload volume with world-space rendering");
        
        // Verify the upload succeeded
        assert_eq!(idx, 0);
    });
}