use bridge_types::{BridgeError, BridgeResult, Loaded, Loader, VolumeSendable};
use log::{error, info};
use nalgebra::Affine3;
use serde::Serialize;
use std::path::Path;
use thiserror::Error;
use volmath::DenseVolume3;

// Use neuroim for NIfTI I/O
use neuroim::io::{read_vec_as, read_vol_as, read_vol_as_column_major};
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
    #[error(
        "NIfTI header declares {0} frames; a multi-frame file cannot be loaded as one 3D volume"
    )]
    MultipleFrames(usize),
    #[error("not a NIfTI file: {0}")]
    NotNifti(String),
    #[error(
        "the file is truncated: the header declares {expected} bytes (header and image data) but the file has {actual}"
    )]
    Truncated { expected: u64, actual: u64 },
}

/// True when the file starts with a NIfTI-2 `sizeof_hdr` (540, either byte order).
fn is_nifti2(path: &Path, compressed: bool) -> bool {
    use std::io::Read;
    let Ok(file) = std::fs::File::open(path) else {
        return false;
    };
    let mut first = [0u8; 4];
    let read = if compressed {
        flate2::read::GzDecoder::new(file).read_exact(&mut first)
    } else {
        std::io::BufReader::new(file).read_exact(&mut first)
    };
    read.is_ok() && (i32::from_le_bytes(first) == 540 || i32::from_be_bytes(first) == 540)
}

/// Header and size checks made before any voxel decode, so a bad file is
/// reported as what it is (empty, not NIfTI, truncated) rather than as a
/// failure of every data-type attempt.
pub fn check_nifti_file(path: &Path) -> Result<(), NiftiError> {
    let actual = std::fs::metadata(path)?.len();
    if actual == 0 {
        return Err(NiftiError::NotNifti("the file is empty".to_string()));
    }
    let compressed = path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("gz"));
    if is_nifti2(path, compressed) {
        return Err(NiftiError::NotNifti(
            "NIfTI-2 files are not supported yet".to_string(),
        ));
    }
    let header = nifti::NiftiHeader::from_file(path).map_err(|e| {
        NiftiError::NotNifti(match e {
            nifti::NiftiError::Io(io) if io.kind() == std::io::ErrorKind::UnexpectedEof => {
                "the file is shorter than a NIfTI header".to_string()
            }
            nifti::NiftiError::InvalidFormat => "the file has no valid NIfTI header".to_string(),
            other => format!("the header could not be read ({other})"),
        })
    })?;
    // Only a single-file `.nii` carries its image data after the header; the
    // compressed size of a `.nii.gz` says nothing about the decoded length.
    if compressed || &header.magic != b"n+1\0" {
        return Ok(());
    }
    let rank = (header.dim[0] as usize).clamp(1, 7);
    let voxels = header.dim[1..=rank]
        .iter()
        .try_fold(1u64, |n, &d| n.checked_mul(u64::from(d.max(1))));
    // Element size from the datatype; `bitpix` only when the code is unknown.
    let bits = match header.data_type() {
        Ok(kind) => kind.size_of() as u64 * 8,
        Err(_) => u64::try_from(header.bitpix).unwrap_or(0),
    };
    // Conformant files start data at vox_offset >= 352; tolerate non-conformant
    // ones that put it straight after the 348-byte header.
    let offset = header.vox_offset.max(348.0) as u64;
    if let Some(expected) = voxels
        .and_then(|n| n.checked_mul(bits))
        .map(|b| b.div_ceil(8))
        .and_then(|b| b.checked_add(offset))
    {
        if bits > 0 && actual < expected {
            return Err(NiftiError::Truncated { expected, actual });
        }
    }
    Ok(())
}

/// Number of frames (product of dims 4..=dim[0]) a NIfTI header declares; 1 for
/// a 3D file. Header-only read.
pub fn header_frame_count(path: &Path) -> Result<usize, NiftiError> {
    let header = nifti::NiftiHeader::from_file(path)
        .map_err(|e| NiftiError::ScalingError(format!("Failed to read NIfTI header: {e}")))?;
    let rank = (header.dim[0] as usize).min(7);
    Ok(header.dim[4..=rank.max(3)]
        .iter()
        .map(|&extent| extent.max(1) as usize)
        .product())
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

    // Read keeping the native x-fastest (Fortran) layout to skip the C-order
    // reorder (~10ms) plus the downstream values() reorder (~29ms). Falls back to
    // the C-order read for anything the 3D fast path rejects (e.g. 4D files).
    let volume: DenseNeuroVol<T> = match read_vol_as_column_major(path) {
        Ok(volume) => volume,
        Err(_) => read_vol_as(path, 0)?,
    };

    // Finalize geometry + variant selection (shared with the native-dtype path).
    finalize_3d_volume(volume)
}

/// Turn a decoded `DenseNeuroVol<T>` into a `VolumeSendable` + affine.
///
/// Shared by the f32-decode path ([`load_nifti_volume_neuroim`]) and the
/// native-dtype path ([`load_nifti_volume_native`]); the only thing that differs
/// upstream is how the volume was decoded.
fn finalize_3d_volume<T>(
    volume: DenseNeuroVol<T>,
) -> Result<(VolumeSendable, Affine3<f32>), NiftiError>
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
    let volume_sendable = create_volume_sendable(dense_volume, affine)?;

    info!("Successfully loaded NIfTI volume: dims={:?}", dims);
    Ok((volume_sendable, affine))
}

/// Load a 3D NIfTI volume in its NATIVE on-disk dtype (no f32 round-trip).
///
/// Delegates to [`neuroim::io::read_vol_native_as`], which refuses scaled volumes
/// and type mismatches (returning `Err`), so this is only ever used for
/// truly-integer files where keeping the native dtype is lossless. Callers fall
/// back to [`load_nifti_volume_neuroim`] on `Err`.
pub fn load_nifti_volume_native<T>(
    path: &Path,
) -> Result<(VolumeSendable, Affine3<f32>), NiftiError>
where
    T: neuroim::Numeric
        + volmath::Numeric
        + neuroim::DataElement
        + Clone
        + Serialize
        + std::fmt::Debug
        + Send
        + Sync
        + 'static,
{
    info!(
        "Loading NIfTI file in native dtype ({}): {}",
        std::any::type_name::<T>(),
        path.display()
    );
    let volume: DenseNeuroVol<T> = neuroim::io::read_vol_native_as(path)?;
    finalize_3d_volume(volume)
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

    check_nifti_file(path)?;
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

/// The on-disk storage (datatype, bitpix, scaling, calibration) a NIfTI header
/// declares. The loaded volume may hold another type (scaled integers load as
/// f32), so the header dialog re-reads it here. Header only; `None` when the
/// file cannot be read.
pub fn read_storage_info(path: &Path) -> Option<bridge_types::NiftiStorageInfo> {
    let header = nifti::NiftiHeader::from_file(path).ok()?;
    let datatype = match header.data_type() {
        Ok(kind) => format!("{kind:?}").to_lowercase(),
        Err(_) => format!("code {}", header.datatype),
    };
    Some(bridge_types::NiftiStorageInfo {
        datatype,
        bitpix: header.bitpix,
        scl_slope: header.scl_slope,
        scl_inter: header.scl_inter,
        cal_min: header.cal_min,
        cal_max: header.cal_max,
    })
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

/// Temporal metadata for a 4D NIfTI time series, parsed from the header.
///
/// `tr_seconds` is normalized to **seconds** regardless of the on-disk unit, so
/// callers can treat it uniformly. `temporal_unit` labels that value
/// (`"seconds"`) when the header declares a temporal unit; it is `None` when the
/// `xyzt_units` temporal bits are unset — we then still assume seconds (the
/// dominant fMRI convention) but leave the label empty to flag the inference.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TemporalMetadata {
    pub tr_seconds: Option<f32>,
    pub temporal_unit: Option<String>,
}

/// Read 4D temporal metadata (TR + unit) from a NIfTI header.
///
/// NIfTI stores the repetition time in `pixdim[4]`, with the time unit encoded
/// in the temporal bits of `xyzt_units` (`& 0x38`: 8 = sec, 16 = msec,
/// 24 = usec). This is a header-only read (no voxel data), mirroring
/// [`read_xform_codes`]. Temporal metadata is non-critical to loading the
/// volume, so any read/parse failure yields the default (no TR) rather than an
/// error.
pub fn read_temporal_metadata(path: &Path) -> TemporalMetadata {
    match nifti::NiftiHeader::from_file(path) {
        Ok(header) => temporal_metadata_from_header(&header),
        Err(_) => TemporalMetadata::default(),
    }
}

/// Decode temporal metadata from an already-parsed NIfTI header (split out so it
/// is unit-testable without a file on disk).
fn temporal_metadata_from_header(header: &nifti::NiftiHeader) -> TemporalMetadata {
    const XYZT_TIME_MASK: u8 = 0x38;
    const NIFTI_UNITS_SEC: u8 = 8;
    const NIFTI_UNITS_MSEC: u8 = 16;
    const NIFTI_UNITS_USEC: u8 = 24;

    // pixdim[4] is the repetition time; a non-finite or non-positive value
    // (including NaN) means "unset".
    let pixdim_t = header.pixdim[4];
    let has_tr = pixdim_t.is_finite() && pixdim_t > 0.0;
    if !has_tr {
        return TemporalMetadata::default();
    }

    let (tr_seconds, temporal_unit) = match header.xyzt_units & XYZT_TIME_MASK {
        NIFTI_UNITS_SEC => (pixdim_t, Some("seconds")),
        NIFTI_UNITS_MSEC => (pixdim_t / 1_000.0, Some("seconds")),
        NIFTI_UNITS_USEC => (pixdim_t / 1_000_000.0, Some("seconds")),
        // Temporal-unit bits unset (or a non-temporal code): assume seconds, but
        // leave the label empty to signal the value was inferred.
        _ => (pixdim_t, None),
    };

    TemporalMetadata {
        tr_seconds: Some(tr_seconds),
        temporal_unit: temporal_unit.map(str::to_string),
    }
}

/// Read the statistic intent (`intent_code`, `intent_p1..p3`, `intent_name`)
/// and the `descrip` string from a NIfTI header (header only, no voxel data),
/// mirroring [`read_temporal_metadata`]. Returns `None` when the header cannot
/// be read (missing file, in-memory volume, non-NIfTI source).
pub fn read_statistic_metadata(path: &Path) -> Option<StatisticMetadata> {
    nifti::NiftiHeader::from_file(path)
        .ok()
        .map(|header| statistic_metadata_from_header(&header))
}

/// Intent and description fields of a NIfTI header, decoded for display.
#[derive(Debug, Clone, PartialEq)]
pub struct StatisticMetadata {
    pub statistic: bridge_types::StatisticInfo,
    /// The header `descrip` field (NUL-trimmed, lossy UTF-8).
    pub description: String,
}

fn header_text(bytes: &[u8]) -> String {
    let end = bytes.iter().position(|b| *b == 0).unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).trim().to_string()
}

fn statistic_metadata_from_header(header: &nifti::NiftiHeader) -> StatisticMetadata {
    let description = header_text(&header.descrip);
    let intent_name = header_text(&header.intent_name);
    let statistic = bridge_types::StatisticInfo::from_intent(
        header.intent_code,
        [header.intent_p1, header.intent_p2, header.intent_p3],
        &intent_name,
        &description,
    );
    StatisticMetadata {
        statistic,
        description,
    }
}

// Try loading 4D volume with different data types
pub fn load_nifti_4d_auto(path: &Path) -> Result<VolumeSendable, NiftiError> {
    // Try loading as f32 first (most common for fMRI)
    let f32_error = match load_nifti_4d_neuroim::<f32>(path) {
        Ok(result) => return Ok(result),
        Err(error) => error,
    };

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

    Err(NiftiError::ScalingError(format!(
        "Could not load 4D file with any supported data type: {f32_error}"
    )))
}

/// Attempt a native-dtype 3D load for truly-integer, unscaled files.
///
/// Returns `Some(..)` only on success. Returns `None` whenever the file is not a
/// safe candidate — float/complex dtype, non-trivial data scaling, non-3D, or any
/// read failure — so the caller transparently falls back to the f32 path.
///
/// Native storage is only ever used when `scl_slope ∈ {0, 1}` and
/// `scl_inter == 0`, i.e. when the on-disk integers already ARE the physical
/// values. Scaled integers (whose physical values are fractional) always keep the
/// f32 path, which is what prevents the scaled-int truncation corruption.
fn try_load_native_3d(path: &Path) -> Option<(VolumeSendable, Affine3<f32>)> {
    let header = nifti::NiftiHeader::from_file(path).ok()?;

    // Only unscaled files are safe to keep as native integers.
    let slope = header.scl_slope;
    let inter = header.scl_inter;
    let trivial_scaling = (slope == 0.0 || slope == 1.0) && inter == 0.0;
    if !trivial_scaling {
        return None;
    }

    // 3D only. (4D, including 4D-with-single-timepoint, keeps the f32 path.)
    if header.dim[0] != 3 {
        return None;
    }

    let datatype = header.data_type().ok()?;
    let result = match datatype {
        // These all upload as R16Float (same as the f32 path did), so the render
        // is byte-identical to before -- only the CPU dtype shrinks.
        nifti::NiftiType::Int16 => load_nifti_volume_native::<i16>(path),
        nifti::NiftiType::Uint16 => load_nifti_volume_native::<u16>(path),
        nifti::NiftiType::Int8 => load_nifti_volume_native::<i8>(path),
        nifti::NiftiType::Int32 => load_nifti_volume_native::<i32>(path),
        nifti::NiftiType::Uint32 => load_nifti_volume_native::<u32>(path),
        // Uint8 is deliberately NOT taken natively yet: a VolU8 uploads as
        // R8Unorm (normalized to [0,1]) whereas the current f32 path uploads as
        // R16Float (raw values), so going native would change the rendered
        // output for plain u8 scalar volumes. Keep u8 on the f32 path until the
        // R8Unorm intensity-window behavior is verified against the golden
        // harness. (Float / complex / rgb also keep the f32 path.)
        _ => return None,
    };

    match result {
        Ok(loaded) => Some(loaded),
        Err(e) => {
            info!("native dtype load failed ({e}); falling back to f32 path");
            None
        }
    }
}

// Simplified load function that tries different types (3D only)
pub fn load_nifti_volume_auto(path: &Path) -> Result<(VolumeSendable, Affine3<f32>), NiftiError> {
    // The f32 fallback below reads only frame 0 of a multi-frame file; refuse
    // rather than silently drop frames (use `load_nifti_auto_dimension`).
    if let Ok(frames) = header_frame_count(path) {
        if frames > 1 {
            return Err(NiftiError::MultipleFrames(frames));
        }
    }

    // Native fast path: unscaled integer files keep their on-disk dtype (2 bytes/
    // voxel for int16, 1 for u8) instead of being inflated to f32. Returns None
    // for scaled/float files and on any native read failure, falling through to
    // the f32 path below.
    if let Some(loaded) = try_load_native_3d(path) {
        return Ok(loaded);
    }

    // Try loading as f32 first (most common; preserves scaled physical values)
    let f32_error = match load_nifti_volume_neuroim::<f32>(path) {
        Ok(result) => return Ok(result),
        Err(error) => error,
    };

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

    Err(NiftiError::ScalingError(format!(
        "Could not load file with any supported data type: {f32_error}"
    )))
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
            frames @ NiftiError::MultipleFrames(_) => BridgeError::Loader {
                code: 5007,
                details: frames.to_string(),
            },
            invalid @ (NiftiError::NotNifti(_) | NiftiError::Truncated { .. }) => {
                BridgeError::Loader {
                    // 5008 is taken by api_bridge (ServiceNotInitialized and others).
                    code: 5003,
                    details: invalid.to_string(),
                }
            }
        }
    }
}

impl Loader for NiftiLoader {
    fn can_load(path: &Path) -> bool {
        path.extension().is_some_and(|ext| {
            let ext_str = ext.to_string_lossy().to_lowercase();
            ext_str == "nii"
                || (ext_str == "gz"
                    && path
                        .file_stem()
                        .is_some_and(|stem| stem.to_string_lossy().ends_with(".nii")))
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

    /// 41x49x40x6 float32 FIR map (gzip) written by the native-check fixture
    /// generator; voxel (7, 23, 30) holds 0.1, 0.6, 1.1, 0.7, 0.3, 0.1 over lags.
    fn fir4d_fixture() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../field_table/fixtures/neurotabs/fir4d/maps/sub-01_task-faces_fir.nii.gz")
    }

    #[test]
    fn three_d_loader_refuses_multi_frame_files() {
        let path = fir4d_fixture();
        assert_eq!(header_frame_count(&path).unwrap(), 6);
        match load_nifti_volume_auto(&path) {
            Err(NiftiError::MultipleFrames(6)) => {}
            other => panic!("expected MultipleFrames(6), got {:?}", other.map(|_| ())),
        }
    }

    #[test]
    fn auto_dimension_loads_every_frame_of_a_4d_file() {
        let VolumeSendable::Vec4DF32(vec) = load_nifti_auto_dimension(&fir4d_fixture()).unwrap()
        else {
            panic!("expected Vec4DF32");
        };
        assert_eq!(vec.space().dim, vec![41, 49, 40, 6]);
        let expected = [0.1f32, 0.6, 1.1, 0.7, 0.3, 0.1];
        for (frame, value) in expected.iter().enumerate() {
            assert_relative_eq!(vec.data[[7, 23, 30, frame]], *value, epsilon = 1e-6);
        }
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

    // --- Temporal metadata (TR / units) decoding ---

    fn header_with_time(pixdim_t: f32, xyzt_units: u8) -> nifti::NiftiHeader {
        let mut pixdim = [1.0f32; 8];
        pixdim[4] = pixdim_t;
        nifti::NiftiHeader {
            pixdim,
            xyzt_units,
            ..Default::default()
        }
    }

    #[test]
    fn temporal_metadata_seconds_unit_is_passed_through() {
        // xyzt_units = mm (2) | sec (8) = 10; the spatial bits must be masked off.
        let meta = temporal_metadata_from_header(&header_with_time(2.0, 2 | 8));
        assert_eq!(meta.tr_seconds, Some(2.0));
        assert_eq!(meta.temporal_unit.as_deref(), Some("seconds"));
    }

    #[test]
    fn temporal_metadata_milliseconds_normalizes_to_seconds() {
        let meta = temporal_metadata_from_header(&header_with_time(2000.0, 16));
        assert_eq!(meta.tr_seconds, Some(2.0));
        assert_eq!(meta.temporal_unit.as_deref(), Some("seconds"));
    }

    #[test]
    fn temporal_metadata_microseconds_normalizes_to_seconds() {
        let meta = temporal_metadata_from_header(&header_with_time(2_000_000.0, 24));
        assert_eq!(meta.tr_seconds, Some(2.0));
        assert_eq!(meta.temporal_unit.as_deref(), Some("seconds"));
    }

    #[test]
    fn temporal_metadata_unset_unit_assumes_seconds_but_leaves_label_empty() {
        // Many fMRI files populate pixdim[4] but leave the temporal-unit bits 0.
        let meta = temporal_metadata_from_header(&header_with_time(2.5, 0));
        assert_eq!(meta.tr_seconds, Some(2.5));
        assert_eq!(meta.temporal_unit, None);
    }

    #[test]
    fn temporal_metadata_nonpositive_tr_is_absent() {
        assert_eq!(
            temporal_metadata_from_header(&header_with_time(0.0, 8)),
            TemporalMetadata::default()
        );
        assert_eq!(
            temporal_metadata_from_header(&header_with_time(-1.0, 8)),
            TemporalMetadata::default()
        );
    }

    // --- Statistic intent / description decoding ---

    fn header_with_intent(
        code: i16,
        p1: f32,
        p2: f32,
        name: &str,
        descrip: &str,
    ) -> nifti::NiftiHeader {
        let mut intent_name = [0u8; 16];
        intent_name[..name.len()].copy_from_slice(name.as_bytes());
        let mut descrip_bytes = descrip.as_bytes().to_vec();
        descrip_bytes.resize(80, 0);
        nifti::NiftiHeader {
            intent_code: code,
            intent_p1: p1,
            intent_p2: p2,
            intent_name,
            descrip: descrip_bytes,
            ..Default::default()
        }
    }

    #[test]
    fn statistic_metadata_decodes_t_intent_and_trims_description() {
        let meta =
            statistic_metadata_from_header(&header_with_intent(3, 24.0, 0.0, "", "contrast 1"));
        assert_eq!(meta.statistic.kind, bridge_types::StatisticKind::T);
        assert_eq!(meta.statistic.label, "t(24)");
        assert_eq!(meta.description, "contrast 1");
    }

    #[test]
    fn statistic_metadata_decodes_f_and_named_intents() {
        let f = statistic_metadata_from_header(&header_with_intent(4, 2.0, 30.0, "", ""));
        assert_eq!(f.statistic.label, "F(2,30)");
        let named = statistic_metadata_from_header(&header_with_intent(1001, 0.0, 0.0, "beta", ""));
        assert_eq!(named.statistic.intent_name, "beta");
        assert_eq!(named.statistic.label, "beta");
    }

    #[test]
    fn statistic_metadata_falls_back_to_spm_description() {
        let meta = statistic_metadata_from_header(&header_with_intent(
            0,
            0.0,
            0.0,
            "",
            "SPM{T_[17.0]} - contrast 2: words > rest",
        ));
        assert_eq!(meta.statistic.label, "t(17)");
        assert!(meta.statistic.from_description);
        let plain = statistic_metadata_from_header(&header_with_intent(0, 0.0, 0.0, "", ""));
        assert_eq!(plain.statistic.kind, bridge_types::StatisticKind::None);
        assert_eq!(plain.description, "");
    }

    #[test]
    fn read_statistic_metadata_reads_unit_fixture_header() {
        let test_file = get_unit_test_file("tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii");
        if !test_file.exists() {
            eprintln!("Test file not found: {:?}, skipping test", test_file);
            return;
        }
        let meta = read_statistic_metadata(&test_file).expect("header readable");
        assert_eq!(meta.statistic.kind, bridge_types::StatisticKind::None);
        assert!(read_statistic_metadata(Path::new("/nonexistent/x.nii")).is_none());
    }

    /// A scratch copy of `bytes` named `name`, unique per test process.
    fn scratch_file(name: &str, bytes: &[u8]) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nifti-loader-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn bad_files_report_what_is_wrong_not_a_debug_dump() {
        let empty = scratch_file("empty.nii", b"");
        let text = scratch_file("wrongext.nii", b"a\tb\tc\n1\t2\t3\n");
        let long_text = scratch_file("wrongext_long.nii", &b"col\tvalue\n".repeat(64));
        for (path, expected) in [
            (&empty, "not a NIfTI file: the file is empty"),
            (
                &text,
                "not a NIfTI file: the file is shorter than a NIfTI header",
            ),
            (
                &long_text,
                "not a NIfTI file: the file has no valid NIfTI header",
            ),
        ] {
            let message = load_nifti_auto_dimension(path).unwrap_err().to_string();
            assert_eq!(message, expected, "{}", path.display());
            assert!(!message.contains("Io(Error"), "{message}");
        }
    }

    #[test]
    fn truncated_file_says_truncated_with_sizes() {
        let full = std::fs::read(get_unit_test_file("simple.nii")).unwrap();
        let path = scratch_file("truncated.nii", &full[..full.len() / 2]);
        let error = load_nifti_auto_dimension(&path).unwrap_err();
        assert!(
            matches!(error, NiftiError::Truncated { expected, actual }
                if expected == full.len() as u64 && actual == (full.len() / 2) as u64),
            "{error}"
        );
        assert!(
            error.to_string().starts_with("the file is truncated"),
            "{error}"
        );
        // The intact file passes the same check.
        check_nifti_file(&get_unit_test_file("simple.nii")).unwrap();
    }

    #[test]
    fn storage_info_reports_the_on_disk_datatype_and_scaling() {
        let scaled = read_storage_info(&get_unit_test_file("scaled_i16.nii")).unwrap();
        assert_eq!(scaled.datatype, "int16");
        assert_eq!(scaled.bitpix, 16);
        assert_relative_eq!(scaled.scl_slope, 0.1);
        assert_relative_eq!(scaled.scl_inter, 0.0);
        let unscaled = read_storage_info(&get_unit_test_file("unscaled_u8.nii")).unwrap();
        assert_eq!(unscaled.datatype, "uint8");
        assert_eq!(unscaled.bitpix, 8);
        assert!(read_storage_info(Path::new("/nonexistent/file.nii")).is_none());
    }

    /// `simple.nii` with header fields patched (little-endian offsets).
    fn patched_simple(name: &str, patch: impl FnOnce(&mut Vec<u8>)) -> PathBuf {
        let mut bytes = std::fs::read(get_unit_test_file("simple.nii")).unwrap();
        patch(&mut bytes);
        scratch_file(name, &bytes)
    }

    #[test]
    fn expected_size_follows_the_datatype_not_bitpix() {
        let header = nifti::NiftiHeader::from_file(get_unit_test_file("simple.nii")).unwrap();
        assert!(header.data_type().unwrap().size_of() > 1);
        // A wrong (too small) bitpix must not hide a truncation, nor a wrong
        // (too large) one invent it.
        let small = patched_simple("bitpix_small.nii", |b| {
            b[72..74].copy_from_slice(&1i16.to_le_bytes());
            b.truncate(b.len() - 1);
        });
        assert!(matches!(
            check_nifti_file(&small),
            Err(NiftiError::Truncated { .. })
        ));
        let large = patched_simple("bitpix_large.nii", |b| {
            b[72..74].copy_from_slice(&128i16.to_le_bytes());
        });
        check_nifti_file(&large).unwrap();
    }

    #[test]
    fn data_right_after_a_348_byte_header_is_not_truncated() {
        // vox_offset 348 (non-conformant) with the data immediately after the
        // header: 4 bytes shorter than a 352 offset would need.
        let path = patched_simple("offset348.nii", |b| {
            b[108..112].copy_from_slice(&348f32.to_le_bytes());
            let offset = 352;
            b.drain(348..offset);
        });
        check_nifti_file(&path).unwrap();
    }

    #[test]
    fn nifti2_is_named_as_unsupported() {
        for (name, sizeof_hdr) in [
            ("nifti2_le.nii", 540i32.to_le_bytes()),
            ("nifti2_be.nii", 540i32.to_be_bytes()),
        ] {
            let mut bytes = vec![0u8; 544];
            bytes[..4].copy_from_slice(&sizeof_hdr);
            let path = scratch_file(name, &bytes);
            assert_eq!(
                load_nifti_auto_dimension(&path).unwrap_err().to_string(),
                "not a NIfTI file: NIfTI-2 files are not supported yet"
            );
        }
    }

    #[test]
    fn invalid_file_errors_use_their_own_bridge_code() {
        let code = |err| match BridgeError::from(err) {
            BridgeError::Loader { code, .. } => code,
            other => panic!("{other:?}"),
        };
        assert_eq!(code(NiftiError::NotNifti("x".into())), 5003);
        assert_eq!(
            code(NiftiError::Truncated {
                expected: 2,
                actual: 1
            }),
            5003
        );
    }

    #[test]
    fn test_can_load() {
        assert!(NiftiLoader::can_load(Path::new("test.nii")));
        assert!(NiftiLoader::can_load(Path::new("test.nii.gz")));
        assert!(!NiftiLoader::can_load(Path::new("test.txt")));
        assert!(!NiftiLoader::can_load(Path::new("test.gz")));
    }

    // The column-major (Fortran) read must produce byte-identical VALUES to the
    // C-order read -- it is purely a memory-layout optimization. `values()` is
    // layout-agnostic, so equal values() proves the rendered output is unchanged.
    #[test]
    fn column_major_read_values_match_cstandard() {
        use neuroim::NeuroVol;
        let test_file = get_unit_test_file("toy_t1w.nii.gz");
        if !test_file.exists() {
            eprintln!("Test file not found: {:?}, skipping test", test_file);
            return;
        }
        let col_major =
            neuroim::io::read_vol_as_column_major::<f32>(&test_file).expect("column-major read");
        let cstd = neuroim::io::read_vol_as::<f32>(&test_file, 0).expect("c-order read");
        assert_eq!(col_major.space().dim, cstd.space().dim, "dims must match");
        assert_eq!(
            col_major.values(),
            cstd.values(),
            "column-major read must yield identical voxel values to the C-order read"
        );
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
        // neuroim surfaces a missing file as its own error type, so the bridge
        // maps it to BridgeError::Loader (not Io). Either variant is acceptable;
        // what matters is that the details clearly name a missing file.
        let details = match result.err().unwrap() {
            BridgeError::Io { details, .. } | BridgeError::Loader { details, .. } => details,
            e => panic!(
                "Expected an Io or Loader error for a missing file, got {:?}",
                e
            ),
        };
        assert!(
            details.contains("No such file or directory")
                || details.contains("cannot find the path specified"),
            "error details should name the missing file, got: {details}"
        );
    }

    // Regression guard for a reverted "header-first datatype dispatch"
    // optimization (PR #2). neuroim's typed reader always decodes to f32 and
    // then converts, so reading a scaled int16 file as i16 truncates the scaled
    // physical values (raw 123 * scl_slope 0.1 = 12.3 -> 12). The f32 reader
    // always succeeds, so `load_nifti_volume_auto` (which tries f32 first) must
    // keep returning VolF32 and preserve 12.3 rather than dispatching to i16.
    // Fixture: 2x2x2 int16, scl_slope=0.1, raw=[123,200,327,500,999,1000,5,50].
    #[test]
    fn auto_load_keeps_scaled_int16_as_f32() {
        let test_file = get_unit_test_file("scaled_i16.nii");
        if !test_file.exists() {
            eprintln!("Test file not found: {:?}, skipping test", test_file);
            return;
        }

        let (vol, _affine) = load_nifti_volume_auto(&test_file).expect("auto load scaled i16");
        match &vol {
            VolumeSendable::VolF32(v, _) => {
                let vals = v.values();
                assert_relative_eq!(vals[0], 12.3, epsilon = 1e-3);
                assert_relative_eq!(vals[4], 99.9, epsilon = 1e-3);
                assert_relative_eq!(vals[6], 0.5, epsilon = 1e-3);
            }
            VolumeSendable::VolI16(v, _) => panic!(
                "scaled int16 was truncated to VolI16 {:?}; expected VolF32 ~[12.3, ..]",
                v.values()
            ),
            _ => panic!("unexpected VolumeSendable variant from auto load"),
        }
    }

    // The native-dtype fast path: a truly-integer, UNSCALED int16 file
    // (scl_slope=1, scl_inter=0) should stay int16 in memory (2 bytes/voxel)
    // rather than being inflated to f32, with values preserved exactly.
    // Fixture: 2x2x2 int16, scl_slope=1, raw=[10,20,30,40,50,60,70,80].
    #[test]
    fn auto_load_unscaled_int16_uses_native_i16() {
        let test_file = get_unit_test_file("unscaled_i16.nii");
        if !test_file.exists() {
            eprintln!("Test file not found: {:?}, skipping test", test_file);
            return;
        }

        let (vol, _affine) = load_nifti_volume_auto(&test_file).expect("auto load unscaled i16");
        match &vol {
            VolumeSendable::VolI16(v, _) => {
                let vals = v.values();
                assert_eq!(vals.len(), 8);
                // 2 bytes/voxel CPU footprint, measured on the element type.
                assert_eq!(std::mem::size_of_val(&vals[0]), 2);
                assert_eq!(vals[0], 10);
                assert_eq!(vals[3], 40);
                assert_eq!(vals[7], 80);
            }
            VolumeSendable::VolF32(v, _) => panic!(
                "unscaled int16 was inflated to VolF32 {:?}; expected native VolI16",
                v.values()
            ),
            other => panic!("unexpected VolumeSendable variant: {other:?}"),
        }
    }

    // Uint8 is deliberately kept on the f32 path for now: a native VolU8 uploads
    // as R8Unorm (normalized [0,1]) instead of R16Float (raw), which would change
    // the rendered output for plain u8 scalar volumes. This test pins that u8
    // stays VolF32 with correct values until the R8Unorm path is verified.
    // Fixture: 2x2x2 uint8, scl_slope=1, raw=[1,2,3,4,5,6,7,8].
    #[test]
    fn auto_load_unscaled_uint8_stays_f32_for_now() {
        let test_file = get_unit_test_file("unscaled_u8.nii");
        if !test_file.exists() {
            eprintln!("Test file not found: {:?}, skipping test", test_file);
            return;
        }

        let (vol, _affine) = load_nifti_volume_auto(&test_file).expect("auto load unscaled u8");
        match &vol {
            VolumeSendable::VolF32(v, _) => {
                let vals = v.values();
                assert_eq!(vals.len(), 8);
                assert_relative_eq!(vals[0], 1.0, epsilon = 1e-6);
                assert_relative_eq!(vals[7], 8.0, epsilon = 1e-6);
            }
            VolumeSendable::VolU8(_, _) => panic!(
                "u8 took the native path (VolU8 -> R8Unorm); it must stay VolF32 until \
                 the R8Unorm intensity-window behavior is verified against the golden harness"
            ),
            other => panic!("unexpected VolumeSendable variant: {other:?}"),
        }
    }

    // Guard extends to scaled UNSIGNED ints: a uint16 file with non-trivial
    // scaling carries fractional physical values and must keep the f32 path, not
    // be truncated to native uint16. Fixture: 2x2x2 uint16, scl_slope=0.1,
    // raw=[123,200,327,500,999,1000,5,50] -> physical [12.3,20.0,..].
    #[test]
    fn auto_load_keeps_scaled_uint16_as_f32() {
        let test_file = get_unit_test_file("scaled_u16.nii");
        if !test_file.exists() {
            eprintln!("Test file not found: {:?}, skipping test", test_file);
            return;
        }

        let (vol, _affine) = load_nifti_volume_auto(&test_file).expect("auto load scaled u16");
        match &vol {
            VolumeSendable::VolF32(v, _) => {
                let vals = v.values();
                assert_relative_eq!(vals[0], 12.3, epsilon = 1e-3);
                assert_relative_eq!(vals[4], 99.9, epsilon = 1e-3);
                assert_relative_eq!(vals[6], 0.5, epsilon = 1e-3);
            }
            VolumeSendable::VolU16(v, _) => panic!(
                "scaled uint16 was truncated to VolU16 {:?}; expected VolF32 ~[12.3, ..]",
                v.values()
            ),
            other => panic!("unexpected VolumeSendable variant: {other:?}"),
        }
    }

    // Headless perf baseline (gated by env + #[ignore]). Measures the two
    // dominant backend load costs without a GUI: gzip+f32 decode, and the
    // histogram clone+scan that currently sits on the first-pixel path.
    //   BF_PERF_NII=/abs/mni.nii BF_PERF_NII_GZ=/abs/mni.nii.gz \
    //     cargo test -p nifti-loader perf_baseline_load -- --nocapture --ignored
    #[test]
    #[ignore]
    fn perf_baseline_load() {
        use std::time::Instant;

        fn time_decode(label: &str, path: &Path, iters: u32) {
            let _ = load_nifti_volume_auto(path); // warm page cache
            let mut best = f64::MAX;
            let mut last = None;
            for _ in 0..iters {
                let t = Instant::now();
                let (vol, _) = load_nifti_volume_auto(path).expect("decode");
                best = best.min(t.elapsed().as_secs_f64() * 1e3);
                last = Some(vol);
            }
            if let Some(VolumeSendable::VolF32(v, _)) = last.as_ref() {
                let dims = v.space().dim.clone();
                let n: usize = dims.iter().product();
                println!("[perf] decode {label}: best {best:.1} ms  dims={dims:?}  voxels={n}");
            } else {
                println!("[perf] decode {label}: best {best:.1} ms");
            }
        }

        let nii = std::env::var("BF_PERF_NII").ok();
        let gz = std::env::var("BF_PERF_NII_GZ").ok();
        if nii.is_none() && gz.is_none() {
            eprintln!("set BF_PERF_NII and/or BF_PERF_NII_GZ; skipping");
            return;
        }
        if let Some(p) = &nii {
            time_decode("uncompressed .nii", Path::new(p), 5);
        }
        if let Some(p) = &gz {
            time_decode("gzip .nii.gz", Path::new(p), 5);
        }

        // Histogram cost: mirrors compute_layer_histogram -- a full deep clone
        // followed by a per-voxel min/max + 256-bin scan (excluding zeros).
        let probe = gz.as_ref().or(nii.as_ref()).unwrap();
        let (vol, _) = load_nifti_volume_auto(Path::new(probe)).expect("decode for histogram");
        if let VolumeSendable::VolF32(v, _) = &vol {
            let t = Instant::now();
            let cloned = v.clone();
            let clone_ms = t.elapsed().as_secs_f64() * 1e3;

            let t = Instant::now();
            let vals = cloned.values();
            let values_ms = t.elapsed().as_secs_f64() * 1e3;

            let t = Instant::now();
            let (mut lo, mut hi) = (f32::MAX, f32::MIN);
            for &x in &vals {
                if x != 0.0 {
                    lo = lo.min(x);
                    hi = hi.max(x);
                }
            }
            let mut bins = [0u32; 256];
            let span = (hi - lo).max(f32::EPSILON);
            for &x in &vals {
                if x != 0.0 {
                    let b = (((x - lo) / span) * 255.0) as usize;
                    bins[b.min(255)] += 1;
                }
            }
            let scan_ms = t.elapsed().as_secs_f64() * 1e3;
            println!(
                "[perf] histogram: clone {clone_ms:.1} ms + values() {values_ms:.1} ms + scan {scan_ms:.1} ms (nonzero range {lo}..{hi})"
            );
        }
    }
}
