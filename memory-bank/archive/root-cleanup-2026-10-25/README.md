# Root cleanup archive — 2026-10-25

These are unchanged historical sources, not current instructions or evidence of
implemented features. Useful content has been extracted into maintained notes.
The [manifest](manifest.json) records original paths, destinations, byte counts
and SHA-256 hashes; it also records the local scratch archive and two deletions.
This pass reduced root files from **38 to 14**. All 22 relocated files and the
retained duplicate fixture were hash-verified. New summary links/anchors, the
generator's Python syntax and the updated setup script's shell syntax were
checked; no application tests or fixture generation were needed for these moves.

| Historical source | Where to read now |
| --- | --- |
| [Group map ideas](GROUP_MAP_DISPLAY_IDEAS.md) | [Population plan: retained display ideas](../../../docs/plans/neurotabs-population-exploration.md#display-ideas-retained-from-the-root-notes) |
| [Vision](VISION.md), [surface parity](SURFACE_PARITY_PLAN.md) | [Compact product ideas](../../../docs/vision.md) |
| [Redesign notes](redesign_notes.md), [plan](redesign_plan.md), [progress](redesign_progress.md) | [Retained design intent](../../../docs/vision.md#interface-design-intent); [current redesign plan](../../../docs/plans/ui-redesign-2026-10.md) |
| [IPC guide](BINARY_IPC_TEST_GUIDE.md), [verification checklist](VERIFY_BINARY_IPC.md) | [Render transport validation](../../../docs/render-transport-validation.md); old timing estimates are not benchmark evidence |
| [Editor scratch index](phase1-document-index.md) | Historical index of [Phase 1 documents](../phase1-planning/); no unique feature proposal was found |

## Retired scripts

`legacy-scripts/` preserves `build-all.sh`, `launch-dev.sh`,
`pre-launch-check.sh`, `start-tauri.sh`, `run_mni_test.sh` and `test-tauri-api.sh`.
Do not run these as current tooling: they contain obsolete UI paths, machine-local
paths, manual compiler linking, destructive build cleanup or broad process-kill
commands. Use the root [development commands](../../../README.md#development-commands),
`Makefile`, `tools/` and the relevant Cargo test target instead. No script was
executed as part of archiving.

The useful fixture generator moved to `tools/create_toy_nifti.py`; run it from
the repository root. Its code and output path are unchanged.

## Local artifacts and deletions

Old `dev_log.txt`, `tauri_dev_log.txt`, `tmp_unreachable_inventory.json`,
`compare-live.png`, `mockup7-live-1600x1000.png` and `mockup7-live-snapshot.md`
were moved intact to **`cruft/root-cleanup-2026-10-25/`**. That directory is
ignored and local to this checkout; it will not travel with Git. The manifest
allows verification and restoration to the original paths. Existing Git history
also retains the previously tracked logs and inventory. No active file handles
were reported for these artifacts before relocation.

The root `global_mask2.nii` was deleted only after verifying byte equality with
the retained `test-data/unit/global_mask2.nii`; restore a root copy from that
fixture if needed. `.DS_Store` was deleted as regenerable Finder metadata.

## What remains at the root

Root files are repository entry points and tool-discovered configuration:
README/agent guides, Cargo and pnpm manifests/locks, Makefile, dependency policy
and dotfiles. Keep new product ideas in the linked plans, developer scripts in
`tools/`, fixtures in `test-data/`, and local captures/logs in ignored `cruft/`.
Directory-wide build/cache cleanup is outside this pass; unrelated worktree
changes were preserved.
