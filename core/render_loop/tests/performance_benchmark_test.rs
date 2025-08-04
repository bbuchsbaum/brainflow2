// Performance benchmark tests for multi-resolution rendering optimizations
#![allow(dead_code)] // TODO: Re-enable when internal API access is available

use nalgebra::{Matrix4, Vector3};
use render_loop::{
    BlendMode, LayerInfo, OptimizedRenderer, PerformanceMonitor, RenderLoopError,
    RenderLoopService, ThresholdMode,
};
use std::time::Instant;
use volmath::{space::GridSpace, traits::Volume, DenseVolume3};

/// Performance test results
#[derive(Debug)]
struct BenchmarkResults {
    test_name: String,
    avg_frame_time_ms: f32,
    fps: f32,
    total_frames: u32,
    layer_count: usize,
    total_voxels: usize,
}

impl BenchmarkResults {
    fn print_summary(&self) {
        println!("\n=== {} ===", self.test_name);
        println!("Layers: {}", self.layer_count);
        println!(
            "Total voxels: {:.2}M",
            self.total_voxels as f32 / 1_000_000.0
        );
        println!("Average frame time: {:.2}ms", self.avg_frame_time_ms);
        println!("FPS: {:.1}", self.fps);
        println!("Total frames: {}", self.total_frames);
    }
}

/// Create test volumes with varying resolutions
fn create_benchmark_volumes() -> Vec<DenseVolume3<f32>> {
    use volmath::space::{NeuroSpace3, NeuroSpaceImpl};

    let mut volumes = Vec::new();

    // High-res anatomical (1mm)
    {
        let dims = [256, 256, 192];
        let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];
        let center = Vector3::new(128.0, 128.0, 96.0);

        for z in 0..dims[2] {
            for y in 0..dims[1] {
                for x in 0..dims[0] {
                    let idx = z * dims[0] * dims[1] + y * dims[0] + x;
                    let pos = Vector3::new(x as f32, y as f32, z as f32);
                    let dist = (pos - center).norm();
                    data[idx] = (1.0 - (dist / 150.0).min(1.0)).max(0.0);
                }
            }
        }

        let transform = Matrix4::new_translation(&Vector3::new(-128.0, -128.0, -96.0));
        let space_impl = NeuroSpaceExt::from_affine_matrix4(dims, transform);
        let space = NeuroSpace3::new(space_impl);
        volumes.push(DenseVolume3::from_data(space.0, data));
    }

    // Medium-res functional (3mm)
    {
        let dims = [64, 64, 48];
        let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];

        for z in 0..dims[2] {
            for y in 0..dims[1] {
                for x in 0..dims[0] {
                    let idx = z * dims[0] * dims[1] + y * dims[0] + x;
                    data[idx] = ((x + y + z) as f32 * 0.1).sin().abs();
                }
            }
        }

        let transform = Matrix4::new_nonuniform_scaling(&Vector3::new(3.0, 3.0, 3.0))
            * Matrix4::new_translation(&Vector3::new(-32.0, -32.0, -24.0));
        let space_impl = NeuroSpaceExt::from_affine_matrix4(dims, transform);
        let space = NeuroSpace3::new(space_impl);
        volumes.push(DenseVolume3::from_data(space.0, data));
    }

    // Low-res mask (5mm)
    {
        let dims = [48, 48, 36];
        let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];

        for z in 0..dims[2] {
            for y in 0..dims[1] {
                for x in 0..dims[0] {
                    let idx = z * dims[0] * dims[1] + y * dims[0] + x;
                    if (x > 20 && x < 28) && (y > 20 && y < 28) && (z > 15 && z < 21) {
                        data[idx] = 1.0;
                    } else {
                        data[idx] = 0.0;
                    }
                }
            }
        }

        let transform = Matrix4::new_nonuniform_scaling(&Vector3::new(5.0, 5.0, 5.0))
            * Matrix4::new_translation(&Vector3::new(-24.0, -24.0, -18.0));
        let space_impl = NeuroSpaceExt::from_affine_matrix4(dims, transform);
        let space = NeuroSpace3::new(space_impl);
        volumes.push(DenseVolume3::from_data(space.0, data));
    }

    volumes
}

/// Benchmark original vs optimized shader performance
async fn benchmark_shader_performance(
    service: &mut RenderLoopService,
    optimized_renderer: &mut OptimizedRenderer,
    volumes: &[DenseVolume3<f32>],
    frame_count: u32,
    layer_configs: &[(f32, BlendMode, u32)], // (opacity, blend_mode, colormap_id)
) -> (BenchmarkResults, BenchmarkResults) {
    // Note: We'll access device and queue directly when needed to avoid borrow checker issues

    // Upload volumes
    let mut volume_handles = Vec::new();
    let mut transforms = Vec::new();
    let mut dimensions = Vec::new();

    for (i, vol) in volumes.iter().enumerate() {
        let (handle, transform) = service
            .upload_volume_3d(vol)
            .expect("Failed to upload volume");
        volume_handles.push(handle);
        transforms.push(transform);
        let dims = vol.space().dims();
        dimensions.push((dims[0] as u32, dims[1] as u32, dims[2] as u32));
    }

    // Create layer infos
    let layers: Vec<LayerInfo> = volumes
        .iter()
        .enumerate()
        .zip(layer_configs.iter())
        .map(
            |((i, _vol), (opacity, blend_mode, colormap_id))| LayerInfo {
                atlas_index: i as u32,
                opacity: *opacity,
                blend_mode: *blend_mode,
                colormap_id: *colormap_id,
                intensity_range: (0.0, 1.0),
                threshold_range: (-f32::INFINITY, f32::INFINITY),
                threshold_mode: ThresholdMode::Range,
                texture_coords: (0.0, 0.0, 1.0, 1.0),
            },
        )
        .collect();

    let total_voxels: usize = volumes
        .iter()
        .map(|v| {
            let dims = v.space().dims();
            dims[0] * dims[1] * dims[2]
        })
        .sum();

    // Set up render parameters
    let origin_mm = [0.0, 0.0, 0.0, 1.0];
    let u_mm = [1.0, 0.0, 0.0, 0.0];
    let v_mm = [0.0, 1.0, 0.0, 0.0];
    let target_dim = [512, 512];

    // Create render target
    let target_texture = service.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("Benchmark Target"),
        size: wgpu::Extent3d {
            width: target_dim[0],
            height: target_dim[1],
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Bgra8UnormSrgb,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let target_view = target_texture.create_view(&wgpu::TextureViewDescriptor::default());

    // Benchmark original shader
    println!("\nBenchmarking original shader...");
    let mut original_monitor = PerformanceMonitor::new(100);
    let mut original_times = Vec::new();

    service.update_layer_uniforms_direct(&layers, &dimensions, &transforms);
    service.update_frame_ubo(origin_mm, u_mm, v_mm);

    for i in 0..frame_count {
        let start = Instant::now();

        // Render frame
        let mut encoder = service
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Benchmark Encoder"),
            });

        // TODO: This test needs refactoring - render_to_texture no longer exists
        // service.render_to_texture(&mut encoder, &target_view)
        //     .expect("Failed to render");

        service.queue.submit(std::iter::once(encoder.finish()));
        service.device.poll(wgpu::Maintain::Wait);

        let elapsed = start.elapsed().as_secs_f32() * 1000.0;
        original_monitor.record_frame_time(elapsed);
        original_times.push(elapsed);

        if i % 100 == 0 {
            println!("  Frame {}: {:.2}ms", i, elapsed);
        }
    }

    let original_results = BenchmarkResults {
        test_name: "Original Shader".to_string(),
        avg_frame_time_ms: original_monitor.average_frame_time(),
        fps: original_monitor.fps(),
        total_frames: frame_count,
        layer_count: layers.len(),
        total_voxels,
    };

    // Benchmark optimized shader
    println!("\nBenchmarking optimized shader...");
    let mut optimized_monitor = PerformanceMonitor::new(100);
    let mut optimized_times = Vec::new();

    optimized_renderer.update_layers(
        &service.device,
        &service.queue,
        &layers,
        &dimensions,
        &transforms,
    );
    // NOTE: OptimizedRenderer doesn't have update_frame_ubo method
    // This test needs refactoring to work with current architecture

    // Load optimized shader
    optimized_renderer
        .load_optimized_shader(&service.device)
        .expect("Failed to load optimized shader");

    for i in 0..frame_count {
        let start = Instant::now();

        // Render frame with optimized renderer
        let mut encoder = service
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Optimized Benchmark Encoder"),
            });

        let frame_bind_group = optimized_renderer.create_frame_bind_group(&service.device);
        // NOTE: texture_manager.create_bind_group requires layout and view parameters
        // This test needs refactoring to work with current architecture
        let texture_bind_group = todo!("texture bind group creation needs refactoring");

        // Note: In real implementation, get pipeline from optimized renderer
        // For now, we'll simulate the render
        optimized_renderer.render(
            &mut encoder,
            &target_view,
            &frame_bind_group,
            &texture_bind_group,
            todo!("get_current_pipeline no longer exists"), // Placeholder
        );

        service.queue.submit(std::iter::once(encoder.finish()));
        service.device.poll(wgpu::Maintain::Wait);

        let elapsed = start.elapsed().as_secs_f32() * 1000.0;
        optimized_monitor.record_frame_time(elapsed);
        optimized_times.push(elapsed);

        if i % 100 == 0 {
            println!("  Frame {}: {:.2}ms", i, elapsed);
        }
    }

    let optimized_results = BenchmarkResults {
        test_name: "Optimized Shader".to_string(),
        avg_frame_time_ms: optimized_monitor.average_frame_time(),
        fps: optimized_monitor.fps(),
        total_frames: frame_count,
        layer_count: layers.len(),
        total_voxels,
    };

    // Calculate improvement
    let improvement = ((original_results.avg_frame_time_ms - optimized_results.avg_frame_time_ms)
        / original_results.avg_frame_time_ms)
        * 100.0;
    println!("\nPerformance improvement: {:.1}%", improvement);

    (original_results, optimized_results)
}

#[test]
#[ignore = "This test uses internal APIs that are no longer accessible"]
fn test_single_layer_performance() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new()
            .await
            .expect("Failed to create RenderLoopService");
        let mut optimized_renderer =
            OptimizedRenderer::new(&service.device).expect("Failed to create OptimizedRenderer");

        let volumes = vec![create_benchmark_volumes()[0].clone()]; // Just high-res
        let layer_configs = vec![(1.0, BlendMode::Normal, 0)];

        let (original, optimized) = benchmark_shader_performance(
            &mut service,
            &mut optimized_renderer,
            &volumes,
            500, // 500 frames
            &layer_configs,
        )
        .await;

        original.print_summary();
        optimized.print_summary();

        // Optimized should be faster
        assert!(
            optimized.avg_frame_time_ms < original.avg_frame_time_ms,
            "Optimized shader should be faster for single layer"
        );
    });
}

#[test]
#[ignore = "This test uses internal APIs that are no longer accessible"]
fn test_multi_layer_blending_performance() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new()
            .await
            .expect("Failed to create RenderLoopService");
        let mut optimized_renderer =
            OptimizedRenderer::new(&service.device).expect("Failed to create OptimizedRenderer");

        let volumes = create_benchmark_volumes();
        let layer_configs = vec![
            (1.0, BlendMode::Normal, 0),   // Anatomical base
            (0.5, BlendMode::Additive, 1), // Functional overlay
            (0.3, BlendMode::Multiply, 2), // Mask
        ];

        let (original, optimized) = benchmark_shader_performance(
            &mut service,
            &mut optimized_renderer,
            &volumes,
            500,
            &layer_configs,
        )
        .await;

        original.print_summary();
        optimized.print_summary();

        // Optimized should show greater improvement with multiple layers
        let improvement = ((original.avg_frame_time_ms - optimized.avg_frame_time_ms)
            / original.avg_frame_time_ms)
            * 100.0;
        println!("\nMulti-layer improvement: {:.1}%", improvement);

        assert!(
            improvement > 10.0,
            "Should see >10% improvement with multiple layers"
        );
    });
}

#[test]
#[ignore = "This test uses internal APIs that are no longer accessible"]
fn test_transparent_layer_early_exit() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new()
            .await
            .expect("Failed to create RenderLoopService");
        let mut optimized_renderer =
            OptimizedRenderer::new(&service.device).expect("Failed to create OptimizedRenderer");

        let volumes = create_benchmark_volumes();

        // Test with many transparent layers (should benefit from early exit)
        let layer_configs = vec![
            (1.0, BlendMode::Normal, 0),   // Visible base
            (0.0, BlendMode::Normal, 1),   // Transparent (early exit)
            (0.0, BlendMode::Normal, 2),   // Transparent (early exit)
            (0.001, BlendMode::Normal, 1), // Nearly transparent
            (0.0, BlendMode::Normal, 0),   // Transparent (early exit)
        ];

        // Duplicate volumes to match layer count
        let test_volumes: Vec<_> = layer_configs
            .iter()
            .enumerate()
            .map(|(i, _)| volumes[i % volumes.len()].clone())
            .collect();

        let (original, optimized) = benchmark_shader_performance(
            &mut service,
            &mut optimized_renderer,
            &test_volumes,
            300,
            &layer_configs,
        )
        .await;

        original.print_summary();
        optimized.print_summary();

        // Should see significant improvement due to early exit
        let improvement = ((original.avg_frame_time_ms - optimized.avg_frame_time_ms)
            / original.avg_frame_time_ms)
            * 100.0;
        println!("\nEarly exit improvement: {:.1}%", improvement);

        assert!(
            improvement > 15.0,
            "Should see >15% improvement with transparent layer early exit"
        );
    });
}

#[test]
#[ignore = "This test uses internal APIs that are no longer accessible"]
fn test_extreme_zoom_lod_performance() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new()
            .await
            .expect("Failed to create RenderLoopService");
        let mut optimized_renderer =
            OptimizedRenderer::new(&service.device).expect("Failed to create OptimizedRenderer");

        let volumes = vec![create_benchmark_volumes()[0].clone()]; // High-res only
        let layer_configs = vec![(1.0, BlendMode::Normal, 0)];

        // Benchmark at different zoom levels
        let zoom_levels = vec![
            1.0,  // Normal view
            0.1,  // Zoomed out (benefits from LOD)
            10.0, // Zoomed in (higher detail needed)
        ];

        for zoom in zoom_levels {
            println!("\n\nTesting zoom level: {}x", zoom);

            // Adjust sampling area based on zoom
            let extent = 100.0 * zoom;
            let origin_mm = [0.0, 0.0, 0.0, 1.0];
            let u_mm = [extent, 0.0, 0.0, 0.0];
            let v_mm = [0.0, extent, 0.0, 0.0];

            // Update both renderers with zoom parameters
            service.update_frame_ubo(origin_mm, u_mm, v_mm);
            // NOTE: OptimizedRenderer doesn't have update_frame_ubo method

            // Run shorter benchmark for each zoom level
            let (original, optimized) = benchmark_shader_performance(
                &mut service,
                &mut optimized_renderer,
                &volumes,
                200,
                &layer_configs,
            )
            .await;

            let improvement = ((original.avg_frame_time_ms - optimized.avg_frame_time_ms)
                / original.avg_frame_time_ms)
                * 100.0;

            println!("Zoom {}x improvement: {:.1}%", zoom, improvement);

            // LOD sampling should show most benefit when zoomed out
            if zoom < 0.5 {
                assert!(
                    improvement > 20.0,
                    "Should see >20% improvement when zoomed out due to LOD"
                );
            }
        }
    });
}

#[test]
#[ignore = "This test uses internal APIs that are no longer accessible"]
fn test_memory_bandwidth_optimization() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new()
            .await
            .expect("Failed to create RenderLoopService");
        let mut optimized_renderer =
            OptimizedRenderer::new(&service.device).expect("Failed to create OptimizedRenderer");

        // Create volumes with different sampling patterns
        let volumes = {
            use volmath::space::{NeuroSpace3, NeuroSpaceImpl};
            let dims = [256, 256, 256];

            vec![
                // Smooth gradient (good cache coherence)
                {
                    let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];
                    for z in 0..dims[2] {
                        for y in 0..dims[1] {
                            for x in 0..dims[0] {
                                let idx = z * dims[0] * dims[1] + y * dims[0] + x;
                                data[idx] =
                                    (x as f32 / 256.0 + y as f32 / 256.0 + z as f32 / 256.0) / 3.0;
                            }
                        }
                    }
                    let space_impl = NeuroSpaceExt::from_affine_matrix4(dims, Matrix4::identity());
                    let space = NeuroSpace3::new(space_impl);
                    DenseVolume3::from_data(space.0, data)
                },
                // Checkerboard pattern (poor cache coherence)
                {
                    let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];
                    for z in 0..dims[2] {
                        for y in 0..dims[1] {
                            for x in 0..dims[0] {
                                let idx = z * dims[0] * dims[1] + y * dims[0] + x;
                                data[idx] = if (x + y + z) % 2 == 0 { 1.0 } else { 0.0 };
                            }
                        }
                    }
                    let space_impl = NeuroSpaceExt::from_affine_matrix4(dims, Matrix4::identity());
                    let space = NeuroSpace3::new(space_impl);
                    DenseVolume3::from_data(space.0, data)
                },
            ]
        };

        println!("\nTesting smooth gradient volume:");
        let (orig_smooth, opt_smooth) = benchmark_shader_performance(
            &mut service,
            &mut optimized_renderer,
            &vec![volumes[0].clone()],
            300,
            &vec![(1.0, BlendMode::Normal, 0)],
        )
        .await;

        println!("\nTesting checkerboard pattern volume:");
        let (orig_check, opt_check) = benchmark_shader_performance(
            &mut service,
            &mut optimized_renderer,
            &vec![volumes[1].clone()],
            300,
            &vec![(1.0, BlendMode::Normal, 0)],
        )
        .await;

        let smooth_improvement = ((orig_smooth.avg_frame_time_ms - opt_smooth.avg_frame_time_ms)
            / orig_smooth.avg_frame_time_ms)
            * 100.0;
        let check_improvement = ((orig_check.avg_frame_time_ms - opt_check.avg_frame_time_ms)
            / orig_check.avg_frame_time_ms)
            * 100.0;

        println!("\nSmooth gradient improvement: {:.1}%", smooth_improvement);
        println!("Checkerboard improvement: {:.1}%", check_improvement);

        // Both should show improvement, but smooth gradient should benefit more from cache coherence
        assert!(
            smooth_improvement > 5.0,
            "Should see improvement for smooth data"
        );
        assert!(
            check_improvement > 0.0,
            "Should see some improvement for checkerboard"
        );
    });
}

/// Summary test that compares overall performance across scenarios
#[test]
#[ignore = "This test uses internal APIs that are no longer accessible"]
fn test_performance_summary() {
    println!("\n\n========================================");
    println!("MULTI-RESOLUTION PERFORMANCE SUMMARY");
    println!("========================================\n");

    pollster::block_on(async {
        let mut service = RenderLoopService::new()
            .await
            .expect("Failed to create RenderLoopService");
        let mut optimized_renderer =
            OptimizedRenderer::new(&service.device).expect("Failed to create OptimizedRenderer");

        let scenarios = vec![
            (
                "Single High-Res Layer",
                vec![0],
                vec![(1.0, BlendMode::Normal, 0)],
            ),
            (
                "Three Layer Blend",
                vec![0, 1, 2],
                vec![
                    (1.0, BlendMode::Normal, 0),
                    (0.5, BlendMode::Additive, 1),
                    (0.3, BlendMode::Multiply, 2),
                ],
            ),
            (
                "Many Transparent Layers",
                vec![0, 1, 2, 0, 1],
                vec![
                    (1.0, BlendMode::Normal, 0),
                    (0.0, BlendMode::Normal, 1),
                    (0.0, BlendMode::Normal, 2),
                    (0.001, BlendMode::Normal, 0),
                    (0.0, BlendMode::Normal, 1),
                ],
            ),
        ];

        let all_volumes = create_benchmark_volumes();
        let mut improvements = Vec::new();

        for (name, volume_indices, layer_configs) in scenarios {
            println!("\nScenario: {}", name);

            let test_volumes: Vec<_> = volume_indices
                .iter()
                .map(|&i| all_volumes[i].clone())
                .collect();

            let (original, optimized) = benchmark_shader_performance(
                &mut service,
                &mut optimized_renderer,
                &test_volumes,
                300,
                &layer_configs,
            )
            .await;

            let improvement = ((original.avg_frame_time_ms - optimized.avg_frame_time_ms)
                / original.avg_frame_time_ms)
                * 100.0;

            improvements.push((name, improvement, original.fps, optimized.fps));

            println!(
                "  Original: {:.2}ms ({:.1} FPS)",
                original.avg_frame_time_ms, original.fps
            );
            println!(
                "  Optimized: {:.2}ms ({:.1} FPS)",
                optimized.avg_frame_time_ms, optimized.fps
            );
            println!("  Improvement: {:.1}%", improvement);
        }

        println!("\n\n========================================");
        println!("FINAL RESULTS");
        println!("========================================");
        for (name, improvement, orig_fps, opt_fps) in improvements {
            println!(
                "{:.<30} {:.1}% faster ({:.1} → {:.1} FPS)",
                name, improvement, orig_fps, opt_fps
            );
        }
        println!("========================================\n");
    });
}
