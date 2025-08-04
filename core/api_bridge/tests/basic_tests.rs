#[cfg(test)]
mod tests {
    use api_bridge::*;
    use brainflow_loaders as core_loaders;
    use bridge_types::*;
    use std::path::PathBuf;

    // Helper function to create a test BridgeState
    fn create_test_state() -> BridgeState {
        BridgeState::default()
    }

    #[test]
    fn test_bridge_state_creation() {
        let state = create_test_state();

        // Test that the state is created with empty registries
        let volume_registry = state.volume_registry.try_lock().unwrap();
        assert_eq!(volume_registry.len(), 0);
        drop(volume_registry);

        let layer_map = state.layer_to_atlas_map.try_lock().unwrap();
        assert_eq!(layer_map.len(), 0);
    }

    #[test]
    fn test_loader_support() {
        let test_path = PathBuf::from("test.nii.gz");
        assert!(core_loaders::is_loadable(&test_path));

        let test_path2 = PathBuf::from("test.nii");
        assert!(core_loaders::is_loadable(&test_path2));

        let test_path3 = PathBuf::from("test.txt");
        assert!(!core_loaders::is_loadable(&test_path3));
    }

    #[test]
    fn test_flat_node_creation() {
        let node = FlatNode {
            id: "/test/path".to_string(),
            name: "test.nii".to_string(),
            parent_idx: None,
            icon_id: icons::NIFTI,
            is_dir: false,
        };

        assert_eq!(node.name, "test.nii");
        assert_eq!(node.icon_id, icons::NIFTI);
        assert!(!node.is_dir);
    }

    #[test]
    fn test_volume_handle_info() {
        let handle = VolumeHandleInfo {
            id: "test-id".to_string(),
            name: "test.nii.gz".to_string(),
            dims: [256, 256, 128],
            dtype: "f32".to_string(),
        };

        assert_eq!(handle.dims[0], 256);
        assert_eq!(handle.dims[1], 256);
        assert_eq!(handle.dims[2], 128);
        assert_eq!(handle.dtype, "f32");
    }
}
