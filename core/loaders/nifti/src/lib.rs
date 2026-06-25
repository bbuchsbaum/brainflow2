use bridge_types::{BridgeError, BridgeResult, Loaded, Loader, VolumeSendable};
use log::{error, info};
use nalgebra::Affine3;
use serde::Serialize;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use thiserror::Error;
use volmath::DenseVolume3;

// Use neuroim for NIfTI I/O
use neuroim::io::{read_vec_as, read_vol_as};
use neuroim::{DenseNeuroVec, DenseNeuroVol, NeuroVecTrait, NeuroVol};

// --- Error Type ---

#[derive(Error, Debug)]
pub enum NiftiError {
    #[error("NIFTI I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("NeuroIM error: {0}")]
    NeuroIM(#[from] neuroim::Error),
    #[error("Unsupported volume dimensions: {0}, expected 3 or 4 (only first volume used)")]
    DimensionMismatch(usize),
    #[error("ScalingError: {0}")]
    ScalingError(String),
}

// --- Loading Function using neuroim ---

/// Loads a NIfTI volume from the given path using neuroim-rs.
/// Returns a VolumeSendable enum containing a volmath::DenseVolume3<T>.
pub fn load_nifti_volume_neuroim<T>(
    path: &Path,
) -> Result<(VolumeSendable, Affine3<f32>), NiftiError>
where
    T: neuroim::Numeric + Clone + Serialize + std::fmt::Debug + Send + Sync + 'static,
{
    info!("Loading NIfTI file using neuroim: {}", path.display());

    // Use neuroim to read the file
    let volume: DenseNeuroVol<T> = read_vol_as(path, 0)?;

    // Get the space (geometry information)
    let space = volume.space();
    let dims = &space.dim;

    // Validate dimensions
    if dims.len() != 3 {
        return Err(NiftiError::DimensionMismatch(dims.len()));
    }

    // Convert neuroim NeuroSpace to volmath NeuroSpace3 (they're the same type now)
    let volmath_space = space.clone();

    // Get the data vector
    let data = volume.values();

    // Create the DenseVolume3 using our extension trait
    let dense_volume = DenseVolume3::from_data(volmath_space, data);

    // Create a basic affine transform from the space's transformation matrix
    // neuroim NeuroSpace has a `trans` field which is a nalgebra DMatrix
    let affine = if space.trans.nrows() >= 4 && space.trans.ncols() >= 4 {
        let trans_4x4 = space.trans.clone().fixed_resize::<4, 4>(0.0);
        Affine3::from_matrix_unchecked(trans_4x4.cast::<f32>())
    } else {
        // Fallback to identity if the matrix is smaller than 4x4
        Affine3::identity()
    };

    // Debug: Log the affine transform
    info!("NIfTI loader - affine transform from NeuroSpace:");
    let affine_matrix = affine.to_homogeneous();
    for i in 0..4 {
        info!(
            "  [{:.3}, {:.3}, {:.3}, {:.3}]",
            affine_matrix[(i, 0)],
            affine_matrix[(i, 1)],
            affine_matrix[(i, 2)],
            affine_matrix[(i, 3)]
        );
    }

    // Debug: Also log the original trans matrix from NeuroSpace
    info!(
        "NIfTI loader - original trans matrix from NeuroSpace ({}x{}):",
        space.trans.nrows(),
        space.trans.ncols()
    );
    for i in 0..space.trans.nrows().min(4) {
        if space.trans.ncols() >= 4 {
            info!(
                "  [{:.3}, {:.3}, {:.3}, {:.3}]",
                space.trans[(i, 0)],
                space.trans[(i, 1)],
                space.trans[(i, 2)],
                space.trans[(i, 3)]
            );
        }
    }

    // Create the appropriate VolumeSendable variant based on type
    let volume_sendable = create_volume_sendable(dense_volume, affine.clone())?;

    info!("Successfully loaded NIfTI volume: dims={:?}", dims);
    Ok((volume_sendable, affine))
}

// Helper function to create VolumeSendable - this needs to be a macro or use Any trait
// For now, we'll implement specific loaders for each type
fn create_volume_sendable<T>(
    volume: DenseVolume3<T>,
    affine: Affine3<f32>,
) -> Result<VolumeSendable, NiftiError>
where
    T: neuroim::Numeric
        + volmath::Numeric
        + Clone
        + Serialize
        + std::fmt::Debug
        + Send
        + Sync
        + 'static,
{
    // This is a bit hacky but works for the type system
    use std::any::TypeId;

    let type_id = TypeId::of::<T>();

    if type_id == TypeId::of::<f32>() {
        // Safety: We've verified T is f32
        let vol_f32 =
            unsafe { std::mem::transmute_copy::<DenseVolume3<T>, DenseVolume3<f32>>(&volume) };
        std::mem::forget(volume); // Prevent double-drop
        Ok(VolumeSendable::VolF32(vol_f32, affine))
    } else if type_id == TypeId::of::<i16>() {
        let vol_i16 =
            unsafe { std::mem::transmute_copy::<DenseVolume3<T>, DenseVolume3<i16>>(&volume) };
        std::mem::forget(volume);
        Ok(VolumeSendable::VolI16(vol_i16, affine))
    } else if type_id == TypeId::of::<u8>() {
        let vol_u8 =
            unsafe { std::mem::transmute_copy::<DenseVolume3<T>, DenseVolume3<u8>>(&volume) };
        std::mem::forget(volume);
        Ok(VolumeSendable::VolU8(vol_u8, affine))
    } else if type_id == TypeId::of::<i8>() {
        let vol_i8 =
            unsafe { std::mem::transmute_copy::<DenseVolume3<T>, DenseVolume3<i8>>(&volume) };
        std::mem::forget(volume);
        Ok(VolumeSendable::VolI8(vol_i8, affine))
    } else if type_id == TypeId::of::<u16>() {
        let vol_u16 =
            unsafe { std::mem::transmute_copy::<DenseVolume3<T>, DenseVolume3<u16>>(&volume) };
        std::mem::forget(volume);
        Ok(VolumeSendable::VolU16(vol_u16, affine))
    } else if type_id == TypeId::of::<i32>() {
        let vol_i32 =
            unsafe { std::mem::transmute_copy::<DenseVolume3<T>, DenseVolume3<i32>>(&volume) };
        std::mem::forget(volume);
        Ok(VolumeSendable::VolI32(vol_i32, affine))
    } else if type_id == TypeId::of::<u32>() {
        let vol_u32 =
            unsafe { std::mem::transmute_copy::<DenseVolume3<T>, DenseVolume3<u32>>(&volume) };
        std::mem::forget(volume);
        Ok(VolumeSendable::VolU32(vol_u32, affine))
    } else if type_id == TypeId::of::<f64>() {
        let vol_f64 =
            unsafe { std::mem::transmute_copy::<DenseVolume3<T>, DenseVolume3<f64>>(&volume) };
        std::mem::forget(volume);
        Ok(VolumeSendable::VolF64(vol_f64, affine))
    } else {
        Err(NiftiError::ScalingError(format!(
            "Unsupported type: {}",
            std::any::type_name::<T>()
        )))
    }
}

// --- 4D Loading Functions ---

/// Loads a 4D NIfTI time series from the given path using neuroim-rs.
/// Returns a VolumeSendable enum containing a neuroim::DenseNeuroVec<T>.
pub fn load_nifti_4d_neuroim<T>(path: &Path) -> Result<VolumeSendable, NiftiError>
where
    T: neuroim::Numeric
        + std::iter::Sum
        + Clone
        + Serialize
        + std::fmt::Debug
        + Send
        + Sync
        + 'static,
{
    info!("Loading 4D NIfTI file using neuroim: {}", path.display());

    // Use neuroim to read the 4D file
    let vec_4d: DenseNeuroVec<T> = read_vec_as(path)?;

    // Get the space information
    let space = vec_4d.space();
    let dims = &space.dim;

    // Validate dimensions
    if dims.len() != 4 {
        return Err(NiftiError::DimensionMismatch(dims.len()));
    }

    info!(
        "Successfully loaded 4D NIfTI volume: dims={:?}, timepoints={}",
        &dims[0..3],
        dims[3]
    );

    // Create the appropriate VolumeSendable variant based on type
    create_4d_volume_sendable(vec_4d)
}

// Helper function to create 4D VolumeSendable
fn create_4d_volume_sendable<T>(vec_4d: DenseNeuroVec<T>) -> Result<VolumeSendable, NiftiError>
where
    T: neuroim::Numeric
        + std::iter::Sum
        + Clone
        + Serialize
        + std::fmt::Debug
        + Send
        + Sync
        + 'static,
{
    use std::any::TypeId;

    let type_id = TypeId::of::<T>();

    if type_id == TypeId::of::<f32>() {
        // Safety: We've verified T is f32
        let vec_f32 =
            unsafe { std::mem::transmute_copy::<DenseNeuroVec<T>, DenseNeuroVec<f32>>(&vec_4d) };
        std::mem::forget(vec_4d); // Prevent double-drop
        Ok(VolumeSendable::Vec4DF32(vec_f32))
    } else if type_id == TypeId::of::<i16>() {
        let vec_i16 =
            unsafe { std::mem::transmute_copy::<DenseNeuroVec<T>, DenseNeuroVec<i16>>(&vec_4d) };
        std::mem::forget(vec_4d);
        Ok(VolumeSendable::Vec4DI16(vec_i16))
    } else if type_id == TypeId::of::<u8>() {
        let vec_u8 =
            unsafe { std::mem::transmute_copy::<DenseNeuroVec<T>, DenseNeuroVec<u8>>(&vec_4d) };
        std::mem::forget(vec_4d);
        Ok(VolumeSendable::Vec4DU8(vec_u8))
    } else if type_id == TypeId::of::<i8>() {
        let vec_i8 =
            unsafe { std::mem::transmute_copy::<DenseNeuroVec<T>, DenseNeuroVec<i8>>(&vec_4d) };
        std::mem::forget(vec_4d);
        Ok(VolumeSendable::Vec4DI8(vec_i8))
    } else if type_id == TypeId::of::<u16>() {
        let vec_u16 =
            unsafe { std::mem::transmute_copy::<DenseNeuroVec<T>, DenseNeuroVec<u16>>(&vec_4d) };
        std::mem::forget(vec_4d);
        Ok(VolumeSendable::Vec4DU16(vec_u16))
    } else if type_id == TypeId::of::<i32>() {
        let vec_i32 =
            unsafe { std::mem::transmute_copy::<DenseNeuroVec<T>, DenseNeuroVec<i32>>(&vec_4d) };
        std::mem::forget(vec_4d);
        Ok(VolumeSendable::Vec4DI32(vec_i32))
    } else if type_id == TypeId::of::<u32>() {
        let vec_u32 =
            unsafe { std::mem::transmute_copy::<DenseNeuroVec<T>, DenseNeuroVec<u32>>(&vec_4d) };
        std::mem::forget(vec_4d);
        Ok(VolumeSendable::Vec4DU32(vec_u32))
    } else if type_id == TypeId::of::<f64>() {
        let vec_f64 =
            unsafe { std::mem::transmute_copy::<DenseNeuroVec<T>, DenseNeuroVec<f64>>(&vec_4d) };
        std::mem::forget(vec_4d);
        Ok(VolumeSendable::Vec4DF64(vec_f64))
    } else {
        Err(NiftiError::ScalingError(format!(
            "Unsupported type: {}",
            std::any::type_name::<T>()
        )))
    }
}

// Auto-detect and load either 3D or 4D NIfTI
pub fn load_nifti_auto_dimension(path: &Path) -> Result<VolumeSendable, NiftiError> {
    // First, read the header to determine dimensions
    use neuroim::io::read_header;

    let header_info = read_header(path)?;
    let ndims = header_info.dim.len();

    info!("NIfTI file has {} dimensions: {:?}", ndims, header_info.dim);

    if ndims == 3 || (ndims == 4 && header_info.dim[3] == 1) {
        // 3D volume (or 4D with single timepoint)
        let (volume, _affine) = load_nifti_volume_auto(path)?;
        Ok(volume)
    } else if ndims == 4 && header_info.dim[3] > 1 {
        // 4D time series
        load_nifti_4d_auto(path)
    } else {
        Err(NiftiError::DimensionMismatch(ndims))
    }
}

/// Read the NIfTI sform/qform transform codes from a file header.
///
/// Returns `(sform_code, qform_code)`. These standard codes are:
/// 0 = unknown, 1 = scanner anatomical, 2 = aligned anatomical,
/// 3 = Talairach, 4 = MNI152. The in-memory volume representation does not
/// retain them, so callers that need the coordinate-space provenance re-read
/// the header here (cheap — header only, no voxel data).
pub fn read_xform_codes(path: &Path) -> Result<(i16, i16), NiftiError> {
    let header_info = neuroim::io::read_header(path)?;
    Ok((header_info.sform_code, header_info.qform_code))
}

// Try loading 4D volume with different data types
pub fn load_nifti_4d_auto(path: &Path) -> Result<VolumeSendable, NiftiError> {
    // Fast path: dispatch on the header datatype to avoid redundant full-file
    // reads (see `load_nifti_volume_auto` for rationale). Falls through to the
    // legacy sequential probing on any failure.
    // Only dispatch types the legacy probing below already exercises (f32, i16,
    // f64, u16), so this adds no new monomorphizations. Anything else falls
    // through to the unchanged sequential path.
    if let Some(datatype) = peek_nifti_datatype(path) {
        let direct = match datatype {
            16 => Some(load_nifti_4d_neuroim::<f32>(path)), // DT_FLOAT32
            4 => Some(load_nifti_4d_neuroim::<i16>(path)),  // DT_INT16
            64 => Some(load_nifti_4d_neuroim::<f64>(path)), // DT_FLOAT64
            512 => Some(load_nifti_4d_neuroim::<u16>(path)), // DT_UINT16
            _ => None,
        };
        if let Some(Ok(result)) = direct {
            return Ok(result);
        }
    }

    // Try loading as f32 first (most common for fMRI)
    if let Ok(result) = load_nifti_4d_neuroim::<f32>(path) {
        return Ok(result);
    }

    // Try i16
    if let Ok(result) = load_nifti_4d_neuroim::<i16>(path) {
        return Ok(result);
    }

    // Try f64
    if let Ok(result) = load_nifti_4d_neuroim::<f64>(path) {
        return Ok(result);
    }

    // Try other types as needed
    if let Ok(result) = load_nifti_4d_neuroim::<u16>(path) {
        return Ok(result);
    }

    Err(NiftiError::ScalingError(
        "Could not load 4D file with any supported data type".to_string(),
    ))
}

/// Reads just the NIfTI header (transparently decompressing gzip) and returns
/// the `datatype` field code, or `None` if it cannot be determined.
///
/// This lets callers dispatch directly to the correct typed loader instead of
/// trial-and-error probing every supported type, which would otherwise read and
/// decompress the entire file once per failed attempt. Parsing is done against
/// the frozen NIfTI-1/NIfTI-2 header layout so it depends only on `std` +
/// `flate2` (no neuroim internals), and any failure simply returns `None` so the
/// caller can fall back to the legacy sequential probing.
fn peek_nifti_datatype(path: &Path) -> Option<i16> {
    // Sniff the first two bytes to detect gzip (.nii.gz) vs raw (.nii).
    let mut sniff = [0u8; 2];
    File::open(path).ok()?.read_exact(&mut sniff).ok()?;

    // A NIfTI-2 header is 540 bytes; read a little more than enough for either.
    let mut header = vec![0u8; 544];
    let filled = if sniff == [0x1f, 0x8b] {
        let file = File::open(path).ok()?;
        read_up_to(&mut flate2::read::GzDecoder::new(file), &mut header)
    } else {
        let mut file = File::open(path).ok()?;
        read_up_to(&mut file, &mut header)
    };
    header.truncate(filled);
    parse_nifti_datatype(&header)
}

/// Fills `buf` by reading repeatedly until it is full or EOF/error is hit.
/// Returns the number of bytes actually read.
fn read_up_to<R: Read>(reader: &mut R, buf: &mut [u8]) -> usize {
    let mut filled = 0;
    while filled < buf.len() {
        match reader.read(&mut buf[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(_) => break,
        }
    }
    filled
}

/// Extracts the `datatype` code from raw NIfTI-1/NIfTI-2 header bytes, handling
/// both little- and big-endian files via the `sizeof_hdr` sentinel.
fn parse_nifti_datatype(h: &[u8]) -> Option<i16> {
    if h.len() < 4 {
        return None;
    }
    let sizeof_hdr_le = i32::from_le_bytes([h[0], h[1], h[2], h[3]]);
    let sizeof_hdr_be = i32::from_be_bytes([h[0], h[1], h[2], h[3]]);

    // NIfTI-1: sizeof_hdr == 348, datatype is an i16 at byte offset 70.
    if sizeof_hdr_le == 348 || sizeof_hdr_be == 348 {
        if h.len() < 72 {
            return None;
        }
        let bytes = [h[70], h[71]];
        return Some(if sizeof_hdr_le == 348 {
            i16::from_le_bytes(bytes)
        } else {
            i16::from_be_bytes(bytes)
        });
    }

    // NIfTI-2: sizeof_hdr == 540, datatype is an i16 at byte offset 12.
    if sizeof_hdr_le == 540 || sizeof_hdr_be == 540 {
        if h.len() < 14 {
            return None;
        }
        let bytes = [h[12], h[13]];
        return Some(if sizeof_hdr_le == 540 {
            i16::from_le_bytes(bytes)
        } else {
            i16::from_be_bytes(bytes)
        });
    }

    None
}

// Simplified load function that tries different types (3D only)
pub fn load_nifti_volume_auto(path: &Path) -> Result<(VolumeSendable, Affine3<f32>), NiftiError> {
    // Fast path: read the datatype directly from the header and load exactly
    // that type. neuroim's typed reader requires T to match the on-disk type
    // (mismatches return Err, which is why the legacy code below probes
    // sequentially) so a single header peek lets us skip up to three full-file
    // reads/decompressions. If the peek or direct load fails for any reason we
    // fall through to the legacy probing so behaviour is never worse than before.
    // Only dispatch types the legacy probing below already exercises, so this
    // adds no new monomorphizations. Any other datatype yields `None` and falls
    // through to the unchanged sequential path.
    if let Some(datatype) = peek_nifti_datatype(path) {
        let direct = match datatype {
            16 => Some(load_nifti_volume_neuroim::<f32>(path)), // DT_FLOAT32
            4 => Some(load_nifti_volume_neuroim::<i16>(path)),  // DT_INT16
            2 => Some(load_nifti_volume_neuroim::<u8>(path)),   // DT_UINT8
            64 => Some(load_nifti_volume_neuroim::<f64>(path)), // DT_FLOAT64
            _ => None,
        };
        if let Some(Ok(result)) = direct {
            return Ok(result);
        }
    }

    // Legacy fallback: try loading as f32 first (most common)
    if let Ok(result) = load_nifti_volume_neuroim::<f32>(path) {
        return Ok(result);
    }

    // Try i16 (common for structural scans)
    if let Ok(result) = load_nifti_volume_neuroim::<i16>(path) {
        return Ok(result);
    }

    // Try u8 (common for masks)
    if let Ok(result) = load_nifti_volume_neuroim::<u8>(path) {
        return Ok(result);
    }

    // Try f64 as last resort
    if let Ok(result) = load_nifti_volume_neuroim::<f64>(path) {
        return Ok(result);
    }

    Err(NiftiError::ScalingError(
        "Could not load file with any supported data type".to_string(),
    ))
}

// --- Loader Implementation ---

#[derive(Default)]
pub struct NiftiLoader;

// Implement the sealed trait from bridge_types
impl bridge_types::private::Sealed for NiftiLoader {}

// --- Error Conversion ---
impl From<NiftiError> for BridgeError {
    fn from(err: NiftiError) -> Self {
        match err {
            NiftiError::Io(e) => BridgeError::Io {
                code: 5001,
                details: format!("NIfTI file I/O error: {}", e),
            },
            NiftiError::NeuroIM(e) => BridgeError::Loader {
                code: 5002,
                details: format!("NeuroIM error: {}", e),
            },
            NiftiError::DimensionMismatch(dim) => BridgeError::Loader {
                code: 5005,
                details: format!("Unsupported NIFTI dimensions: {}", dim),
            },
            NiftiError::ScalingError(msg) => BridgeError::Loader {
                code: 5006,
                details: format!("NIFTI scaling error: {}", msg),
            },
        }
    }
}

impl Loader for NiftiLoader {
    fn can_load(path: &Path) -> bool {
        path.extension().map_or(false, |ext| {
            let ext_str = ext.to_string_lossy().to_lowercase();
            ext_str == "nii"
                || (ext_str == "gz"
                    && path
                        .file_stem()
                        .map_or(false, |stem| stem.to_string_lossy().ends_with(".nii")))
        })
    }

    fn load(path: &Path) -> BridgeResult<Loaded> {
        info!(
            "NiftiLoader: Loading file using neuroim: {}",
            path.display()
        );

        match load_nifti_auto_dimension(path) {
            Ok(volume_data) => {
                // Extract necessary info for Loaded::Volume
                let (dtype_str, dims_vec) = match &volume_data {
                    // 3D variants
                    VolumeSendable::VolF32(vol, _) => ("f32".to_string(), vol.space().dim.clone()),
                    VolumeSendable::VolI16(vol, _) => ("i16".to_string(), vol.space().dim.clone()),
                    VolumeSendable::VolU8(vol, _) => ("u8".to_string(), vol.space().dim.clone()),
                    VolumeSendable::VolI8(vol, _) => ("i8".to_string(), vol.space().dim.clone()),
                    VolumeSendable::VolU16(vol, _) => ("u16".to_string(), vol.space().dim.clone()),
                    VolumeSendable::VolI32(vol, _) => ("i32".to_string(), vol.space().dim.clone()),
                    VolumeSendable::VolU32(vol, _) => ("u32".to_string(), vol.space().dim.clone()),
                    VolumeSendable::VolF64(vol, _) => ("f64".to_string(), vol.space().dim.clone()),
                    // 4D variants
                    VolumeSendable::Vec4DF32(vec) => ("f32".to_string(), vec.space().dim.clone()),
                    VolumeSendable::Vec4DI16(vec) => ("i16".to_string(), vec.space().dim.clone()),
                    VolumeSendable::Vec4DU8(vec) => ("u8".to_string(), vec.space().dim.clone()),
                    VolumeSendable::Vec4DI8(vec) => ("i8".to_string(), vec.space().dim.clone()),
                    VolumeSendable::Vec4DU16(vec) => ("u16".to_string(), vec.space().dim.clone()),
                    VolumeSendable::Vec4DI32(vec) => ("i32".to_string(), vec.space().dim.clone()),
                    VolumeSendable::Vec4DU32(vec) => ("u32".to_string(), vec.space().dim.clone()),
                    VolumeSendable::Vec4DF64(vec) => ("f64".to_string(), vec.space().dim.clone()),
                };

                // For now, still return 3D dims for Loaded::Volume compatibility
                // TODO: Update Loaded enum to support variable dimensions
                let dims_u16: [u16; 3] = dims_vec
                    .iter()
                    .take(3)
                    .map(|&d| d as u16)
                    .collect::<Vec<u16>>()
                    .try_into()
                    .map_err(|_| NiftiError::DimensionMismatch(dims_vec.len()))?;

                let dims_str = if dims_vec.len() == 4 {
                    format!("{:?} (4D with {} timepoints)", &dims_u16, dims_vec[3])
                } else {
                    format!("{:?}", dims_u16)
                };

                info!(
                    "Successfully loaded volume: dims={}, dtype={}",
                    dims_str, dtype_str
                );

                Ok(Loaded::Volume {
                    dims: dims_u16,
                    dtype: dtype_str,
                    path: path.to_string_lossy().to_string(),
                })
            }
            Err(nifti_err) => {
                error!(
                    "Failed to load NIFTI file {}: {}",
                    path.display(),
                    nifti_err
                );
                Err(BridgeError::from(nifti_err))
            }
        }
    }
}

// --- Unit Tests ---
#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;
    use std::path::PathBuf;

    // Helper to get the path to the test data directory
    fn get_test_data_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..") // Go up to loaders/
            .join("..") // Go up to core/
            .join("..") // Go up to workspace root
            .join("test-data")
            .join("unit")
    }

    // Helper to get the full path to a specific unit test file
    fn get_unit_test_file(filename: &str) -> PathBuf {
        get_test_data_dir().join(filename)
    }

    #[test]
    fn read_xform_codes_reads_mni_template_codes() {
        let test_file = get_unit_test_file("tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii");
        if !test_file.exists() {
            eprintln!("Test file not found: {:?}, skipping test", test_file);
            return;
        }
        let (sform, qform) = read_xform_codes(&test_file).expect("read xform codes");
        // The bundled MNI152 template is tagged (sform=1, qform=1) -- a concrete
        // reminder that NIfTI xform codes alone do NOT identify MNI space, so the
        // coordinate-space heuristic must also consult the filename.
        assert_eq!((sform, qform), (1, 1));
    }

    #[test]
    fn test_can_load() {
        assert!(NiftiLoader::can_load(Path::new("test.nii")));
        assert!(NiftiLoader::can_load(Path::new("test.nii.gz")));
        assert!(!NiftiLoader::can_load(Path::new("test.txt")));
        assert!(!NiftiLoader::can_load(Path::new("test.gz")));
    }

    // Test loading a real file
    #[test]
    fn test_load_real_file_toy_t1w() {
        let test_file = get_unit_test_file("toy_t1w.nii.gz");
        if !test_file.exists() {
            eprintln!("Test file not found: {:?}, skipping test", test_file);
            return;
        }

        let result = NiftiLoader::load(&test_file);
        assert!(
            result.is_ok(),
            "Failed to load test file: {:?}",
            result.err()
        );

        if let Ok(loaded_data) = result {
            match loaded_data {
                Loaded::Volume { dims, dtype, path } => {
                    assert_eq!(dims, [10u16, 10, 10]);
                    // neuroim loads most files as f64 by default
                    assert!(dtype == "f32" || dtype == "f64" || dtype == "i16");
                    assert_eq!(path, test_file.to_string_lossy());
                    println!(
                        "Loaded toy_t1w metadata: dims={:?}, dtype={}, path={}",
                        dims, dtype, path
                    );
                }
                _ => panic!("Expected Loaded::Volume for toy_t1w.nii.gz"),
            }
        }
    }

    #[test]
    fn test_load_nonexistent_file() {
        let path = Path::new("nonexistent_file.nii");
        let result = NiftiLoader::load(path);
        assert!(result.is_err());
        match result.err().unwrap() {
            BridgeError::Io { code: _, details } => assert!(
                details.contains("No such file or directory")
                    || details.contains("cannot find the path specified")
            ),
            e => panic!("Expected IoError, got {:?}", e),
        }
    }
}
