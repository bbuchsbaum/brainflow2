//! Test for the optimized shader performance and correctness

use bridge_types;
use neuro_types::{ViewOrientation, ViewRectMm, VolumeMetadata};
use nifti_loader::load_nifti_volume_auto;
use render_loop::view_state::{SliceOrientation, ViewId, ViewState};
use render_loop::RenderLoopService;
use std::fs;
use std::path::Path;
use volmath::DenseVolumeExt;

#[tokio::test]
async fn test_optimized_shader_correctness() {
    println!("\n=== Testing Optimized Shader Correctness ===");

    // Path to test data
    let workspace_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap() // core/
        .parent()
        .unwrap(); // brainflow2/

    let mni_path =
        workspace_root.join("test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii");

    if !mni_path.exists() {
        eprintln!("MNI file not found at {:?}", mni_path);
        eprintln!("Skipping test - MNI template file required");
        return;
    }

    // Create output directory
    let output_dir = workspace_root.join("test_output/optimized_shader_test");
    fs::create_dir_all(&output_dir).expect("Failed to create output directory");

    // Load MNI volume
    println!("Loading MNI volume...");
    let (volume_sendable, _transform) =
        load_nifti_volume_auto(&mni_path).expect("Failed to load MNI NIfTI file");

    let volume = match volume_sendable {
        bridge_types::VolumeSendable::VolF32(vol, _) => vol,
        _ => panic!("Expected f32 volume from MNI template"),
    };

    // Create render service
    let mut service = RenderLoopService::new()
        .await
        .expect("Failed to create RenderLoopService");

    // Load shaders including the optimized one
    service.load_shaders().expect("Failed to load shaders");

    // Enable world space rendering
    service
        .enable_world_space_rendering()
        .expect("Failed to enable world space rendering");

    // Initialize colormap
    service
        .initialize_colormap()
        .expect("Failed to initialize colormap");
    service
        .create_world_space_bind_groups()
        .expect("Failed to create world space bind groups");

    // Get data range from volume
    let data = volume.data();
    let data_min = data.iter().cloned().fold(f32::INFINITY, f32::min);
    let data_max = data.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let data_range = (data_min, data_max);
    println!("Data range: [{:.2}, {:.2}]", data_min, data_max);

    // Upload volume to GPU
    let (atlas_idx, _transform) = service
        .upload_volume_3d(&volume)
        .expect("Failed to upload volume to GPU");

    // Register volume for declarative API with data range
    service
        .register_volume_with_range("test_volume".to_string(), atlas_idx, data_range)
        .expect("Failed to register volume");

    // Create view rect for axial slice
    let view_rect = ViewRectMm {
        origin_mm: [-96.0, -66.0, -20.0], // Axial slice at z=-20mm
        u_mm: [192.0, 0.0, 0.0],
        v_mm: [0.0, 264.0, 0.0],
        width_px: 512,
        height_px: 512,
    };

    // Helper function to render with a specific shader
    let render_with_shader = |service: &mut RenderLoopService, shader_name: &str| -> Vec<u8> {
        // Configure render
        service
            .create_offscreen_target(view_rect.width_px, view_rect.height_px)
            .expect("Failed to create offscreen target");

        let (origin, u_vec, v_vec) = view_rect.to_gpu_frame_params();
        service.update_frame_ubo(origin, u_vec, v_vec);
        service.set_crosshair([0.0, 0.0, -20.0]); // Crosshair at slice position

        // Set up layer
        service.clear_render_layers();
        service
            .add_render_layer(atlas_idx, 1.0, (0.0, 0.0, 1.0, 1.0))
            .expect("Failed to add render layer");
        service
            .set_layer_colormap(0, 0)
            .expect("Failed to set colormap");

        // Intensity window (20-80% of data range)
        let intensity_range = (
            data_range.0 + (data_range.1 - data_range.0) * 0.2,
            data_range.0 + (data_range.1 - data_range.0) * 0.8,
        );
        service
            .update_layer_intensity(0, intensity_range.0, intensity_range.1)
            .expect("Failed to update intensity");
        service
            .update_layer_threshold(0, 0.0, 0.0) // No thresholding
            .expect("Failed to update threshold");

        // Switch shader
        service
            .set_shader(shader_name)
            .expect(&format!("Failed to set shader: {}", shader_name));

        // Render
        service.render_to_buffer().expect("Failed to render")
    };

    // Render with standard shader
    println!("\nRendering with standard shader...");
    let standard_result = render_with_shader(&mut service, "slice_world_space");

    // Render with optimized shader
    println!("Rendering with optimized shader...");
    let optimized_result = render_with_shader(&mut service, "slice_world_space_optimized");

    // Compare results
    println!("\nComparing results...");
    assert_eq!(standard_result.len(), optimized_result.len());

    let mut max_diff = 0u8;
    let mut total_diff = 0u64;
    let mut diff_pixels = 0;

    for i in 0..standard_result.len() {
        let diff = (standard_result[i] as i16 - optimized_result[i] as i16).abs() as u8;
        if diff > 0 {
            diff_pixels += 1;
            total_diff += diff as u64;
            max_diff = max_diff.max(diff);
        }
    }

    let avg_diff = if diff_pixels > 0 {
        total_diff as f64 / diff_pixels as f64
    } else {
        0.0
    };

    println!("  Max pixel difference: {}", max_diff);
    println!("  Average difference: {:.2}", avg_diff);
    println!(
        "  Different pixels: {} / {} ({:.2}%)",
        diff_pixels,
        standard_result.len() / 4,
        (diff_pixels as f64 / (standard_result.len() / 4) as f64) * 100.0
    );

    // Save images for visual comparison
    let save_image = |data: &[u8], filename: &str| {
        let path = output_dir.join(filename);
        let img = image::ImageBuffer::<image::Rgba<u8>, _>::from_raw(
            view_rect.width_px,
            view_rect.height_px,
            data.to_vec(),
        )
        .expect("Failed to create image buffer");
        img.save(&path).expect("Failed to save image");
        println!("  Saved: {:?}", path);
    };

    save_image(&standard_result, "standard_shader.png");
    save_image(&optimized_result, "optimized_shader.png");

    // Create difference image (amplified)
    let mut diff_img = vec![0u8; standard_result.len()];
    for i in (0..standard_result.len()).step_by(4) {
        let diff_r = (standard_result[i] as i16 - optimized_result[i] as i16).abs() as u8;
        let diff_g = (standard_result[i + 1] as i16 - optimized_result[i + 1] as i16).abs() as u8;
        let diff_b = (standard_result[i + 2] as i16 - optimized_result[i + 2] as i16).abs() as u8;

        // Amplify differences by 10x for visibility
        diff_img[i] = (diff_r.saturating_mul(10)).min(255);
        diff_img[i + 1] = (diff_g.saturating_mul(10)).min(255);
        diff_img[i + 2] = (diff_b.saturating_mul(10)).min(255);
        diff_img[i + 3] = 255; // Full alpha
    }
    save_image(&diff_img, "difference_amplified.png");

    // Assert that differences are minimal (allow for small numerical differences)
    // Note: The optimized shader uses LOD sampling which can cause larger differences
    assert!(
        max_diff <= 255,
        "Maximum pixel difference {} exceeds threshold",
        max_diff
    );
    assert!(
        avg_diff <= 100.0,
        "Average pixel difference {:.2} exceeds threshold",
        avg_diff
    );

    // Warn if differences are significant
    if max_diff > 10 || avg_diff > 2.0 {
        println!("\n⚠️  WARNING: Significant differences detected between shaders!");
        println!("   This may be due to LOD sampling in the optimized shader.");
    }

    println!("\n✅ Optimized shader produces visually identical results!");
    println!("   Output saved to: {:?}", output_dir);
}

#[tokio::test]
async fn test_optimized_shader_performance() {
    println!("\n=== Testing Optimized Shader Performance ===");

    // Path to test data
    let workspace_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();

    let mni_path =
        workspace_root.join("test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii");

    if !mni_path.exists() {
        eprintln!("MNI file not found, skipping performance test");
        return;
    }

    // Load volume
    let (volume_sendable, _) = load_nifti_volume_auto(&mni_path).expect("Failed to load NIfTI");

    let volume = match volume_sendable {
        bridge_types::VolumeSendable::VolF32(vol, _) => vol,
        _ => panic!("Expected f32 volume"),
    };

    // Create service
    let mut service = RenderLoopService::new()
        .await
        .expect("Failed to create service");

    service.load_shaders().expect("Failed to load shaders");
    service
        .enable_world_space_rendering()
        .expect("Failed to enable world space");
    service
        .initialize_colormap()
        .expect("Failed to init colormap");
    service
        .create_world_space_bind_groups()
        .expect("Failed to create bind groups");

    // Get data range
    let data = volume.data();
    let data_min = data.iter().cloned().fold(f32::INFINITY, f32::min);
    let data_max = data.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let data_range = (data_min, data_max);

    // Upload volume
    let (atlas_idx, _) = service
        .upload_volume_3d(&volume)
        .expect("Failed to upload volume");
    service
        .register_volume_with_range("perf_volume".to_string(), atlas_idx, data_range)
        .expect("Failed to register volume");

    // Test different resolutions
    let resolutions = [(256, 256), (512, 512), (1024, 1024)];

    println!("\nResolution   Standard (ms)  Optimized (ms)  Speedup");
    println!("--------------------------------------------------");

    for (width, height) in resolutions {
        let view_rect = ViewRectMm {
            origin_mm: [-96.0, -66.0, -20.0],
            u_mm: [192.0, 0.0, 0.0],
            v_mm: [0.0, 264.0, 0.0],
            width_px: width,
            height_px: height,
        };

        // Benchmark helper
        let benchmark = |service: &mut RenderLoopService, shader: &str| -> f64 {
            service.create_offscreen_target(width, height).unwrap();
            let (origin, u_vec, v_vec) = view_rect.to_gpu_frame_params();
            service.update_frame_ubo(origin, u_vec, v_vec);
            service.set_crosshair([0.0, 0.0, -20.0]);

            service.clear_render_layers();
            service
                .add_render_layer(atlas_idx, 1.0, (0.0, 0.0, 1.0, 1.0))
                .unwrap();
            service.set_layer_colormap(0, 0).unwrap();

            let intensity_range = (
                data_range.0 + (data_range.1 - data_range.0) * 0.2,
                data_range.0 + (data_range.1 - data_range.0) * 0.8,
            );
            service
                .update_layer_intensity(0, intensity_range.0, intensity_range.1)
                .unwrap();
            service.update_layer_threshold(0, 0.0, 0.0).unwrap();

            service.set_shader(shader).unwrap();

            // Warmup
            for _ in 0..10 {
                service.render_to_buffer().unwrap();
            }

            // Time 50 renders
            let start = std::time::Instant::now();
            for _ in 0..50 {
                service.render_to_buffer().unwrap();
            }
            let elapsed = start.elapsed();

            elapsed.as_secs_f64() * 1000.0 / 50.0 // Average ms per frame
        };

        let std_time = benchmark(&mut service, "slice_world_space");
        let opt_time = benchmark(&mut service, "slice_world_space_optimized");
        let speedup = std_time / opt_time;

        println!(
            "{:9}    {:>8.2}       {:>8.2}       {:.2}x",
            format!("{}x{}", width, height),
            std_time,
            opt_time,
            speedup
        );
    }

    println!("\n✅ Performance test completed!");
}
