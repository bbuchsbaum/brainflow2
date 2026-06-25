# Brainflow Test Scenarios

Real end-to-end **use-case stress tests** exercised against the *running* desktop app
(driven via the computer-use MCP, with screenshots at each step). Their job is to surface
bugs, pain points, and **missing capabilities** that unit/integration tests don't catch —
the gap between "the code compiles and the unit tests pass" and "a neuroscientist can
actually do the thing."

Each scenario file captures:

- **Goal / user story** — the real outcome a user is after.
- **Preconditions** — what must be loaded/configured first.
- **Steps** — the exact path (menu items, clicks, drags) to reproduce.
- **Expected behavior / acceptance** — what "working" looks like.
- **Findings** — dated runs: bugs, pain points, and missing features, each with a severity
  and (where known) code references and a fix status.

## Running a scenario (computer-use)

`cargo tauri dev` is **not** attachable by computer-use (bare binary, no bundle identity).
Build and register a debug `.app` instead:

```bash
# Build a debug .app (skip `tsc -b`; the working tree often has pre-existing tsc errors).
cargo tauri build --debug --bundles app \
  -c '{"build":{"beforeBuildCommand":"cd /Users/bbuchsbaum/code/brainflow2/ui2 && npx vite build"}}'

LSREG=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister
"$LSREG" -f "$PWD/target/debug/bundle/macos/Brainflow.app"
open "$PWD/target/debug/bundle/macos/Brainflow.app"
```

Then `request_access` for bundle id `com.brainflow.dev` (full tier), `open_application`,
and drive with screenshots. The bundle embeds `ui2/dist`, so no dev server is needed.

## Severity

- **blocker** — the scenario's core promise cannot be fulfilled.
- **major** — works but with a serious defect or dead end.
- **minor** — friction, polish, or a non-blocking inconsistency.
- **needs-confirm** — observed once; may be a synthetic-input artifact, re-test with a real mouse.

## Index

| # | Scenario | Core premise | Status |
|---|----------|--------------|--------|
| [01](01-mni-integrated-linked-cursor.md) | MNI volume + surface in Integrated view, linked cursor | Clicking a voxel mirrors to the surface | Link was missing → **added + verified** (`feat/integrated-linked-cursor`); 2 minor findings logged |
