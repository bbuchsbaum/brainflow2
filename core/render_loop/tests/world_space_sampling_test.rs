// Test world-space sampling shader implementation

use nalgebra::Point3;
use pollster;
use render_loop::multi_texture_manager::MultiTextureManager;
use render_loop::test_fixtures::TestVolumeSet;
use render_loop::transform_validator::TransformValidator;

/// Test multi-texture manager with different resolution volumes
#[test]
fn test_multi_texture_upload() {
    pollster::block_on(async {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::default());
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions::default())
            .await
            .expect("Failed to get adapter");
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor::default(), None)
            .await
            .expect("Failed to get device");

        // Create test volumes
        let volumes = TestVolumeSet::create_aligned();

        // Create multi-texture manager
        let mut texture_manager = MultiTextureManager::new(16);

        // Upload anatomical volume (1mm resolution)
        let (anat_idx, anat_tfm) = texture_manager
            .upload_volume(
                &device,
                &queue,
                &volumes.anatomical,
                wgpu::TextureFormat::R8Unorm,
            )
            .expect("Failed to upload anatomical");

        assert_eq!(anat_idx, 0);
        let anat_info = texture_manager.get_texture_info(0).unwrap();
        assert_eq!(anat_info.dimensions, [256, 256, 256]);

        // Upload functional volume (2x2x4mm resolution)
        let (func_idx, func_tfm) = texture_manager
            .upload_volume(
                &device,
                &queue,
                &volumes.functional,
                wgpu::TextureFormat::R32Float,
            )
            .expect("Failed to upload functional");

        assert_eq!(func_idx, 1);
        let func_info = texture_manager.get_texture_info(1).unwrap();
        assert_eq!(func_info.dimensions, [128, 128, 32]);

        // Upload detail patch (0.5mm resolution)
        let (detail_idx, detail_tfm) = texture_manager
            .upload_volume(
                &device,
                &queue,
                &volumes.detail_patch,
                wgpu::TextureFormat::R16Uint,
            )
            .expect("Failed to upload detail");

        assert_eq!(detail_idx, 2);
        let detail_info = texture_manager.get_texture_info(2).unwrap();
        assert_eq!(detail_info.dimensions, [128, 128, 64]);

        // Validate transforms match expected
        assert_eq!(anat_tfm, volumes.get_transforms().0);
        assert_eq!(func_tfm, volumes.get_transforms().1);
        assert_eq!(detail_tfm, volumes.get_transforms().2);
    });
}

/// Test world-space coordinate validation
#[test]
fn test_world_space_coordinate_validation() {
    let volumes = TestVolumeSet::create_aligned();
    let (anat_tfm, func_tfm, detail_tfm) = volumes.get_transforms();

    // Test point at world origin - should be in bounds for all volumes
    let world_origin = Point3::new(0.0, 0.0, 0.0);

    let anat_valid =
        TransformValidator::validate_world_point(&world_origin, &anat_tfm, [256, 256, 256]);
    assert!(anat_valid.in_bounds);
    assert_eq!(anat_valid.voxel_coords, Point3::new(128.0, 128.0, 128.0));

    let func_valid =
        TransformValidator::validate_world_point(&world_origin, &func_tfm, [128, 128, 32]);
    assert!(func_valid.in_bounds);
    assert_eq!(func_valid.voxel_coords, Point3::new(64.0, 64.0, 16.0));

    let detail_valid =
        TransformValidator::validate_world_point(&world_origin, &detail_tfm, [128, 128, 64]);
    assert!(detail_valid.in_bounds);
    assert_eq!(detail_valid.voxel_coords, Point3::new(64.0, 64.0, 32.0));

    // Test point outside detail patch but inside other volumes
    let edge_point = Point3::new(50.0, 0.0, 0.0);

    let anat_valid =
        TransformValidator::validate_world_point(&edge_point, &anat_tfm, [256, 256, 256]);
    assert!(anat_valid.in_bounds);

    let func_valid =
        TransformValidator::validate_world_point(&edge_point, &func_tfm, [128, 128, 32]);
    assert!(func_valid.in_bounds);

    let detail_valid =
        TransformValidator::validate_world_point(&edge_point, &detail_tfm, [128, 128, 64]);
    assert!(!detail_valid.in_bounds); // Outside detail patch bounds
}

/// Test shader validation
#[test]
fn test_world_space_shader_compilation() {
    use render_loop::shaders::{sources, ShaderManager};

    pollster::block_on(async {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::default());
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions::default())
            .await
            .expect("Failed to get adapter");
        let (device, _queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("Test Device"),
                required_features: wgpu::Features::TEXTURE_BINDING_ARRAY 
                    | wgpu::Features::SAMPLED_TEXTURE_AND_STORAGE_BUFFER_ARRAY_NON_UNIFORM_INDEXING,
                required_limits: wgpu::Limits::default(),
            }, None)
            .await
            .expect("Failed to get device");

        let mut shader_manager = ShaderManager::new();

        // Validate the world-space shader
        let validation =
            ShaderManager::validate_shader(sources::SLICE_WORLD_SPACE, "slice_world_space");
        assert!(
            validation.valid,
            "World-space shader validation failed: {:?}",
            validation.errors
        );

        // Load the shader
        let result = shader_manager.load_shader_validated(
            &device,
            "slice_world_space",
            sources::SLICE_WORLD_SPACE,
        );

        assert!(
            result.is_ok(),
            "Failed to load world-space shader: {:?}",
            result.err()
        );

        let (_module, validation) = result.unwrap();
        if !validation.warnings.is_empty() {
            println!("World-space shader warnings: {:?}", validation.warnings);
        }
    });
}

/// Test layer data structure for world-space rendering
#[test]
fn test_layer_data_structure() {
    use nalgebra::Matrix4;
    use render_loop::layer_storage::LayerStorageManager;
    use render_loop::render_state::{BlendMode, LayerInfo, ThresholdMode};

    pollster::block_on(async {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::default());
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions::default())
            .await
            .expect("Failed to get adapter");
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor::default(), None)
            .await
            .expect("Failed to get device");

        let mut layer_manager = LayerStorageManager::new(&device, 8);
        let layout = LayerStorageManager::create_bind_group_layout(&device);
        layer_manager.create_bind_group(&device, &layout);

        // Create layers for each volume with proper texture indices
        let layers = vec![
            LayerInfo {
                atlas_index: 0, // This becomes texture_index
                opacity: 1.0,
                blend_mode: BlendMode::Normal,
                colormap_id: 0,
                intensity_range: (0.0, 1.0),
                threshold_range: (0.0, 1.0),
                threshold_mode: ThresholdMode::Range,
                texture_coords: (0.0, 0.0, 1.0, 1.0),
                is_mask: false,
            },
            LayerInfo {
                atlas_index: 1, // Functional volume
                opacity: 0.7,
                blend_mode: BlendMode::Additive,
                colormap_id: 1,
                intensity_range: (0.1, 0.8),
                threshold_range: (0.3, 1.0),
                threshold_mode: ThresholdMode::Above,
                texture_coords: (0.0, 0.0, 1.0, 1.0),
                is_mask: false,
            },
            LayerInfo {
                atlas_index: 2, // Detail patch
                opacity: 1.0,
                blend_mode: BlendMode::Normal,
                colormap_id: 0,
                intensity_range: (0.0, 65535.0),
                threshold_range: (0.0, 65535.0),
                threshold_mode: ThresholdMode::Range,
                texture_coords: (0.0, 0.0, 1.0, 1.0),
                is_mask: false,
            },
        ];

        let volumes = TestVolumeSet::create_aligned();
        let (anat_tfm, func_tfm, detail_tfm) = volumes.get_transforms();

        let dims = vec![
            (256, 256, 256), // Anatomical
            (128, 128, 32),  // Functional
            (128, 128, 64),  // Detail
        ];
        let transforms = vec![anat_tfm, func_tfm, detail_tfm];

        layer_manager.update_layers(&device, &queue, &layout, &layers, &dims, &transforms);

        assert_eq!(layer_manager.active_count(), 3);
    });
}
