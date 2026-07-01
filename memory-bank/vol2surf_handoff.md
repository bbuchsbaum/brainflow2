# vol2surf + Integrated Workspace — Handoff

_Snapshot for a fresh session. Goal: let users with MNI-space activation maps view them on a
cortical surface, inside a combined surface+volume ("Integrated") workspace._

mote umbrella: `bd-01KVRDY3838EXS09D3CE4NNRHC` (`mote show <id>`, `mote ls --tag vol2surf`).

## Milestone status (5 closed + verified, 3 open)

| Bead | Milestone | Status | Notes |
|------|-----------|--------|-------|
| bd-01KVRDY3G3HP1J2EJCRBPV245S | M1 get_volume_for_projection command | **closed** | Was dead (stale perm stubs only); now a real registered serializable command + coord round-trip test |
| bd-01KVRDY3JES079KCRZ2Y010DHC | M2 Integrated workspace reachable | **closed** | flag default true + persist migrate; native View→Integrated menu; top-bar pill; 29 FE tests |
| bd-01KVRDY3MQFQFP30PVQ0X5VVC3 | M3 4D timepoint extraction | **closed** | routes through extract_3d_volume_at_timepoint; per-timepoint test |
| bd-01KVRDY3TZF8T80ZXQJF4027Q8 | M5 projection engine + sampler tier | **closed** | wraps neurosurf `vol_to_surf`/`surface_sampler`/`apply_surface_sampler`; e2e (1/112/223) + sampler lifecycle |
| bd-01KVRDY3XWFKGET11AKA2CFQ41 | M6 NIfTI space tagging | **closed** | `coordinate_space` in bindings; codes+filename heuristic (MNI fixture is coded (1,1), not 4!) |
| bd-01KVRDY3QPTG8R9F9ZBC7RWDGW | M4 "View on surface" entry point | **doing** | code+unit tests done; needs VISUAL app verification |
| bd-01KVRDY40XRARGXZ0X15SNH4W9 | M7 offline fsaverage assets | **open** | documented + offline error hardened; needs BUNDLE-vs-download decision + runtime check |
| bd-01KVRDY42V0A3TZEK009WX8Z6J | M8 auto-mount MNI template surface | **open** | resolution-order core + "MNI underlay" badge tested; async auto-mount wiring NOT written (deliberately, pending M4/M7); needs visual |

All five closed milestones are committed-ready and test-backed. M4/M8 logic is coded + unit-tested but their
acceptance is visual; M7's is a product decision.

## Key files touched

Backend (Rust):
- `core/api_bridge/src/lib.rs` — `get_volume_for_projection`(+_impl), `VolumeProjectionData`,
  `detect_coordinate_space`, `project_volume_to_surface`/`create_surface_sampler`/`apply_sampler`/`release_sampler`
  (+_impls), `BridgeState.surface_samplers`, `build_volume3d_from_projection`, hardened `load_surface_template` error.
- `core/api_bridge/build.rs`, `permissions/default.toml`, `src/bin/export_types.rs`.
- `core/bridge_types/src/lib.rs` (`NiftiHeaderInfo.coordinate_space`) + `src/bin/export_types.rs`.
- `core/loaders/nifti/src/lib.rs` (`read_xform_codes` + test). NOTE pre-existing unrelated failing test
  `test_load_nonexistent_file` (verified failing on HEAD).
- `core/api_bridge/tests/sampling_tests.rs`.

Frontend (ui2, package `temp-ui`):
- `src/stores/featureFlagStore.ts` (default true + `migrateFeatureFlags`).
- `src/services/transport.ts` (4 commands allowlisted).
- `src/components/ui/LayerTable.tsx` + `panels/VolumeLayerPanel.tsx` ("View on surface" action + handler).
- `src/components/views/surfaceProjectionResolution.ts` (NEW: `resolveSurfaceProjectionTarget`, `isMniSpace`,
  `isTemplateSurfacePath`).
- `src/components/views/surfaceAssociation.helpers.ts` + `SurfaceAssociationBadge.tsx` ("template-underlay" state).
- `src-tauri/src/main.rs` (Integrated View menu item id `workspace_integrated`).

Verify: `cargo test -p api-bridge`, `cargo test -p nifti-loader`,
`pnpm --filter temp-ui exec vitest run`, `cd ui2 && npx tsc --noEmit`.

## Screenshot diagnosis — what ails the Integrated workspace

User opened an MNI152 template, clicked "Integrated". Result was chaotic. Observed:

1. **Tab/workspace proliferation.** Center tab strip shows `ORTHOGONAL 2,3,4,5` + `INTEGRATED` — many view
   tabs spawned. Mode-switch/template-load should reconfigure ONE active tab in place (DisplayModeSelector's
   own comment says pills set the mode of the active tab), not mint new workspaces. Likely `createWorkspace`
   is being called where `setActiveWorkspaceMode` should be (cold-start / template-load path).
2. **Duplicate inspector (root architectural ail).** The Integrated workspace embeds its OWN
   `InspectorAnnotatePanel` (the `INSPECTOR | ANNOTATE | MNI152` column) AND the app-shell right rail
   `INSPECTOR` is open — both bound to the same MNI152 layer. Two editable homes for the same controls,
   violating Design.md "one editable home per control" + "Integrated as a display mode."
3. **Cramped composition / overflow.** Center column crams ortho + surface + an inspector; PLOT says "Panel
   too small for histogram"; LOG wraps near char-by-char ("Loaded template … 1626.00000000000018 ms"). The
   Integrated *workspace* is fighting the app shell rather than being a mode of the center column.
4. **Dead, dev-speak surface pane.** "SURFACE BUFFER EMPTY / AWAITING MESH DATA / DOUBLE-CLICK .GII ASSET" +
   "NO SURFACE / + LOAD SURFACE" is developer-facing and a dead end. For an MNI volume this is exactly where
   M8 auto-mount (or a clear "Use MNI template surface" CTA) belongs.
5. **The promise isn't realized.** MNI volume loaded, Integrated open, but no surface and no path to one →
   the core "see my MNI map on a surface" outcome never happens for the user.

## Fresh-take thesis

Per the repo's own `resdesign/Design.md` (three-column shell: 320px left rail | fluid center | 376px right
inspector; "Integrated as a display mode"; "one editable home per control"), **Integrated should be a display
mode of the center column** (ortho + surface side-by-side), reusing the SINGLE app-shell right inspector and
the SINGLE bottom dock — NOT a self-contained GoldenLayout workspace (`IntegratedVolumeSurfaceWorkspace`) that
re-embeds its own `InspectorAnnotatePanel` + `BottomWorkbenchDock`. The double-rendered shell is the root of
the clutter in the screenshot.

Suggested fresh-take ordering:
1. **Reconcile Integrated with the app shell** — one inspector, one dock; the Integrated tab owns only the
   center (ortho + surface). Kill the embedded second inspector.
2. **Fix tab proliferation** — mode switch + template load reconfigure the active tab; stop minting
   ORTHOGONAL N.
3. **Make the surface pane purposeful** — replace dev-speak with a real CTA: "Load surface" or, for MNI-space
   volumes (M6 `coordinate_space === "MNI"`), "Use MNI template surface" → wire M8 auto-mount (M5 backend +
   `load_surface_template` already exist; resolveSurfaceProjectionTarget is written).
4. **Then** the visual checks (M4) and the M7 bundling decision land naturally.

## Calm-shell convergence — Phase 1 + 2 DONE (2026-06-22/23)

Plan: `~/.claude/plans/elegant-tumbling-hopper.md` (approved). Goal: make Integrated match Design.md
(one shell, one inspector, one dock; Integrated = a center layout) — calm, not Frankenstein.

- **Phase 1 (done, verified): one inspector.** Removed the embedded `InspectorAnnotatePanel` pane
  from `IntegratedVolumeSurfaceWorkspace.tsx` (+ its import/constants). Integrated center is now
  Ortho | Surface (full width); the single shell `InspectorRouter` → `ImagingInspector` serves all
  modes. Parity confirmed: `ImagingInspector` (SceneStack + SectionRouter, selection-driven) is the
  richer/canonical inspector; both annotate bodies were stubs, so nothing real lost. IVSW test
  updated (asserts no `integrated-workspace-inspector-region`). 10/10 IVSW tests green.
- **Phase 2a (done, verified): single view tab.** `workspaceStore.createWorkspace` now treats the
  `visualization` family (orthogonal-*/mosaic/comparison/integrated) as a de-facto singleton —
  reconfigures + activates the one existing view tab instead of minting ORTHOGONAL 2/3/4/5. Exempts
  presets (`presetId`) and an explicit `forceNew` opt-out. New `workspaceStore.viewReuse.test.ts`
  (3/3); existing store/preset tests still green (125/126; 1 pre-existing skip).
- **Phase 2b (done, verified): calm surface empty state.** Replaced the dev-speak
  ("SURFACE BUFFER EMPTY / DOUBLE-CLICK .GII ASSET") in `SurfaceViewPanel.tsx` with a quiet
  "No surface loaded" + working **Load surface…** button (→ `SurfaceLoadingService`). tsc 0 errors.

Verification: full temp-ui suite 1125 pass / 3 skip; tsc 0. NOTE one PRE-EXISTING unrelated failure
`VolumeLoadingService.dedupe.test.ts` (fails at collection with `eventBus.on is not a function` even
in isolation; not in my change set).

### Codex council review (2026-06-23) + remediation

Adversarial review (workflow=review): **Phase 1 endorsed**; **Phase 2a (createWorkspace reuse guard)
rejected as too broad**; **Phase 2b had a new duplicate CTA**. Verified against code, then fixed:

- **REVERTED Phase 2a.** The `visualization`-singleton guard lived in generic `createWorkspace`, which
  also serves explicit-creation paths — confirmed: FileTreeRow "Open In New Tab"
  (`FileTreeRow.tsx:324` → `DisplayLifecycleOrchestrator.ts:202` `createWorkspace('orthogonal-locked')`
  w/o opt-out) and comparison-ensure (`DisplayLifecycleOrchestrator.ts:251`,
  `StudioDisplayService.ts:188` `createWorkspace('comparison')`). It also reused the FIRST view tab,
  not the active one. Removed the guard + `forceNew`; `viewReuse.test.ts` is now an `it.todo`
  documenting the proper approach (reuse on the MODE-SWITCH path only, active-tab target) — needs the
  app + a product decision on whether Comparison is a center mode or a separate destination.
- **FIXED Phase 2b duplication.** `SurfaceAssociationBadge` now returns null on `missing` and only
  speaks to a *loaded* surface's association; the `SurfaceViewPanel` empty-state owns the single
  "Load surface" CTA (it renders in Studio/GoldenLayout/IVSW; the badge is IVSW-only). Badge tests
  updated. Removed the badge's now-dead load handler/style/imports.

Council follow-ups still open: tab-proliferation redesign (above); delete/quarantine now-unused
`InspectorAnnotatePanel` + `LayerInspectorContent` (dead cluster after Phase 1; self-contained, only
their own tests import them).

Post-remediation verification: views 83/83, stores 122 pass/1 skip/1 todo, tsc 0.

**Phase 3 (remaining, app-paired):** add the "Use MNI template surface" CTA + wire M8 auto-mount
(needs `coordinate_space` from `get_nifti_header_info` + `load_surface_template`); wire the shell
InspectorRouter LoadSheet stubs; apply Design.md §2.3 spacing; visual acceptance against §20.
"View on surface" (M4) is already wired in `VolumeLayerPanel`. These need the running GPU app to
verify, so they're best done in an app-paired pass.

## Resuming the /goal loop

A `/goal` Stop hook is bound to the umbrella bead and will re-fire until it closes (needs the 3 external
items) — run `/goal clear` to end it before starting the fresh take. M4/M7/M8 remain open in mote with
progress notes capturing exactly what's left.
