#![cfg(feature = "legacy_pipeline_tests")]
// End-to-end pipeline integration test with known patterns

use nalgebra::{Matrix4, Vector3};
use ndarray::{s, Array3};
use std::path::Path;
use tempfile::TempDir;

// Test helpers for creating known patterns
mod test_patterns {
    use super::*;

    /// Create a 10x10x10 volume with a known gradient pattern
    pub fn create_gradient_volume() -> Array3<f32> {
        let mut data = Array3::<f32>::zeros((10, 10, 10));
        for i in 0..10 {
            for j in 0..10 {
                for k in 0..10 {
                    // Linear gradient from 0 to 1000 based on position
                    data[[i, j, k]] = (i + j + k) as f32 * 1000.0 / 27.0;
                }
            }
        }
        data
    }

    /// Create a 10x10x10 volume with a sphere pattern
    pub fn create_sphere_volume() -> Array3<f32> {
        let mut data = Array3::<f32>::zeros((10, 10, 10));
        let center = 4.5; // Center of 10x10x10 volume
        let radius = 3.0;

        for i in 0..10 {
            for j in 0..10 {
                for k in 0..10 {
                    let dx = i as f32 - center;
                    let dy = j as f32 - center;
                    let dz = k as f32 - center;
                    let dist = (dx * dx + dy * dy + dz * dz).sqrt();

                    if dist <= radius {
                        data[[i, j, k]] = 1000.0 * (1.0 - dist / radius);
                    }
                }
            }
        }
        data
    }

    /// Create a checkerboard pattern
    pub fn create_checkerboard_volume() -> Array3<f32> {
        let mut data = Array3::<f32>::zeros((10, 10, 10));
        for i in 0..10 {
            for j in 0..10 {
                for k in 0..10 {
                    if (i + j + k) % 2 == 0 {
                        data[[i, j, k]] = 1000.0;
                    }
                }
            }
        }
        data
    }
}

/// Save a test volume as NIfTI file
fn save_test_nifti(
    data: &Array3<f32>,
    path: &Path,
    voxel_size: [f32; 3],
) -> Result<(), Box<dyn std::error::Error>> {
    use nifti::{writer::WriterOptions, NiftiHeader, NiftiObject};

    // Create header with known properties
    let mut header = NiftiHeader::default();
    header.dim = [3, 10, 10, 10, 1, 1, 1, 1];
    header.datatype = 16; // FLOAT32
    header.bitpix = 32;
    header.pixdim = [
        1.0,
        voxel_size[0],
        voxel_size[1],
        voxel_size[2],
        1.0,
        1.0,
        1.0,
        1.0,
    ];

    // Set affine transform (RAS+ coordinates)
    // Simple identity with voxel scaling
    header.srow_x = [voxel_size[0], 0.0, 0.0, -5.0 * voxel_size[0]]; // Center at origin
    header.srow_y = [0.0, voxel_size[1], 0.0, -5.0 * voxel_size[1]];
    header.srow_z = [0.0, 0.0, voxel_size[2], -5.0 * voxel_size[2]];
    header.qform_code = 0;
    header.sform_code = 1; // Scanner coordinates

    // Convert data to Vec<f32> in Fortran order (NIfTI standard)
    let mut nifti_data = Vec::with_capacity(1000);
    for k in 0..10 {
        for j in 0..10 {
            for i in 0..10 {
                nifti_data.push(data[[i, j, k]]);
            }
        }
    }

    // Write file
    let writer = WriterOptions::new(path)
        .reference(&header)
        .write_nifti(&nifti_data)?;

    Ok(())
}

/// Verify rendered output matches expected pattern
fn verify_rendered_output(
    rendered_data: &[u8],
    width: u32,
    height: u32,
    expected_pattern: &dyn Fn(u32, u32) -> [u8; 4],
    tolerance: u8,
) -> Result<(), String> {
    for y in 0..height {
        for x in 0..width {
            let idx = ((y * width + x) * 4) as usize;
            let pixel = [
                rendered_data[idx],
                rendered_data[idx + 1],
                rendered_data[idx + 2],
                rendered_data[idx + 3],
            ];
            let expected = expected_pattern(x, y);

            for i in 0..4 {
                if pixel[i].abs_diff(expected[i]) > tolerance {
                    return Err(format!(
                        "Pixel mismatch at ({}, {}): got {:?}, expected {:?}",
                        x, y, pixel, expected
                    ));
                }
            }
        }
    }
    Ok(())
}

#[test]
fn test_pipeline_gradient_volume() {
    use api_bridge::{create_api_bridge, VolumeLoadRequest};
    use render_loop::{BlendMode, LayerInfo, RenderLoopService, ThresholdMode};

    pollster::block_on(async {
        // Create temporary directory for test files
        let temp_dir = TempDir::new().unwrap();
        let nifti_path = temp_dir.path().join("gradient.nii.gz");

        // Step 1: Create and save test volume
        let gradient_data = test_patterns::create_gradient_volume();
        save_test_nifti(&gradient_data, &nifti_path, [1.0, 1.0, 1.0]).unwrap();

        // Step 2: Load through API bridge
        let api_bridge = create_api_bridge().await.unwrap();
        let request = VolumeLoadRequest {
            path: nifti_path.to_str().unwrap().to_string(),
            requested_space: None,
        };

        let handle = api_bridge
            .load_volume(request)
            .await
            .expect("Failed to load test volume");

        // Verify loaded metadata
        let info = api_bridge
            .get_volume_info(handle)
            .await
            .expect("Failed to get volume info");
        assert_eq!(info.dimensions, (10, 10, 10));
        assert_eq!(info.spacing, (1.0, 1.0, 1.0));

        // Step 3: Get volume data for rendering
        let volume_data = api_bridge
            .get_volume_for_rendering(handle)
            .await
            .expect("Failed to get volume for rendering");

        // Step 4: Create render service and upload
        let mut render_service = RenderLoopService::new()
            .await
            .expect("Failed to create render service");

        let (texture_handle, transform) = render_service
            .upload_volume_3d(&volume_data)
            .expect("Failed to upload volume");

        // Step 5: Configure rendering parameters
        let volume_dims = volume_data.space.dims();
        let layer = LayerInfo {
            atlas_index: texture_handle,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            colormap_id: 0, // Grayscale
            intensity_range: (0.0, 1000.0),
            threshold_range: (-f32::INFINITY, f32::INFINITY),
            threshold_mode: ThresholdMode::Range,
            texture_coords: (0.0, 0.0, 1.0, 1.0),
            is_mask: false,
            interpolation_mode: 1,
        };

        // Set up axial slice through center (z=5)
        let origin_mm = [0.0, 0.0, 0.0, 1.0]; // World center
        let u_mm = [10.0, 0.0, 0.0, 0.0]; // 10mm width
        let v_mm = [0.0, 10.0, 0.0, 0.0]; // 10mm height
        let target_dim = [100, 100]; // 100x100 render target

        render_service.update_layer_uniforms_direct(
            &[layer],
            &[(
                volume_dims[0] as u32,
                volume_dims[1] as u32,
                volume_dims[2] as u32,
            )],
            &[transform],
        );
        render_service
            .create_offscreen_target(target_dim[0], target_dim[1])
            .expect("create offscreen target");
        render_service.update_frame_ubo(origin_mm, u_mm, v_mm);

        // Step 6: Render to texture
        let rendered_data = render_service.render_to_buffer().expect("Failed to render");

        // Step 7: Verify rendered output
        // For axial slice at z=0, we expect gradient pattern
        let verify_result = verify_rendered_output(
            &rendered_data,
            100,
            100,
            &|x, y| {
                // Map pixel position to volume coordinates
                let voxel_x = (x as f32 / 10.0).floor() as usize;
                let voxel_y = (y as f32 / 10.0).floor() as usize;
                let voxel_z = 5; // Center slice

                if voxel_x < 10 && voxel_y < 10 {
                    let expected_value = gradient_data[[voxel_x, voxel_y, voxel_z]];
                    let normalized = (expected_value / 1000.0 * 255.0) as u8;
                    [normalized, normalized, normalized, 255]
                } else {
                    [0, 0, 0, 255] // Outside volume
                }
            },
            5, // Tolerance for rounding errors
        );

        match verify_result {
            Ok(_) => println!("✓ Gradient volume rendered correctly"),
            Err(e) => panic!("Gradient volume rendering failed: {}", e),
        }

        // Optional: Save rendered image for debugging
        #[cfg(debug_assertions)]
        {
            use image::{ImageBuffer, Rgba};
            let img = ImageBuffer::<Rgba<u8>, _>::from_raw(100, 100, rendered_data.clone())
                .expect("Failed to create image");
            img.save("debug_gradient_render.png").ok();
        }
    });
}

#[test]
fn test_pipeline_sphere_volume_multi_slice() {
    use api_bridge::{create_api_bridge, VolumeLoadRequest};
    use render_loop::{BlendMode, LayerInfo, RenderLoopService, ThresholdMode};

    pollster::block_on(async {
        let temp_dir = TempDir::new().unwrap();
        let nifti_path = temp_dir.path().join("sphere.nii.gz");

        // Create sphere volume
        let sphere_data = test_patterns::create_sphere_volume();
        save_test_nifti(&sphere_data, &nifti_path, [2.0, 2.0, 2.0]).unwrap(); // 2mm voxels

        // Load through pipeline
        let api_bridge = create_api_bridge().await.unwrap();
        let handle = api_bridge
            .load_volume(VolumeLoadRequest {
                path: nifti_path.to_str().unwrap().to_string(),
                requested_space: None,
            })
            .await
            .unwrap();

        let volume_data = api_bridge.get_volume_for_rendering(handle).await.unwrap();

        // Render service
        let mut render_service = RenderLoopService::new().await.unwrap();
        let (texture_handle, transform) = render_service.upload_volume_3d(&volume_data).unwrap();

        // Test multiple slice orientations
        let test_slices = vec![
            ("Axial", [1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0]), // XY plane
            ("Coronal", [1.0, 0.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0]), // XZ plane
            ("Sagittal", [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0]), // YZ plane
        ];

        let vol_dims = volume_data.space.dims();
        for (name, u_vec, v_vec) in test_slices {
            println!("Testing {} slice", name);

            let layer = LayerInfo {
                atlas_index: texture_handle,
                opacity: 1.0,
                blend_mode: BlendMode::Normal,
                colormap_id: 1, // Hot colormap for better visualization
                intensity_range: (0.0, 1000.0),
                threshold_range: (-f32::INFINITY, f32::INFINITY),
                threshold_mode: ThresholdMode::Range,
                texture_coords: (0.0, 0.0, 1.0, 1.0),
                is_mask: false,
                interpolation_mode: 1,
            };

            render_service.update_layer_uniforms_direct(
                &[layer],
                &[(vol_dims[0] as u32, vol_dims[1] as u32, vol_dims[2] as u32)],
                &[transform],
            );
            render_service
                .create_offscreen_target(100, 100)
                .expect("create offscreen target");
            render_service.update_frame_ubo([0.0, 0.0, 0.0, 1.0], u_vec, v_vec);

            let rendered_data = render_service.render_to_buffer().unwrap();

            // Verify we see a circular pattern (sphere cross-section)
            let center_pixel =
                rendered_data[50 * 100 * 4 + 50 * 4..50 * 100 * 4 + 50 * 4 + 4].to_vec();
            let edge_pixel = rendered_data[0..4].to_vec();

            // Center should be bright (inside sphere)
            assert!(
                center_pixel[0] > 128,
                "{} slice center should be bright",
                name
            );

            // Edge should be dark (outside sphere)
            assert!(edge_pixel[0] < 50, "{} slice edge should be dark", name);

            #[cfg(debug_assertions)]
            {
                use image::{ImageBuffer, Rgba};
                let img = ImageBuffer::<Rgba<u8>, _>::from_raw(100, 100, rendered_data)
                    .expect("Failed to create image");
                img.save(format!("debug_sphere_{}.png", name.to_lowercase()))
                    .ok();
            }
        }
    });
}

#[test]
fn test_pipeline_multi_resolution_overlay() {
    use api_bridge::{create_api_bridge, VolumeLoadRequest};
    use render_loop::{BlendMode, LayerInfo, RenderLoopService, ThresholdMode};

    pollster::block_on(async {
        let temp_dir = TempDir::new().unwrap();

        // Create two volumes with different resolutions
        // High-res anatomical (1mm)
        let anat_path = temp_dir.path().join("anatomical.nii.gz");
        let anat_data = test_patterns::create_gradient_volume();
        save_test_nifti(&anat_data, &anat_path, [1.0, 1.0, 1.0]).unwrap();

        // Low-res functional overlay (3mm)
        let func_path = temp_dir.path().join("functional.nii.gz");
        let func_data = test_patterns::create_sphere_volume();
        save_test_nifti(&func_data, &func_path, [3.0, 3.0, 3.0]).unwrap();

        // Load both volumes
        let api_bridge = create_api_bridge().await.unwrap();

        let anat_handle = api_bridge
            .load_volume(VolumeLoadRequest {
                path: anat_path.to_str().unwrap().to_string(),
                requested_space: None,
            })
            .await
            .unwrap();

        let func_handle = api_bridge
            .load_volume(VolumeLoadRequest {
                path: func_path.to_str().unwrap().to_string(),
                requested_space: None,
            })
            .await
            .unwrap();

        // Get rendering data
        let anat_volume = api_bridge
            .get_volume_for_rendering(anat_handle)
            .await
            .unwrap();
        let func_volume = api_bridge
            .get_volume_for_rendering(func_handle)
            .await
            .unwrap();

        // Upload to GPU
        let mut render_service = RenderLoopService::new().await.unwrap();

        let (anat_tex, anat_transform) = render_service.upload_volume_3d(&anat_volume).unwrap();
        let (func_tex, func_transform) = render_service.upload_volume_3d(&func_volume).unwrap();

        // Configure layers
        let layers = vec![
            LayerInfo {
                atlas_index: anat_tex,
                opacity: 1.0,
                blend_mode: BlendMode::Normal,
                colormap_id: 0, // Grayscale
                intensity_range: (0.0, 1000.0),
                threshold_range: (-f32::INFINITY, f32::INFINITY),
                threshold_mode: ThresholdMode::Range,
                texture_coords: (0.0, 0.0, 1.0, 1.0),
                is_mask: false,
                interpolation_mode: 1,
            },
            LayerInfo {
                atlas_index: func_tex,
                opacity: 0.5,
                blend_mode: BlendMode::Additive,
                colormap_id: 1,                   // Hot colormap
                intensity_range: (200.0, 1000.0), // Threshold to show only sphere
                threshold_range: (200.0, f32::INFINITY),
                threshold_mode: ThresholdMode::Range,
                texture_coords: (0.0, 0.0, 1.0, 1.0),
                is_mask: false,
                interpolation_mode: 1,
            },
        ];

        render_service.update_layer_uniforms_direct(
            &layers,
            &[
                (
                    anat_volume.space.dims()[0] as u32,
                    anat_volume.space.dims()[1] as u32,
                    anat_volume.space.dims()[2] as u32,
                ),
                (
                    func_volume.space.dims()[0] as u32,
                    func_volume.space.dims()[1] as u32,
                    func_volume.space.dims()[2] as u32,
                ),
            ],
            &[anat_transform, func_transform],
        );

        render_service
            .create_offscreen_target(150, 150)
            .expect("create offscreen target");
        render_service.update_frame_ubo(
            [0.0, 0.0, 0.0, 1.0],
            [15.0, 0.0, 0.0, 0.0],
            [0.0, 15.0, 0.0, 0.0],
        );

        let rendered_data = render_service.render_to_buffer().unwrap();

        // Verify overlay worked - center should show both gradient and sphere
        let center_idx = 75 * 150 * 4 + 75 * 4;
        let center_pixel = &rendered_data[center_idx..center_idx + 4];

        // Should have some red component from hot colormap overlay
        assert!(
            center_pixel[0] > center_pixel[1],
            "Overlay should add red component"
        );
        assert!(
            center_pixel[1] > 0,
            "Base grayscale should still be visible"
        );

        #[cfg(debug_assertions)]
        {
            use image::{ImageBuffer, Rgba};
            let img = ImageBuffer::<Rgba<u8>, _>::from_raw(150, 150, rendered_data)
                .expect("Failed to create image");
            img.save("debug_multi_resolution_overlay.png").ok();
        }

        println!("✓ Multi-resolution overlay rendered correctly");
    });
}

#[test]
fn test_pipeline_coordinate_accuracy() {
    use api_bridge::{create_api_bridge, VolumeLoadRequest};
    use render_loop::RenderLoopService;

    pollster::block_on(async {
        let temp_dir = TempDir::new().unwrap();
        let nifti_path = temp_dir.path().join("coords.nii.gz");

        // Create volume with single bright voxel at known location
        let mut data = Array3::<f32>::zeros((10, 10, 10));
        data[[3, 5, 7]] = 1000.0; // Single bright voxel

        save_test_nifti(&data, &nifti_path, [2.0, 2.0, 2.0]).unwrap();

        // Load and verify coordinates
        let api_bridge = create_api_bridge().await.unwrap();
        let handle = api_bridge
            .load_volume(VolumeLoadRequest {
                path: nifti_path.to_str().unwrap().to_string(),
                requested_space: None,
            })
            .await
            .unwrap();

        // Get world coordinates of the bright voxel
        let info = api_bridge.get_volume_info(handle).await.unwrap();

        // Expected world coordinates (with 2mm voxels and centered volume)
        // Voxel [3,5,7] -> World: [(3-5)*2, (5-5)*2, (7-5)*2] = [-4, 0, 4]
        let expected_world = Vector3::new(-4.0, 0.0, 4.0);

        // Sample at the expected world position
        let sampled_value = api_bridge
            .sample_volume_at_world(handle, expected_world.x, expected_world.y, expected_world.z)
            .await
            .unwrap();

        assert!(
            sampled_value > 900.0,
            "Should sample bright voxel, got {}",
            sampled_value
        );

        // Sample adjacent positions (should be zero)
        let adjacent_value = api_bridge
            .sample_volume_at_world(
                handle,
                expected_world.x + 2.0, // One voxel over
                expected_world.y,
                expected_world.z,
            )
            .await
            .unwrap();

        assert!(
            adjacent_value < 100.0,
            "Adjacent voxel should be dark, got {}",
            adjacent_value
        );

        println!("✓ Coordinate system accuracy verified");
    });
}

/// Helper to create a test render target and read back results
async fn render_and_readback(
    render_service: &mut RenderLoopService,
    width: u32,
    height: u32,
) -> Vec<u8> {
    render_service
        .create_offscreen_target(width, height)
        .expect("Failed to create offscreen target");
    render_service.render_to_buffer().expect("Failed to render")
}

#[test]
fn test_pipeline_performance_baseline() {
    use api_bridge::create_api_bridge;
    use render_loop::{FrameTimeTracker, RenderLoopService};
    use std::time::Instant;

    pollster::block_on(async {
        let temp_dir = TempDir::new().unwrap();

        // Create test volume
        let nifti_path = temp_dir.path().join("perf_test.nii.gz");
        let data = test_patterns::create_checkerboard_volume();
        save_test_nifti(&data, &nifti_path, [1.0, 1.0, 1.0]).unwrap();

        // Load through pipeline
        let api_bridge = create_api_bridge().await.unwrap();
        let handle = api_bridge
            .load_volume(VolumeLoadRequest {
                path: nifti_path.to_str().unwrap().to_string(),
                requested_space: None,
            })
            .await
            .unwrap();

        let volume_data = api_bridge.get_volume_for_rendering(handle).await.unwrap();

        // Set up rendering
        let mut render_service = RenderLoopService::new().await.unwrap();
        let (texture_handle, transform) = render_service.upload_volume_3d(&volume_data).unwrap();

        // Configure layer
        use render_loop::{BlendMode, LayerInfo, ThresholdMode};
        let volume_dims = volume_data.space.dims();
        let layer = LayerInfo {
            atlas_index: texture_handle,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            colormap_id: 0,
            intensity_range: (0.0, 1000.0),
            threshold_range: (-f32::INFINITY, f32::INFINITY),
            threshold_mode: ThresholdMode::Range,
            texture_coords: (0.0, 0.0, 1.0, 1.0),
            is_mask: false,
            interpolation_mode: 1,
        };

        render_service.update_layer_uniforms_direct(
            &[layer],
            &[(
                volume_dims[0] as u32,
                volume_dims[1] as u32,
                volume_dims[2] as u32,
            )],
            &[transform],
        );
        render_service
            .create_offscreen_target(256, 256)
            .expect("create offscreen target");

        // Benchmark rendering
        let mut tracker = FrameTimeTracker::new(100);

        for frame in 0..100 {
            // Animate camera position
            let angle = frame as f32 * 0.1;
            let distance = 15.0;
            let origin = [angle.cos() * distance, angle.sin() * distance, 0.0, 1.0];

            render_service.update_frame_ubo(origin, [10.0, 0.0, 0.0, 0.0], [0.0, 10.0, 0.0, 0.0]);

            let start = Instant::now();
            let _ = render_and_readback(&mut render_service, 256, 256).await;
            tracker.record_duration(start.elapsed());
        }

        println!("\nPipeline Performance Baseline:");
        println!("  Average: {:.2}ms", tracker.average_ms());
        println!("  FPS: {:.1}", tracker.fps());
        println!("  Min: {:.2}ms", tracker.min_ms());
        println!("  Max: {:.2}ms", tracker.max_ms());
        println!("  95th percentile: {:.2}ms", tracker.percentile_ms(95.0));

        // Ensure reasonable performance
        assert!(
            tracker.average_ms() < 50.0,
            "Rendering should be faster than 50ms"
        );
        assert!(tracker.fps() > 20.0, "Should achieve at least 20 FPS");
    });
}
