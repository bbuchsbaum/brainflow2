#[cfg(test)]
mod integration_tests {
    use api_bridge::*;
    use bridge_types::*;
    use nifti_loader::NiftiLoader;
    use std::path::PathBuf;
    use volmath::space::GridSpace;
    use volmath::traits::Volume;

    // Helper to get test data path
    fn test_data_path() -> PathBuf {
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.pop(); // Go up from api_bridge
        path.pop(); // Go up from core
        path.push("test-data");
        path.push("unit");
        path
    }

    #[test]
    fn test_nifti_loader_integration() {
        let test_file = test_data_path().join("toy_t1w.nii.gz");

        if !test_file.exists() {
            println!("Skipping test - test file not found at {:?}", test_file);
            return;
        }

        // Test can_load
        assert!(NiftiLoader::can_load(&test_file));

        // Test load
        let result = NiftiLoader::load(&test_file);
        assert!(result.is_ok());

        match result.unwrap() {
            Loaded::Volume { dims, dtype, path } => {
                assert_eq!(dims, [10, 10, 10]);
                assert_eq!(dtype, "f32");
                assert!(path.contains("toy_t1w.nii.gz"));
            }
            _ => panic!("Expected Volume variant"),
        }
    }

    #[test]
    fn test_load_nifti_volume_data() {
        let test_file = test_data_path().join("toy_t1w.nii.gz");

        if !test_file.exists() {
            println!("Skipping test - test file not found at {:?}", test_file);
            return;
        }

        use flate2::read::GzDecoder;
        use std::fs::File;

        let file = File::open(&test_file).unwrap();
        let reader = GzDecoder::new(file);
        let result = nifti_loader::load_nifti_volume(reader);

        assert!(result.is_ok());
        let (volume_sendable, affine) = result.unwrap();

        match volume_sendable {
            VolumeSendable::VolF32(vol, _) => {
                let dims = vol.space().dims();
                assert_eq!(dims, &[10, 10, 10]);

                // Test that we can access the volume data
                let dims_prod = dims[0] * dims[1] * dims[2];
                assert_eq!(dims_prod, 1000); // 10 * 10 * 10
            }
            _ => panic!("Expected VolF32 variant"),
        }

        // Test that affine is valid (4x4 matrix)
        let matrix = affine.to_homogeneous();
        assert_eq!(matrix.nrows(), 4);
        assert_eq!(matrix.ncols(), 4);
    }

    #[test]
    fn test_volume_layer_spec() {
        let spec = LayerSpec::Volume(VolumeLayerSpec {
            id: "layer-1".to_string(),
            source_resource_id: "volume-1".to_string(),
            colormap: "grayscale".to_string(),
            slice_axis: None,
            slice_index: None,
        });

        match spec {
            LayerSpec::Volume(vol_spec) => {
                assert_eq!(vol_spec.id, "layer-1");
                assert_eq!(vol_spec.source_resource_id, "volume-1");
                assert_eq!(vol_spec.colormap, "grayscale");
            }
        }
    }
}
