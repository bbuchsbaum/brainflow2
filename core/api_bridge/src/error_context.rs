use anyhow::{Context, Result};
use bridge_types::BridgeError;

/// Extension trait to add context to errors
pub trait ErrorContext<T> {
    /// Add context to a Result, converting to anyhow::Result
    fn context_any<C>(self, context: C) -> Result<T>
    where
        C: std::fmt::Display + Send + Sync + 'static;

    /// Add context and convert to BridgeResult
    fn context_bridge<C>(self, context: C, code: u16) -> bridge_types::BridgeResult<T>
    where
        C: std::fmt::Display + Send + Sync + 'static;
}

impl<T, E> ErrorContext<T> for std::result::Result<T, E>
where
    E: std::error::Error + Send + Sync + 'static,
{
    fn context_any<C>(self, context: C) -> Result<T>
    where
        C: std::fmt::Display + Send + Sync + 'static,
    {
        self.context(context)
    }

    fn context_bridge<C>(self, context: C, code: u16) -> bridge_types::BridgeResult<T>
    where
        C: std::fmt::Display + Send + Sync + 'static,
    {
        self.map_err(|e| {
            let context_str = context.to_string();
            BridgeError::Internal {
                code,
                details: format!("{}: {}", context_str, e),
            }
        })
    }
}

/// Helper for adding context to Option values
pub trait OptionContext<T> {
    /// Convert None to an error with context
    fn context_bridge<C>(self, context: C, code: u16) -> bridge_types::BridgeResult<T>
    where
        C: std::fmt::Display + Send + Sync + 'static;
}

impl<T> OptionContext<T> for Option<T> {
    fn context_bridge<C>(self, context: C, code: u16) -> bridge_types::BridgeResult<T>
    where
        C: std::fmt::Display + Send + Sync + 'static,
    {
        self.ok_or_else(|| BridgeError::Internal {
            code,
            details: context.to_string(),
        })
    }
}

/// Helper macro for adding file and line context
#[macro_export]
macro_rules! context_here {
    ($msg:expr) => {
        format!("{} at {}:{}", $msg, file!(), line!())
    };
}

/// Helper for volume-specific errors with context
pub fn volume_not_found_context(volume_id: &str, operation: &str) -> BridgeError {
    BridgeError::VolumeNotFound {
        code: 4040,
        details: format!("Volume '{}' not found while {}", volume_id, operation),
    }
}

/// Helper for layer-specific errors with context
pub fn layer_error_context(
    layer_id: &str,
    operation: &str,
    error: impl std::fmt::Display,
) -> BridgeError {
    BridgeError::Internal {
        code: 5050,
        details: format!("Layer '{}' error during {}: {}", layer_id, operation, error),
    }
}

/// Helper for GPU-specific errors with context
pub fn gpu_error_context(operation: &str, error: impl std::fmt::Display) -> BridgeError {
    BridgeError::GpuError {
        code: 5060,
        details: format!("GPU error during {}: {}", operation, error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_context() {
        let result: std::result::Result<i32, std::io::Error> = Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "file missing",
        ));

        let bridge_result = result.context_bridge("loading configuration", 1001);

        match bridge_result {
            Err(BridgeError::Internal { code, details }) => {
                assert_eq!(code, 1001);
                assert!(details.contains("loading configuration"));
                assert!(details.contains("file missing"));
            }
            _ => panic!("Expected Internal error"),
        }
    }

    #[test]
    fn test_option_context() {
        let option: Option<i32> = None;
        let result = option.context_bridge("value not found", 2002);

        match result {
            Err(BridgeError::Internal { code, details }) => {
                assert_eq!(code, 2002);
                assert_eq!(details, "value not found");
            }
            _ => panic!("Expected Internal error"),
        }
    }
}
