//! Save the accepted label document as NIfTI plus its BIDS dseg.tsv table.
use crate::{invalid, Error, LabelDefinition, Operation, Result, Session};
use label_store::{write_label_export, Companion};
use nifti::NiftiHeader;
use serde::Serialize;
use std::path::{Path, PathBuf};
use ts_rs::TS;

/// One accepted revision, copied out of the session so the destination can be
/// chosen without holding the document. Writing it never touches the session.
#[derive(Debug, Clone)]
pub struct LabelExport {
    pub session_id: String,
    pub revision: u32,
    pub label_revision: u32,
    pub dimensions: [u32; 3],
    pub labels: Vec<u16>,
    pub header: NiftiHeader,
    pub table: String,
    pub suggested_name: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "SegmentationSavedLabels")]
pub struct SavedLabels {
    pub session_id: String,
    pub revision: u32,
    /// Label-volume revision written; lock/complete changes do not move it.
    pub label_revision: u32,
    pub label_path: String,
    pub table_path: String,
}

fn cell(text: &str) -> String {
    let text: String = text
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let text = text.trim();
    if text.is_empty() {
        "n/a".into()
    } else {
        text.into()
    }
}

/// BIDS dseg.tsv: `index` and `name` are required; abbreviation, colour and
/// the parent's index (the hierarchy) are extra columns. Background is not listed.
pub fn dseg_tsv(labels: &[LabelDefinition]) -> String {
    let mut rows = vec!["index\tname\tabbreviation\tcolor\tparent".to_owned()];
    for label in labels {
        let [r, g, b] = label.color;
        rows.push(format!(
            "{}\t{}\t{}\t#{r:02x}{g:02x}{b:02x}\t{}",
            label.id,
            cell(&label.name),
            cell(&label.abbreviation),
            label
                .parent
                .map_or_else(|| "n/a".to_owned(), |p| p.to_string())
        ));
    }
    rows.join("\n") + "\n"
}

fn entity(text: &str) -> String {
    text.chars().filter(char::is_ascii_alphanumeric).collect()
}

/// `sub-<subject>[_ses-<session>]_desc-<rater>_dseg.nii.gz`, BIDS-safe entities.
pub fn suggested_file_name(subject: &str, session: &str, rater: &str) -> String {
    let mut name = String::new();
    let subject = entity(subject);
    if !subject.is_empty() {
        name.push_str(&format!("sub-{subject}_"));
    }
    let session = entity(session);
    if !session.is_empty() {
        name.push_str(&format!("ses-{session}_"));
    }
    let rater = entity(rater);
    if !rater.is_empty() {
        name.push_str(&format!("desc-{rater}_"));
    }
    name + "dseg.nii.gz"
}

/// The dseg.tsv that belongs to a label volume: same stem, `.tsv` suffix.
pub fn table_path(label_path: &Path) -> Result<PathBuf> {
    let name = label_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| invalid("Choose a file name for the labels"))?;
    let stem = name
        .strip_suffix(".nii.gz")
        .or_else(|| name.strip_suffix(".nii"))
        .filter(|stem| !stem.is_empty())
        .ok_or_else(|| invalid("Label files must end in .nii.gz or .nii"))?;
    Ok(label_path.with_file_name(format!("{stem}.tsv")))
}

/// Resolve the path picked in a save dialog. The dialog confirmed replacing
/// `picked` only; when `.nii.gz` has to be appended, an existing file is
/// refused. A table is never replaced unless its label volume is.
pub fn resolve_destination(picked: &Path) -> Result<PathBuf> {
    if !picked.is_absolute() {
        return Err(invalid("Choose an absolute location for the labels"));
    }
    let name = picked
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| invalid("Choose a file name for the labels"))?;
    let lower = name.to_ascii_lowercase();
    let target = if lower.ends_with(".nii.gz") || lower.ends_with(".nii") {
        if !(name.ends_with(".nii.gz") || name.ends_with(".nii")) {
            return Err(invalid("Use a lowercase .nii.gz or .nii extension"));
        }
        picked.to_path_buf()
    } else if Path::new(name).extension().is_some() {
        return Err(invalid("Label files must end in .nii.gz or .nii"));
    } else {
        let target = picked.with_file_name(format!("{name}.nii.gz"));
        if target.symlink_metadata().is_ok() {
            return Err(Error::Invalid(format!(
                "{} already exists; choose it explicitly to replace it",
                target.display()
            )));
        }
        target
    };
    let table = table_path(&target)?;
    if table.symlink_metadata().is_ok() && target.symlink_metadata().is_err() {
        return Err(Error::Invalid(format!(
            "{} already exists without its label volume; choose another name",
            table.display()
        )));
    }
    Ok(target)
}

impl Session {
    /// Copy the accepted document at `owner.base_revision`. A stale owner or
    /// revision is refused, so the file is exactly what the caller displayed.
    pub fn export(&self, owner: &Operation) -> Result<LabelExport> {
        self.check(owner)?;
        let mut header = self.header().clone();
        let description = format!("Brainflow segmentation labels, revision {}", self.revision);
        header
            .set_description(description.as_bytes())
            .map_err(|e| Error::Invalid(e.to_string()))?;
        header.aux_file = [0; 24];
        let definitions: Vec<_> = self
            .table
            .values()
            .map(|row| row.definition.clone())
            .collect();
        let identity = &self.setup.identity;
        Ok(LabelExport {
            session_id: self.id.clone(),
            revision: self.revision,
            label_revision: self.labels.revision() as u32,
            dimensions: self.labels.dimensions(),
            labels: self.labels.dense()?,
            header,
            table: dseg_tsv(&definitions),
            suggested_name: suggested_file_name(
                &identity.subject,
                &identity.session,
                &identity.rater,
            ),
        })
    }
}

/// Write a copied revision to an already resolved destination.
pub fn write_export(export: &LabelExport, destination: &Path) -> Result<SavedLabels> {
    let table = table_path(destination)?;
    write_label_export(
        export.dimensions,
        &export.labels,
        &export.header,
        destination,
        &[Companion {
            path: table.clone(),
            bytes: export.table.as_bytes().to_vec(),
        }],
    )?;
    Ok(SavedLabels {
        session_id: export.session_id.clone(),
        revision: export.revision,
        label_revision: export.label_revision,
        label_path: destination.to_string_lossy().into_owned(),
        table_path: table.to_string_lossy().into_owned(),
    })
}
