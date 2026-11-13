//! Dataset cards in the file browser: folder markers, the dataset card of one
//! folder, and the sidecar card of one image file. Everything here is read
//! from the tree as it is; nothing is declared by the UI.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A pipeline as `GeneratedBy` names it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DatasetPipelineRef {
    pub name: String,
    pub version: Option<String>,
}

/// The hover summary of a folder that has a `dataset_description.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DatasetMarkerSummary {
    pub name: Option<String>,
    pub dataset_type: Option<String>,
    /// The first `GeneratedBy` entry that has a name.
    pub generated_by: Option<DatasetPipelineRef>,
}

/// What `probe_dataset_markers` knows about one folder row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DatasetMarker {
    /// The path as it was asked for.
    pub path: String,
    pub has_description: bool,
    /// Child folders that look like analyses, in this folder or in its
    /// `derivatives/` child. `None` when there are none.
    pub analysis_count: Option<u32>,
    /// More children exist than the probe looks at, so the count is a floor.
    pub analysis_count_truncated: bool,
    pub summary: Option<DatasetMarkerSummary>,
    /// Why this folder could not be read, or what is wrong with its
    /// description. The other fields hold whatever was still learned.
    pub issue: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DatasetContainer {
    #[serde(rename = "type")]
    pub container_type: Option<String>,
    pub tag: Option<String>,
    pub uri: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DatasetGeneratedBy {
    pub name: Option<String>,
    pub version: Option<String>,
    pub description: Option<String>,
    pub code_url: Option<String>,
    pub container: Option<DatasetContainer>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DatasetSource {
    pub url: Option<String>,
    pub doi: Option<String>,
    pub version: Option<String>,
}

/// A top-level description key the card has no field for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DatasetOtherField {
    pub key: String,
    /// The value as compact JSON, cut at a bounded length.
    pub value: String,
    pub truncated: bool,
}

/// The standard fields of a `dataset_description.json`, as far as they parsed.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DatasetDescription {
    pub name: Option<String>,
    pub bids_version: Option<String>,
    pub dataset_type: Option<String>,
    pub license: Option<String>,
    pub authors: Vec<String>,
    pub acknowledgements: Option<String>,
    pub how_to_acknowledge: Option<String>,
    pub funding: Vec<String>,
    pub ethics_approvals: Vec<String>,
    pub references_and_links: Vec<String>,
    pub dataset_doi: Option<String>,
    /// One entry per declared HED schema.
    pub hed_version: Vec<String>,
    /// The non-standard free-text `Description`, when a dataset has one.
    pub description: Option<String>,
    pub generated_by: Vec<DatasetGeneratedBy>,
    pub source_datasets: Vec<DatasetSource>,
    /// Every other top-level key, in file order. A standard key whose value
    /// has the wrong shape is kept here too, so nothing is hidden.
    pub other_fields: Vec<DatasetOtherField>,
}

/// README text. It is text only; nothing here interprets it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DatasetReadme {
    pub file_name: String,
    pub path: String,
    pub text: String,
    /// The file is longer than the text returned.
    pub truncated: bool,
}

/// Images that share one per-subject relative path, the subject, session and
/// run labels replaced by `*`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DatasetImageKind {
    pub path: String,
    pub count: u32,
    /// The subject folders beside the ones these images are in: how many
    /// `sub-*` folders their common parent folder holds. `None` when the
    /// images are not in subject folders (subjects named in file names
    /// only), or are in subject folders of more than one folder. Only this,
    /// never `subjectCount`, says how many images of the kind to expect.
    pub subject_folders: Option<u32>,
}

/// What the tree holds, counted. With `truncated` every number is a floor.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DatasetContents {
    pub subject_count: u32,
    /// Distinct session labels across subjects.
    pub session_count: u32,
    pub tasks: Vec<String>,
    pub spaces: Vec<String>,
    pub image_count: u32,
    /// A `group/` folder, or images that belong to no subject.
    pub has_group_level: bool,
    /// Images that belong to no subject.
    pub group_image_count: u32,
    /// The most common kinds first; at most a bounded number of them.
    pub image_kinds: Vec<DatasetImageKind>,
    /// Distinct kinds seen, which may exceed `image_kinds.len()`.
    pub image_kind_count: u32,
    /// The walk stopped at a bound, so the counts are not exact.
    pub truncated: bool,
    pub truncated_reason: Option<String>,
}

/// One analysis folder below a folder that holds analyses.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DatasetAnalysis {
    pub path: String,
    pub folder_name: String,
    /// `Name` from its description.
    pub title: Option<String>,
    pub generated_by: Option<DatasetPipelineRef>,
    /// `sub-*` folders directly inside it.
    pub subject_count: u32,
    /// It also holds `sub-*` links that were not followed, so the count is a
    /// floor.
    pub subject_count_truncated: bool,
    pub has_group_level: bool,
    pub has_description: bool,
    /// Its description exists but could not be read or parsed in full.
    pub issue: Option<String>,
    /// A date its description declares under a top-level key such as `Date`
    /// or `DateCreated`, as written. Never taken from a folder name.
    pub date: Option<String>,
}

/// How much of a card `get_dataset_card` reads.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum DatasetCardPhase {
    /// What the description files say: this folder's description and README,
    /// and the description of each child folder that has one. Nothing is
    /// counted: `contents` is empty, and an analysis has no `subjectCount` or
    /// `hasGroupLevel` yet. A child without a description is not listed until
    /// the full card finds it by its subject folders.
    Descriptions,
    /// The whole card, with the counting walk.
    #[default]
    Full,
}

/// The answer to `get_dataset_card`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DatasetCard {
    /// How much of the card this is. A request for the descriptions is
    /// answered with the full card when that is already known.
    pub phase: DatasetCardPhase,
    pub path: String,
    pub folder_name: String,
    pub has_description: bool,
    /// `None` when there is no description file or none of it parsed.
    pub description: Option<DatasetDescription>,
    pub description_issue: Option<String>,
    pub description_path: Option<String>,
    /// The description file's text, cut at a bounded length.
    pub description_raw: Option<String>,
    pub description_raw_truncated: bool,
    pub readme: Option<DatasetReadme>,
    pub contents: DatasetContents,
    pub analyses: Vec<DatasetAnalysis>,
    /// The folder whose children `analyses` are: this one or its `derivatives/`.
    pub analyses_path: Option<String>,
    pub analyses_truncated: bool,
    /// Every file whose content this card shows.
    pub source_paths: Vec<String>,
}

/// Where a sidecar value comes from, nearest first in precedence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum SidecarLevel {
    /// The image's own sidecar.
    File,
    /// A shared sidecar in a folder that is none of the levels below.
    Directory,
    Session,
    Subject,
    /// The dataset root.
    Dataset,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SidecarEntry {
    pub key: String,
    /// The effective value as compact JSON, cut at a bounded length.
    pub value: String,
    pub value_truncated: bool,
    pub source_level: SidecarLevel,
    pub source_path: String,
    /// Farther sidecars that also set this key and were overridden.
    pub overridden_paths: Vec<String>,
}

/// Header facts of a NIfTI file, read from its first bytes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SidecarHeader {
    pub dim: Vec<u32>,
    /// One per entry of `dim`; the fourth is the header's time step.
    pub voxel_sizes: Vec<f32>,
    /// Storage type on disk, such as `int16`.
    pub datatype: Option<String>,
    pub tr_seconds: Option<f32>,
    pub n_volumes: Option<u32>,
    pub qform_code: i16,
    pub sform_code: i16,
}

/// The answer to `get_sidecar_card`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SidecarCard {
    pub path: String,
    pub file_name: String,
    pub header: Option<SidecarHeader>,
    /// Why there is no header: not a NIfTI file, or it could not be read.
    pub header_issue: Option<String>,
    /// The nearest ancestor with a `dataset_description.json`.
    pub dataset_root: Option<String>,
    /// The file name is `key-value` entities and a suffix, so shared sidecars
    /// can apply. Otherwise only the same-named `.json` does.
    pub entity_named: bool,
    /// Effective metadata, by key.
    pub entries: Vec<SidecarEntry>,
    /// The sidecars that apply, farthest first.
    pub sidecar_paths: Vec<String>,
    /// Sidecars that apply but could not be read or parsed.
    pub issues: Vec<String>,
    /// More sidecars apply than are read; the farthest were left out.
    pub truncated: bool,
}
