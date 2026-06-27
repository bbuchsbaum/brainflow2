# Correctness & Safety-Net Audit Remediation — 2026-06-27

Source: multi-agent audit (5 lanes) of `feat/plot-grammar-sample-frame`. Findings memo in
memory `audit-2026-06-correctness-and-safety-net`. Tracked in mote under umbrella
`bd-01KW56KJ5N97QEKSAVQ00XVECN` (tag `audit-2026-06`).

## Diagnosis

Two intertwined clusters. **(A)** The automated safety net is comprehensively down — CI
frontend gates target the dead `ui` app (shipping app is `ui2`, pkg `temp-ui`); no CI job
runs the production build; the Rust workspace has been red ~10 months (3 `neuro-types`
coordinate tests, clippy won't compile clean); ~20 `render_loop` integration tests are
`#[ignore]`d; the CPU↔GPU differential harness is disabled; 2 ui2 vitest suites crash at
import. **(B)** A cluster of confirmed silent scientific-correctness bugs in the
volume→pixel and volume→surface sampling paths — which exist *because* (A) removed the net.

## Execute now (items 1–6, tag `audit-exec`)

| # | Bead | What | Files | Acceptance |
|---|------|------|-------|-----------|
| 1 | bd-01KW56MV4DH2GJT482YRSB8JGQ | Mosaic colormap: send name, drop numeric id map | `ui2/src/services/mosaic/BatchRenderService.ts` | mosaic colormap matches single-slice for all builtins |
| 2 | bd-01KW56MV7D35E716THYWZQ5JJJ | File-browser atlas: integer/label detection → label mode + nearest | `ui2/src/services/VolumeLoadingService.ts`, `LayerApiImpl.ts` | integer atlas via file browser renders discrete |
| 3 | bd-01KW56MV9J3WXE7DVM7ZFQ2XDA | GPU half-voxel `+0.5` + CPU/GPU golden test | `core/render_loop/shaders/slice_world_space_masked.wgsl`, `…_optimized_masked.wgsl` | GPU sample == CPU at integer voxel |
| 4 | bd-01KW56MVBGQPQ7C84C08RKARM3 | Projection `fill=NaN`, exclude from coverage | `core/api_bridge/src/lib.rs`, `VolumeSurfaceProjectionService.ts` | out-of-coverage vertices transparent, uncounted |
| 5 | bd-01KW56MVDFGY4WHE7XHMWTY6W9 | `surf_to_world` on GPU geometry + hemisphere from metadata (cross-repo: neurosurf-rs) | `core/api_bridge/src/lib.rs`, `/Users/bbuchsbaum/code/rust/neurosurf-rs` | transformed surface CPU==GPU; hemisphere correct |
| 6 | bd-01KW56MVFC6X6KETXV5DWN73H9 | Repoint CI to ui2 + gate prod build; revive differential harness | `.github/workflows/*`, `core/neuro-integration-tests` | CI builds/typechecks ui2; harness runs |

## Backlog (tag `audit-backlog`)

Intensity windowing (20–80% raw range; is_binary_like→[0,1]; NaN/Inf 3D range), oblique
affine→diagonal in CPU projection, overlay hemisphere/space guard, export_types bin
collision, ts-rs `skip_serializing_if` drop, GPU device-loss recovery, api_bridge panic
triage, clippy-clean, 2 dark vitest suites, stale e2e. See `mote ls --tag audit-backlog`.

## Method

Execute on `feat/plot-grammar-sample-frame` (carries the `tsc -b` fixes needed for clean ui2
verification). One bead at a time: `mote begin` → change → build/test → commit → `mote done`.
Items 5 (cross-repo) and 6 (harness revival) may exceed one session; do the tractable,
verified portion and note the remainder on the bead.
