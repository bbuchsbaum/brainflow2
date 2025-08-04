//! MNI brain orthogonal slice differential testing
//!
//! This test loads a real MNI brain template and generates orthogonal slice comparisons
//! between CPU and GPU rendering at various anatomically interesting world coordinates.

use colormap::BuiltinColormap;
use nalgebra::Point3;
use neuro_cpu::CpuVolumeRenderer;
use neuro_integration_tests::{
    add_crosshairs_to_slices, DifferentialTestHarness, ImageDimensions, OrthogonalDashboard,
    OrthogonalSlices, OrthogonalTestResult,
};
use neuro_types::{
    OrientedEllipsoid, RgbaImage, SliceSpec, ViewOrientation, ViewRectMm, VolumeMetadata,
};
use nifti_loader::load_nifti_volume_auto;
use render_loop::RenderLoopService;
use std::path::Path;

/// Test configuration for MNI brain slices
struct MniTestConfig {
    /// Name of the test point
    name: String,
    /// World coordinate in MNI space (mm)
    world_coordinate: Point3<f64>,
    /// Description of the anatomical location
    description: String,
}

/// Create test configurations for various anatomical locations
fn create_mni_test_configs() -> Vec<MniTestConfig> {
    vec![
        MniTestConfig {
            name: "brain_center".to_string(),
            world_coordinate: Point3::new(0.0, 0.0, 0.0),
            description: "Brain center (AC-PC midpoint)".to_string(),
        },
        MniTestConfig {
            name: "frontal_lobe".to_string(),
            world_coordinate: Point3::new(0.0, 40.0, 20.0),
            description: "Frontal lobe (prefrontal cortex)".to_string(),
        },
        MniTestConfig {
            name: "temporal_lobe".to_string(),
            world_coordinate: Point3::new(40.0, 0.0, -20.0),
            description: "Right temporal lobe".to_string(),
        },
        MniTestConfig {
            name: "occipital_lobe".to_string(),
            world_coordinate: Point3::new(0.0, -60.0, 10.0),
            description: "Occipital lobe (visual cortex)".to_string(),
        },
        MniTestConfig {
            name: "hippocampus".to_string(),
            world_coordinate: Point3::new(25.0, -20.0, -15.0),
            description: "Right hippocampus region".to_string(),
        },
        MniTestConfig {
            name: "motor_cortex".to_string(),
            world_coordinate: Point3::new(-20.0, -10.0, 60.0),
            description: "Left motor cortex".to_string(),
        },
    ]
}

#[tokio::test]
async fn test_mni_orthogonal_dashboard() {
    println!("=== Generating MNI Brain Orthogonal Slice Differential Testing Dashboard ===");

    // Path to MNI brain template
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

    println!("Loading MNI brain template from: {:?}", mni_path);

    // Load the NIfTI file
    let (volume_sendable, _affine) =
        load_nifti_volume_auto(&mni_path).expect("Failed to load NIfTI file");

    // Extract the DenseVolume3<f32>
    let volume = match volume_sendable {
        bridge_types::VolumeSendable::VolF32(vol, _) => vol,
        _ => panic!("Expected f32 volume from MNI template"),
    };

    // Get volume info for intensity scaling
    let data_range = volume.range().unwrap_or((0.0, 100.0));
    println!(
        "MNI volume data range: [{:.1}, {:.1}]",
        data_range.0, data_range.1
    );

    // Initialize GPU renderer
    let mut gpu_service = RenderLoopService::new()
        .await
        .expect("Failed to initialize GPU render service");

    gpu_service.load_shaders().expect("Failed to load shaders");

    gpu_service
        .create_offscreen_target(256, 256)
        .expect("Failed to create offscreen target");

    // Enable world space rendering for proper NIfTI support
    gpu_service
        .enable_world_space_rendering()
        .expect("Failed to enable world space rendering");

    // Upload volume to GPU once
    let (atlas_idx, _transform) = gpu_service
        .upload_volume_3d(&volume)
        .expect("Failed to upload volume to GPU");

    // Register volume for declarative API
    let volume_id = "mni_brain".to_string();
    gpu_service
        .register_volume(volume_id.clone(), atlas_idx)
        .expect("Failed to register volume");

    // Initialize colormap and create bind groups for world-space rendering
    gpu_service
        .initialize_colormap()
        .expect("Failed to initialize colormap");
    gpu_service
        .create_world_space_bind_groups()
        .expect("Failed to create world space bind groups");

    // Initialize CPU renderer
    let cpu_renderer = CpuVolumeRenderer::new();

    // Create volume metadata for ViewRectMm
    let volume_meta = VolumeMetadata {
        dimensions: [
            volume.space.dims()[0],
            volume.space.dims()[1],
            volume.space.dims()[2],
        ],
        voxel_to_world: volume.space.voxel_to_world(),
    };

    println!(
        "Volume dimensions: {}x{}x{} voxels",
        volume_meta.dimensions[0], volume_meta.dimensions[1], volume_meta.dimensions[2]
    );

    // Create test results
    let mut test_results = Vec::new();

    // Run tests for each anatomical location
    for config in create_mni_test_configs() {
        println!(
            "\nTesting location: {} - {}",
            config.name, config.description
        );
        println!(
            "World coordinate: ({:.1}, {:.1}, {:.1}) mm",
            config.world_coordinate.x, config.world_coordinate.y, config.world_coordinate.z
        );

        // Create view rectangles using unified abstraction
        let crosshair_world = [
            config.world_coordinate.x as f32,
            config.world_coordinate.y as f32,
            config.world_coordinate.z as f32,
        ];

        let axial_view = ViewRectMm::full_extent(
            &volume_meta,
            ViewOrientation::Axial,
            crosshair_world,
            [256, 256],
        );
        println!(
            "Axial view dimensions: {}x{}",
            axial_view.width_px, axial_view.height_px
        );

        let sagittal_view = ViewRectMm::full_extent(
            &volume_meta,
            ViewOrientation::Sagittal,
            crosshair_world,
            [256, 256],
        );
        println!(
            "Sagittal view dimensions: {}x{}",
            sagittal_view.width_px, sagittal_view.height_px
        );

        let coronal_view = ViewRectMm::full_extent(
            &volume_meta,
            ViewOrientation::Coronal,
            crosshair_world,
            [256, 256],
        );
        println!(
            "Coronal view dimensions: {}x{}",
            coronal_view.width_px, coronal_view.height_px
        );

        // Convert to SliceSpec for CPU renderer
        let axial_spec = SliceSpec::from(&axial_view);
        let sagittal_spec = SliceSpec::from(&sagittal_view);
        let coronal_spec = SliceSpec::from(&coronal_view);

        // Render CPU slices
        let cpu_axial = cpu_renderer
            .render_volume_slice(
                &volume,
                &axial_spec,
                data_range.0,
                data_range.1,
                BuiltinColormap::Grayscale,
                1.0,
            )
            .expect("Failed to render CPU axial slice");

        let cpu_sagittal = cpu_renderer
            .render_volume_slice(
                &volume,
                &sagittal_spec,
                data_range.0,
                data_range.1,
                BuiltinColormap::Grayscale,
                1.0,
            )
            .expect("Failed to render CPU sagittal slice");

        let cpu_coronal = cpu_renderer
            .render_volume_slice(
                &volume,
                &coronal_spec,
                data_range.0,
                data_range.1,
                BuiltinColormap::Grayscale,
                1.0,
            )
            .expect("Failed to render CPU coronal slice");

        // Create CPU orthogonal slices structure with dimensions
        let mut cpu_slices = OrthogonalSlices {
            world_coordinate: config.world_coordinate,
            axial: cpu_axial,
            sagittal: cpu_sagittal,
            coronal: cpu_coronal,
            axial_dims: ImageDimensions::new(axial_spec.dim_px[0], axial_spec.dim_px[1]),
            sagittal_dims: ImageDimensions::new(sagittal_spec.dim_px[0], sagittal_spec.dim_px[1]),
            coronal_dims: ImageDimensions::new(coronal_spec.dim_px[0], coronal_spec.dim_px[1]),
        };

        // Add crosshairs to CPU slices
        add_crosshairs_to_slices(&mut cpu_slices, &axial_spec, &sagittal_spec, &coronal_spec);

        // Render GPU slices using ViewRectMm
        let gpu_axial = render_gpu_slice_from_view(
            &mut gpu_service,
            volume_id.clone(),
            &axial_view,
            data_range,
        )
        .await;
        let gpu_sagittal = render_gpu_slice_from_view(
            &mut gpu_service,
            volume_id.clone(),
            &sagittal_view,
            data_range,
        )
        .await;
        let gpu_coronal = render_gpu_slice_from_view(
            &mut gpu_service,
            volume_id.clone(),
            &coronal_view,
            data_range,
        )
        .await;

        // Create GPU orthogonal slices structure with dimensions
        let mut gpu_slices = OrthogonalSlices {
            world_coordinate: config.world_coordinate,
            axial: gpu_axial,
            sagittal: gpu_sagittal,
            coronal: gpu_coronal,
            axial_dims: ImageDimensions::new(axial_view.width_px, axial_view.height_px),
            sagittal_dims: ImageDimensions::new(sagittal_view.width_px, sagittal_view.height_px),
            coronal_dims: ImageDimensions::new(coronal_view.width_px, coronal_view.height_px),
        };

        // Add crosshairs to GPU slices
        add_crosshairs_to_slices(&mut gpu_slices, &axial_spec, &sagittal_spec, &coronal_spec);

        // Debug dimensions - RgbaImage is Vec<u8> with 4 bytes per pixel
        println!("CPU axial size: {} bytes", cpu_slices.axial.len());
        println!("GPU axial size: {} bytes", gpu_slices.axial.len());
        println!("CPU sagittal size: {} bytes", cpu_slices.sagittal.len());
        println!("GPU sagittal size: {} bytes", gpu_slices.sagittal.len());
        println!("CPU coronal size: {} bytes", cpu_slices.coronal.len());
        println!("GPU coronal size: {} bytes", gpu_slices.coronal.len());

        // Create test harness for metrics calculation
        let harness = DifferentialTestHarness::new();

        // Compute metrics for each plane
        let axial_metrics = harness
            .compute_metrics(&cpu_slices.axial, &gpu_slices.axial)
            .expect("Failed to compute axial metrics");
        let sagittal_metrics = harness
            .compute_metrics(&cpu_slices.sagittal, &gpu_slices.sagittal)
            .expect("Failed to compute sagittal metrics");
        let coronal_metrics = harness
            .compute_metrics(&cpu_slices.coronal, &gpu_slices.coronal)
            .expect("Failed to compute coronal metrics");

        // Evaluate metrics with relaxed thresholds for real MRI data
        let axial_passed = axial_metrics.dice_coefficient >= 0.9 && axial_metrics.ssim >= 0.85;
        let sagittal_passed =
            sagittal_metrics.dice_coefficient >= 0.9 && sagittal_metrics.ssim >= 0.85;
        let coronal_passed =
            coronal_metrics.dice_coefficient >= 0.9 && coronal_metrics.ssim >= 0.85;

        let passed = axial_passed && sagittal_passed && coronal_passed;
        let mut failure_reasons = Vec::new();
        if !axial_passed {
            failure_reasons.push(format!(
                "Axial plane: Dice={:.3}, SSIM={:.3}",
                axial_metrics.dice_coefficient, axial_metrics.ssim
            ));
        }
        if !sagittal_passed {
            failure_reasons.push(format!(
                "Sagittal plane: Dice={:.3}, SSIM={:.3}",
                sagittal_metrics.dice_coefficient, sagittal_metrics.ssim
            ));
        }
        if !coronal_passed {
            failure_reasons.push(format!(
                "Coronal plane: Dice={:.3}, SSIM={:.3}",
                coronal_metrics.dice_coefficient, coronal_metrics.ssim
            ));
        }

        // Create test result
        let result = OrthogonalTestResult {
            test_name: config.name.clone(),
            ellipsoid: OrientedEllipsoid::sphere(Point3::new(0.0, 0.0, 0.0), 1.0, 1.0).unwrap(), // Dummy ellipsoid for compatibility
            world_coordinate: config.world_coordinate,
            color: [255, 255, 255, 255], // White for grayscale
            cpu_slices,
            gpu_slices,
            axial_metrics,
            sagittal_metrics,
            coronal_metrics,
            passed,
            failure_reasons,
        };

        test_results.push(result);
    }

    // Generate dashboard
    let dashboard = OrthogonalDashboard::new("./test_output/mni_orthogonal_dashboard");
    let dashboard_path = dashboard
        .generate_dashboard(&test_results)
        .await
        .expect("Failed to generate dashboard");

    println!("\n✅ MNI orthogonal dashboard generated successfully!");
    println!("📊 Open the dashboard at: {}", dashboard_path);
    println!("\nThe dashboard shows:");
    println!("  - Real MNI brain template slices at various anatomical locations");
    println!("  - CPU vs GPU comparisons for all three anatomical planes");
    println!("  - Crosshairs indicating the exact world space coordinate");
    println!("  - Comprehensive metrics for each plane (SSIM, Dice, RMSE)");
    println!("  - Grayscale colormap appropriate for T1-weighted MRI data");
}

/// Helper function to render a slice using GPU from ViewRectMm with declarative API
async fn render_gpu_slice_from_view(
    service: &mut RenderLoopService,
    volume_id: String,
    view_rect: &ViewRectMm,
    data_range: (f32, f32),
) -> RgbaImage {
    use render_loop::view_state::{ViewId, ViewState};

    // Use the declarative API to create ViewState from ViewRectMm
    let mut view_state = ViewState::from_view_rect(view_rect, volume_id, data_range);

    // Set crosshair position
    view_state.crosshair_world = view_rect.origin_mm;

    // Request frame using declarative API
    let result = service
        .request_frame(ViewId::new("orthogonal_test"), view_state)
        .await
        .expect("Failed to render frame");

    result.image_data
}
