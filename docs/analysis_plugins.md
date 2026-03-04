# Analysis Plugins (Host Infrastructure)

This document describes the lightweight analysis plugin system scaffolded in Brainflow2.
It is intended as a stable I/O boundary so we can grow a full workbench later without
entangling analysis logic with visualization/rendering.

See `docs/analysis_bundle_architecture.md` for the longer‑term “analysis bundle” vision.

## Contract Types

Shared, versioned types live in `core/bridge_types/src/lib.rs`:

- `AnalysisDescriptor`: declarative description for UI forms + validation.
- `AnalysisInputKind` / `AnalysisInput`: accepted input kinds and concrete inputs.
- `AnalysisArtifactKind` / `AnalysisArtifact`: declared and concrete outputs.
- `AnalysisStartRequest`: payload to start a job.
- `AnalysisJobState` / `AnalysisJobStatus`: lifecycle snapshots for polling/status panels.
- `AnalysisRunnerKind`: `builtin` vs `sidecar`.

These types are exported to TypeScript via `ts-rs` (run `cargo xtask ts-bindings` to regenerate).

## Discovery

The host scans for sidecar analyses at startup:

1. App‑bundled plugins under `plugins/analyses/*`
2. User plugins under the platform data dir:
   - macOS/Linux: `~/.local/share/brainflow/plugins/analyses/*`
   - Windows: `%APPDATA%\\brainflow\\plugins\\analyses\\*`

Each plugin folder should include an `analysis.json` manifest.

## Manifest (`analysis.json`)

Minimal schema (unknown/additive fields allowed):

```json
{
  "id": "roi-stats",
  "name": "ROI Statistics",
  "version": "0.1.0",
  "api_version": "0.1",
  "description": "Compute summary stats in an ROI",
  "inputs": ["volume", "roi"],
  "params_schema": {
    "type": "object",
    "properties": {
      "radius_mm": { "type": "number", "default": 5.0, "minimum": 0.5, "maximum": 50 }
    },
    "required": ["radius_mm"]
  },
  "outputs": ["table"],
  "runner": {
    "type": "sidecar",
    "command": "bin/roi_stats.py",
    "args": [],
    "env": {},
    "timeout_sec": 120
  }
}
```

Notes:
- `command` may be absolute or relative to the plugin folder.
- `params_schema` is JSON‑Schema‑ish; UI hints can be added under custom keys.
- `runner.type = "builtin"` is reserved for future in‑process analyses.

## Sidecar CLI‑JSON Protocol

Sidecars are invoked as external executables. The host writes one JSON request to stdin,
then closes stdin. Sidecars stream newline‑delimited JSON (NDJSON) events to stdout.

### Run request (stdin)

```json
{
  "api_version": "0.1",
  "job_id": "uuid",
  "inputs": [
    { "kind": "volume", "handle": "vol_123", "path": "/host/inputs/vol_123.nii.gz" }
  ],
  "params": { "radius_mm": 5.0 },
  "output_dir": "/host/jobs/uuid/out",
  "temp_dir": "/host/jobs/uuid/tmp"
}
```

The host owns `output_dir`/`temp_dir`; sidecars should only write within them.

### Events (stdout NDJSON)

Supported event shapes:

```json
{ "type": "progress", "job_id": "uuid", "pct": 0.4, "message": "Running..." }
{ "type": "log", "job_id": "uuid", "level": "info", "message": "Loaded volume" }
{ "type": "artifact", "job_id": "uuid", "artifact": { "kind": "table", "path": "stats.csv" } }
{ "type": "result", "job_id": "uuid", "artifacts": [ { "kind": "volume", "path": "out.nii.gz" } ] }
{ "type": "error", "job_id": "uuid", "message": "Something went wrong" }
```

The host currently **polls** job status via `get_analysis_job_status`; event forwarding
to the UI is a future extension.

### Exit codes
- Exit `0` ⇒ success; any `result` artifacts are registered by the host.
- Non‑zero ⇒ failure; host records stderr text in `AnalysisJobStatus.error`.

## Tauri Commands

Exposed by the `api_bridge` plugin:

- `list_analyses() -> AnalysisDescriptor[]`
- `start_analysis(request: AnalysisStartRequest) -> string` (job id)
- `cancel_analysis(job_id: string) -> boolean`
- `get_analysis_job_status(job_id: string) -> AnalysisJobStatus | null`

These are minimal by design; future work can add richer provenance, bundle handling,
and push‑style progress events.

