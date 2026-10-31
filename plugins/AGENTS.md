<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10; corrected against the code 2026-10-31 -->

# plugins - Analysis sidecar plugins

## Purpose
Bundled analysis plugins. The only plugin mechanism Brainflow has today is the
analysis sidecar protocol in [docs/analysis_plugins.md](../docs/analysis_plugins.md):
the host discovers `analysis.json` manifests, runs the declared executable as a
child process, writes one JSON request to its stdin and reads NDJSON events from
its stdout.

Plugins cannot add panels, menus, tools or other UI, and they run outside the
app. There is no in-process JavaScript/WASM plugin runtime, iframe sandbox,
capability model or `window.brainflow` API. An earlier version of this file
described those; they were never implemented.

## Layout
| Path | Purpose |
|------|---------|
| `analyses/example/` | Runnable example: `analysis.json`, `bin/copy_volume.py`, `README.md` |

## How the host runs plugins
- **Discovery:** `AnalysisRegistry::load_default_locations` in
  `core/modules/analysis/src/lib.rs` (crate `bf_analysis`; the bridge adapter is
  `core/api_bridge/src/modules/analysis.rs`) scans `plugins/analyses/*` relative to the
  process working directory, then `plugins/analyses/*` under the local data dir
  from `directories::ProjectDirs::from("", "", "brainflow")` (for example
  `~/.local/share/brainflow/plugins/analyses` on Linux). Each plugin folder needs
  an `analysis.json`; a malformed manifest is logged and skipped.
- **Manifest:** deserialized by `AnalysisManifest` in the same file: `id`,
  `name`, `version`, optional `api_version` (defaults to `ANALYSIS_API_VERSION`),
  `description`, `inputs`, `outputs`, `params_schema` and `runner`. A sidecar
  runner is `{ "type": "sidecar", "command", "args", "env", "timeout_sec" }`.
- **Execution:** `command` resolves relative to the plugin folder and is spawned
  directly with the plugin folder as its working directory. No interpreter is
  added, so a script needs a shebang and the executable bit. Inputs arrive as
  file paths; the host owns `output_dir` and `temp_dir`.
- **Status:** the UI polls `get_analysis_job_status`; the other commands are
  `list_analyses`, `start_analysis` and `cancel_analysis`. There is no push
  event stream and no long-lived session.
- **Types:** `AnalysisDescriptor`, `AnalysisStartRequest`, `AnalysisJobStatus`
  and related types live in `core/bridge_types/src/lib.rs` and are exported to
  TypeScript with ts-rs.
- **UI:** the Analysis module (`ui2/src/modules/analysis/`; experimental, off
  by default, switched on in Settings › Modules).

## Adding a plugin
1. Create `plugins/analyses/<id>/` with an `analysis.json` and an executable.
2. Follow the request and event shapes in `docs/analysis_plugins.md`.
3. Check that the bundled example still loads and runs:
   `cargo test -p api_bridge bundled_example_sidecar`.

## Where this is going
Out-of-process plugins are **providers** in the module architecture
(`docs/plans/module-architecture.md`). Today's `analysis.json` sidecar becomes the
`job` runner, and a long-lived `session` runner is planned for interactive tools.
The unused `brainflow-plugin.json` schema, `tools/plugin-verify` and
`packages/plugin-sdk` were removed on 2026-10-31; a provider manifest schema
replaces them when the session runner lands.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
