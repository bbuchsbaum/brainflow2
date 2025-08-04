use bridge_types::BridgeError;
use std::path::Path;

/// Convert technical errors into user-friendly messages
pub trait UserFriendly {
    /// Get a user-friendly error message
    fn user_message(&self) -> String;

    /// Get suggested actions for the user
    fn suggested_actions(&self) -> Vec<String>;
}

impl UserFriendly for BridgeError {
    fn user_message(&self) -> String {
        match self {
            BridgeError::Io { details, .. } => {
                if details.contains("Not found")
                    || details.contains("not found")
                    || details.contains("cannot find")
                    || details.contains("Could not find file")
                {
                    format!(
                        "Cannot find the requested file. {}",
                        extract_filename(details)
                    )
                } else if details.contains("Permission denied") {
                    format!(
                        "Permission denied. Cannot access {}.",
                        extract_filename(details)
                    )
                } else if details.contains("No space left") {
                    "Not enough disk space to complete the operation.".to_string()
                } else if details.contains("Too many open files") {
                    "Too many files are open. Please close some applications and try again."
                        .to_string()
                } else {
                    "An error occurred while accessing files on your system.".to_string()
                }
            }

            BridgeError::Scope { path, .. } => {
                format!("Permission denied. Cannot access {}.", path)
            }

            BridgeError::Input { details, .. } => {
                if details.contains("format") || details.contains("unsupported") {
                    format!(
                        "This file format is not supported. {}",
                        extract_format_info(details)
                    )
                } else {
                    format!("Invalid input: {}", details)
                }
            }

            BridgeError::Loader { details, .. } => {
                if details.contains("header") {
                    "The image file appears to be corrupted or invalid.".to_string()
                } else if details.contains("dimension") {
                    "The image has unsupported dimensions.".to_string()
                } else {
                    "Unable to load the image file.".to_string()
                }
            }

            BridgeError::VolumeError { .. } => {
                "There was an error processing the volume data.".to_string()
            }

            BridgeError::GpuError { .. } => {
                "Graphics processing error. Your GPU may not support this operation.".to_string()
            }

            BridgeError::VolumeNotFound { .. } => {
                "The requested volume is no longer available. It may have been closed.".to_string()
            }

            BridgeError::ServiceNotInitialized { .. } => {
                "The graphics system is not ready. Please wait a moment and try again.".to_string()
            }

            BridgeError::Internal { details, .. } => {
                // Try to extract useful info from internal errors
                if details.contains("GPU") || details.contains("render") {
                    "Graphics processing error. Your GPU may not support this operation."
                        .to_string()
                } else if details.contains("memory") {
                    "Not enough memory to complete this operation.".to_string()
                } else {
                    "An unexpected error occurred.".to_string()
                }
            }
        }
    }

    fn suggested_actions(&self) -> Vec<String> {
        match self {
            BridgeError::Io { details, .. } => {
                if details.contains("Not found")
                    || details.contains("not found")
                    || details.contains("cannot find")
                    || details.contains("Could not find file")
                {
                    vec![
                        "Check that the file path is correct".to_string(),
                        "Ensure the file hasn't been moved or deleted".to_string(),
                    ]
                } else if details.contains("Permission denied") {
                    vec![
                        "Check file permissions".to_string(),
                        "Try running the application with appropriate permissions".to_string(),
                        "Move the file to an accessible location".to_string(),
                    ]
                } else if details.contains("No space left") {
                    vec![
                        "Free up disk space".to_string(),
                        "Try saving to a different location".to_string(),
                    ]
                } else {
                    vec!["Try the operation again".to_string()]
                }
            }

            BridgeError::Scope { .. } => vec![
                "Check file permissions".to_string(),
                "Try running the application with appropriate permissions".to_string(),
                "Move the file to an accessible location".to_string(),
            ],

            BridgeError::Input { details, .. } => {
                if details.contains("format") || details.contains("unsupported") {
                    vec![
                        "Convert the file to a supported format (NIFTI, GIFTI)".to_string(),
                        "Check that the file extension matches the actual format".to_string(),
                    ]
                } else {
                    vec!["Check your input and try again".to_string()]
                }
            }

            BridgeError::Loader { .. } => vec![
                "Verify the file is a valid neuroimaging format".to_string(),
                "Try opening the file in another viewer to check validity".to_string(),
                "Check if the file was compressed correctly".to_string(),
            ],

            BridgeError::VolumeError { .. } => vec![
                "Try loading the volume again".to_string(),
                "Check if the volume data is valid".to_string(),
            ],

            BridgeError::GpuError { .. } => vec![
                "Update your graphics drivers".to_string(),
                "Try disabling hardware acceleration".to_string(),
            ],

            BridgeError::VolumeNotFound { .. } => vec!["Reload the volume from disk".to_string()],

            BridgeError::ServiceNotInitialized { .. } => vec![
                "Wait for initialization to complete".to_string(),
                "Restart the application if the problem persists".to_string(),
            ],

            BridgeError::Internal { details, .. } => {
                if details.contains("GPU") || details.contains("render") {
                    vec![
                        "Update your graphics drivers".to_string(),
                        "Try disabling hardware acceleration".to_string(),
                    ]
                } else if details.contains("memory") {
                    vec![
                        "Close other applications to free memory".to_string(),
                        "Try working with smaller files".to_string(),
                    ]
                } else {
                    vec!["Restart the application and try again".to_string()]
                }
            }
        }
    }
}

/// Extract filename from error details
fn extract_filename(details: &str) -> String {
    if let Some(path_str) = details.split('\'').nth(1) {
        if let Some(filename) = Path::new(path_str).file_name() {
            return format!("File: {}", filename.to_string_lossy());
        }
    }
    String::new()
}

/// Extract format information from error details
fn extract_format_info(details: &str) -> String {
    if details.contains(".nii") {
        "Expected NIFTI format (.nii or .nii.gz)".to_string()
    } else if details.contains(".gii") {
        "Expected GIFTI format (.gii)".to_string()
    } else {
        "Supported formats: NIFTI (.nii, .nii.gz), GIFTI (.gii)".to_string()
    }
}

/// Format error for display in UI with all information
pub fn format_error_for_ui(error: &BridgeError) -> ErrorDisplay {
    ErrorDisplay {
        title: error_title(error),
        message: error.user_message(),
        technical_details: format!("{:?}", error),
        suggested_actions: error.suggested_actions(),
        error_code: error_code(error),
    }
}

/// Get a short title for the error
fn error_title(error: &BridgeError) -> String {
    match error {
        BridgeError::Io { details, .. } => {
            if details.contains("Not found") || details.contains("cannot find") {
                "File Not Found".to_string()
            } else if details.contains("Permission denied") {
                "Access Denied".to_string()
            } else {
                "File System Error".to_string()
            }
        }
        BridgeError::Scope { .. } => "Access Denied".to_string(),
        BridgeError::Input { details, .. } => {
            let details_lower = details.to_lowercase();
            if details_lower.contains("format") || details_lower.contains("unsupported") {
                "Unsupported Format".to_string()
            } else {
                "Invalid Input".to_string()
            }
        }
        BridgeError::Loader { .. } => "Loading Error".to_string(),
        BridgeError::VolumeError { .. } => "Volume Error".to_string(),
        BridgeError::GpuError { .. } => "Graphics Error".to_string(),
        BridgeError::VolumeNotFound { .. } => "Volume Not Found".to_string(),
        BridgeError::ServiceNotInitialized { .. } => "Not Ready".to_string(),
        BridgeError::Internal { .. } => "System Error".to_string(),
    }
}

/// Get error code for support/logging
fn error_code(error: &BridgeError) -> u16 {
    match error {
        BridgeError::Io { code, .. }
        | BridgeError::Loader { code, .. }
        | BridgeError::Scope { code, .. }
        | BridgeError::Input { code, .. }
        | BridgeError::Internal { code, .. }
        | BridgeError::VolumeError { code, .. }
        | BridgeError::GpuError { code, .. }
        | BridgeError::VolumeNotFound { code, .. }
        | BridgeError::ServiceNotInitialized { code, .. } => *code,
    }
}

/// Complete error information for UI display
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[ts(export)]
pub struct ErrorDisplay {
    pub title: String,
    pub message: String,
    pub technical_details: String,
    pub suggested_actions: Vec<String>,
    pub error_code: u16,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_not_found_message() {
        let error = BridgeError::Io {
            code: 404,
            details: "File '/home/user/scan.nii' not found".to_string(),
        };

        assert_eq!(
            error.user_message(),
            "Cannot find the requested file. File: scan.nii"
        );

        let actions = error.suggested_actions();
        assert!(actions.len() > 0);
        assert!(actions[0].contains("Check"));
    }

    #[test]
    fn test_gpu_error_message() {
        let error = BridgeError::Internal {
            code: 5000,
            details: "GPU initialization failed: device not found".to_string(),
        };

        assert!(error.user_message().contains("Graphics"));

        let actions = error.suggested_actions();
        assert!(actions.iter().any(|a| a.contains("drivers")));
    }

    #[test]
    fn test_format_for_ui() {
        let error = BridgeError::Input {
            code: 415,
            details: "Format .dcm not supported".to_string(),
        };

        let display = format_error_for_ui(&error);
        assert_eq!(display.title, "Unsupported Format");
        assert!(display.message.contains("not supported"));
        assert_eq!(display.error_code, 415);
    }
}
