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
        &Target {
            path: destination.to_path_buf(),
            replace: true,
        },
        &[],
    )
}

/// A destination and whether an existing file there may be replaced. When
/// `replace` is false the file is created only if nothing exists there at the
/// moment of the rename (no check-then-overwrite race).
pub struct Target {
    pub path: PathBuf,
    pub replace: bool,
}

/// One text or binary file written beside a label volume (e.g. a dseg.tsv).
pub struct Companion {
    pub target: Target,
    pub bytes: Vec<u8>,
}

#[cfg(test)]
thread_local! {
    /// Test hook: fail the rename of the n-th file (0 = the label volume).
    static FAIL_RENAME: std::cell::Cell<Option<usize>> = const { std::cell::Cell::new(None) };
}

fn rename(
    temporary: tempfile::NamedTempFile,
    target: &Target,
    _index: usize,
) -> std::io::Result<()> {
    #[cfg(test)]
    if FAIL_RENAME.with(|hook| hook.get()) == Some(_index) {
        return Err(std::io::Error::other("injected rename failure"));
    }
    if target.replace {
        temporary
            .persist(&target.path)
            .map(drop)
            .map_err(|e| e.error)
    } else {
        temporary
            .persist_noclobber(&target.path)
            .map(drop)
            .map_err(|e| e.error)
    }
}

/// Keep the previous file at `path` (hard link, or copy) so a failed export
/// can put it back. Returns `None` when nothing existed there.
fn back_up(path: &Path) -> Result<Option<PathBuf>> {
    if path.symlink_metadata().is_err() {
        return Ok(None);
    }
    let backup = parent(path).join(format!(
        ".brainflow-backup-{}-{}",
        std::process::id(),
        path.file_name().and_then(|n| n.to_str()).unwrap_or("file")
    ));
    let _ = std::fs::remove_file(&backup);
    if std::fs::hard_link(path, &backup).is_err() {
        std::fs::copy(path, &backup)?;
    }
    Ok(Some(backup))
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
    destination: &Target,
    companions: &[Companion],
) -> Result<()> {
    let destination_target = destination;
    let destination = destination_target.path.as_path();
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
        .any(|c| c.target.path == destination_target.path || c.target.path.file_name().is_none())
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
            .tempfile_in(parent(&companion.target.path))?;
        temporary.write_all(&companion.bytes)?;
        temporary.as_file().sync_all()?;
        staged.push((temporary, &companion.target));
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
    staged.insert(0, (temporary, destination_target));
    commit(staged)
}

/// Rename every staged file into place, label volume first. Existing files
/// that may not be replaced are refused before anything is renamed. If a
/// later rename fails, earlier ones are rolled back (previous files restored,
/// new ones removed) and the error says what, if anything, is left on disk.
fn commit(staged: Vec<(tempfile::NamedTempFile, &Target)>) -> Result<()> {
    if let Some((_, target)) = staged
        .iter()
        .find(|(_, t)| !t.replace && t.path.symlink_metadata().is_ok())
    {
        return Err(Error::Export(format!(
            "{} already exists; nothing was written",
            target.path.display()
        )));
    }
    let mut backups = Vec::with_capacity(staged.len());
    for (_, target) in &staged {
        match if target.replace {
            back_up(&target.path)
        } else {
            Ok(None)
        } {
            Ok(backup) => backups.push(backup),
            Err(error) => {
                backups
                    .into_iter()
                    .flatten()
                    .for_each(|b| drop(std::fs::remove_file(b)));
                return Err(error);
            }
        }
    }
    let mut done: Vec<(&Target, Option<PathBuf>)> = Vec::new();
    let mut backups = backups.into_iter();
    for (index, (temporary, target)) in staged.into_iter().enumerate() {
        let backup = backups.next().flatten();
        if let Err(error) = rename(temporary, target, index) {
            let mut unrestored = Vec::new();
            for (target, backup) in done.into_iter().rev() {
                let restored = match &backup {
                    Some(backup) => std::fs::rename(backup, &target.path),
                    None => std::fs::remove_file(&target.path),
                };
                if restored.is_err() {
                    unrestored.push(target.path.display().to_string());
                }
            }
            for backup in std::iter::once(backup).chain(backups).flatten() {
                let _ = std::fs::remove_file(backup);
            }
            let left = if unrestored.is_empty() {
                "no file was changed".to_owned()
            } else {
                format!(
                    "these files are new and could not be rolled back: {}",
                    unrestored.join(", ")
                )
            };
            return Err(Error::Export(format!(
                "Could not write {}: {error}; {left}",
                target.path.display()
            )));
        }
        done.push((target, backup));
    }
    for (_, backup) in done {
        if let Some(backup) = backup {
            let _ = std::fs::remove_file(backup);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reference() -> NiftiHeader {
        NiftiHeader {
            dim: [3, 2, 2, 1, 1, 1, 1, 1],
            ..NiftiHeader::default()
        }
    }

    #[test]
    fn a_failed_table_rename_restores_the_previous_label_volume_and_table() {
        let directory = tempfile::tempdir().unwrap();
        let labels = directory.path().join("labels.nii");
        let table = directory.path().join("labels.tsv");
        std::fs::write(&labels, b"old labels").unwrap();
        std::fs::write(&table, b"old table").unwrap();
        FAIL_RENAME.with(|hook| hook.set(Some(1)));
        let error = write_label_export(
            [2, 2, 1],
            &[0, 1, 2, 3],
            &reference(),
            &Target {
                path: labels.clone(),
                replace: true,
            },
            &[Companion {
                target: Target {
                    path: table.clone(),
                    replace: true,
                },
                bytes: b"new".to_vec(),
            }],
        )
        .unwrap_err()
        .to_string();
        FAIL_RENAME.with(|hook| hook.set(None));
        assert!(
            error.contains("labels.tsv") && error.contains("no file was changed"),
            "{error}"
        );
        assert_eq!(std::fs::read(&labels).unwrap(), b"old labels");
        assert_eq!(std::fs::read(&table).unwrap(), b"old table");
        assert_eq!(
            std::fs::read_dir(directory.path()).unwrap().count(),
            2,
            "no temporary or backup files remain"
        );
    }

    #[test]
    fn a_failed_table_rename_removes_a_label_volume_that_did_not_exist_before() {
        let directory = tempfile::tempdir().unwrap();
        let labels = directory.path().join("labels.nii");
        let table = directory.path().join("labels.tsv");
        FAIL_RENAME.with(|hook| hook.set(Some(1)));
        assert!(write_label_export(
            [2, 2, 1],
            &[0, 1, 2, 3],
            &reference(),
            &Target {
                path: labels.clone(),
                replace: false
            },
            &[Companion {
                target: Target {
                    path: table.clone(),
                    replace: false
                },
                bytes: b"new".to_vec()
            }],
        )
        .is_err());
        FAIL_RENAME.with(|hook| hook.set(None));
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
    }

    #[test]
    fn files_that_may_not_be_replaced_are_refused_before_anything_is_renamed() {
        let directory = tempfile::tempdir().unwrap();
        let labels = directory.path().join("labels.nii");
        let table = directory.path().join("labels.tsv");
        std::fs::write(&table, b"someone else's table").unwrap();
        let error = write_label_export(
            [2, 2, 1],
            &[0, 1, 2, 3],
            &reference(),
            &Target {
                path: labels.clone(),
                replace: false,
            },
            &[Companion {
                target: Target {
                    path: table.clone(),
                    replace: false,
                },
                bytes: b"new".to_vec(),
            }],
        )
        .unwrap_err()
        .to_string();
        assert!(
            error.contains("already exists; nothing was written"),
            "{error}"
        );
        assert!(!labels.exists());
        assert_eq!(std::fs::read(&table).unwrap(), b"someone else's table");
    }
}
