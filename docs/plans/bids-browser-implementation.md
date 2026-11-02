# BIDS browser implementation plan (2026-11)

Implements [bids-browser-design.md](bids-browser-design.md). That document and
`bids-browser-mockups/src/r3.html` are authoritative for look and behaviour.
This file records the bridge contract, the build order and the decisions the
design left open.

## Decisions

| Topic | Decision | Why |
| --- | --- | --- |
| v1 `scan_bids_dataset` | Left unchanged. The earlier uncommitted coverage refactor is dropped. | It counted `.nii.gz` + `.json` as two runs, mixed derivatives into raw columns, collapsed `dir-`/`acq-`, and sorted `run-10` before `run-2`. |
| Browser payload | New `scan_bids_browser`, returning per-run records. Columns are derived in the UI model. | One model owns every count (scientific rule 1). |
| FD | Stored per run in the index: mean, frames over 0.2/0.5 mm and a 28-point downsampled trace, for local datasets. Full per-volume trace is fetched on select. | The matrix needs sparklines and the summary needs means, so "lazy on select" cannot hold for all of it. Results are cached in the index. |
| Remote mounts | The scan walks the dataset on the server (`RemoteFs::list`, skipping `.git`, `.datalad`, `sourcedata`) and builds a bids-rs supplied manifest. It fetches into memory, never the cache: root and pipeline descriptions, root sidecars and events, `participants.tsv`, dated tables, exclusions and MRIQC group tables every scan; subject sidecars for changed subjects; confounds and events per subject, dropped after it. Any file over 32 MiB stays unread and reported. NIfTI headers stream from the server. Derivative images are names only, for coverage. No image is downloaded. | Reads hold mount operation permits, not `ADMISSION`. Walk and fetch run in batches of 32, so a cancel lands between them. The bids-rs compliance rules run on the snapshot. |
| Index location | `ProjectDirs` cache dir, `bids-index/<hash of dataset path>.json`, outside the evicted remote cache. Keyed per file on size and mtime. | Incremental rescans and "since last scan". |
| Lenses | Serializable predicates. Saved in localStorage per dataset path, never in the dataset. | The exclusion writer is the only writer. |
| Exports | "Copy summary", "Copy CuBIDS table" and lens export copy to the clipboard. | Same rule. |
| Undo | Local strip above the dock, as designed, not the status bar notification. It belongs to the workspace and leaves with it. | Design is explicit. |
| Author | Editable dialog field, default from `default_author` (OS user), remembered in localStorage. | No identity service exists. |
| Contact sheet | New on-demand command; mean of at most 8 evenly spaced volumes; PNG; disk cache; at most 2 concurrent decodes in Rust. Slice chosen by world z through the affine. Window is the 2nd–98th percentile rule applied per image and stated in the caption. | Full decode cost; no existing thumbnail path. |
| Exclusion rows | Each row carries its threshold, FD definition and, for wider scopes, `triggered_by`. `exclusions.json` only describes columns. A write returns `{ all, added }`; undo and Revert remove rows by `(entity, criterion)` in one rewrite. The UI reads rows with `read_bids_exclusions` before a scan streams and refuses to exclude until then. | One sidecar cannot speak for rows made under different thresholds, and comparing against an unread list deleted older rows. |
| Remote absence | `listing_complete` is true when the server walk reached every directory. Then a remote absence is a real absence. If it did not, absent cells are `unknown`; no column totals, absence claims, derivative marks or validator findings, and no subject is stored. | A partial listing is not evidence, a finished one is. |
| Listed without images | Participants in `participants.tsv` with no images in a complete local scan are not rows and not in any count; the summary and legend state how many. | A partial copy is not a dataset with missing runs. |
| FD comparability | A session dot is hollow when its runs' acquisition groups differ from that session's modal composition, not whenever a run is outside the dataset's modal group. Pooled counts name their groups. | In a multi-TR design every session mixes TRs alike, so the old mark was on every dot. |
| Session order | `session_order` comes from `acq_time`. Otherwise numbered sessions are in order and named ones are not called "second". | `retest` sorts before `test`. |
| Open in viewer | A run with no `space-` entity opens as its own base, selected, other layers hidden in that view only, with the Plot dock on its time series. | Native EPI on a template claims an alignment that does not exist. |
| Opening runs | `loadFile(path, 'programmatic', 'new-workspace')`, then `setTimepoint(peak)` guarded by workspace identity, then publish events. | Existing seam. |
| Events as a track | New small `timeEventsStore`, drawn as bands on the existing time series plot. | No track exists. |
| Findings tab | GoldenLayout `BidsFindingsPanel` added to the left stack only while `bids-explorer` is active; stripped from saved layouts. | No workspace-scoped panel seam exists. |

## Bridge contract (`core/bridge_types/src/bids.rs`)

Existing v1 types stay. Add, all `#[derive(Serialize, Deserialize, TS)]`, snake_case on the wire:

```rust
BidsBrowserIndex {
  scan_id: String, dataset_path: String, name: String, bids_version: String,
  dataset_version: Option<String>, doi: Option<String>, license: Option<String>,
  authors: Vec<String>, scanner: Option<String>, // modal Manufacturer + ManufacturersModelName + field strength
  is_remote: bool, complete: bool, listing_complete: bool, default_author: String,
  previous_scan_at: Option<String>, new_subjects: Vec<String>, // "since last scan"
  total_file_count: f64, total_size_bytes: f64, files_read: f64,
  participants: Vec<BidsParticipantRow>, participant_columns: Vec<String>,
  subjects: Vec<String>, // natural order; includes on-disk subjects absent from participants.tsv
  runs: Vec<BidsRunRecord>,
  series_modal: Vec<BidsSeriesModal>,
  variants: Vec<BidsVariantGroup>,
  findings: Vec<BidsFinding>,        // validator + content + notes; quality is derived in the UI
  derivatives: Vec<BidsDerivativeInfo>,
  derivative_status: Vec<BidsSubjectDerivative>,
  exclusions: Vec<BidsExclusion>,
}
BidsRunRecord {
  id: String,            // BIDS stem without suffix extension, e.g. sub-01_ses-02_task-nback_run-1_bold
  subject, session: Option, datatype, suffix, task: Option, acq: Option,
  dir: Option, run: Option, echo: Option,
  path: String, rel_path: String, size_bytes: f64,
  series: String,        // e.g. "task-nback_bold", "T1w", "epi_dir-AP"; includes acq/dir/ce/rec/echo
  sidecar: Vec<BidsMetaValue>,  // effective, with provenance; acquisition keys only
  header: Option<BidsHeaderSummary>,
  variant_id: Option<String>,   // None = modal
  fmap: Option<BidsFieldmapLink>,
  fd: Option<BidsFdSummary>,
  iqms: Option<BidsIqms>,
  has_events: bool,
  mtime: Option<String>,
}
BidsMetaValue { key, value: serde_json::Value as string JSON, source: String /* rel path or "NIfTI" */, source_kind: "run"|"dataset"|"nifti" }
BidsHeaderSummary { dim: Vec<u32>, pixdim: Vec<f32>, qform_code: i16, sform_code: i16, tr_seconds: Option<f32>, n_volumes: Option<u32> }
BidsSeriesModal { series, values: Vec<BidsMetaValue>, n_runs: u32 }
BidsVariantGroup { id: String /* A.. per series; modal excluded */, series, name, diff: String, note: String, keys: Vec<String>, run_ids: Vec<String> }
BidsFinding { id, tag: "validator"|"content"|"note", severity: "error"|"warning"|"info",
              code, title, detail, subject: Option, session: Option, run_ids: Vec<String>, file: Option }
BidsFdSummary { mean: f32, max: f32, n_frames: u32, over_0_2: u32, over_0_5: u32, peak_volume: u32,
                trace: Vec<f32> /* 28 points */, source: String /* "fmriprep 24.1.1 confounds" */, definition: String /* "Power" */, filtered: bool }
BidsIqms { tsnr: Option<f32>, fd_mean: Option<f32>, gsr_y: Option<f32>, source: String /* "mriqc 24.0.2" */ }
BidsFieldmapLink { source_id: Option, fmap_run_ids: Vec<String>, via: "B0FieldSource"|"IntendedFor"|"none",
                   checks: Vec<BidsCheck> }
BidsCheck { ok: bool, severity: "ok"|"warning"|"error", text: String }
BidsDerivativeInfo { name, version: Option, source_version: Option, stale: bool, runs: u32, of: u32, root: String }
BidsSubjectDerivative { subject, name, status: "current"|"partial"|"missing"|"stale" }
BidsExclusion { entity, scope: "run"|"session"|"participant", reason, criterion, value, author, date, source }
BidsScanProgress { scan_id, phase, subjects_done: u32, subjects_total: u32, files_done: f64, files_total: f64,
                   current: Option<String>, subject: Option<String>, runs: Vec<BidsRunRecord>, findings: Vec<BidsFinding> }
BidsRunDetail { run_id, fd_trace: Vec<f32>, fd_source, fd_definition, fd_filtered, event_checks: Vec<BidsCheck>,
                events_duration: Option<f32>, derivative_checks: Vec<BidsCheck> }
BidsSliceRequest { path, kind: "mean"|"first"|"tsnr"|"anat", world_z_mm: Option<f32>, max_px: u32 }
BidsSliceImage { png_base64, width, height, world_z_mm }
```

Numbers that may exceed 2^53 are not expected; use `f64` where ts-rs would otherwise emit `bigint`.

### Changes made while building step 1

`core/bridge_types/src/bids.rs` is the source of truth. These differ from the block above, or add to it:

| Item | As built |
| --- | --- |
| `BidsRunRecord.id` | The file stem including the BIDS suffix. |
| `BidsRunRecord.series` | Task series: `task-x[_entities]_suffix`. Others: `suffix[_entities]`. Every entity except sub, ses, run and task is kept, so `part-` and `inv-` stay apart too. |
| `BidsMetaValue` keys | Sidecar keys plus header keys with `source_kind: "nifti"`: `VoxelSize`, `Matrix`, `NumberOfVolumes`, `pixdim[4]`. Numbers keep their JSON text; compare through `value`, parsed. |
| `BidsSeriesModal.values` | Excludes `B0FieldIdentifier`, `B0FieldSource` and `IntendedFor`, which are per run by nature. |
| `BidsVariantGroup` | Letters restart per series, and `name` is generated (`TR, MB differs`). Upgrades spanning several tasks are one group per task series; merging them is a UI concern. |
| `BidsFdSummary.n_frames` | Frames with a value, so a leading `n/a` is not counted. `mean` covers those frames. `peak_volume` indexes the full series. |
| `BidsFdSummary.trace` | 28 bins, each the bin's maximum, so spikes survive. It is not used for the mean. |
| `BidsRunDetail.fd_trace` | `Vec<Option<f32>>`, one entry per volume, `null` at `n/a`. Keeps frames aligned with volumes and avoids NaN in JSON. |
| `BidsRunDetail.fd_source`, `fd_definition` | `Option<String>`: a run can have no confounds. |
| `BidsSubjectDerivative.status` | Adds `no_local_data`: no images for this subject here. |
| `BidsDerivativeInfo.unit` | New: `run` or `subject`, what `runs` and `of` count. Pipelines with task-level outputs count bold runs; others (FreeSurfer) count subjects. |
| `BidsExclusion.scope` | Not a TSV column. Derived from the entity on read; the UI may send an empty string. |
| `BidsExclusion.entity` | A run id, `sub-XX_ses-YY` or `sub-XX`. Matches `BidsRunRecord.id`. |
| `BidsSliceImage` | `world_z_mm` is `Option` (a carpet has none). New: `window_low`, `window_high`, `volumes_used`. |
| `BidsMedianSliceImage` | New return type of `get_bids_median_slice`: `{ image, runs_used, runs_skipped }`. With more than 15 paths, 15 evenly spaced runs are used and the rest are not counted as skipped. |
| `write_bids_exclusions` | `(dataset_path, rows, context)`. `source_version` moved into `BidsExclusionContext { source_version, fd_definition, fd_source, fd_threshold_mm }`, which `exclusions.json` needs. |
| `cancel_bids_scan` | Returns `bool`: whether a scan with that id was running. |

Behaviour the UI should rely on:

- Progress events carry `variant_id: null` and no `iqms`; series results, IQMs, derivatives, validator findings and exclusions arrive only in the returned index.
- A cancelled scan returns `complete: false` with all `subjects` listed and only read subjects in `runs`. It stores its work but does not move `previous_scan_at`.
- A second scan of a dataset supersedes the first, which stops and may not write the index. The same `scan_id` twice is an error.
- `get_bids_run_detail` reads files directly and works during a scan. It builds a project of the root files and that subject, for sidecar resolution.
- A dangling symlink (an annexed image not yet fetched) is a present run with `header: null`, `size_bytes: 0` and an `IMAGE_UNAVAILABLE` finding. Slice commands return an error for it. Its missing `VoxelSize` and `Matrix` do not make it a variant.
- A subject with a failed remote header, sidecar, events or confounds read reports it but is not stored, so the next scan retries it.
- `get_bids_run_detail` and `get_bids_run_events` read the mirror, not the server: per-volume FD of a remote run appears only once its confounds are mirrored. The FD summary comes from the scan.
- A malformed sidecar that applies to a run gives one `SIDECAR_UNREADABLE`, and only that file is skipped: the run keeps every key from its other sidecars. bids-rs resolves all or nothing, so these runs are merged per candidate in `meta.rs` with upstream's ordering. A sidecar above the subject level is named on no subject.
- The median is taken over each run's windowed slice, so `window_low`/`window_high` of a median are 0 and 1. The single-run tile beside it uses its own 2nd to 98th percentile window: the same rule, not the same numbers.
- Slices are axial with +A up and +R to the right of the image (neurological), chosen by world z through the affine. `world_z_mm` is the slice drawn, which can differ from the one asked for.
- Exclusions are refused on remote mounts: a mirror's copy would not reach the server.
- An exclusion with the same entity and criterion as an existing row is not added again.
- `SliceTiming` absence is a `SLICE_TIMING_MISSING` finding, not a variant. Every other absent key counts as a value when grouping. Numbers compare rounded to 1e-4, or to five significant digits below 0.1, so 0.00027 and 0.00031 s of echo spacing stay apart. Voxel sizes compare at 0.01 mm: reconstructed sizes wobble in the third decimal within one protocol (1.2994 to 1.3006 mm in ds000114).
- Truncation compares a run with its own acquisition group, so a variant with fewer volumes by design is not flagged.
- `NO_FIELDMAP` is one finding per subject-session. A dataset with no field maps gets a single `NO_FIELDMAPS_IN_DATASET` note instead.
- Events follow the inheritance principle: `has_events`, the scan's checks and `get_bids_run_detail` all use the nearest table whose entities the run carries, so a root `task-x_events.tsv` serves every run of task x. Tables are not merged. `events.json` resolves against the run's own name.
- A participant with no images here is `no_local_data` in `derivative_status`, whatever a pipeline's group table lists, and is left out of subject-level coverage (`runs` and `of`). They are one `PARTICIPANTS_WITHOUT_DATA` note, which replaces the validator's `subject_directory` and `participant_directory_missing` errors for them.
- `FMAP_GRID_MISMATCH` applies to EPI field maps only. A phasediff has its own grid and is resampled to the run.
- Events may run past the scan end by up to one TR before `EVENTS_AFTER_SCAN` fires. `EVENTS_RT_MISSING` is a note above 20% missing.

### Harness

`createBidsBrowserDataset()` in `ui2/src/devHarness/app/bidsBrowserData.ts` ports the mock generator, re-exported from `scenarioData.ts`. Root: `/harness/wm-reward`.

Streaming: add `?bidsStream=<ms>` for one subject per interval, or `?bidsStream=hold-<n>` to deliver n subjects and wait for `cancel_bids_scan`. `safeListen` routes to `window.__harnessEvents` when the harness has installed it, so the store uses `safeListen` unchanged. Without the flag a scan returns at once and no events fire.

### Changes made while building steps 4 and 5

| Item | As built |
| --- | --- |
| Status bar | Two slots of its own, `workspaceStatus` and `workspaceStatusRight`, replace the imaging readouts while present, so nothing needs saving or restoring and the crosshair Go To cannot fire. Validator and Brainflow check counts are shown apart (rule 7). |
| Key hints | A footer slot of `CenterWithBottomDock`, below the dock. The extra `R` shortcut is gone; ⌘K › Go to runs in lens reaches the dock. |
| Files tree | Subject, session, task or datatype, run. Branches opened only to reveal the selection close when it moves on. |
| ⌘K | Sections capped at six rows; every entry is ranked. Enter runs, Tab and click use `select` when an entry has one. |
| Exclude dialog | A criterion selector sits above the reason. The description preview is compact; the written file is pretty-printed. `Version` comes from the app and is omitted if the app cannot report it. |
| Events track | Bands appear on a single run's seconds axis only: a concatenated run group is another clock. |

## Commands

All in `core/api_bridge`, logic in a pure module `bids_index/` with unit tests on temp-dir fixtures.

| Command | Purpose |
| --- | --- |
| `scan_bids_browser(dataset_path, scan_id)` | Streams `bids-scan-progress` per subject, returns the final `BidsBrowserIndex`. Pausable via `cancel_bids_scan(scan_id)`. |
| `cancel_bids_scan(scan_id)` | Stops a scan and keeps partial results (`complete: false`). |
| `get_bids_run_detail(dataset_path, run_id)` | Lazy per-volume FD, events and derivative checks. |
| `get_bids_slice(request)` | Contact-sheet and inspector thumbnails, cached on disk. |
| `get_bids_median_slice(paths, request)` | Median of cached slices with modal grid, at most 15 runs. |
| `get_bids_carpet(path, width, height)` | Carpet PNG from a sampled in-brain voxel set. |
| `write_bids_exclusions(dataset_path, rows, context)` | Appends rows. The only writer; dataset root plus fixed relative names, no client path. Creates `exclusions.json` and `dataset_description.json` on first write. |
| `revert_bids_exclusions(dataset_path, keys)` | Removes rows by entity and criterion, in one rewrite, same guard. Returns the updated list. |
| `read_bids_exclusions(dataset_path)` | The rows on disk, before a scan finishes. |
| `get_bids_run_events(dataset_path, run_id)` | A run's events table, inherited or its own. |

## Build order

1. Backend: contract, `bids_index`, commands, bindings, permissions, harness mocks.
2. Store and model: `bidsStore` on generated types, generation counter, `bidsModel.ts`, lens, thresholds, tests (including the excluded-counts test the design requires).
3. Centre: summary, view bar and lens chip, coverage, legend, runs dock tab, key hints, shortcuts, scanning and compressed states.
4. Sides: Findings panel, Files reveal, Inspector, exclusions and undo, ⌘K, status bar.
5. Images view and open-in-viewer with events track.
6. Review, native check, harness baseline.
