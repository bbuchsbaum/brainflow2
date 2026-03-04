# Analysis Bundle Architecture (Ideation Draft)

_Last updated: 2025-11-19_

## Goals
- Support modular analysis “apps” that run within (or adjacent to) Brainflow.
- Capture analysis specs, parameters, provenance, and outputs in a reusable format.
- Feed resulting artifacts (volumes, surfaces, tables, auxiliary data) back into the existing Brainflow visualization pathways with zero bespoke wiring.

## Key Concepts

### 1. Analysis Spec
A lightweight structured document (JSON / YAML / TOML) describing:
- **Inputs**: references to volumes, surfaces, tables, ROIs, etc.
- **Parameters**: typed fields (numbers, enums, strings) with UI hints (slider, dropdown, wizard step).
- **Execution metadata**: module name/version, default runtime, optional resource requirements.
- **Expected outputs**: declared artifacts with identifiers (`contrast_map`, `cluster_table`, …) and types (`volume`, `surface`, `table`, `plot`, `json`).

This spec drives UI wizard generation and lives on disk so jobs are reproducible and shareable.

### 2. Result Bundle
Each analysis run writes a self-contained bundle (think folder/zip) with:
```
analysis_name/
  metadata.json          # job spec hash, runtime info, provenance
  artifacts/
    volumes/
      contrast_map.nii.gz
      beta_series.nii.gz
    surfaces/
      cortex_activation.gii
    tables/
      clusters.tsv
    aux/
      design_matrix.png
  manifest.json          # canonical list of artifacts + display defaults
```

`manifest.json` entries include:
- `id`, `type`, `path`
- Visualization hints (default colormap, threshold, smoothing, preferred slice orientation, etc.)
- Provenance (input IDs, parameter snapshot, module version)

### 3. Analysis Explorer UI
- Reads bundles from a project directory.
- Displays job history + artifact list.
- Loading a bundle artifact simply calls existing loaders (volumes/surfaces/tables) using the manifest info.
- Tables feed into future reporting widgets; volumes/surfaces go straight into LayerService.

### 4. Execution Runtime
- Modules register a manifest (inputs/params/outputs) so the app can render wizards automatically.
- Runs can happen inside Tauri (Rust) or delegated to an external worker; as long as the bundle schema is honored, results plug back in.
- Background job controller tracks progress and emits status events (already compatible with `StatusBarProgress`).

## Advantages
- **Modularity**: New analyses only need to define specs + bundle writers; the core app stays untouched.
- **Reproducibility**: Specs + manifests double as provenance records.
- **Interoperability**: External pipelines can emit bundles to integrate with Brainflow’s visualizers.
- **Extensibility**: Future features (sharing, cloud execution) just pass around bundles.

## Next Steps
1. Draft the spec/manifest schema (likely JSON Schema + TypeScript types via `ts-rs`).
2. Define a bundle storage location and file format (plain folder vs. zipped `.brainflow-analysis` archive).
3. Prototype a simple module (e.g., GLM contrast) that emits a bundle and ensure the UI can load its volumes/tables.
4. Add an “Analysis Explorer” panel that lists bundles and lets users load artifacts into the workspace.

_Open questions_: authentication/permissions for external runtimes, versioning of modules, caching strategy for large bundles, and wiring tables/plots into the UI.
