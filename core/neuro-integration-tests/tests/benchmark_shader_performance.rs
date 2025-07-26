use render_loop::RenderLoopService;
use nifti_loader::load_nifti_volume_auto;
use std::path::Path;
use std::time::Instant;
use neuro_types::ViewRectMm;
use bridge_types;
use volmath::DenseVolumeExt;

/// Benchmark configuration
const NUM_WARMUP_RUNS: u32 = 10;
const NUM_BENCHMARK_RUNS: u32 = 100;
const BENCHMARK_DIMENSIONS: [(u32, u32); 3] = [
    (256, 256),   // Small
    (512, 512),   // Medium  
    (1024, 1024), // Large
];

/// Run benchmark for a specific shader and configuration
async fn benchmark_shader_render(
    service: &mut RenderLoopService,
    shader_name: &str,
    atlas_idx: u32,
    view_rect: &ViewRectMm,
    data_range: (f32, f32),
    warmup_runs: u32,
    benchmark_runs: u32,
) -> (f64, f64, f64) { // Returns (mean_ms, min_ms, max_ms)
    // Configure render parameters
    service.create_offscreen_target(view_rect.width_px, view_rect.height_px)
        .expect("Failed to create offscreen target");
    
    let (origin, u_vec, v_vec) = view_rect.to_gpu_frame_params();
    service.update_frame_ubo(origin, u_vec, v_vec);
    service.set_crosshair([0.0, 0.0, 0.0]);
    
    // Set up layer
    service.clear_render_layers();
    service.add_render_layer(atlas_idx, 1.0, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add render layer");
    service.set_layer_colormap(0, 0)
        .expect("Failed to set colormap");
    
    // Calculate intensity window (20-80% of data range)
    let intensity_range = (
        data_range.0 + (data_range.1 - data_range.0) * 0.2,
        data_range.0 + (data_range.1 - data_range.0) * 0.8
    );
    service.update_layer_intensity(0, intensity_range.0, intensity_range.1)
        .expect("Failed to update intensity");
    service.update_layer_threshold(0, 0.0, 0.0)
        .expect("Failed to update threshold");
    
    // Switch to the specified shader
    service.set_shader(shader_name)
        .expect(&format!("Failed to set shader: {}", shader_name));
    
    // Warmup runs
    for _ in 0..warmup_runs {
        let _ = service.render_to_buffer()
            .expect("Warmup render failed");
    }
    
    // Benchmark runs
    let mut timings = Vec::with_capacity(benchmark_runs as usize);
    
    for _ in 0..benchmark_runs {
        let start = Instant::now();
        let _ = service.render_to_buffer()
            .expect("Benchmark render failed");
        let elapsed = start.elapsed();
        timings.push(elapsed.as_secs_f64() * 1000.0); // Convert to milliseconds
    }
    
    // Calculate statistics
    let mean = timings.iter().sum::<f64>() / timings.len() as f64;
    let min = timings.iter().cloned().fold(f64::INFINITY, f64::min);
    let max = timings.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    
    (mean, min, max)
}

#[tokio::test]
async fn benchmark_standard_vs_optimized_shader() {
    println!("\n=== GPU Shader Performance Benchmark ===");
    println!("Comparing standard vs optimized world-space shaders");
    println!("Warmup runs: {}", NUM_WARMUP_RUNS);
    println!("Benchmark runs: {}", NUM_BENCHMARK_RUNS);
    
    // Path to test data
    let workspace_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap()  // core/
        .parent().unwrap(); // brainflow2/
    
    let mni_path = workspace_root
        .join("test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii");
    
    if !mni_path.exists() {
        eprintln!("MNI file not found at {:?}", mni_path);
        eprintln!("Skipping benchmark - MNI template file required");
        return;
    }
    
    // Load MNI volume
    println!("\nLoading MNI volume...");
    let (volume_sendable, _transform) = load_nifti_volume_auto(&mni_path)
        .expect("Failed to load MNI NIfTI file");
    
    let volume = match volume_sendable {
        bridge_types::VolumeSendable::VolF32(vol, _) => vol,
        _ => panic!("Expected f32 volume from MNI template"),
    };
    
    // Create render service
    let mut service = RenderLoopService::new()
        .await
        .expect("Failed to create RenderLoopService");
    
    // Load shaders including the optimized one
    service.load_shaders()
        .expect("Failed to load shaders");
    
    // Enable world space rendering
    service.enable_world_space_rendering()
        .expect("Failed to enable world space rendering");
    
    // Initialize colormap
    service.initialize_colormap()
        .expect("Failed to initialize colormap");
    service.create_world_space_bind_groups()
        .expect("Failed to create world space bind groups");
    
    // Get data range from volume
    let data = volume.data();
    let data_min = data.iter().cloned().fold(f32::INFINITY, f32::min);
    let data_max = data.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let data_range = (data_min, data_max);
    
    // Upload volume to GPU
    let (atlas_idx, _transform) = service.upload_volume_3d(&volume)
        .expect("Failed to upload volume to GPU");
    
    // Also register volume for declarative API with data range
    service.register_volume_with_range("benchmark_volume".to_string(), atlas_idx, data_range)
        .expect("Failed to register volume");
    
    println!("\nRunning benchmarks for different resolutions:");
    println!("{:<12} {:<20} {:<20} {:<20} {:<20}", 
        "Resolution", "Standard (ms)", "Optimized (ms)", "Speedup", "Improvement");
    println!("{}", "-".repeat(92));
    
    for (width, height) in BENCHMARK_DIMENSIONS {
        // Create view rect for this resolution
        let view_rect = ViewRectMm {
            origin_mm: [-96.0, -66.0, -72.0],
            u_mm: [192.0, 0.0, 0.0],
            v_mm: [0.0, 264.0, 0.0],
            width_px: width,
            height_px: height,
        };
        
        // Benchmark standard shader
        let (standard_mean, standard_min, standard_max) = benchmark_shader_render(
            &mut service,
            "slice_world_space",
            atlas_idx,
            &view_rect,
            data_range,
            NUM_WARMUP_RUNS,
            NUM_BENCHMARK_RUNS
        ).await;
        
        // Benchmark optimized shader
        let (optimized_mean, optimized_min, optimized_max) = benchmark_shader_render(
            &mut service,
            "slice_world_space_optimized",
            atlas_idx,
            &view_rect,
            data_range,
            NUM_WARMUP_RUNS,
            NUM_BENCHMARK_RUNS
        ).await;
        
        // Calculate speedup
        let speedup = standard_mean / optimized_mean;
        let improvement_pct = ((standard_mean - optimized_mean) / standard_mean) * 100.0;
        
        // Print results for this resolution
        println!("{:<12} {:>8.2} ± {:>6.2} {:>8.2} ± {:>6.2} {:>8.2}x {:>8.1}%",
            format!("{}x{}", width, height),
            standard_mean,
            standard_max - standard_min,
            optimized_mean,
            optimized_max - optimized_min,
            speedup,
            improvement_pct
        );
    }
    
    println!("\nBenchmark complete!");
    println!("\nNotes:");
    println!("- Times shown are mean ± range (in milliseconds)");
    println!("- Speedup is the ratio of standard/optimized times");
    println!("- Improvement % shows the relative performance gain");
    
    // Additional detailed benchmark for 512x512
    println!("\n\nDetailed benchmark for 512x512:");
    let detailed_view = ViewRectMm {
        origin_mm: [-96.0, -66.0, -72.0],
        u_mm: [192.0, 0.0, 0.0],
        v_mm: [0.0, 264.0, 0.0],
        width_px: 512,
        height_px: 512,
    };
    
    // Run more detailed benchmark
    let num_detailed_runs = 500;
    println!("Running {} iterations for detailed analysis...", num_detailed_runs);
    
    let (std_mean, std_min, std_max) = benchmark_shader_render(
        &mut service,
        "slice_world_space",
        atlas_idx,
        &detailed_view,
        data_range,
        NUM_WARMUP_RUNS,
        num_detailed_runs
    ).await;
    
    let (opt_mean, opt_min, opt_max) = benchmark_shader_render(
        &mut service,
        "slice_world_space_optimized",
        atlas_idx,
        &detailed_view,
        data_range,
        NUM_WARMUP_RUNS,
        num_detailed_runs
    ).await;
    
    println!("\nStandard shader statistics:");
    println!("  Mean:  {:.3} ms", std_mean);
    println!("  Min:   {:.3} ms", std_min);
    println!("  Max:   {:.3} ms", std_max);
    println!("  Range: {:.3} ms", std_max - std_min);
    
    println!("\nOptimized shader statistics:");
    println!("  Mean:  {:.3} ms", opt_mean);
    println!("  Min:   {:.3} ms", opt_min);
    println!("  Max:   {:.3} ms", opt_max);
    println!("  Range: {:.3} ms", opt_max - opt_min);
    
    println!("\nPerformance improvement:");
    println!("  Speedup:     {:.2}x", std_mean / opt_mean);
    println!("  Time saved:  {:.3} ms per frame", std_mean - opt_mean);
    println!("  Improvement: {:.1}%", ((std_mean - opt_mean) / std_mean) * 100.0);
    
    if opt_mean < std_mean {
        println!("\n✅ Optimized shader is faster!");
    } else if opt_mean > std_mean {
        println!("\n⚠️  Optimized shader is slower - may need investigation");
    } else {
        println!("\n➖ Both shaders have similar performance");
    }
}

#[tokio::test] 
async fn benchmark_shader_with_multiple_layers() {
    println!("\n=== Multi-Layer Shader Performance Benchmark ===");
    println!("Testing shader performance with multiple overlapping volumes");
    
    // Path to test data
    let workspace_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap()
        .parent().unwrap();
    
    let mni_path = workspace_root
        .join("test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii");
    
    if !mni_path.exists() {
        eprintln!("MNI file not found, skipping multi-layer benchmark");
        return;
    }
    
    // Load volume
    let (volume_sendable, _transform) = load_nifti_volume_auto(&mni_path)
        .expect("Failed to load NIfTI");
    
    let volume = match volume_sendable {
        bridge_types::VolumeSendable::VolF32(vol, _) => vol,
        _ => panic!("Expected f32 volume from MNI template"),
    };
    
    // Create service
    let mut service = RenderLoopService::new()
        .await
        .expect("Failed to create service");
    
    service.load_shaders()
        .expect("Failed to load shaders");
    
    // Enable world space rendering
    service.enable_world_space_rendering()
        .expect("Failed to enable world space rendering");
    
    // Initialize colormap
    service.initialize_colormap()
        .expect("Failed to initialize colormap");
    service.create_world_space_bind_groups()
        .expect("Failed to create world space bind groups");
    
    // Get data range
    let data = volume.data();
    let data_min = data.iter().cloned().fold(f32::INFINITY, f32::min);
    let data_max = data.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let data_range = (data_min, data_max);
    
    // Upload multiple copies of the volume to simulate layers
    let num_layers = 4;
    let mut atlas_indices = Vec::new();
    
    for i in 0..num_layers {
        let (atlas_idx, _) = service.upload_volume_3d(&volume)
            .expect(&format!("Failed to upload volume {}", i));
        atlas_indices.push(atlas_idx);
        
        // Register for declarative API
        service.register_volume_with_range(
            format!("benchmark_volume_{}", i), 
            atlas_idx, 
            data_range
        ).expect(&format!("Failed to register volume {}", i));
    }
    
    // Create view rect
    let view_rect = ViewRectMm {
        origin_mm: [-96.0, -66.0, -72.0],
        u_mm: [192.0, 0.0, 0.0],
        v_mm: [0.0, 264.0, 0.0],
        width_px: 512,
        height_px: 512,
    };
    
    println!("\nBenchmarking with 1 to {} layers:", num_layers);
    println!("{:<10} {:<20} {:<20} {:<20}", 
        "Layers", "Standard (ms)", "Optimized (ms)", "Speedup");
    println!("{}", "-".repeat(70));
    
    for layer_count in 1..=num_layers {
        // Benchmark function for multi-layer setup
        let benchmark_multi = |service: &mut RenderLoopService, shader: &str| -> f64 {
            service.set_shader(shader).unwrap();
            service.create_offscreen_target(view_rect.width_px, view_rect.height_px).unwrap();
            
            let (origin, u_vec, v_vec) = view_rect.to_gpu_frame_params();
            service.update_frame_ubo(origin, u_vec, v_vec);
            service.set_crosshair([0.0, 0.0, 0.0]);
            
            // Clear and add layers
            service.clear_render_layers();
            for i in 0..layer_count {
                let opacity = if i == 0 { 1.0 } else { 0.5 }; // Base layer opaque, overlays semi-transparent
                service.add_render_layer(atlas_indices[i], opacity, (0.0, 0.0, 1.0, 1.0)).unwrap();
                service.set_layer_colormap(i, (i % 5) as u32).unwrap(); // Vary colormaps
                let intensity_range = (
                    data_min + (data_max - data_min) * 0.2,
                    data_min + (data_max - data_min) * 0.8
                );
                service.update_layer_intensity(i, intensity_range.0, intensity_range.1).unwrap();
                service.update_layer_threshold(i, 0.0, 0.0).unwrap();
            }
            
            // Warmup
            for _ in 0..10 {
                service.render_to_buffer().unwrap();
            }
            
            // Benchmark
            let mut times = Vec::new();
            for _ in 0..50 {
                let start = Instant::now();
                service.render_to_buffer().unwrap();
                times.push(start.elapsed().as_secs_f64() * 1000.0);
            }
            
            times.iter().sum::<f64>() / times.len() as f64
        };
        
        let std_mean = benchmark_multi(&mut service, "slice_world_space");
        let opt_mean = benchmark_multi(&mut service, "slice_world_space_optimized");
        let speedup = std_mean / opt_mean;
        
        println!("{:<10} {:>8.3} {:>20.3} {:>20.2}x",
            layer_count,
            std_mean,
            opt_mean,
            speedup
        );
    }
    
    println!("\n📊 Analysis:");
    println!("- The optimized shader should maintain its performance advantage");
    println!("- Benefits may be more pronounced with multiple layers");
    println!("- Early exit optimization helps when layers have transparency");
}

#[tokio::test]
async fn profile_shader_differences() {
    println!("\n=== Shader Performance Profiling ===");
    println!("Analyzing performance differences between standard and optimized shaders");
    
    // Path to test data
    let workspace_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap()
        .parent().unwrap();
    
    let mni_path = workspace_root
        .join("test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii");
    
    if !mni_path.exists() {
        eprintln!("MNI file not found, skipping profiling");
        return;
    }
    
    // Load volume
    let (volume_sendable, _transform) = load_nifti_volume_auto(&mni_path)
        .expect("Failed to load NIfTI");
    
    let volume = match volume_sendable {
        bridge_types::VolumeSendable::VolF32(vol, _) => vol,
        _ => panic!("Expected f32 volume"),
    };
    
    // Create service
    let mut service = RenderLoopService::new()
        .await
        .expect("Failed to create service");
    
    service.load_shaders()
        .expect("Failed to load shaders");
    service.enable_world_space_rendering()
        .expect("Failed to enable world space rendering");
    service.initialize_colormap()
        .expect("Failed to initialize colormap");
    service.create_world_space_bind_groups()
        .expect("Failed to create bind groups");
    
    // Get data range
    let data = volume.data();
    let data_min = data.iter().cloned().fold(f32::INFINITY, f32::min);
    let data_max = data.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let data_range = (data_min, data_max);
    
    // Upload volume
    let (atlas_idx, _) = service.upload_volume_3d(&volume)
        .expect("Failed to upload volume");
    service.register_volume_with_range("profile_volume".to_string(), atlas_idx, data_range)
        .expect("Failed to register volume");
    
    // Test different scenarios
    println!("\nScenario 1: Single layer, full opacity");
    let view_rect = ViewRectMm {
        origin_mm: [-96.0, -66.0, -72.0],
        u_mm: [192.0, 0.0, 0.0],
        v_mm: [0.0, 264.0, 0.0],
        width_px: 512,
        height_px: 512,
    };
    
    let (std_time, _) = profile_shader_scenario(
        &mut service, 
        "slice_world_space", 
        atlas_idx, 
        &view_rect, 
        data_range,
        1.0,  // opacity
        false // no threshold
    ).await;
    
    let (opt_time, _) = profile_shader_scenario(
        &mut service, 
        "slice_world_space_optimized", 
        atlas_idx, 
        &view_rect, 
        data_range,
        1.0,  // opacity
        false // no threshold
    ).await;
    
    println!("  Standard:  {:.3} ms", std_time);
    println!("  Optimized: {:.3} ms (speedup: {:.2}x)", opt_time, std_time / opt_time);
    
    println!("\nScenario 2: Single layer with thresholding");
    let (std_time_thresh, _) = profile_shader_scenario(
        &mut service, 
        "slice_world_space", 
        atlas_idx, 
        &view_rect, 
        data_range,
        1.0,  // opacity
        true  // with threshold
    ).await;
    
    let (opt_time_thresh, _) = profile_shader_scenario(
        &mut service, 
        "slice_world_space_optimized", 
        atlas_idx, 
        &view_rect, 
        data_range,
        1.0,  // opacity
        true  // with threshold
    ).await;
    
    println!("  Standard:  {:.3} ms", std_time_thresh);
    println!("  Optimized: {:.3} ms (speedup: {:.2}x)", opt_time_thresh, std_time_thresh / opt_time_thresh);
    
    println!("\nScenario 3: Semi-transparent layer (early exit test)");
    let (std_time_alpha, _) = profile_shader_scenario(
        &mut service, 
        "slice_world_space", 
        atlas_idx, 
        &view_rect, 
        data_range,
        0.5,  // semi-transparent
        false // no threshold
    ).await;
    
    let (opt_time_alpha, _) = profile_shader_scenario(
        &mut service, 
        "slice_world_space_optimized", 
        atlas_idx, 
        &view_rect, 
        data_range,
        0.5,  // semi-transparent
        false // no threshold
    ).await;
    
    println!("  Standard:  {:.3} ms", std_time_alpha);
    println!("  Optimized: {:.3} ms (speedup: {:.2}x)", opt_time_alpha, std_time_alpha / opt_time_alpha);
    
    println!("\n🔍 Performance Analysis:");
    println!("LOD sampling overhead: {:.1}%", 
        ((opt_time - std_time) / std_time) * 100.0);
    println!("Threshold optimization impact: {:.1}%", 
        ((opt_time_thresh - std_time_thresh) / std_time_thresh) * 100.0);
    println!("Early exit benefit: {:.1}%",
        ((opt_time_alpha - std_time_alpha) / std_time_alpha) * 100.0);
    
    // Key difference analysis
    println!("\n🔑 Key Differences:");
    println!("1. Optimized shader uses LOD-based texture sampling");
    println!("2. Optimized shader has precomputed inv_intensity_delta");
    println!("3. Optimized shader uses select() for reduced branching");
    println!("4. Optimized shader has early exit for transparent layers");
    
    // Performance hypothesis
    println!("\n💡 Performance Hypothesis:");
    if opt_time > std_time {
        println!("❌ LOD calculation overhead may exceed cache coherence benefits");
        println!("❌ Additional per-pixel computations (pixel_size, LOD) add cost");
        println!("❌ Early exit benefits may not compensate for extra work");
    } else {
        println!("✅ Optimizations are providing expected performance gains");
    }
}

// Helper function for profiling specific scenarios
async fn profile_shader_scenario(
    service: &mut RenderLoopService,
    shader_name: &str,
    atlas_idx: u32,
    view_rect: &ViewRectMm,
    data_range: (f32, f32),
    opacity: f32,
    use_threshold: bool,
) -> (f64, f64) { // Returns (mean_ms, std_dev)
    // Configure render
    service.create_offscreen_target(view_rect.width_px, view_rect.height_px)
        .expect("Failed to create offscreen target");
    
    let (origin, u_vec, v_vec) = view_rect.to_gpu_frame_params();
    service.update_frame_ubo(origin, u_vec, v_vec);
    service.set_crosshair([0.0, 0.0, 0.0]);
    
    // Set up layer
    service.clear_render_layers();
    service.add_render_layer(atlas_idx, opacity, (0.0, 0.0, 1.0, 1.0))
        .expect("Failed to add render layer");
    service.set_layer_colormap(0, 0)
        .expect("Failed to set colormap");
    
    // Intensity window
    let intensity_range = (
        data_range.0 + (data_range.1 - data_range.0) * 0.2,
        data_range.0 + (data_range.1 - data_range.0) * 0.8
    );
    service.update_layer_intensity(0, intensity_range.0, intensity_range.1)
        .expect("Failed to update intensity");
    
    // Threshold setup
    if use_threshold {
        // Set threshold to hide middle 50% of intensity range
        let thresh_low = data_range.0 + (data_range.1 - data_range.0) * 0.25;
        let thresh_high = data_range.0 + (data_range.1 - data_range.0) * 0.75;
        service.update_layer_threshold(0, thresh_low, thresh_high)
            .expect("Failed to update threshold");
    } else {
        service.update_layer_threshold(0, 0.0, 0.0)
            .expect("Failed to update threshold");
    }
    
    // Switch shader
    service.set_shader(shader_name)
        .expect(&format!("Failed to set shader: {}", shader_name));
    
    // Warmup
    for _ in 0..20 {
        let _ = service.render_to_buffer()
            .expect("Warmup render failed");
    }
    
    // Benchmark
    let mut timings = Vec::with_capacity(100);
    for _ in 0..100 {
        let start = Instant::now();
        let _ = service.render_to_buffer()
            .expect("Benchmark render failed");
        let elapsed = start.elapsed();
        timings.push(elapsed.as_secs_f64() * 1000.0);
    }
    
    // Calculate stats
    let mean = timings.iter().sum::<f64>() / timings.len() as f64;
    let variance = timings.iter()
        .map(|t| (t - mean).powi(2))
        .sum::<f64>() / timings.len() as f64;
    let std_dev = variance.sqrt();
    
    (mean, std_dev)
}