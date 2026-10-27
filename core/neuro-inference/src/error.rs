//! Errors shared by every inference method.
use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum InferenceError {
    /// A parameter or input is outside its valid range.
    InvalidInput(String),
    /// The method does not support this field type or configuration.
    Unsupported(String),
    /// The search volume has no usable extent (for example no resels).
    EmptySearchVolume(String),
}

impl fmt::Display for InferenceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            InferenceError::InvalidInput(m) => write!(f, "invalid input: {m}"),
            InferenceError::Unsupported(m) => write!(f, "unsupported: {m}"),
            InferenceError::EmptySearchVolume(m) => write!(f, "empty search volume: {m}"),
        }
    }
}

impl std::error::Error for InferenceError {}

pub type Result<T> = std::result::Result<T, InferenceError>;

pub(crate) fn invalid(message: impl Into<String>) -> InferenceError {
    InferenceError::InvalidInput(message.into())
}
