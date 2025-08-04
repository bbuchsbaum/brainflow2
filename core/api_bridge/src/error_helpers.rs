// Helper functions for creating user-friendly error messages

use bridge_types::BridgeError;
use std::path::Path;

/// Create a user-friendly error message for file not found errors
pub fn file_not_found_error(path: &str) -> BridgeError {
    let path_obj = Path::new(path);
    let filename = path_obj
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path);

    BridgeError::Io { 
        code: 1001, 
        details: format!(
            "Could not find file '{}'. Please check that the file exists and you have permission to read it.", 
            filename
        )
    }
}

/// Create a user-friendly error message for volume loading failures
pub fn volume_load_error(path: &str, reason: &str) -> BridgeError {
    let path_obj = Path::new(path);
    let filename = path_obj
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path);

    BridgeError::Loader {
        code: 3001,
        details: format!(
            "Failed to load volume '{}': {}. Supported formats: NIfTI (.nii, .nii.gz)",
            filename, reason
        ),
    }
}

/// Create a user-friendly error message for GPU resource allocation failures
pub fn gpu_allocation_error(_volume_id: &str, reason: &str) -> BridgeError {
    BridgeError::GpuError { 
        code: 6001, 
        details: format!(
            "Could not allocate GPU resources for volume: {}. Try closing other volumes to free up memory.", 
            reason
        )
    }
}

/// Create a user-friendly error message for unsupported file formats
pub fn unsupported_format_error(path: &str) -> BridgeError {
    let path_obj = Path::new(path);
    let extension = path_obj
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("unknown");

    BridgeError::Input { 
        code: 2002, 
        details: format!(
            "File format '.{}' is not supported. Supported formats: NIfTI (.nii, .nii.gz), GIFTI (.gii)", 
            extension
        )
    }
}

/// Create a user-friendly error message for permission errors
pub fn permission_error(path: &str) -> BridgeError {
    BridgeError::Scope {
        code: 3001,
        path: path.to_string(),
    }
}

/// Add context to an existing error to make it more user-friendly
pub fn add_user_context(error: BridgeError, context: &str) -> BridgeError {
    match error {
        BridgeError::Internal { code, details } => BridgeError::Internal {
            code,
            details: format!("{}: {}", context, details),
        },
        BridgeError::Loader { code, details } => BridgeError::Loader {
            code,
            details: format!("{}: {}", context, details),
        },
        other => other, // Return other errors unchanged
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_not_found_error() {
        let error = file_not_found_error("/path/to/missing.nii");
        match error {
            BridgeError::Io { code, details } => {
                assert_eq!(code, 1001);
                assert!(details.contains("missing.nii"));
                assert!(details.contains("check that the file exists"));
            }
            _ => panic!("Expected Io error"),
        }
    }

    #[test]
    fn test_unsupported_format_error() {
        let error = unsupported_format_error("/path/to/file.txt");
        match error {
            BridgeError::Input { code, details } => {
                assert_eq!(code, 2002);
                assert!(details.contains(".txt"));
                assert!(details.contains("not supported"));
            }
            _ => panic!("Expected Input error"),
        }
    }
}
