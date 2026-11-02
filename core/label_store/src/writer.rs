use crate::{Error, LabelVolume, Result};
use ndarray::{ArrayView3, ShapeBuilder};
use nifti::{writer::WriterOptions, NiftiHeader};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Atomic NIfTI-1 label export (u8 when possible, otherwise u16), optionally gzip.
/// The reference header carries both original transforms and spatial units.
/// Label values are unscaled; intent is always NIFTI_INTENT_LABEL (1002).
pub fn write_label_nifti(
    volume: &LabelVolume,
    reference: &NiftiHeader,
    destination: &Path,
) -> Result<()> {
    write_label_export(
        volume.dimensions(),
        &volume.dense()?,
        reference,
        destination,
        &[],
    )
}

/// One text or binary file written beside a label volume (e.g. a dseg.tsv).
pub struct Companion {
    pub path: PathBuf,
    pub bytes: Vec<u8>,
}

fn parent(destination: &Path) -> &Path {
    destination
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
}

/// Export an x-fastest label snapshot plus companion files. Every file is
/// fully written and synced to a temporary sibling before any destination is
/// replaced; the label volume is renamed into place first, then companions.
/// A failure before the first rename leaves every destination untouched.
pub fn write_label_export(
    dimensions: [u32; 3],
    labels: &[u16],
    reference: &NiftiHeader,
    destination: &Path,
    companions: &[Companion],
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
    if (0..3).any(|a| u32::from(reference.dim[a + 1]) != dimensions[a]) {
        return Err(Error::Grid(
            "reference header dimensions differ from labels",
        ));
    }
    if labels.len() != dimensions.iter().map(|&v| v as usize).product::<usize>() {
        return Err(Error::Grid("label array length differs from grid"));
    }
    if companions
        .iter()
        .any(|c| c.path == destination || c.path.file_name().is_none())
    {
        return Err(Error::Grid("invalid companion filename"));
    }
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
    let mut staged = Vec::with_capacity(companions.len());
    for companion in companions {
        let mut temporary = tempfile::Builder::new()
            .prefix(".brainflow-labels-")
            .suffix(".tmp")
            .tempfile_in(parent(&companion.path))?;
        temporary.write_all(&companion.bytes)?;
        temporary.as_file().sync_all()?;
        staged.push((temporary, &companion.path));
    }
    let temporary = tempfile::Builder::new()
        .prefix(".brainflow-labels-")
        .suffix(suffix)
        .tempfile_in(parent(destination))?;
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
        let array = ArrayView3::from_shape(shape, labels)
            .map_err(|_| Error::Grid("invalid label array shape"))?;
        WriterOptions::new(temporary.path())
            .reference_header(&header)
            .write_nifti(&array)?;
    }
    temporary.as_file().sync_all()?;
    temporary
        .persist(destination)
        .map_err(|error| Error::Io(error.error))?;
    for (temporary, path) in staged {
        temporary
            .persist(path)
            .map_err(|error| Error::Io(error.error))?;
    }
    Ok(())
}
