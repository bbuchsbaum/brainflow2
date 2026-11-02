use crate::{Error, LabelVolume, Result};
use ndarray::{ArrayView3, ShapeBuilder};
use nifti::{writer::WriterOptions, NiftiHeader};
use std::path::Path;

/// Atomic NIfTI-1 label export (u8 when possible, otherwise u16), optionally gzip.
/// The reference header carries both original transforms and spatial units.
/// Label values are unscaled; intent is always NIFTI_INTENT_LABEL (1002).
pub fn write_label_nifti(
    volume: &LabelVolume,
    reference: &NiftiHeader,
    destination: &Path,
) -> Result<()> {
    let name = destination
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or(Error::Grid("invalid output filename"))?;
    let suffix = if name.ends_with(".nii.gz") {
        ".nii.gz"
    } else if name.ends_with(".nii") {
        ".nii"
    } else {
        return Err(Error::Grid("label output must end in .nii or .nii.gz"));
    };
    let dimensions = volume.dimensions();
    if (0..3).any(|a| u32::from(reference.dim[a + 1]) != dimensions[a]) {
        return Err(Error::Grid(
            "reference header dimensions differ from labels",
        ));
    }
    let labels = volume.dense()?;
    let maximum = labels.iter().copied().max().unwrap_or(0);
    let mut header = reference.clone();
    header.intent_code = 1002;
    header.intent_name = [0; 16];
    header.intent_name[..6].copy_from_slice(b"Labels");
    header.intent_p1 = 0.0;
    header.intent_p2 = 0.0;
    header.intent_p3 = 0.0;
    header.cal_min = 0.0;
    header.cal_max = f32::from(maximum);
    let parent = destination
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let temporary = tempfile::Builder::new()
        .prefix(".brainflow-labels-")
        .suffix(suffix)
        .tempfile_in(parent)?;
    let shape = dimensions.map(|v| v as usize);
    let shape = (shape[0], shape[1], shape[2]).f();
    if maximum <= u16::from(u8::MAX) {
        let bytes: Vec<u8> = labels.iter().map(|&v| v as u8).collect();
        let array = ArrayView3::from_shape(shape, &bytes)
            .map_err(|_| Error::Grid("invalid label array shape"))?;
        WriterOptions::new(temporary.path())
            .reference_header(&header)
            .write_nifti(&array)?;
    } else {
        let array = ArrayView3::from_shape(shape, &labels)
            .map_err(|_| Error::Grid("invalid label array shape"))?;
        WriterOptions::new(temporary.path())
            .reference_header(&header)
            .write_nifti(&array)?;
    }
    temporary.as_file().sync_all()?;
    temporary
        .persist(destination)
        .map_err(|error| Error::Io(error.error))?;
    Ok(())
}
