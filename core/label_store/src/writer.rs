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
/// `replace` is false the destination is reserved with an exclusive create
/// before anything is renamed, so a file that appears later is never
/// overwritten. (This avoids `renamex_np(RENAME_EXCL)`, which exFAT, FAT and
/// SMB volumes reject.)
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
    /// Test hook: fail restoring previous files during rollback.
    static FAIL_RESTORE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

fn rename(temporary: tempfile::NamedTempFile, path: &Path, _index: usize) -> std::io::Result<()> {
    #[cfg(test)]
    if FAIL_RENAME.with(|hook| hook.get()) == Some(_index) {
        return Err(std::io::Error::other("injected rename failure"));
    }
    // Plain rename: the destination is either a file the caller may replace
    // or this export's own empty reservation.
    temporary.persist(path).map(drop).map_err(|e| e.error)
}

/// A temporary sibling that becomes a saved file. On Unix it is created with
/// mode 0666 so the process umask decides the final mode (typically 0644),
/// like any ordinary new file, instead of tempfile's private 0600.
fn staging_file(directory: &Path, suffix: &str) -> std::io::Result<tempfile::NamedTempFile> {
    let mut builder = tempfile::Builder::new();
    builder.prefix(".brainflow-labels-").suffix(suffix);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        builder.permissions(std::fs::Permissions::from_mode(0o666));
    }
    builder.tempfile_in(directory)
}

fn restore(backup: &Path, path: &Path) -> std::io::Result<()> {
    #[cfg(test)]
    if FAIL_RESTORE.with(|hook| hook.get()) {
        return Err(std::io::Error::other("injected restore failure"));
    }
    std::fs::rename(backup, path)
}

/// Keep the previous file at `path` under a unique sibling name (hard link,
/// or copy where links are unsupported) so a failed export can put it back.
fn back_up(path: &Path) -> std::io::Result<PathBuf> {
    let builder = {
        let mut builder = tempfile::Builder::new();
        builder.prefix(".brainflow-backup-").suffix(".tmp");
        builder
    };
    let linked = builder.make_in(parent(path), |backup| std::fs::hard_link(path, backup));
    let backup = match linked {
        Ok(backup) => backup,
        Err(_) => builder.make_in(parent(path), |backup| std::fs::copy(path, backup).map(drop))?,
    };
    backup.into_temp_path().keep().map_err(|e| e.error)
}

/// How one destination is changed, for rollback.
enum Slot {
    /// Nothing existed; the path holds this export's reservation or file.
    Fresh,
    /// An existing file is replaced; its previous version is kept here.
    Replaced(PathBuf),
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
        let mut temporary = staging_file(parent(&companion.target.path), ".tmp")?;
        temporary.write_all(&companion.bytes)?;
        temporary.as_file().sync_all()?;
        staged.push((temporary, &companion.target));
    }
    let temporary = staging_file(parent(destination), suffix)?;
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

/// Rename every staged file into place, label volume first. Destinations
/// that may not be replaced are reserved (exclusive create) before anything
/// is renamed; an existing one refuses the whole export. If a later step
/// fails, earlier ones are rolled back (previous files restored, new files and
/// reservations removed) and the error says what, if anything, is left.
fn commit(staged: Vec<(tempfile::NamedTempFile, &Target)>) -> Result<()> {
    let (temporaries, targets): (Vec<_>, Vec<_>) = staged.into_iter().unzip();
    let mut slots: Vec<Slot> = Vec::with_capacity(targets.len());
    let mut failure = None;
    for target in &targets {
        let prepared = if !target.replace {
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target.path)
                .map(|_| Slot::Fresh)
                .map_err(|error| {
                    if error.kind() == std::io::ErrorKind::AlreadyExists {
                        format!("{} already exists", target.path.display())
                    } else {
                        format!("Could not create {}: {error}", target.path.display())
                    }
                })
        } else if target.path.symlink_metadata().is_ok() {
            back_up(&target.path).map(Slot::Replaced).map_err(|error| {
                format!(
                    "Could not keep a copy of {}: {error}",
                    target.path.display()
                )
            })
        } else {
            Ok(Slot::Fresh)
        };
        match prepared {
            Ok(slot) => slots.push(slot),
            Err(error) => {
                failure = Some(error);
                break;
            }
        }
    }
    if let Some(error) = failure {
        // Nothing was renamed: drop the reservations and copies made so far.
        for (target, slot) in targets.iter().zip(&slots) {
            match slot {
                Slot::Fresh if !target.replace => drop(std::fs::remove_file(&target.path)),
                Slot::Fresh => {}
                Slot::Replaced(backup) => drop(std::fs::remove_file(backup)),
            }
        }
        return Err(Error::Export(format!("{error}; nothing was written")));
    }
    let mut renamed = 0;
    let mut failure = None;
    for (index, temporary) in temporaries.into_iter().enumerate() {
        if let Err(error) = rename(temporary, &targets[index].path, index) {
            failure = Some(error);
            break;
        }
        renamed += 1;
    }
    let Some(error) = failure else {
        for slot in slots {
            if let Slot::Replaced(backup) = slot {
                let _ = std::fs::remove_file(backup);
            }
        }
        return Ok(());
    };
    // Roll back. Renamed destinations get their previous file back, or are
    // removed when new; unrenamed reservations and copies are dropped.
    let mut left = Vec::new();
    for (index, (target, slot)) in targets.iter().zip(slots).enumerate().rev() {
        let was_renamed = index < renamed;
        match slot {
            Slot::Replaced(backup) if was_renamed => {
                if restore(&backup, &target.path).is_err() {
                    left.push(format!(
                        "{} holds the new file; its previous version is kept at {}",
                        target.path.display(),
                        backup.display()
                    ));
                }
            }
            Slot::Replaced(backup) => drop(std::fs::remove_file(backup)),
            Slot::Fresh if was_renamed || !target.replace => {
                if std::fs::remove_file(&target.path).is_err() {
                    left.push(format!(
                        "{} is new and could not be removed",
                        target.path.display()
                    ));
                }
            }
            Slot::Fresh => {}
        }
    }
    let left = if left.is_empty() {
        "no file was changed".to_owned()
    } else {
        left.join("; ")
    };
    Err(Error::Export(format!(
        "Could not write {}: {error}; {left}",
        targets[renamed].path.display()
    )))
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

    /// Saved files follow the umask like ordinary new files (0644 under the
    /// usual 022), not tempfile's private 0600, whether the destination is
    /// reserved (no replace) or replaced.
    #[cfg(unix)]
    #[test]
    fn saved_files_are_created_with_the_umask_mode_not_private_0600() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        // The mode an ordinary new file gets under this process's umask.
        let probe = directory.path().join("probe");
        std::fs::File::create(&probe).unwrap();
        let expected = probe.metadata().unwrap().permissions().mode() & 0o777;
        for replace in [false, true] {
            let labels = directory.path().join(format!("labels-{replace}.nii.gz"));
            let table = directory.path().join(format!("labels-{replace}.tsv"));
            write_label_export(
                [2, 2, 1],
                &[0, 1, 2, 3],
                &reference(),
                &Target {
                    path: labels.clone(),
                    replace,
                },
                &[Companion {
                    target: Target {
                        path: table.clone(),
                        replace,
                    },
                    bytes: b"index\tname\n".to_vec(),
                }],
            )
            .unwrap();
            for path in [&labels, &table] {
                let mode = path.metadata().unwrap().permissions().mode() & 0o777;
                assert_eq!(mode, expected, "{} has mode {mode:o}", path.display());
                assert_ne!(mode, 0o600);
            }
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

    #[test]
    fn a_failure_after_reserving_new_destinations_removes_every_reservation() {
        let directory = tempfile::tempdir().unwrap();
        let labels = directory.path().join("labels.nii");
        let table = directory.path().join("labels.tsv");
        // The label rename fails after both destinations were reserved.
        FAIL_RENAME.with(|hook| hook.set(Some(0)));
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
        FAIL_RENAME.with(|hook| hook.set(None));
        assert!(error.contains("no file was changed"), "{error}");
        assert_eq!(
            std::fs::read_dir(directory.path()).unwrap().count(),
            0,
            "reservations and staged files are gone"
        );
        // Without the hook the same export reserves, then fills, both files.
        write_label_export(
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
        .unwrap();
        assert_eq!(std::fs::read(&table).unwrap(), b"new");
        assert!(
            std::fs::metadata(&labels).unwrap().len() > 348,
            "the reservation was replaced by the volume"
        );
    }

    #[test]
    fn a_failed_restore_names_the_backup_that_holds_the_previous_file() {
        let directory = tempfile::tempdir().unwrap();
        let labels = directory.path().join("labels.nii");
        let table = directory.path().join("labels.tsv");
        std::fs::write(&labels, b"old labels").unwrap();
        std::fs::write(&table, b"old table").unwrap();
        FAIL_RENAME.with(|hook| hook.set(Some(1)));
        FAIL_RESTORE.with(|hook| hook.set(true));
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
        FAIL_RESTORE.with(|hook| hook.set(false));
        let backup = std::fs::read_dir(directory.path())
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with(".brainflow-backup-")
            })
            .expect("the previous label volume is kept");
        assert_eq!(std::fs::read(&backup).unwrap(), b"old labels");
        assert!(
            error.contains(&format!(
                "its previous version is kept at {}",
                backup.display()
            )),
            "{error}"
        );
        assert_eq!(
            std::fs::read(&table).unwrap(),
            b"old table",
            "the table was never replaced"
        );
    }

    #[test]
    fn backups_of_the_same_file_get_distinct_names() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("labels.nii");
        std::fs::write(&path, b"old").unwrap();
        let first = back_up(&path).unwrap();
        let second = back_up(&path).unwrap();
        assert_ne!(first, second);
        assert_eq!(std::fs::read(&first).unwrap(), b"old");
        assert_eq!(std::fs::read(&second).unwrap(), b"old");
    }
}
