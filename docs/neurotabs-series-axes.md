# NeuroTabs series axes (time and lag)

A NeuroTabs package can declare a **series axis**, so that Brainflow plots a
locus as a series (for example an FIR response per lag, or a time course)
instead of as unrelated members. Brainflow reads the declaration as a typed
`SeriesAxis`:

```ts
SeriesAxis {
  kind: "time" | "lag" | "index";
  source:
    | { type: "observation_column"; column: string }
    | { type: "feature_axis"; feature: string; axis: string; position: number };
  unit: string | null;   // "s", "ms", "TR", ...
  start: number | null;  // declared axes only
  step: number | null;   // declared axes only, > 0
  count: number | null;  // from logical.shape or axis_domains.size
  alignment: "declared_common_axis" | "observation_values";
}
```

It appears as `SpatialFieldSetSummary.seriesAxes` for manifest-backed sets.
`index` is reserved for series without physical spacing, such as image-set
frames; a manifest never declares it.

## Units

A series axis unit is `"s"`, `"ms"` or `"TR"`. A `time` axis must declare one.
A `lag` axis may omit it; positions are then plain bins (lag 0, 1, 2, …).
Strict manifest validation rejects any other unit.

## Convention 1: an observation column

Use this convention when each observation row is one position on the axis.
This is typical for FIR results stored as one 3D map per subject × condition ×
lag.

```yaml
observation_axes: ["subject", "condition", "lag"]
observation_columns:
  lag:
    dtype: float64          # int32 | int64 | float32 | float64
    nullable: false
    semantic_role: lag      # or: time
    unit: "s"               # optional
```

- The column must be numeric. A `lag`/`time` role on a string column fails
  strict validation.
- `unit` follows the rules above. It is required for `semantic_role: time`.
- Positions are the column's values (`alignment: observation_values`). They
  need not be evenly spaced.

## Convention 2: a feature logical axis

Use this convention when each member carries the whole series, for example a
4D volume or a vector of values per lag.

```yaml
features:
  bold:
    logical:
      kind: volume
      axes: ["x", "y", "z", "time"]   # axis named `time` or `lag`
      dtype: float32
      shape: [91, 109, 91, 120]       # optional; supplies count
      axis_domains:
        time:
          unit: "s"                   # required for time; "s" | "ms" | "TR"
          start: 0.0                  # optional, finite
          step: 2.0                   # optional, finite and > 0
```

Positions are `start + i * step`, common to all members
(`alignment: declared_common_axis`). `axis_domains` keeps its existing
`id`/`labels`/`size`/`description` fields; `unit`, `start` and `step` are new
and optional.

## Folder discovery

When a folder is opened without a manifest, ontology inference proposes a lag
axis:

- A `lag-<value>` filename entity (e.g. `sub-01_task-faces_lag-3_beta.nii.gz`)
  becomes a `lag` design factor (source `bids_entity`). It is part of the
  member identity, so each lag is its own observation.
- A `lag` or `time` factor whose values are all numeric is marked
  `seriesAxis: "lag" | "time"` on `StudioFolderOntologyFactor`.
- On promotion to a NeuroTabs package, such a column is written as `float64`
  with `semantic_role` equal to its name, which is convention 1.

Units cannot be inferred from file names; add `unit` in the manifest.

## Worked example: an FIR study

Three subjects and two conditions have FIR betas at lags 0–3. These are stored
as one 3D map per subject × condition × lag, with a lag spacing of one TR.

`manifest.yaml`:

```yaml
spec_version: "0.1.0"
dataset_id: "fir-faces-houses"
storage_profile: "table-package"
observation_table: { path: "observations.csv", format: "csv" }
row_id: "row_id"
observation_axes: ["subject", "condition", "lag"]
observation_columns:
  row_id:    { dtype: string,  nullable: false, semantic_role: row_id }
  subject:   { dtype: string,  nullable: false, semantic_role: subject }
  condition: { dtype: string,  nullable: false, semantic_role: condition }
  lag:       { dtype: float64, nullable: false, semantic_role: lag, unit: "TR" }
  beta_res:  { dtype: string,  nullable: true }
features:
  beta:
    logical: { kind: volume, axes: ["x", "y", "z"], dtype: float32, support_ref: "mni2" }
    encodings:
      - type: ref
        binding: { resource_id: { column: "beta_res" } }
resources: { path: "resources.csv", format: "csv" }
supports:
  mni2:
    support_type: volume
    support_id: "mni152-2mm"
    space: "MNI152NLin2009cAsym"
    grid_id: "mni152-2mm"
```

`observations.csv` (first rows):

```text
row_id,subject,condition,lag,beta_res
s01_faces_l0,s01,faces,0,s01_faces_l0
s01_faces_l1,s01,faces,1,s01_faces_l1
s01_faces_l2,s01,faces,2,s01_faces_l2
s01_faces_l3,s01,faces,3,s01_faces_l3
s01_houses_l0,s01,houses,0,s01_houses_l0
```

Brainflow reports one axis:

```json
{ "kind": "lag", "source": { "type": "observation_column", "column": "lag" },
  "unit": "TR", "start": null, "step": null, "count": null,
  "alignment": "observation_values" }
```

A series plot for a region then reduces each subject's map at every lag, and
draws one line per condition (with a population band) against lag in TR.
The same study opened as a folder of `sub-01_task-faces_lag-2_beta.nii.gz`
files proposes the `lag` factor as a lag axis without a unit; add
`unit: "TR"` when saving the manifest.

