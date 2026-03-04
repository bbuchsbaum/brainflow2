use api_bridge::{
    get_volume_for_projection_for_testing, sample_layer_value_at_world_for_testing,
    sample_world_coordinate_for_testing, BridgeState, VolumeMetadataInfo,
};
use bridge_types::{BridgeError, VolumeSendable, VolumeType};
use nalgebra::{Affine3, Matrix4};
use volmath::dense_vol::DenseVolume3;
use volmath::space::NeuroSpaceImpl;
use volmath::{NeuroSpace3, NeuroSpaceExt};

#[tokio::test]
async fn sample_world_coordinate_returns_expected_values() {
    // Set up a small synthetic volume with a simple pattern:
    // value(x, y, z) = x + 10*y + 100*z
    let dims = [3, 3, 3];
    let mut data = Vec::new();
    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                data.push(x as f32 + 10.0 * y as f32 + 100.0 * z as f32);
            }
        }
    }

    let affine = Matrix4::<f32>::identity();
    let space =
        NeuroSpaceImpl::from_affine_matrix4(dims.to_vec(), affine.clone()).expect("neuro space");
    let volume = DenseVolume3::<f32>::from_data(space.clone(), data);
    let _neuro_space = NeuroSpace3::new(space);

    let bridge_state = BridgeState::default().expect("bridge state");

    let volume_id = "sampling_volume".to_string();
    let affine3 = Affine3::from_matrix_unchecked(affine);
    let metadata = VolumeMetadataInfo {
        name: volume_id.clone(),
        path: "<memory>".to_string(),
        dtype: "f32".to_string(),
        volume_type: VolumeType::Volume3D,
        time_series_info: None,
    };

    bridge_state.volume_registry.lock().await.insert(
        volume_id.clone(),
        VolumeSendable::VolF32(volume, affine3),
        metadata,
    );

    // Sample inside bounds
    let world = [1.0_f32, 2.0_f32, 1.0_f32];
    let value = sample_world_coordinate_for_testing(&volume_id, &world, &bridge_state)
        .await
        .expect("sample");
    let expected = 1.0 + 10.0 * 2.0 + 100.0 * 1.0;
    assert!((value - expected).abs() < 1e-4);

    // Out-of-bounds world coordinate should return 0.0
    let oob_world = [-10.0_f32, -10.0_f32, -10.0_f32];
    let value_oob = sample_world_coordinate_for_testing(&volume_id, &oob_world, &bridge_state)
        .await
        .expect("sample oob");
    assert_eq!(value_oob, 0.0);
}

#[tokio::test]
async fn sample_layer_value_at_world_resolves_layer_mapping() {
    let dims = [2, 2, 2];
    let data = vec![
        0.0_f32, 1.0, 2.0, 3.0, //
        4.0, 5.0, 6.0, 7.0,
    ];

    let affine = Matrix4::<f32>::identity();
    let space =
        NeuroSpaceImpl::from_affine_matrix4(dims.to_vec(), affine.clone()).expect("neuro space");
    let volume = DenseVolume3::<f32>::from_data(space.clone(), data);
    let _neuro_space = NeuroSpace3::new(space);

    let bridge_state = BridgeState::default().expect("bridge state");

    let volume_id = "layer_sampling_volume".to_string();
    let affine3 = Affine3::from_matrix_unchecked(affine);
    let metadata = VolumeMetadataInfo {
        name: volume_id.clone(),
        path: "<memory>".to_string(),
        dtype: "f32".to_string(),
        volume_type: VolumeType::Volume3D,
        time_series_info: None,
    };

    bridge_state.volume_registry.lock().await.insert(
        volume_id.clone(),
        VolumeSendable::VolF32(volume, affine3),
        metadata,
    );

    // Map a UI layer id to the volume handle
    {
        let mut map = bridge_state.layer_to_volume_map.lock().await;
        map.insert("layer-1".to_string(), volume_id.clone());
    }

    let world = [1.0_f32, 0.0_f32, 0.0_f32];
    let value = sample_layer_value_at_world_for_testing("layer-1", &world, &bridge_state)
        .await
        .unwrap();

    // For identity affine, world coordinates map directly to voxel indices,
    // so (1,0,0) corresponds to x=1,y=0,z=0 i.e. value 1.0.
    assert_eq!(value, 1.0);
}

#[tokio::test]
async fn sample_layer_value_at_world_handles_missing_layer_and_bad_input() {
    let bridge_state = BridgeState::default().expect("bridge state");

    // Unknown layer id should yield BridgeError::Input with code 2017
    let world = [0.0_f32, 0.0_f32, 0.0_f32];
    let err = sample_layer_value_at_world_for_testing("missing-layer", &world, &bridge_state)
        .await
        .expect_err("expected error");

    match err {
        BridgeError::Input { code, .. } => assert_eq!(code, 2017),
        other => panic!("expected BridgeError::Input, got {:?}", other),
    }

    // Bad world coordinate length should yield BridgeError::Input with code 2016
    let bad_world: [f32; 2] = [0.0, 1.0];
    let err = sample_layer_value_at_world_for_testing("any-layer", &bad_world, &bridge_state)
        .await
        .expect_err("expected error for bad input");

    match err {
        BridgeError::Input { code, .. } => assert_eq!(code, 2016),
        other => panic!("expected BridgeError::Input for bad input, got {:?}", other),
    }
}

// --- Tests for get_volume_for_projection ---

#[tokio::test]
async fn get_volume_for_projection_returns_correct_data_and_dims() {
    // Create a 3x3x3 volume with a simple pattern
    let dims = [3, 3, 3];
    let mut data = Vec::new();
    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                data.push(x as f32 + 10.0 * y as f32 + 100.0 * z as f32);
            }
        }
    }

    let affine = Matrix4::<f32>::identity();
    let space =
        NeuroSpaceImpl::from_affine_matrix4(dims.to_vec(), affine.clone()).expect("neuro space");
    let volume = DenseVolume3::<f32>::from_data(space.clone(), data.clone());

    let bridge_state = BridgeState::default().expect("bridge state");

    let volume_id = "projection_test_volume".to_string();
    let affine3 = Affine3::from_matrix_unchecked(affine);
    let metadata = VolumeMetadataInfo {
        name: volume_id.clone(),
        path: "<memory>".to_string(),
        dtype: "f32".to_string(),
        volume_type: VolumeType::Volume3D,
        time_series_info: None,
    };

    bridge_state.volume_registry.lock().await.insert(
        volume_id.clone(),
        VolumeSendable::VolF32(volume, affine3),
        metadata,
    );

    // Get projection data
    let result = get_volume_for_projection_for_testing(&volume_id, None, &bridge_state)
        .await
        .expect("get_volume_for_projection");

    // Verify dimensions
    assert_eq!(result.dims, [3, 3, 3]);

    // Verify data length
    assert_eq!(result.volume_data.len(), 27); // 3*3*3

    // Verify data values match
    assert_eq!(result.volume_data, data);

    // Verify data range
    let expected_min = 0.0; // x=0, y=0, z=0
    let expected_max = 2.0 + 10.0 * 2.0 + 100.0 * 2.0; // x=2, y=2, z=2 = 222.0
    assert!((result.data_range.min - expected_min).abs() < 1e-4);
    assert!((result.data_range.max - expected_max).abs() < 1e-4);

    // Verify affine is identity (column-major)
    let expected_affine = [
        1.0, 0.0, 0.0, 0.0, // column 0
        0.0, 1.0, 0.0, 0.0, // column 1
        0.0, 0.0, 1.0, 0.0, // column 2
        0.0, 0.0, 0.0, 1.0, // column 3
    ];
    assert_eq!(result.affine_matrix, expected_affine);

    // Verify volume_id is returned
    assert_eq!(result.volume_id, volume_id);

    // Verify timepoint is None
    assert_eq!(result.timepoint, None);
}

#[tokio::test]
async fn get_volume_for_projection_handles_non_identity_affine() {
    // Create a simple 2x2x2 volume
    let dims = [2, 2, 2];
    let data: Vec<f32> = (0..8).map(|i| i as f32).collect();

    // Create a non-identity affine (2mm spacing, offset by 10mm)
    #[rustfmt::skip]
    let affine = Matrix4::<f32>::new(
        2.0, 0.0, 0.0, 10.0,
        0.0, 2.0, 0.0, 20.0,
        0.0, 0.0, 2.0, 30.0,
        0.0, 0.0, 0.0, 1.0,
    );

    let space =
        NeuroSpaceImpl::from_affine_matrix4(dims.to_vec(), affine.clone()).expect("neuro space");
    let volume = DenseVolume3::<f32>::from_data(space.clone(), data);

    let bridge_state = BridgeState::default().expect("bridge state");

    let volume_id = "affine_test_volume".to_string();
    let affine3 = Affine3::from_matrix_unchecked(affine);
    let metadata = VolumeMetadataInfo {
        name: volume_id.clone(),
        path: "<memory>".to_string(),
        dtype: "f32".to_string(),
        volume_type: VolumeType::Volume3D,
        time_series_info: None,
    };

    bridge_state.volume_registry.lock().await.insert(
        volume_id.clone(),
        VolumeSendable::VolF32(volume, affine3),
        metadata,
    );

    let result = get_volume_for_projection_for_testing(&volume_id, None, &bridge_state)
        .await
        .expect("get_volume_for_projection");

    // Verify the affine matrix is correctly converted to column-major
    // Original (row-major):
    // [2, 0, 0, 10]
    // [0, 2, 0, 20]
    // [0, 0, 2, 30]
    // [0, 0, 0, 1]
    // Column-major should be:
    let expected_affine = [
        2.0, 0.0, 0.0, 0.0, // column 0
        0.0, 2.0, 0.0, 0.0, // column 1
        0.0, 0.0, 2.0, 0.0, // column 2
        10.0, 20.0, 30.0, 1.0, // column 3 (translation)
    ];
    assert_eq!(result.affine_matrix, expected_affine);
}

#[tokio::test]
async fn get_volume_for_projection_handles_missing_volume() {
    let bridge_state = BridgeState::default().expect("bridge state");

    let err = get_volume_for_projection_for_testing("nonexistent_volume", None, &bridge_state)
        .await
        .expect_err("expected error for missing volume");

    match err {
        BridgeError::VolumeNotFound { code, .. } => assert_eq!(code, 4045),
        other => panic!("expected BridgeError::VolumeNotFound, got {:?}", other),
    }
}

#[tokio::test]
async fn get_volume_for_projection_handles_i16_volume() {
    // Test with I16 volume type
    let dims = [2, 2, 2];
    let data: Vec<i16> = vec![-100, 0, 50, 100, -50, 25, 75, 127];

    let affine = Matrix4::<f32>::identity();
    let space =
        NeuroSpaceImpl::from_affine_matrix4(dims.to_vec(), affine.clone()).expect("neuro space");
    let volume = DenseVolume3::<i16>::from_data(space.clone(), data.clone());

    let bridge_state = BridgeState::default().expect("bridge state");

    let volume_id = "i16_volume".to_string();
    let affine3 = Affine3::from_matrix_unchecked(affine);
    let metadata = VolumeMetadataInfo {
        name: volume_id.clone(),
        path: "<memory>".to_string(),
        dtype: "i16".to_string(),
        volume_type: VolumeType::Volume3D,
        time_series_info: None,
    };

    bridge_state.volume_registry.lock().await.insert(
        volume_id.clone(),
        VolumeSendable::VolI16(volume, affine3),
        metadata,
    );

    let result = get_volume_for_projection_for_testing(&volume_id, None, &bridge_state)
        .await
        .expect("get_volume_for_projection");

    // Verify data is converted to f32
    let expected_data: Vec<f32> = data.iter().map(|&v| v as f32).collect();
    assert_eq!(result.volume_data, expected_data);

    // Verify data range
    assert_eq!(result.data_range.min, -100.0);
    assert_eq!(result.data_range.max, 127.0);
}
