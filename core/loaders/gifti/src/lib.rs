use bridge_types::{BridgeError, BridgeResult, Loaded, Loader, SurfaceDataHandle, SurfaceHandle};
use log::{debug, error, info, warn};
use neurosurf_rs::{
    geometry::{Hemisphere, SurfaceGeometry, SurfaceType},
    io::read_surface,
    NeuroSurfError,
};
use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;

// --- Error Type ---

#[derive(Error, Debug)]
pub enum GiftiError {
    #[error("GIFTI I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("NeuroSurf error: {0}")]
    NeuroSurf(#[from] NeuroSurfError),

    #[error("Unsupported file format: {0}")]
    UnsupportedFormat(String),

    #[error("Invalid GIFTI content: {0}")]
    InvalidContent(String),

    #[error("Content type detection failed: {0}")]
    ContentDetectionFailed(String),
}

// --- Content Types ---

/// Represents the type of content in a GIFTI file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum GiftiContentType {
    /// Surface geometry (vertices and faces)
    Geometry {
        vertex_count: usize,
        face_count: usize,
        hemisphere: Option<String>,
        surface_type: Option<String>,
    },
    /// Surface data (scalar values mapped to vertices)
    SurfaceData { data_count: usize, intent: String },
    /// Combined geometry and data in one file
    Combined {
        vertex_count: usize,
        face_count: usize,
        data_arrays: Vec<String>,
    },
}

/// Loaded GIFTI content
#[derive(Debug, Clone)]
pub enum GiftiContent {
    /// Surface geometry
    Surface(SurfaceGeometry),
    /// Surface data values
    Data(Vec<f64>),
    /// Both geometry and data
    Combined {
        surface: SurfaceGeometry,
        data: Vec<Vec<f64>>,
    },
}

// --- Loading Functions ---

/// Detects the content type of a GIFTI file without fully loading it
pub fn detect_gifti_content_type(path: &Path) -> Result<GiftiContentType, GiftiError> {
    info!("Detecting GIFTI content type: {}", path.display());

    // First, try to detect based on filename patterns
    let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

    // Check for functional/shape data patterns
    if filename.contains(".func.gii") || filename.contains(".shape.gii") {
        info!("Detected as functional/shape data based on filename pattern");

        // Try to parse the GIFTI file to get data array info
        if let Ok(gifti_data) = gifti::read_gifti(path) {
            // Check for data arrays without coordinate data
            let has_coordinates = gifti_data.data_arrays.iter().any(|da| {
                // Check if this is coordinate data (points/vertices)
                match &da.attributes.intent {
                    gifti::Intent::Pointset => true,
                    _ => false,
                }
            });

            if !has_coordinates {
                // This is a data overlay file
                if let Some(first_array) = gifti_data.data_arrays.first() {
                    let data_count = first_array.data.len();
                    let intent = format!("{:?}", first_array.attributes.intent);

                    return Ok(GiftiContentType::SurfaceData { data_count, intent });
                }
            }
        }
    }

    // Try to load as surface geometry
    match read_surface(path) {
        Ok(surface) => {
            // Successfully loaded as surface geometry
            let hemisphere = match surface.hemisphere() {
                Hemisphere::Left => Some("left".to_string()),
                Hemisphere::Right => Some("right".to_string()),
                Hemisphere::Both => Some("both".to_string()),
                Hemisphere::Unknown => None,
            };

            let surface_type = match surface.surface_type() {
                SurfaceType::White => Some("white".to_string()),
                SurfaceType::Pial => Some("pial".to_string()),
                SurfaceType::Inflated => Some("inflated".to_string()),
                _ => None, // Handle any other variants
            };

            Ok(GiftiContentType::Geometry {
                vertex_count: surface.vertex_count(),
                face_count: surface.face_count(),
                hemisphere,
                surface_type,
            })
        }
        Err(e) => {
            // Could not load as surface geometry
            // Try to load as data array using gifti crate directly
            match gifti::read_gifti(path) {
                Ok(gifti_data) => {
                    // Check if this is a data-only file
                    if let Some(first_array) = gifti_data.data_arrays.first() {
                        let data_count = first_array.data.len();
                        let intent = format!("{:?}", first_array.attributes.intent);

                        info!(
                            "Detected as surface data: {} values, intent: {}",
                            data_count, intent
                        );
                        Ok(GiftiContentType::SurfaceData { data_count, intent })
                    } else {
                        Err(GiftiError::ContentDetectionFailed(
                            "GIFTI file contains no data arrays".to_string(),
                        ))
                    }
                }
                Err(gifti_err) => {
                    warn!(
                        "Could not load as surface or data: surface error: {}, gifti error: {}",
                        e, gifti_err
                    );
                    Err(GiftiError::ContentDetectionFailed(format!(
                        "Unable to determine GIFTI content type: No coordinate data found in GIFTI file",
                    )))
                }
            }
        }
    }
}

/// Loads a GIFTI file and returns its content
pub fn load_gifti_file(path: &Path) -> Result<GiftiContent, GiftiError> {
    info!("Loading GIFTI file: {}", path.display());

    // First, try to detect the content type
    let content_type = detect_gifti_content_type(path)?;

    match content_type {
        GiftiContentType::Geometry { .. } => {
            // Load as surface geometry
            let surface = read_surface(path)?;
            info!(
                "Loaded surface geometry: {} vertices, {} faces",
                surface.vertex_count(),
                surface.face_count()
            );
            Ok(GiftiContent::Surface(surface))
        }
        GiftiContentType::SurfaceData { data_count, .. } => {
            // Load surface data using gifti crate directly
            let gifti_data = gifti::read_gifti(path).map_err(|e| {
                GiftiError::InvalidContent(format!("Failed to read GIFTI data: {}", e))
            })?;

            // Extract the scalar data from the first data array
            if let Some(first_array) = gifti_data.data_arrays.first() {
                // Convert data to f64 vector
                let data: Vec<f64> = first_array.data.iter().map(|&v| v as f64).collect();

                info!("Loaded surface data: {} values", data.len());
                Ok(GiftiContent::Data(data))
            } else {
                Err(GiftiError::InvalidContent(
                    "No data arrays found in GIFTI file".to_string(),
                ))
            }
        }
        GiftiContentType::Combined { .. } => {
            // TODO: Implement loading of combined files
            // This will require enhanced neurosurf-rs support
            // or direct gifti-rs usage
            error!("Loading combined geometry+data files not yet implemented");
            Err(GiftiError::InvalidContent(
                "Combined geometry+data loading not yet implemented".to_string(),
            ))
        }
    }
}

/// Loads surface data from a GIFTI overlay file
pub fn load_gifti_surface_data(path: &Path) -> Result<Vec<f32>, GiftiError> {
    info!("Loading GIFTI surface data: {}", path.display());

    // Load using gifti crate
    let gifti_data = gifti::read_gifti(path)
        .map_err(|e| GiftiError::InvalidContent(format!("Failed to read GIFTI data: {}", e)))?;

    // Extract the first data array
    if let Some(first_array) = gifti_data.data_arrays.first() {
        // The gifti crate has already parsed the data as Vec<f64>
        // We need to convert it to f32
        let data: Vec<f32> = first_array.data.iter().map(|&v| v as f32).collect();

        info!("Loaded {} surface data values", data.len());
        Ok(data)
    } else {
        Err(GiftiError::InvalidContent(
            "No data arrays found in GIFTI file".to_string(),
        ))
    }
}

/// Loads a GIFTI surface geometry file
pub fn load_gifti_surface(path: &Path) -> Result<SurfaceGeometry, GiftiError> {
    info!("Loading GIFTI surface: {}", path.display());

    // Load the surface using neurosurf-rs
    let surface = read_surface(path)?;

    debug!(
        "Loaded GIFTI surface: {} vertices, {} faces, hemisphere: {:?}, type: {:?}",
        surface.vertex_count(),
        surface.face_count(),
        surface.hemisphere(),
        surface.surface_type()
    );

    Ok(surface)
}

/// Information about a loaded surface
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SurfaceInfo {
    pub vertex_count: usize,
    pub face_count: usize,
    pub hemisphere: String,
    pub surface_type: String,
    pub bounding_box: BoundingBox,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoundingBox {
    pub min: [f64; 3],
    pub max: [f64; 3],
}

/// Extracts information from a surface geometry
pub fn get_surface_info(surface: &SurfaceGeometry) -> SurfaceInfo {
    // Handle the Result from bounding_box()
    // Extract coordinates without directly using nalgebra types to avoid version conflicts
    let (min_coords, max_coords) = if let Ok((min_pt, max_pt)) = surface.bounding_box() {
        // Access coordinates using array indexing to avoid nalgebra type issues
        (
            [min_pt[0], min_pt[1], min_pt[2]],
            [max_pt[0], max_pt[1], max_pt[2]],
        )
    } else {
        // Return default bounding box on error
        ([0.0, 0.0, 0.0], [0.0, 0.0, 0.0])
    };

    SurfaceInfo {
        vertex_count: surface.vertex_count(),
        face_count: surface.face_count(),
        hemisphere: format!("{:?}", surface.hemisphere()),
        surface_type: format!("{:?}", surface.surface_type()),
        bounding_box: BoundingBox {
            min: min_coords,
            max: max_coords,
        },
    }
}

// --- Conversion to Bridge Types ---

impl From<GiftiError> for BridgeError {
    fn from(err: GiftiError) -> Self {
        BridgeError::LoaderError(format!("GIFTI loader error: {}", err))
    }
}

// --- Loader Trait Implementation ---

pub struct GiftiLoader;

// Seal the trait
impl bridge_types::private::Sealed for GiftiLoader {}

impl Loader for GiftiLoader {
    fn can_load(path: &Path) -> bool
    where
        Self: Sized,
    {
        // Check if file has .gii extension
        if let Some(ext) = path.extension() {
            if ext.eq_ignore_ascii_case("gii") {
                return true;
            }
        }
        false
    }

    fn load(path: &Path) -> BridgeResult<Loaded>
    where
        Self: Sized,
    {
        info!("GiftiLoader: Loading file: {}", path.display());

        // Detect content type first
        let content_type = detect_gifti_content_type(path)?;

        match content_type {
            GiftiContentType::Geometry {
                vertex_count,
                face_count,
                ..
            } => {
                // Create a handle for the surface
                let handle = SurfaceHandle(format!("surface_{}", uuid::Uuid::new_v4()));

                Ok(Loaded::Surface {
                    handle,
                    vertex_count,
                    face_count,
                    path: path.to_string_lossy().to_string(),
                })
            }
            GiftiContentType::SurfaceData { data_count, .. } => {
                // Create a handle for the surface data
                let handle = SurfaceDataHandle(format!("surfdata_{}", uuid::Uuid::new_v4()));

                Ok(Loaded::SurfaceData {
                    handle,
                    data_count,
                    path: path.to_string_lossy().to_string(),
                })
            }
            GiftiContentType::Combined { .. } => {
                // For now, treat combined files as surfaces
                // In the future, we might want to return both components
                let surface = read_surface(path).map_err(|e| GiftiError::NeuroSurf(e))?;
                let handle = SurfaceHandle(format!("surface_{}", uuid::Uuid::new_v4()));

                Ok(Loaded::Surface {
                    handle,
                    vertex_count: surface.vertex_count(),
                    face_count: surface.face_count(),
                    path: path.to_string_lossy().to_string(),
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_error_conversion() {
        let err = GiftiError::UnsupportedFormat("test.xyz".to_string());
        let bridge_err: BridgeError = err.into();
        match bridge_err {
            BridgeError::LoaderError(msg) => {
                assert!(msg.contains("GIFTI loader error"));
            }
            _ => panic!("Expected LoaderError variant"),
        }
    }

    #[test]
    fn test_can_load() {
        assert!(GiftiLoader::can_load(Path::new("test.gii")));
        assert!(GiftiLoader::can_load(Path::new("TEST.GII")));
        assert!(GiftiLoader::can_load(Path::new("/path/to/surface.gii")));
        assert!(!GiftiLoader::can_load(Path::new("test.nii")));
        assert!(!GiftiLoader::can_load(Path::new("test.txt")));
    }

    #[test]
    #[ignore] // Requires actual GIFTI test files
    fn test_detect_content_type() {
        let path = PathBuf::from("test_data/surface.gii");
        let result = detect_gifti_content_type(&path);
        assert!(result.is_ok());
    }
}
