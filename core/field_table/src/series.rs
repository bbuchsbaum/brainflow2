//! Typed series axes (time / lag) declared by a NeuroTabs manifest.
//!
//! Two conventions, documented in `docs/neurotabs-series-axes.md`:
//!
//! - **Observation column**: one observation row per axis position, with a
//!   numeric column whose `semantic_role` is `lag` or `time` (unit from the
//!   column `unit`). Typical for FIR results stored as one 3D map per subject ×
//!   condition × lag.
//! - **Feature axis**: a feature whose `logical.axes` contains `lag` or `time`
//!   (e.g. `[x, y, z, time]`). `logical.axis_domains.<axis>` may declare
//!   `unit`, `start` and `step`; the count comes from `logical.shape` or the
//!   domain `size`.
use crate::neurotabs::{LogicalKind, NeuroTabsIssue, NeuroTabsManifest, ScalarDType};
use bridge_types::{SeriesAxis, SeriesAxisAlignment, SeriesAxisKind, SeriesAxisSource};

fn is_numeric(dtype: ScalarDType) -> bool {
    matches!(
        dtype,
        ScalarDType::Int32 | ScalarDType::Int64 | ScalarDType::Float32 | ScalarDType::Float64
    )
}

impl NeuroTabsManifest {
    /// Every series axis the manifest declares, observation columns first,
    /// then feature axes (in feature id order).
    pub fn series_axes(&self) -> Vec<SeriesAxis> {
        let mut axes = Vec::new();
        for (column, schema) in &self.observation_columns {
            let Some(kind) = schema
                .semantic_role
                .as_deref()
                .and_then(SeriesAxisKind::from_convention_name)
            else {
                continue;
            };
            axes.push(SeriesAxis {
                kind,
                source: SeriesAxisSource::ObservationColumn {
                    column: column.clone(),
                },
                unit: schema.unit.clone(),
                start: None,
                step: None,
                count: None,
                alignment: SeriesAxisAlignment::ObservationValues,
            });
        }
        for (feature_id, feature) in &self.features {
            for (position, axis) in feature.logical.axes.iter().enumerate() {
                let Some(kind) = SeriesAxisKind::from_convention_name(axis) else {
                    continue;
                };
                let domain = feature.logical.axis_domains.get(axis);
                let count = feature
                    .logical
                    .shape
                    .as_ref()
                    .and_then(|shape| shape.get(position).copied())
                    .or_else(|| domain.and_then(|d| d.size));
                axes.push(SeriesAxis {
                    kind,
                    source: SeriesAxisSource::FeatureAxis {
                        feature: feature_id.clone(),
                        axis: axis.clone(),
                        position,
                    },
                    unit: domain.and_then(|d| d.unit.clone()),
                    start: domain.and_then(|d| d.start),
                    step: domain.and_then(|d| d.step),
                    count,
                    alignment: SeriesAxisAlignment::DeclaredCommonAxis,
                });
            }
        }
        axes
    }
}

/// Units accepted on series axes: seconds, milliseconds or repetition times.
pub const SERIES_AXIS_UNITS: [&str; 3] = ["s", "ms", "TR"];

/// A time axis must declare its unit; a lag axis may (bins otherwise). A
/// declared unit must be one of [`SERIES_AXIS_UNITS`].
fn check_unit(
    kind: SeriesAxisKind,
    unit: Option<&str>,
    path: String,
    issues: &mut Vec<NeuroTabsIssue>,
) {
    match unit {
        None if kind == SeriesAxisKind::Time => issues.push(NeuroTabsIssue::new(
            path,
            "a time axis must declare its unit (\"s\", \"ms\" or \"TR\")",
        )),
        Some(unit) if !SERIES_AXIS_UNITS.contains(&unit) => issues.push(NeuroTabsIssue::new(
            path,
            format!("unit {unit:?} is not one of \"s\", \"ms\" or \"TR\""),
        )),
        _ => {}
    }
}

/// Strict-validation rules for series axes.
pub(crate) fn validate_series_axes(manifest: &NeuroTabsManifest, issues: &mut Vec<NeuroTabsIssue>) {
    for (column, schema) in &manifest.observation_columns {
        let Some(kind) = schema
            .semantic_role
            .as_deref()
            .and_then(SeriesAxisKind::from_convention_name)
        else {
            continue;
        };
        let path = format!("$.observation_columns.{column}");
        if !is_numeric(schema.dtype) {
            issues.push(NeuroTabsIssue::new(
                format!("{path}.dtype"),
                "a lag or time axis column must be numeric (int32, int64, float32 or float64)",
            ));
        }
        check_unit(kind, schema.unit.as_deref(), format!("{path}.unit"), issues);
    }
    for (feature_id, feature) in &manifest.features {
        let series_positions: Vec<usize> = feature
            .logical
            .axes
            .iter()
            .enumerate()
            .filter(|(_, axis)| SeriesAxisKind::from_convention_name(axis).is_some())
            .map(|(position, _)| position)
            .collect();
        let axes_path = format!("$.features.{feature_id}.logical.axes");
        if series_positions.len() > 1 {
            issues.push(NeuroTabsIssue::new(
                axes_path.clone(),
                "declare at most one lag or time axis",
            ));
        }
        // Volume members are [x, y, z] plus at most one series axis, 4th.
        if feature.logical.kind == LogicalKind::Volume
            && series_positions.iter().any(|position| *position != 3)
        {
            issues.push(NeuroTabsIssue::new(
                axes_path.clone(),
                "a volume's lag or time axis must be the 4th axis ([x, y, z, lag|time])",
            ));
        }
        for &position in &series_positions {
            let axis = &feature.logical.axes[position];
            // The frame count is part of the contract: members are checked
            // against it, and members of different lengths cannot be stacked.
            let from_shape = feature
                .logical
                .shape
                .as_ref()
                .and_then(|shape| shape.get(position).copied());
            let from_domain = feature.logical.axis_domains.get(axis).and_then(|d| d.size);
            let count_path = format!("$.features.{feature_id}.logical");
            match (from_shape, from_domain) {
                (None, None) => issues.push(NeuroTabsIssue::new(
                    count_path,
                    format!(
                        "the {axis} axis needs a sample count (logical.shape[{position}] or \
                         axis_domains.{axis}.size)"
                    ),
                )),
                (Some(a), Some(b)) if a != b => issues.push(NeuroTabsIssue::new(
                    count_path,
                    format!("logical.shape[{position}] = {a} disagrees with axis_domains.{axis}.size = {b}"),
                )),
                (Some(0), _) | (_, Some(0)) => issues.push(NeuroTabsIssue::new(
                    count_path,
                    format!("the {axis} axis must have at least one sample"),
                )),
                _ => {}
            }
        }
        for axis in &feature.logical.axes {
            let Some(kind) = SeriesAxisKind::from_convention_name(axis) else {
                continue;
            };
            let path = format!("$.features.{feature_id}.logical.axis_domains.{axis}");
            let domain = feature.logical.axis_domains.get(axis);
            check_unit(
                kind,
                domain.and_then(|d| d.unit.as_deref()),
                format!("{path}.unit"),
                issues,
            );
            let Some(domain) = domain else {
                continue;
            };
            if domain.start.is_some_and(|v| !v.is_finite()) {
                issues.push(NeuroTabsIssue::new(
                    format!("{path}.start"),
                    "must be finite",
                ));
            }
            if domain.step.is_some_and(|v| !(v.is_finite() && v > 0.0)) {
                issues.push(NeuroTabsIssue::new(
                    format!("{path}.step"),
                    "must be finite and > 0",
                ));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::neurotabs::parse_manifest_str;
    use bridge_types::{SeriesAxisAlignment, SeriesAxisKind, SeriesAxisSource};
    use std::path::Path;

    const FIR_MANIFEST: &str = r#"
spec_version: "0.1.0"
dataset_id: "fir-demo"
storage_profile: "table-package"
observation_table:
  path: "observations.csv"
  format: "csv"
row_id: "row_id"
observation_axes: ["subject", "condition", "lag"]
observation_columns:
  row_id: { dtype: string, nullable: false, semantic_role: row_id }
  subject: { dtype: string, nullable: false, semantic_role: subject }
  condition: { dtype: string, nullable: false, semantic_role: condition }
  lag: { dtype: float64, nullable: false, semantic_role: lag, unit: "s" }
  beta_res: { dtype: string, nullable: true }
features:
  beta:
    logical:
      kind: volume
      axes: ["x", "y", "z"]
      dtype: float32
      support_ref: "grid"
    encodings:
      - type: ref
        binding:
          resource_id: { column: "beta_res" }
  bold:
    logical:
      kind: volume
      axes: ["x", "y", "z", "time"]
      dtype: float32
      support_ref: "grid"
      shape: [4, 4, 4, 12]
      axis_domains:
        time: { unit: "s", start: 0.0, step: 2.0 }
    encodings:
      - type: ref
        binding:
          resource_id: { column: "beta_res" }
resources:
  path: "resources.csv"
  format: "csv"
supports:
  grid:
    support_type: volume
    support_id: "grid-4"
    space: "MNI152NLin2009cAsym"
    grid_id: "grid-4"
"#;

    fn parse(text: &str) -> Result<crate::neurotabs::NeuroTabsManifest, String> {
        parse_manifest_str(text, Path::new("/tmp/fir/manifest.yaml")).map_err(|e| e.to_string())
    }

    #[test]
    fn finds_observation_column_and_feature_axes() {
        let manifest = parse(FIR_MANIFEST).expect("valid FIR manifest");
        let axes = manifest.series_axes();
        assert_eq!(axes.len(), 2);
        assert_eq!(axes[0].kind, SeriesAxisKind::Lag);
        assert_eq!(
            axes[0].source,
            SeriesAxisSource::ObservationColumn {
                column: "lag".into()
            }
        );
        assert_eq!(axes[0].unit.as_deref(), Some("s"));
        assert_eq!(axes[0].alignment, SeriesAxisAlignment::ObservationValues);
        assert_eq!(axes[1].kind, SeriesAxisKind::Time);
        assert_eq!(
            axes[1].source,
            SeriesAxisSource::FeatureAxis {
                feature: "bold".into(),
                axis: "time".into(),
                position: 3
            }
        );
        assert_eq!(
            (axes[1].start, axes[1].step, axes[1].count),
            (Some(0.0), Some(2.0), Some(12))
        );
        assert_eq!(axes[1].alignment, SeriesAxisAlignment::DeclaredCommonAxis);
    }

    #[test]
    fn rejects_non_numeric_lag_column_and_bad_step() {
        let text = FIR_MANIFEST
            .replace("lag: { dtype: float64", "lag: { dtype: string")
            .replace("step: 2.0", "step: -1.0");
        let error = parse(&text).expect_err("invalid series axes");
        assert!(error.contains("observation_columns.lag.dtype"), "{error}");
        assert!(error.contains("axis_domains.time.step"), "{error}");
    }

    #[test]
    fn time_axes_require_a_known_unit() {
        // Time axis without a unit.
        let text = FIR_MANIFEST.replace(r#"time: { unit: "s", start"#, "time: { start");
        let error = parse(&text).expect_err("time axis needs a unit");
        assert!(error.contains("axis_domains.time.unit"), "{error}");
        // TR is accepted; an unknown unit is not.
        let tr = FIR_MANIFEST.replace(r#"time: { unit: "s""#, r#"time: { unit: "TR""#);
        assert_eq!(
            parse(&tr).unwrap().series_axes()[1].unit.as_deref(),
            Some("TR")
        );
        let bad = FIR_MANIFEST.replace(r#"unit: "s" }"#, r#"unit: "seconds" }"#);
        let error = parse(&bad).expect_err("unknown lag unit");
        assert!(error.contains("observation_columns.lag.unit"), "{error}");
        // A lag axis may omit its unit (bins).
        let bins = FIR_MANIFEST.replace(r#", unit: "s" }"#, " }");
        assert_eq!(parse(&bins).unwrap().series_axes()[0].unit, None);
    }

    #[test]
    fn manifests_without_series_axes_report_none() {
        let text = FIR_MANIFEST
            .replace("semantic_role: lag, ", "")
            .replace(
                r#"axes: ["x", "y", "z", "time"]"#,
                r#"axes: ["x", "y", "z", "t"]"#,
            )
            .replace("time: { unit", "t: { unit");
        let manifest = parse(&text).expect("valid manifest");
        assert!(manifest.series_axes().is_empty());
    }

    #[test]
    fn series_axis_needs_one_consistent_count_in_fourth_position() {
        // No count at all.
        let no_count = FIR_MANIFEST.replace("      shape: [4, 4, 4, 12]\n", "");
        let error = parse(&no_count).expect_err("count required");
        assert!(error.contains("time axis needs a sample count"), "{error}");
        // The domain size alone is enough.
        let by_size = no_count.replace("time: { unit", "time: { size: 12, unit");
        assert_eq!(parse(&by_size).unwrap().series_axes()[1].count, Some(12));
        // Shape and size disagree.
        let disagree = FIR_MANIFEST.replace("time: { unit", "time: { size: 10, unit");
        assert!(parse(&disagree).unwrap_err().contains("disagrees"));
        // Zero samples.
        let zero = FIR_MANIFEST.replace("shape: [4, 4, 4, 12]", "shape: [4, 4, 4, 0]");
        assert!(parse(&zero).unwrap_err().contains("at least one sample"));
        // A volume's series axis must be 4th, and only one is allowed.
        let first = FIR_MANIFEST
            .replace(
                r#"axes: ["x", "y", "z", "time"]"#,
                r#"axes: ["time", "x", "y", "z"]"#,
            )
            .replace("shape: [4, 4, 4, 12]", "shape: [12, 4, 4, 4]");
        assert!(parse(&first).unwrap_err().contains("must be the 4th axis"));
        let two = FIR_MANIFEST
            .replace(
                r#"axes: ["x", "y", "z", "time"]"#,
                r#"axes: ["x", "y", "z", "time", "lag"]"#,
            )
            .replace("shape: [4, 4, 4, 12]", "shape: [4, 4, 4, 12, 3]");
        assert!(parse(&two)
            .unwrap_err()
            .contains("at most one lag or time axis"));
    }
}
