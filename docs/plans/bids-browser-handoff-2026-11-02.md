# BIDS browser: handoff (2026-11-02)

## Native run report supplied by the user (2026-11-02)

The user reports that the native checklist items 1–5 and 7 passed on the
rebuilt app. Item 6 passed: switching datasets closes the Exclude dialog, so a
stale dialog cannot be submitted into another dataset (prevented by design).
The `[object Object]` fix was verified natively; the later doubled-period
wording tweak has only unit-test evidence. Live remote mount testing (item 8)
has not run and requires an SSH host with a BIDS dataset and key-based login.
Injected reorder failure and simultaneous writers remain local-test-only.

The native run also reported GPU slot exhaustion during run replacement, a
median sample that omitted the selected run, and stale undo, no-op row-count,
run-together caption and lingering status-error presentation issues. These are
addressed locally as described below. This report supersedes the older
blocked-native notes below.

## Post-run fixes (2026-11-02)

- When an upload has no free GPU slots, it can reclaim a non-displayed,
  prefetched 4D frame from a resident ring. Displayed frames stay resident;
  genuinely full active slots still produce a GPU error. Both the direct upload
  and render-time allocation paths are covered. Two regression tests passed
  on an actual local GPU adapter, plus a ring bookkeeping unit test. The app
  workflow has not been retested since this change.
- A median sample of at most 15 now includes the selected reference when it is
  eligible; excluded or non-modal references are not added to eligible runs.
  A synthetic grid regression and the 121-test BIDS Rust suite passed (three
  ignored).
- The undo notice expires without erasing undo history, stays visible while
  hovered or focused, and does not revive after leaving the workspace. A no-op
  says no rows were written. The contact-sheet caption now separates its
  sentences. A newer successful volume load resolves earlier load errors in the
  same view, including late failures, without clearing newer or unrelated
  errors. The focused UI suite passed 170 tests, with 75 affected tests rerun
  after the final notice change; the application TypeScript check passed.
  Targeted ESLint passed outside EventBus; EventBus has pre-existing lint
  errors for explicit any and empty object types.
- Native computer use is currently unavailable: `Sky Computer Use service
  startup request failed`. The original app bundle is running in another
  session and was left alone. The new debug bundle is
  `target/debug/bundle/macos/Brainflow BIDS QA.app`. It shares the original
  bundle identifier, so quit the old app before opening this one for checks.

### Native checks for the new fixes

1. With another 4D layer open, open a BIDS run, step its timepoint to populate
   the frame cache, and switch to another run. Repeat the switch and verify the
   selected run and the other layer still render without a slots-full error.
2. On the dataset and selected eligible run that reproduced the median failure,
   open Images / Mean EPI and inspect the selected-run median. Verify it draws
   and reports the number of runs and any grid skips.
3. Mount `/private/tmp/bids-gpu-followup/writable-fixture`, a synthetic local
   dataset not yet exercised in the app. Exclude its run, repeat the identical
   exclusion, and verify the second result says no rows were written. The
   earlier undo remains available through Cmd-Z; the notice expires after five
   seconds unless hovered or focused, and does not reappear after leaving and
   returning to the workspace.
4. Check the Mean EPI and b0 contact-sheet captions have separated sentences.
   In one viewer, attempt to open the synthetic invalid file
   `/private/tmp/bids-gpu-followup/invalid.nii`, then load a valid volume in the
   same viewer. After the success notice expires, the old load error must not
   reappear. Unrelated errors must remain available until dismissed.
5. Mount `/private/tmp/bids-gpu-followup/locked-fixture`, a synthetic local
   dataset containing a deliberate fake exclusion lock. Submit an exclusion
   there and wait about five seconds. The resulting error should end its retry
   sentence with one period before `Derivative metadata`; the earlier
   `[object Object]` fix was already verified by the user's run. The fixture
   and its artificial lock have not yet been exercised in the native app.
6. Live remote mount test 8 still needs an SSH host with a BIDS dataset and
   key-based access. Injected reorder failures and simultaneous writers remain
   local-test-only; dataset switching closes the Exclude dialog by design.

## Follow-up in progress (2026-11-02)

- PR #30 merged. This checkout is on `fix/bids-qc-followup`, based on
  `origin/main` at `7b1f52ed`; follow-up changes remain uncommitted.
- R1–R11 have regression-backed local fixes. Opening a run scopes its initial
  timepoint to that layer. Dataset-switch notices now cover direct scans. An
  existing exclusions lock is never broken automatically; after a crash,
  confirm no writer is active before manually removing the abandoned lock.
- The Images contact sheet is implemented locally, with one shared reference
  window and nearest world-z, mean EPI/T1w/b0/tSNR modes, sorting, and a
  matching-grid Inspector median. The latter is a thumbnail comparison, not
  evidence of anatomical registration. Exact-zero b-values are inherited for
  b0; ambiguous or invalid b-value files fail closed. Decode work is bounded.
- The Scene context menu now reflects visibility in the active view. Reopen
  mounts the selected directory in the Files store; a UI test covers that path.
  The BIDS visual baseline was refreshed and inspected after the redesign.
- Local checks: 120 BIDS Rust tests passed (3 ignored), the affected UI tests
  passed, the actual UI application TypeScript project and targeted ESLint
  passed, and a synthetic full-app browser check covered desktop and narrow
  Images views. These do not establish native, GPU, or live-server behavior.
- The earlier debug app at `target/debug/bundle/macos/Brainflow.app` was
  tested natively as reported above. Computer use is currently unavailable for
  retesting the later fixes. This agent did not change or hash a Passport
  dataset during the follow-up. Live remote mount verification remains open. The user asked to
  ignore untraceable viewer-polish items 17, 18, 20 and 25 and to defer scale
  polish.
- `bbuchsbaum/bids-rs#1` is closed as completed after verifying the pinned
  `c7021c5` source. Retired-v1 and stray-binding deletions remain for the user,
  as this handoff forbids agent deletion. Shared target-directory setup was not
  requested.
- Main moved to `df543107` while this follow-up was in progress; this dirty
  branch is still based on `7b1f52ed`. At that base, Brainflow CI passed and
  Quality Gates failed in Rust Security Audit and Dependency Check: the audit
  reported 40 vulnerabilities and 43 allowed warnings. At the newer main
  revision Brainflow CI passed and Quality Gates was still in progress when
  checked. Main's newer commit changes the lockfile, dependency pins, audit
  configuration and API bridge, so reconcile that separate security work
  before attempting dependency upgrades here. The separate security workflow
  had failed Rust audit, license, secret-scan and frontend-audit steps at
  `7453e121`; these project-wide failures were not changed by this follow-up.

The remaining sections record the original handoff; the progress above
supersedes its status for the findings listed there.

### Manual cleanup prepared for the user

The retired component imports are confined to the retired files and their
listed tests; `bids_coverage.rs` has no module or command registration. Keep
`BidsCoverage.tsx`, `BidsEventsTimeline.tsx`, and the generated coverage types:
they are still used. From this checkout, the exact files described by items
13 and 14 can be removed by the user with:

```sh
rm -- core/api_bridge/src/bids_coverage.rs \
  ui2/src/components/bids/BidsCoverageMatrix.tsx \
  ui2/src/components/bids/BidsDetailTabs.tsx \
  ui2/src/components/bids/BidsSummaryStrip.tsx \
  ui2/src/components/bids/BidsValidationPanel.tsx \
  ui2/src/components/bids/__tests__/BidsCoverageMatrix.test.tsx \
  ui2/src/components/bids/__tests__/BidsValidationPanel.test.tsx \
  core/api_bridge/bindings/AtlasRoiLocation.ts \
  core/api_bridge/bindings/ModuleDescriptor.ts \
  core/api_bridge/bindings/ModuleInfo.ts \
  core/api_bridge/bindings/ModuleStage.ts \
  core/api_bridge/bindings/ParcelColumnInfo.ts \
  core/api_bridge/bindings/ParcelOverlayInfo.ts \
  core/api_bridge/bindings/ParcelTablePreview.ts \
  core/api_bridge/bindings/ParcelTableRequest.ts \
  core/api_bridge/bindings/SurfaceParcelTable.ts \
  core/bridge_types/bindings/NiftiStorageInfo.ts
```

The BIDS browser is built and merged (PR #24, merge commit `2428c14a`). This
note lists what is still open. The design is
[bids-browser-design.md](bids-browser-design.md) and the build plan is
[bids-browser-implementation.md](bids-browser-implementation.md).

## Before you start

- **Checkout:** `/Users/bbuchsbaum/code/brainflow2-bids`. The user objects to
  git worktrees: branch in this checkout from `origin/main`.
- **Open PR:** #30 (`fix/remote-scan-entry-names`) adds
  `is_single_remote_name` in `core/api_bridge/src/lib.rs`, which skips
  server-supplied remote entry names that would leave their directory. Check
  whether it has merged before you branch.
- **Real data:** BIDS datasets live on the WD Passport under
  `/Volumes/My Passport for Mac/data/brainflow-bids/` (ds000114, ds001734),
  downloaded by `tools/fetch_bids_fixtures.py`. Never put real data on the
  system disk; add any new dataset to that script.
- **Toolchain:** `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm`; the UI
  package is `temp-ui`; run vitest with
  `NODE_OPTIONS=--no-experimental-webstorage`. Vitest can print all passes and
  still exit 1 on unhandled errors, so check the exit code. Rust BIDS tests:
  `cargo test -p api-bridge bids`.
- **Native checks:** build a debug `.app` bundle and register it, because
  computer use cannot attach to `cargo tauri dev`.
- **Permissions:** `rm` and `kill` are denied to agents. Ask the user to run
  them (`! <command>`).
- Commit, push and open PRs only when the user asks.

## Open work

### Unbuilt parts of the design

1. **Images contact sheet.** The design's "Images (contact sheet)" section
   (`bids-browser-design.md`, around line 106). This is the largest remaining
   piece.
2. **Scale polish.** Tuning for large datasets was deferred. No written spec
   exists beyond the design doc, so agree on its scope with the user first.
3. **Round 3 implementation notes** (`bids-browser-design.md`, "Implementation
   notes from round 3"):
   - scroll containers must not show half rows at the bottom: snap to whole
     rows or fade;
   - wrap the TSV and JSON previews in the Exclude dialog;
   - make variant outlines one step lighter than in round 3;
   - use one family (sans or mono) for count labels in panel headers;
   - export a saved lens as a participant/run list (TSV or a BIDS filter
     file) for fMRIPrep and FitLins.
4. **"Notes items 17, 18, 20 and 25" (viewer polish).** Earlier summaries list
   this, but its source could not be traced: the numbers appear in neither
   plan doc nor the session's scratch files. Ask the user which list it refers
   to before doing anything.

### Testing never done

5. **Remote datasets on a live server.** Not tested against a real remote
   mount. Remote runs show "not available" for motion and events, because
   those are not fetched remotely yet.
6. **The merged build in the native app.** All native checks ran before the
   final merge from main. Rerun exclude, undo, re-exclude and revert on
   ds000114, and confirm the raw `.tsv`/`.json` files are byte-identical before
   and after (hash them).
7. **Two fixes from the last round have never run natively:**
   - a passed-over load no longer blanks the viewer when a later load fails
     (`ui2/src/services/bids/openRunInViewer.ts`);
   - a stale Exclude dialog can no longer write into a different dataset
     (`bidsStore.ts` `writeExclusions`, `BidsExcludeDialog.tsx`).
   Leaving the run tab during a load was tried once, on a fast load only. That
   fix round also had no fresh-context review.
8. **`bids` visual baseline.** Not regenerated since the redesign. Regenerate
   it only after confirming that the current rendering is the intended one.

### Known rough edges

9. After Reopen, the Files panel says "No directory mounted".
10. In the run tab, user layers are hidden under native-space runs but stay
    listed under Scene.
11. Cold-loading a 629 MB run takes about 30 s, and first-view thumbnails take
    about a minute.

### Docs

12. The Status section of `bids-browser-design.md` still says "Agreed design,
    not yet built". Update it to describe what shipped and what remains.

### Housekeeping (the user must run the file deletions)

13. Delete the retired v1 components and their tests:
    `core/api_bridge/src/bids_coverage.rs`, `BidsCoverageMatrix`,
    `BidsDetailTabs`, `BidsSummaryStrip`, `BidsValidationPanel` (under
    `ui2/src/components/bids/`). Keep `BidsEventsTimeline`, and keep
    `BidsCoverage.tsx`: it is the new design's view, used by
    `BidsExplorerWorkspace.tsx`, not the retired `BidsCoverageMatrix`. Check
    for remaining imports and command registrations first.
14. Delete the stray untracked generated bindings in `core/*/bindings`
    (`AtlasRoiLocation`, `Module*`, `Parcel*`, `SurfaceParcelTable`,
    `NiftiStorageInfo`). They are not part of any change.
15. Done: the old vite dev server (PID 53251) was stopped on 2026-11-02.
16. Close `bbuchsbaum/bids-rs#1`. Its content is covered by bids-rs `c7021c5`,
    which brainflow2 pins.
17. Optional: share one `CARGO_TARGET_DIR` across checkouts to save disk.

### Project-wide (not BIDS-specific)

18. CI on main is broadly red independently of the BIDS work:
    - `build-and-test` fails on ubuntu and windows; the cause was not
      investigated;
    - `.github/workflows/security.yml` has failed on main since at least May;
    - `cargo audit` reports 39 advisories, all on crate versions that predate
      the BIDS PR. The `russh` and `rustls` advisories matter for remote
      mounts.
    Related upstream: `bbuchsbaum/remotely#8` asks `read_dir` to reject entry
    names that are not a single path component.

## Unfixed review findings (R1–R11)

A fresh-context review of `feat/bids-browser` at `52d1d0a2` found 3 important
issues, fixed before the merge, and these 11 minor ones, which are not fixed.
Line numbers refer to that commit and may have moved. "Confirmed" means the
reviewer traced the path in the code; none of these was reproduced in the
native app. Write a failing test for each before fixing it.

**Opening a run in the viewer** (`ui2/src/services/bids/openRunInViewer.ts`)

- **R1. The previous run leaks if reordering fails** (`:318-320`). If
  `showAlone` throws, `release(previous)` is skipped after `shown` has moved
  on, so that volume stays loaded for the session. Fix with try/finally.
  Confirmed, but whether `reorderLayers` can actually throw was not checked.
- **R2. Hidden copies of a run are removed** (`:93-98`). `release` only counts
  views where the layer is visible, but `removeViewLayer`
  (`LayerApiImpl.ts:252`) strips the layer from every view. If the user copies
  the run tab and hides the layer there, the next open removes it from that
  tab. Confirmed.
- **R3. Reopening a hidden run shows nothing** (`:284`). Reopening the run
  already in the tab does not make it visible again if the user hid it.
  Confirmed.
- **R4. Landing moves every 4D layer in every tab** (`land` at `:261`,
  `TimeNavigationService.ts:166-178`). Opening a run jumps to its peak-motion
  frame. That changes `layer.currentTimepoint` and the backend frame for every
  4D layer, while other tabs' `view.timepoint` does not change, so their
  status bar and Inspector disagree with their slider. Confirmed in the
  stores; the effect on rendering was not traced.

**Exclusion writer and dialog**

- **R5. Re-excluding with a new reason fails silently**
  (`core/api_bridge/src/bids_index/exclusions.rs:411-420`,
  `ui2/src/components/bids/BidsExcludeDialog.tsx:107`). Excluding again with
  the same entity and `manual` criterion but a new reason writes nothing, and
  the dialog closes as if it had saved. Confirmed.
- **R6. Hand edits to `exclusions.json` are lost** (`exclusions.rs:422`). The
  sidecar is rewritten on every write, even a no-op. Confirmed.
- **R7. Failure messages overstate what was left untouched**
  (`exclusions.rs:99,399,422-430`, `BidsExcludeDialog.tsx:202`). "Nothing was
  changed" and "Nothing was written" are not always true:
  `derivatives/brainflow/` is created before the lock is taken, and the JSON
  metadata is written before the TSV. Raw data is never touched. Confirmed.
- **R8. Lock staleness uses the local clock** (`exclusions.rs:51-57`). It
  compares local time with the lock file's mtime. On a shared drive whose
  clock lags by more than 60 s, a live lock can look stale, and two writers
  can lose rows. Suspected only.

**tSNR**

- **R9. The Findings denominator is misleading**
  (`ui2/src/stores/bidsModel.ts:1269`). `withTsnr` counts runs from groups
  smaller than 8 that were never evaluated, so "1 of 40" can mean only 8 were
  tested. Groups too small to test also produce no finding, which reads the
  same as passing. Confirmed. This is probably the most consequential of the
  11 for QC.

**Switching datasets**

- **R10. `selection` is not reset on a switch**
  (`ui2/src/stores/bidsStore.ts:338-356`, read at `BidsView.tsx:111`). A
  subject selected in dataset A stays selected in B if B has the same id. The
  missing reset is confirmed; the visible effect is suspected.
- **R11. Direct scans skip the switch notice** (`FileTreeRow.tsx:309`,
  `BidsView.tsx:270,277`). These scans bypass `switchToDataset`, so undo
  history and thresholds are dropped without the "undo no longer applies"
  message. Confirmed.

## Suggested order

1. Item 6: native retest of the merged build.
2. R9, R5 and R6: they give wrong or lost QC information.
3. R2 and R3: small viewer fixes.
4. Item 3 (round 3 notes: small and well specified), then item 1 (contact
   sheet).

Ask the user about item 4 at the start. R8 only matters on shared drives.
