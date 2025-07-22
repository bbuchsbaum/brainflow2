//! Error types for neuro-core

use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("Invalid slice specification: {0}")]
    InvalidSliceSpec(String),
    
    #[error("Volume not found: {0:?}")]
    VolumeNotFound(crate::VolumeHandle),
    
    #[error("Transform error: {0}")]
    TransformError(String),
    
    #[error("Interpolation error: {0}")]
    InterpolationError(String),
    
    #[error("Blend error: {0}")]
    BlendError(String),
    
    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),
    
    #[error("GPU error: {0}")]
    GpuError(String),
    
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

pub type Result<T> = std::result::Result<T, Error>;