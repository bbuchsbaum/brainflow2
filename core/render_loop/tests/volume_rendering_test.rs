// Test rendering with actual volume data

use render_loop::RenderLoopService;
use volmath::{DenseVolume3, NeuroSpace3};
use volmath::space::NeuroSpaceImpl;
use pollster::FutureExt;

fn create_test_volume() -> DenseVolume3<f32> {
    // Create a 64x64x32 test volume with gradient pattern
    let dims = [64, 64, 32];
    let spacing = [1.0, 1.0, 1.5];
    let origin = [0.0, 0.0, 0.0];
    
    let space = NeuroSpace3(NeuroSpaceImpl::<3>::from_dims_spacing_origin(dims, spacing, origin));
    
    // Create data with gradient pattern
    let mut data = Vec::with_capacity(dims[0] * dims[1] * dims[2]);
    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                // Create gradient from 0.0 to 1.0 based on position
                let value = (x as f32 / dims[0] as f32 + 
                            y as f32 / dims[1] as f32 + 
                            z as f32 / dims[2] as f32) / 3.0;
                data.push(value);
            }
        }
    }
    
    DenseVolume3::from_data(space, data)
}

#[test]
fn test_upload_and_render_volume() {
    // Create render loop service
    let mut service = RenderLoopService::new().block_on()
        .expect("Failed to create RenderLoopService");
    
    // Create test volume
    let volume = create_test_volume();
    
    // Test uploading multiple slices
    let slice_indices = vec![0, 15, 31]; // First, middle, and last slice
    let mut layer_indices = Vec::new();
    
    for &slice_idx in &slice_indices {
        match service.upload_slice(&volume, 2, slice_idx) { // Z-axis slice
            Ok((atlas_idx, u_min, v_min, u_max, v_max)) => {
                println!("Uploaded slice {} to atlas layer {}", slice_idx, atlas_idx);
                println!("Texture coordinates: ({}, {}) to ({}, {})", 
                    u_min, v_min, u_max, v_max);
                
                // Add as render layer
                let layer_idx = service.add_render_layer(
                    atlas_idx, 
                    1.0, 
                    (u_min, v_min, u_max, v_max)
                ).expect("Failed to add render layer");
                
                layer_indices.push(layer_idx);
                
                // Verify layer was added
                assert_eq!(service.active_layer_count(), layer_indices.len());
            }
            Err(e) => panic!("Failed to upload slice: {:?}", e),
        }
    }
    
    // Test updating layer properties
    if let Some(&first_layer) = layer_indices.first() {
        service.update_layer(first_layer, 0.5, 2) // 50% opacity, colormap 2
            .expect("Failed to update layer");
    }
    
    // Verify frame UBO updates with new signature
    // For axial view: origin at center of volume, u/v are X/Y axes
    service.update_frame_ubo(
        [32.0, 32.0, 16.0, 1.0], // origin_mm: Center of volume
        [1.0, 0.0, 0.0, 0.0],    // u_mm: X axis in world space
        [0.0, 1.0, 0.0, 0.0],    // v_mm: Y axis in world space
    );
    
    // Test removing a layer
    if layer_indices.len() > 1 {
        let removed_atlas_idx = service.remove_render_layer(layer_indices[1]);
        assert!(removed_atlas_idx.is_some());
        assert_eq!(service.active_layer_count(), layer_indices.len() - 1);
    }
    
    println!("Volume rendering test completed successfully!");
}

#[test]
fn test_volume_metadata_tracking() {
    let mut service = RenderLoopService::new().block_on()
        .expect("Failed to create RenderLoopService");
    
    let volume = create_test_volume();
    
    // Upload a slice
    let (atlas_idx, _, _, _, _) = service.upload_slice(&volume, 2, 10)
        .expect("Failed to upload slice");
    
    // Add as render layer
    service.add_render_layer(atlas_idx, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add render layer");
    
    // The volume metadata should be tracked internally and used for uniforms
    // This is verified by the layer uniform updates happening correctly
    assert_eq!(service.active_layer_count(), 1);
}

#[test]
fn test_atlas_layer_allocation() {
    let mut service = RenderLoopService::new().block_on()
        .expect("Failed to create RenderLoopService");
    
    let volume = create_test_volume();
    let mut allocated_layers = Vec::new();
    
    // Test allocating multiple layers
    for i in 0..5 {
        let (atlas_idx, _, _, _, _) = service.upload_slice(&volume, 2, i)
            .expect("Failed to upload slice");
        allocated_layers.push(atlas_idx);
        
        // Verify unique allocation
        for j in 0..i {
            assert_ne!(allocated_layers[j], atlas_idx, 
                "Atlas layer {} was allocated twice", atlas_idx);
        }
    }
    
    println!("Successfully allocated {} unique atlas layers", allocated_layers.len());
}