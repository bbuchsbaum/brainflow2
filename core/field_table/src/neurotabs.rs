use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::fmt;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NeuroTabsIssue {
    pub path: String,
    pub message: String,
}

impl NeuroTabsIssue {
    fn new(path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NeuroTabsManifestError {
    pub issues: Vec<NeuroTabsIssue>,
}

impl NeuroTabsManifestError {
    fn parse(message: impl Into<String>) -> Self {
        Self {
            issues: vec![NeuroTabsIssue::new("$", message)],
        }
    }

    fn validation(issues: Vec<NeuroTabsIssue>) -> Self {
        Self { issues }
    }
}

impl fmt::Display for NeuroTabsManifestError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (index, issue) in self.issues.iter().enumerate() {
            if index > 0 {
                write!(f, "; ")?;
            }
            write!(f, "{}: {}", issue.path, issue.message)?;
        }
        Ok(())
    }
}

impl std::error::Error for NeuroTabsManifestError {}

pub fn parse_manifest_str(
    text: &str,
    manifest_path: &Path,
) -> Result<NeuroTabsManifest, NeuroTabsManifestError> {
    let extension = manifest_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default();

    let manifest: NeuroTabsManifest = if extension.eq_ignore_ascii_case("json") {
        serde_json::from_str(text)
            .map_err(|error| NeuroTabsManifestError::parse(format!("JSON parse error: {error}")))?
    } else {
        serde_yaml::from_str(text)
            .map_err(|error| NeuroTabsManifestError::parse(format!("YAML parse error: {error}")))?
    };

    manifest.validate_strict()?;
    Ok(manifest)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct NeuroTabsManifest {
    pub spec_version: String,
    pub dataset_id: String,
    pub storage_profile: StorageProfile,
    pub observation_table: TableRef,
    pub row_id: String,
    pub observation_axes: Vec<String>,
    pub observation_columns: BTreeMap<String, ScalarColumnSchema>,
    pub features: BTreeMap<String, FeatureSchema>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub supports: BTreeMap<String, SupportSchema>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_feature: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub import_recipe: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resources: Option<TableRef>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extensions: BTreeMap<String, Value>,
}

impl NeuroTabsManifest {
    pub fn validate_strict(&self) -> Result<(), NeuroTabsManifestError> {
        let mut issues = Vec::new();

        if !is_semver(&self.spec_version) {
            issues.push(NeuroTabsIssue::new(
                "$.spec_version",
                "must be a semantic version string like 0.1.0",
            ));
        }
        if self.dataset_id.trim().is_empty() {
            issues.push(NeuroTabsIssue::new("$.dataset_id", "must not be empty"));
        }
        if self.row_id.trim().is_empty() {
            issues.push(NeuroTabsIssue::new("$.row_id", "must not be empty"));
        }
        if self.observation_axes.is_empty() {
            issues.push(NeuroTabsIssue::new(
                "$.observation_axes",
                "must contain at least one axis column",
            ));
        }
        push_duplicate_issues(
            &mut issues,
            "$.observation_axes",
            &self.observation_axes,
            "axis column",
        );
        if !self.observation_columns.contains_key(&self.row_id) {
            issues.push(NeuroTabsIssue::new(
                "$.row_id",
                format!(
                    "row id column '{}' is not declared in observation_columns",
                    self.row_id
                ),
            ));
        }
        for axis in &self.observation_axes {
            if !self.observation_columns.contains_key(axis) {
                issues.push(NeuroTabsIssue::new(
                    "$.observation_axes",
                    format!("axis column '{axis}' is not declared in observation_columns"),
                ));
            }
        }
        if self.features.is_empty() {
            issues.push(NeuroTabsIssue::new(
                "$.features",
                "must contain at least one feature",
            ));
        }
        if let Some(primary_feature) = &self.primary_feature {
            if !self.features.contains_key(primary_feature) {
                issues.push(NeuroTabsIssue::new(
                    "$.primary_feature",
                    format!("primary feature '{primary_feature}' is not declared in features"),
                ));
            }
        }
        for key in self.extensions.keys() {
            if !key.starts_with("x-") {
                issues.push(NeuroTabsIssue::new(
                    format!("$.extensions.{key}"),
                    "extension keys must begin with x-",
                ));
            }
        }

        for (feature_id, feature) in &self.features {
            self.validate_feature(feature_id, feature, &mut issues);
        }

        if issues.is_empty() {
            Ok(())
        } else {
            Err(NeuroTabsManifestError::validation(issues))
        }
    }

    pub fn primary_feature_id(&self) -> Option<&str> {
        self.primary_feature
            .as_deref()
            .or_else(|| {
                self.features
                    .iter()
                    .find(|(_, feature)| feature.logical.kind.requires_support_ref())
                    .map(|(id, _)| id.as_str())
            })
            .or_else(|| self.features.keys().next().map(String::as_str))
    }

    fn validate_feature(
        &self,
        feature_id: &str,
        feature: &FeatureSchema,
        issues: &mut Vec<NeuroTabsIssue>,
    ) {
        let feature_path = format!("$.features.{feature_id}");

        if feature.logical.axes.is_empty() {
            issues.push(NeuroTabsIssue::new(
                format!("{feature_path}.logical.axes"),
                "must contain at least one axis",
            ));
        }
        push_duplicate_issues(
            issues,
            &format!("{feature_path}.logical.axes"),
            &feature.logical.axes,
            "logical axis",
        );
        if let Some(shape) = &feature.logical.shape {
            if shape.len() != feature.logical.axes.len() {
                issues.push(NeuroTabsIssue::new(
                    format!("{feature_path}.logical.shape"),
                    "shape length must match logical axis count",
                ));
            }
            for (index, value) in shape.iter().enumerate() {
                if *value == 0 {
                    issues.push(NeuroTabsIssue::new(
                        format!("{feature_path}.logical.shape[{index}]"),
                        "shape dimensions must be positive",
                    ));
                }
            }
        }

        let support_ref = feature.logical.support_ref.as_deref();
        if feature.logical.kind.requires_support_ref() && support_ref.is_none() {
            issues.push(NeuroTabsIssue::new(
                format!("{feature_path}.logical.support_ref"),
                "volume and surface features must declare support_ref",
            ));
        }
        if let Some(support_ref) = support_ref {
            if self.supports.is_empty() {
                issues.push(NeuroTabsIssue::new(
                    "$.supports",
                    "supports is required because a feature declares logical.support_ref",
                ));
            } else if !self.supports.contains_key(support_ref) {
                issues.push(NeuroTabsIssue::new(
                    format!("{feature_path}.logical.support_ref"),
                    format!("support_ref '{support_ref}' is not declared in supports"),
                ));
            }
        }

        if feature.encodings.is_empty() {
            issues.push(NeuroTabsIssue::new(
                format!("{feature_path}.encodings"),
                "must contain at least one encoding",
            ));
        }
        for (index, encoding) in feature.encodings.iter().enumerate() {
            self.validate_encoding(
                feature_id,
                feature,
                encoding,
                index,
                &format!("{feature_path}.encodings[{index}]"),
                issues,
            );
        }
    }

    fn validate_encoding(
        &self,
        feature_id: &str,
        feature: &FeatureSchema,
        encoding: &FeatureEncoding,
        index: usize,
        path: &str,
        issues: &mut Vec<NeuroTabsIssue>,
    ) {
        match encoding {
            FeatureEncoding::Ref { binding } => {
                let has_resource = binding.resource_id.is_some();
                let has_backend_locator = binding.backend.is_some() && binding.locator.is_some();
                if !has_resource && !has_backend_locator {
                    issues.push(NeuroTabsIssue::new(
                        format!("{path}.binding"),
                        "ref encoding must declare resource_id or both backend and locator",
                    ));
                }
                for (field, column) in binding.column_sources() {
                    self.validate_column_reference(
                        &format!("{path}.binding.{field}"),
                        column,
                        issues,
                    );
                }
            }
            FeatureEncoding::Columns { binding } => {
                if binding.columns.is_empty() {
                    issues.push(NeuroTabsIssue::new(
                        format!("{path}.binding.columns"),
                        "columns encoding must bind at least one observation column",
                    ));
                }
                push_duplicate_issues(
                    issues,
                    &format!("{path}.binding.columns"),
                    &binding.columns,
                    "bound column",
                );
                for column in &binding.columns {
                    self.validate_column_reference(
                        &format!("{path}.binding.columns"),
                        column,
                        issues,
                    );
                }
                if feature.logical.axes.len() != 1 {
                    issues.push(NeuroTabsIssue::new(
                        format!("$.features.{feature_id}.logical.axes"),
                        "columns encoding is defined only for one-dimensional logical features",
                    ));
                }
                if let Some(shape) = &feature.logical.shape {
                    if shape.len() == 1 && shape[0] != binding.columns.len() {
                        issues.push(NeuroTabsIssue::new(
                            format!("$.features.{feature_id}.logical.shape"),
                            format!(
                                "shape[0] must equal the number of bound columns for columns encoding {index}"
                            ),
                        ));
                    }
                }
            }
        }
    }

    fn validate_column_reference(
        &self,
        path: &str,
        column: &str,
        issues: &mut Vec<NeuroTabsIssue>,
    ) {
        if column.trim().is_empty() {
            issues.push(NeuroTabsIssue::new(
                path,
                "column reference must not be empty",
            ));
        } else if !self.observation_columns.contains_key(column) {
            issues.push(NeuroTabsIssue::new(
                path,
                format!("column '{column}' is not declared in observation_columns"),
            ));
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StorageProfile {
    TablePackage,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TableFormat {
    Csv,
    Tsv,
    Parquet,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TableRef {
    pub path: String,
    pub format: TableFormat,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ScalarColumnSchema {
    pub dtype: ScalarDType,
    #[serde(default = "default_true")]
    pub nullable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub semantic_role: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub levels: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ScalarDType {
    String,
    Int32,
    Int64,
    Float32,
    Float64,
    Bool,
    Date,
    Datetime,
    Json,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FeatureSchema {
    pub logical: LogicalFeatureSchema,
    pub encodings: Vec<FeatureEncoding>,
    #[serde(default)]
    pub nullable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

impl FeatureSchema {
    pub fn encoding_column_references(&self) -> Vec<&str> {
        self.encodings
            .iter()
            .flat_map(FeatureEncoding::column_references)
            .collect()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LogicalFeatureSchema {
    pub kind: LogicalKind,
    pub axes: Vec<String>,
    pub dtype: LogicalDType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub support_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<Vec<usize>>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub axis_domains: BTreeMap<String, AxisDomain>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alignment: Option<Alignment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LogicalKind {
    Array,
    Volume,
    Vector,
    Matrix,
    Surface,
}

impl LogicalKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Array => "array",
            Self::Volume => "volume",
            Self::Vector => "vector",
            Self::Matrix => "matrix",
            Self::Surface => "surface",
        }
    }

    fn requires_support_ref(self) -> bool {
        matches!(self, Self::Volume | Self::Surface)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LogicalDType {
    String,
    Int32,
    Int64,
    Float32,
    Float64,
    Bool,
    Uint8,
    Uint16,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Alignment {
    #[serde(rename = "same_grid", alias = "same-grid")]
    SameGrid,
    #[serde(rename = "same_space", alias = "same-space")]
    SameSpace,
    #[serde(rename = "same_topology", alias = "same-topology")]
    SameTopology,
    #[serde(rename = "loose")]
    Loose,
    #[serde(rename = "none")]
    None,
}

impl Alignment {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SameGrid => "same_grid",
            Self::SameSpace => "same_space",
            Self::SameTopology => "same_topology",
            Self::Loose => "loose",
            Self::None => "none",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AxisDomain {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub labels: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum FeatureEncoding {
    Ref { binding: RefBinding },
    Columns { binding: ColumnsBinding },
}

impl FeatureEncoding {
    pub fn column_references(&self) -> Vec<&str> {
        match self {
            Self::Ref { binding } => binding
                .column_sources()
                .into_iter()
                .map(|(_, column)| column)
                .collect(),
            Self::Columns { binding } => binding.columns.iter().map(String::as_str).collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RefBinding {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_id: Option<StringValueSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backend: Option<StringValueSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locator: Option<StringValueSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selector: Option<JsonValueSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checksum: Option<StringValueSource>,
}

impl RefBinding {
    fn column_sources(&self) -> Vec<(&'static str, &str)> {
        let mut sources = Vec::new();
        if let Some(column) = self
            .resource_id
            .as_ref()
            .and_then(StringValueSource::column)
        {
            sources.push(("resource_id", column));
        }
        if let Some(column) = self.backend.as_ref().and_then(StringValueSource::column) {
            sources.push(("backend", column));
        }
        if let Some(column) = self.locator.as_ref().and_then(StringValueSource::column) {
            sources.push(("locator", column));
        }
        if let Some(column) = self.selector.as_ref().and_then(JsonValueSource::column) {
            sources.push(("selector", column));
        }
        if let Some(column) = self.checksum.as_ref().and_then(StringValueSource::column) {
            sources.push(("checksum", column));
        }
        sources
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ColumnsBinding {
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum StringValueSource {
    Column { column: String },
    Literal(String),
}

impl StringValueSource {
    pub fn column(&self) -> Option<&str> {
        match self {
            Self::Column { column } => Some(column),
            Self::Literal(_) => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum JsonValueSource {
    Column { column: String },
    Literal(Value),
}

impl JsonValueSource {
    pub fn column(&self) -> Option<&str> {
        match self {
            Self::Column { column } => Some(column),
            Self::Literal(_) => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "support_type", rename_all = "lowercase")]
pub enum SupportSchema {
    Volume(VolumeSupport),
    Surface(SurfaceSupport),
    Parcel(ParcelSupport),
    Generic(GenericSupport),
}

impl SupportSchema {
    pub fn support_type(&self) -> &'static str {
        match self {
            Self::Volume(_) => "volume",
            Self::Surface(_) => "surface",
            Self::Parcel(_) => "parcel",
            Self::Generic(_) => "generic",
        }
    }

    pub fn support_id(&self) -> &str {
        match self {
            Self::Volume(support) => &support.support_id,
            Self::Surface(support) => &support.support_id,
            Self::Parcel(support) => &support.support_id,
            Self::Generic(support) => &support.support_id,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VolumeSupport {
    pub support_id: String,
    pub space: String,
    pub grid_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub affine_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SurfaceSupport {
    pub support_id: String,
    pub template: String,
    pub mesh_id: String,
    pub topology_id: String,
    pub hemisphere: Hemisphere,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Hemisphere {
    Left,
    Right,
    Both,
    Midline,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ParcelSupport {
    pub support_id: String,
    pub space: String,
    pub n_parcels: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parcel_map: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub membership_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GenericSupport {
    pub support_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

fn default_true() -> bool {
    true
}

fn is_semver(value: &str) -> bool {
    let mut parts = value.split('.');
    matches!(
        (parts.next(), parts.next(), parts.next(), parts.next()),
        (Some(major), Some(minor), Some(patch), None)
            if !major.is_empty()
                && !minor.is_empty()
                && !patch.is_empty()
                && major.chars().all(|ch| ch.is_ascii_digit())
                && minor.chars().all(|ch| ch.is_ascii_digit())
                && patch.chars().all(|ch| ch.is_ascii_digit())
    )
}

fn push_duplicate_issues(
    issues: &mut Vec<NeuroTabsIssue>,
    path: &str,
    values: &[String],
    label: &str,
) {
    let mut seen = HashSet::new();
    for value in values {
        if !seen.insert(value) {
            issues.push(NeuroTabsIssue::new(
                path,
                format!("duplicate {label} '{value}'"),
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FACES_DEMO_MANIFEST: &str = r#"
spec_version: "0.1.0"
dataset_id: "faces-demo"
storage_profile: "table-package"

observation_table:
  path: "observations.csv"
  format: "csv"

row_id: "row_id"
observation_axes: ["subject", "condition", "run"]

observation_columns:
  row_id:
    dtype: string
    nullable: false
    semantic_role: row_id
  subject:
    dtype: string
    nullable: false
    semantic_role: subject
  group:
    dtype: string
    nullable: false
    semantic_role: group
  condition:
    dtype: string
    nullable: false
    semantic_role: condition
  run:
    dtype: int32
    nullable: false
    semantic_role: run
  stat_res:
    dtype: string
    nullable: true
  stat_sel:
    dtype: json
    nullable: true
  roi_1:
    dtype: float32
    nullable: true
  roi_2:
    dtype: float32
    nullable: true
  roi_3:
    dtype: float32
    nullable: true

features:
  statmap:
    description: "3D statistical map"
    logical:
      kind: volume
      axes: ["x", "y", "z"]
      dtype: float32
      support_ref: "mni_2mm_demo"
      shape: [91, 109, 91]
      space: "MNI152NLin2009cAsym"
      alignment: same_grid
    encodings:
      - type: ref
        binding:
          resource_id:
            column: "stat_res"
          selector:
            column: "stat_sel"

  roi_beta:
    description: "ROI feature vector (3 regions)"
    logical:
      kind: vector
      axes: ["roi"]
      dtype: float32
      shape: [3]
      axis_domains:
        roi:
          id: "desikan3-demo"
          labels: "roi_labels.tsv"
    encodings:
      - type: columns
        binding:
          columns: ["roi_1", "roi_2", "roi_3"]

resources:
  path: "resources.csv"
  format: "csv"

supports:
  mni_2mm_demo:
    support_type: volume
    support_id: "mni152-2mm-grid-91x109x91-demo"
    space: "MNI152NLin2009cAsym"
    grid_id: "mni152-2mm-demo-grid"
"#;

    const ROI_ONLY_MANIFEST: &str = r#"
spec_version: "0.1.0"
dataset_id: "roi-only"
storage_profile: "table-package"

observation_table:
  path: "observations.csv"
  format: "csv"

row_id: "row_id"
observation_axes: ["subject", "condition"]

observation_columns:
  row_id:
    dtype: string
    nullable: false
    semantic_role: row_id
  subject:
    dtype: string
    nullable: false
    semantic_role: subject
  group:
    dtype: string
    nullable: false
    semantic_role: group
  condition:
    dtype: string
    nullable: false
    semantic_role: condition
  age:
    dtype: float64
    nullable: false
    semantic_role: covariate
    unit: years
  roi_1:
    dtype: float32
    nullable: false
  roi_2:
    dtype: float32
    nullable: false
  roi_3:
    dtype: float32
    nullable: false
  roi_4:
    dtype: float32
    nullable: false
  roi_5:
    dtype: float32
    nullable: false

features:
  roi_beta:
    description: "5-region ROI betas"
    logical:
      kind: vector
      axes: [roi]
      dtype: float32
      shape: [5]
    encodings:
      - type: columns
        binding:
          columns: ["roi_1", "roi_2", "roi_3", "roi_4", "roi_5"]
"#;

    const MINIMAL_VECTOR_MANIFEST: &str = r#"
spec_version: "0.1.0"
dataset_id: demo
storage_profile: "table-package"
observation_table:
  path: observations.csv
  format: csv
row_id: row_id
observation_axes: [subject]
observation_columns:
  row_id: { dtype: string }
  subject: { dtype: string }
  roi_1: { dtype: float32 }
features:
  roi_beta:
    logical:
      kind: vector
      axes: [roi]
      dtype: float32
      shape: [1]
    encodings:
      - type: columns
        binding:
          columns: [roi_1]
"#;

    fn parse_yaml(text: &str) -> Result<NeuroTabsManifest, NeuroTabsManifestError> {
        parse_manifest_str(text, Path::new("nftab.yaml"))
    }

    #[test]
    fn parses_faces_demo_manifest_shape() {
        let manifest = parse_yaml(FACES_DEMO_MANIFEST).expect("parse faces-demo manifest");
        assert_eq!(manifest.dataset_id, "faces-demo");
        assert_eq!(manifest.primary_feature_id(), Some("statmap"));
        let statmap = manifest.features.get("statmap").expect("statmap feature");
        assert_eq!(statmap.logical.kind, LogicalKind::Volume);
        assert_eq!(statmap.logical.support_ref.as_deref(), Some("mni_2mm_demo"));
        assert_eq!(statmap.logical.alignment, Some(Alignment::SameGrid));
        assert!(matches!(
            statmap.encodings.first(),
            Some(FeatureEncoding::Ref { binding })
                if matches!(binding.resource_id, Some(StringValueSource::Column { ref column }) if column == "stat_res")
                    && matches!(binding.selector, Some(JsonValueSource::Column { ref column }) if column == "stat_sel")
        ));
        assert!(matches!(
            manifest.supports.get("mni_2mm_demo"),
            Some(SupportSchema::Volume(support))
                if support.grid_id == "mni152-2mm-demo-grid"
        ));
    }

    #[test]
    fn parses_roi_only_columns_manifest_shape() {
        let manifest = parse_yaml(ROI_ONLY_MANIFEST).expect("parse roi-only manifest");
        assert_eq!(manifest.dataset_id, "roi-only");
        let feature = manifest.features.get("roi_beta").expect("roi feature");
        assert_eq!(feature.logical.kind, LogicalKind::Vector);
        assert!(matches!(
            feature.encodings.first(),
            Some(FeatureEncoding::Columns { binding }) if binding.columns.len() == 5
        ));
    }

    #[test]
    fn rejects_missing_required_fields() {
        let err = parse_yaml(
            r#"
spec_version: "0.1.0"
storage_profile: "table-package"
"#,
        )
        .expect_err("missing dataset_id must fail");
        assert!(err.to_string().contains("dataset_id"));
    }

    #[test]
    fn rejects_unknown_top_level_keys() {
        let err = parse_yaml(&format!("{MINIMAL_VECTOR_MANIFEST}\nunknown_key: true\n"))
            .expect_err("unknown top-level key must fail");
        assert!(err.to_string().contains("unknown_key"));
    }

    #[test]
    fn rejects_missing_primary_feature_target() {
        let err = parse_yaml(&format!(
            "{MINIMAL_VECTOR_MANIFEST}\nprimary_feature: missing_feature\n"
        ))
        .expect_err("missing primary feature target must fail");
        assert!(err.to_string().contains("$.primary_feature"));
    }

    #[test]
    fn rejects_missing_support_ref_for_volume() {
        let err = parse_yaml(
            r#"
spec_version: "0.1.0"
dataset_id: demo
storage_profile: "table-package"
observation_table:
  path: observations.csv
  format: csv
row_id: row_id
observation_axes: [subject]
observation_columns:
  row_id: { dtype: string }
  subject: { dtype: string }
  statmap_path: { dtype: string }
features:
  statmap:
    logical:
      kind: volume
      axes: [x, y, z]
      dtype: float32
    encodings:
      - type: ref
        binding:
          backend: nifti
          locator:
            column: statmap_path
"#,
        )
        .expect_err("volume without support_ref must fail");
        assert!(err.to_string().contains("support_ref"));
    }

    #[test]
    fn rejects_unknown_support_ref() {
        let err = parse_yaml(
            r#"
spec_version: "0.1.0"
dataset_id: demo
storage_profile: "table-package"
observation_table:
  path: observations.csv
  format: csv
row_id: row_id
observation_axes: [subject]
observation_columns:
  row_id: { dtype: string }
  subject: { dtype: string }
  statmap_path: { dtype: string }
features:
  statmap:
    logical:
      kind: volume
      axes: [x, y, z]
      dtype: float32
      support_ref: missing_mni
    encodings:
      - type: ref
        binding:
          backend: nifti
          locator:
            column: statmap_path
supports:
  mni:
    support_type: volume
    support_id: mni-demo
    space: MNI152NLin2009cAsym
    grid_id: mni-grid
"#,
        )
        .expect_err("unknown support_ref must fail");
        assert!(err.to_string().contains("missing_mni"));
    }

    #[test]
    fn rejects_bad_storage_profile() {
        let err = parse_yaml(&MINIMAL_VECTOR_MANIFEST.replace("table-package", "loose-files"))
            .expect_err("bad storage_profile must fail");
        assert!(err.to_string().contains("loose-files"));
    }

    #[test]
    fn rejects_invalid_extension_keys() {
        let err = parse_yaml(&format!(
            "{MINIMAL_VECTOR_MANIFEST}\nextensions:\n  bad-key: true\n"
        ))
        .expect_err("invalid extension key must fail");
        assert!(err.to_string().contains("$.extensions.bad-key"));
    }
}
