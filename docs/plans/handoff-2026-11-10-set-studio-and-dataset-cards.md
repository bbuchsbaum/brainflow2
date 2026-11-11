# Handoff: Set studio feedback and dataset cards (2026-11-10)

Written for an agent starting with no context. Everything below is in the
working tree of branch `fix/set-studio-feedback` (branched from `main` at
`0f098bdd`). **Nothing is committed.** Two features share the tree.

Read `AGENTS.md` first. Working rules the owner has set: no git worktrees
(branch in this checkout, run agents one after another when they touch the
same files); delegate investigation and bulk work to subagents; verify with
real commands before claiming done; never weaken a test; independent review
in a fresh context for substantial work; commit only when asked.

## 1. State at a glance

| Piece | State | Evidence |
| --- | --- | --- |
| A. Set studio feedback (4 parts) | Code complete, reviewed once, review fixes applied | Unit and mocked-UI tests, in-process SFTP fixture. Not run natively. |
| B. Dataset cards: design | Approved by the owner | `docs/plans/dataset-cards-design/` |
| B. Dataset cards: backend | Done | Rust tests, clippy, fmt, permissions check |
| B. Dataset cards: UI | Built, **not reviewed, never seen rendered** | 75 new vitest tests, `tsc -b` clean |
| Review of the A fix wave, and of all of B | Not done | |
| Native check of anything | Not done | |

## 2. Feature A: Set studio feedback

Origin: the owner opened a 35-member image set from a remote SSH folder
(Trillium) and reported no loading feedback, no anatomical background, and a
cryptic Population message.

What was built:

1. **Loading feedback.** Folder review footer and button show busy copy; the
   Deck shows a compact card with the member's load stage and progress
   (`useStudioMemberLoad`, `StudioMemberLoadOverlay`) and a failure card with
   Retry; `StatusBarProgress` shows the task message.
2. **Population readiness.** `populationReadiness.ts` replaces the single
   opaque message with cause-specific wording. "Check image grids before
   opening" option in the folder review; in-place "Check image grids" action
   (`SetIngestionService.checkActiveSetGrids`, store `applySetAudit`,
   `PopulationIssueNotice`), run under a cancellation ticket.
3. **Background template.** Per-set "Background" select in the Set studio
   toolbar (`studioBackground.ts`, `StudioBackgroundControl`), honoured by
   Population and Compare through one resolver, and drawn in the Deck by an
   ordered render scope `[template, member]` (`RenderLayerScope`,
   `StudioDisplayService.syncBackground`).
4. **Remote header audit (Rust).** For a set on a remote mount every bound
   member's NIfTI header is read over SFTP (prefix read, no payload) and fed
   to the same grid audit as local folders. A remote set can now become
   compare-ready. `core/field_table/src/preview/{discovery,support}.rs`,
   `core/api_bridge/src/lib.rs` (`audit_remote_discovery_headers`),
   `remote_transfer::read_headers_owned`.

Changes made after the independent review (all applied):

- The grid signature now includes the voxel-to-world affine, compared with
  `nifti_loader::affines_match` (absolute 1e-5 on the 3×3 block, 1e-3 mm on
  the origin), the same function
  `population_slice.rs` uses. Table imports use it too.
- Local audits read headers only (previously decoded every volume). A file
  with a valid header and a truncated payload now passes the audit and fails
  at load, locally and remotely alike.
- Member opacity under a background is one rule for all members and is
  restored on "None" and on Studio exit.
- Latest-wins guard for rapid paging; a template open only in another view
  tab is loaded into the Studio's view; cancellable grid check; "Open set"
  reuses a just-finished header-checking preview.

Known limits, accepted or deferred by the owner:

- Preview tickets are capped at two minutes in
  `core/api_bridge/src/population_sampling.rs`. A header audit that needs
  longer is stopped with a "took longer than two minutes" message. **Owner's
  decision: leave it until it bites.** Lifting it means longer or renewable
  tickets in Rust.
- Voxel-size comparison is still exact f32 equality. Population also rejects
  sheared affines, which the audit does not check.
- Local `WalkDir` skips symlinked files and the remote lister includes them;
  the remote lister does not descend symlinked directories. Pre-existing.
- Unverified: whether a background template already open in another tab
  draws, or yields "This template could not be opened."

## 3. Feature B: dataset cards

Idea (owner's): folders on local disks and remote mounts often hold 10 to 12
analyses, each a BIDS-like tree, with optional `dataset_description.json`,
README and per-file `.json` sidecars. Show that metadata in the file browser.

### Design (approved)

`docs/plans/dataset-cards-design/` holds the four artboards as HTML
(`Main`, `DatasetCard`, `CollectionCard`, `SidecarCard`) and `canvas.json`.
Hex values in them are the live `--bf-*` token values; map them back to
tokens, never paste hex. The published canvas is private to the previous
account, so use these files.

Decisions the owner accepted:

- Structured fields, not arbitrary HTML. README rendered as safe Markdown.
- Hover shows only a short summary from the cheap marker probe; it must
  trigger no backend call. The full card opens on click or Space and stays
  pinned and scrollable.
- "What is in the folder" (counted) comes before provenance.
- "Open as set" is offered per analysis, not on a folder of analyses.

### Backend (done)

`core/api_bridge/src/dataset_card.rs` (+ `dataset_card_tests.rs`), types in
`core/bridge_types/src/dataset_card.rs`, generated TS in
`packages/api/src/generated/` (`Dataset*.ts`, `Sidecar*.ts`).

| Command | Args | Returns |
| --- | --- | --- |
| `probe_dataset_markers` | `{ paths, rootPath?, ticket? }` (at most 128 paths) | `DatasetMarker[]` |
| `get_dataset_card` | `{ path, rootPath?, refresh?, ticket? }` | `DatasetCard` |
| `get_sidecar_card` | `{ path, rootPath?, ticket? }` | `SidecarCard` |

- `rootPath` is the browse root; always pass it. `ticket` is the population
  `SampleTicket`, cancelled with `cancel_population_sample`.
- `contents.truncated` true means every count is a floor (walk caps: depth 8,
  1500 folders, 200,000 entries, 20 s; also linked folders, which are not
  followed, and analysis folders past the first 64).
- `imageKinds` are subject-normalized relative image paths with counts.
- `analyses` non-empty means the folder is a collection.
- `SidecarEntry.value` is compact JSON (strings keep their quotes).
- Error codes: 8232 mount not active, 8262 mount replaced mid-read, 8263
  could not read, 2026 cancelled (stay silent), 8260/8261 bad path, 8264
  more than 128 marker paths, 8265 sidecar path equals the browse root.
- Ticket expiry (120 s) returns 2026, like a user cancel.
- `probe_dataset_markers` answers every path. A path that fails 8260/8261,
  or is not reached within the batch's 4 s budget, gets an empty marker (or
  the last one known) that is not cached; 8232, 8262 and 8264 still fail the
  batch. On a remote mount a marker counts analyses only for a folder named
  `derivatives` or holding one; the card still finds them.
- Paths are taken as written (no trimming). A local folder is canonicalised
  and must stay inside the browse root (8261). Remote reads follow
  server-side links without containment (accepted).
- Caches live in `BridgeState.dataset_cards` (markers 10 s without I/O).
  Card staleness is keyed on the root listing only: a change deeper in the
  tree needs `refresh`. Answers with a read error, an unreadable folder or a
  time-budget truncation are returned but not cached.
- No wire field for a README or `derivatives/` that could not be read: the
  first is appended to `descriptionIssue`, the second to
  `contents.truncatedReason` (and the marker's `issue`).

### UI (built; unreviewed and never seen rendered)

All under `ui2/src/`:

- `stores/datasetCardStore.ts`: markers keyed by (rootPath, path) and the
  one pinned card.
- `services/DatasetCardService.ts`: marker batching (60 ms window, chunks of
  at most 128, 30 s client TTL, no ticket), ticketed card loads with
  latest-wins, back, refresh, retry, close, `openAsSet`, error mapping.
- `services/sampleTicket.ts`: mirrors the private
  `SetIngestionService.invokeWithTicket` protocol. Candidate for merging the
  two once both features are committed.
- `components/datasetCard/`: `DatasetCardHost.tsx` (non-modal Radix popover
  anchored to the file browser panel), `DatasetCardView.tsx`,
  `SidecarCardView.tsx`, `cardParts.tsx`, `datasetCardFormat.ts`,
  `safeMarkdown.ts` (parser) and `ReadmeText.tsx` (renderer).
- `components/panels/files/DatasetMarker.tsx` and `datasetMarkerModel.ts`;
  edits to `FileBrowserPanel.tsx`, `files/FileTreeRow.tsx`, `ImagesView.tsx`,
  `FilesFooterStatus.tsx`.

Choices made during the build that the owner has not seen:

- README uses a small in-repo safe-subset Markdown renderer, no new
  dependency. Raw HTML shows as typed text, images become `[Image: alt]`,
  links are `text (url)` and not clickable (the repo has no external-link
  opener). Pipe tables are shown preformatted. An extensionless `README` is
  treated as Markdown.
- The hover summary is a portaled `role="tooltip"`, not `ui/Tooltip.tsx`
  (which would be clipped by the virtualized rows). It shows title, path,
  "Generated by" and "Type" only.
- No sidecar icon on image rows (no room): "Show metadata" in the context
  menu, and Space.
- Opening a card moves focus into it, so arrow keys do not move through rows
  with the card following; Escape first.
- The BIDS view is untouched; markers are in the folder tree only.
- The collection card also shows Readme and Other fields; "People" shows
  more fields than the artboard when present; the card header has a refresh
  button.
- Level tags: solid "This file"; dashed "Folder", "Session", "Subject";
  dotted "Dataset".

Not verified, and the first things to check natively:

- Everything visual: layout, popover placement and flipping in a small
  window, focus ring, selected-row edge, fidelity to the artboards.
- That the capture-phase Space handler pre-empts react-arborist's own key
  handling. The panel tests use a stand-in for the tree.
- "Open as set" end to end into the folder review, and the remote error
  paths against a live mount.

One inert file to delete: `ui2/src/components/datasetCard/SafeMarkdown.tsx`
(an `export {}` stub left from a case-colliding rename the permission system
would not allow; nothing imports it).

## 4. How to verify

Toolchain quirks: use `corepack pnpm`; the UI package is `temp-ui`; vitest
on this machine needs `NODE_OPTIONS=--no-experimental-webstorage`.

```bash
# UI tests (2026-11-10, combined tree: 462 files, 3759 tests pass)
NODE_OPTIONS=--no-experimental-webstorage corepack pnpm --filter temp-ui exec vitest run src/components src/services src/stores src/hooks

# Type-check exactly as the production build does
(cd ui2 && corepack pnpm exec tsc -b)

# Rust
cargo test -p field_table -p nifti-loader -p bridge_types
cargo test -p api-bridge --lib -- remote_discovery dropping_a_remote_header population_slice remote_inventory dataset_card
cargo clippy -p field_table -p nifti-loader -p api-bridge -p bridge_types --all-targets
cargo fmt --all --check
corepack pnpm check:permissions:strict
```

- `tsc --noEmit -p .` misses errors that `tsc -b` catches. Use `tsc -b`.
- The vitest run reports 5 unhandled rejections from
  `SurfaceLoading.selection.test.ts`. That is upstream surface code, not this
  branch.
- **Do not run `cargo test -p api-bridge` unfiltered, and expect
  `cargo test -p bridge_types` to do the same:** the ts-rs export tests write
  binding files into the tree.
- The 24 "failed to parse serde attribute" lines from clippy are ts-rs build
  notes, present on `main`.

Native build (computer-use cannot attach to `cargo tauri dev`):

```bash
cargo tauri build --debug --bundles app
```

```bash
open -n target/debug/bundle/macos/Brainflow.app
```

Log: `~/Library/Logs/com.brainflow.dev/Brainflow.log`. Other Brainflow
instances may be running from other worktrees or sessions; do not kill them.

## 5. Before committing

Stray generated files to remove (cleanup was blocked by the permission
system in the previous session, so the owner or a session with permission
must do it):

- `core/api_bridge/bindings/Residency{DemandResult,DemandedLayer,FrameDemand,LayerReport,LayerState,Owner,Pin,Priority,Refusal,Report}.ts`
  (untracked) and `core/api_bridge/bindings/AtlasStats.ts` (restore to HEAD).
- `core/bridge_types/bindings/{BidsDirectoryProbe,BidsDirectoryStatus,NiftiStorageInfo,SshConfigHost}.ts`
  (untracked). The 17 new `Dataset*.ts` and `Sidecar*.ts` files in that
  folder are legitimate and belong to feature B.
- `ui2/src/components/datasetCard/SafeMarkdown.tsx` (inert stub, see
  section 3).

About 250 other dirty files predate this branch and are unrelated: generated
PNGs under `core/**/test_output` and `core/target`, `packages/legacy-ts/dist`,
`src-tauri/gen/schemas`, `docs/qa`, `e2e/*zz*`, `target-r3-wasm/`,
`core/api_bridge/src/rft.rs`, `core/render_loop/tests/zz_scratch_lut_bench.rs`,
and nine older untracked files in `core/api_bridge/bindings`. Leave them out.

Splitting into two commits (or two branches). Files touched by both features:
`core/api_bridge/src/lib.rs`, `core/api_bridge/src/remote_transfer.rs`,
`core/api_bridge/src/remote_transfer_tests.rs`,
`core/loaders/nifti/src/lib.rs` (A added the affine and header-only read; B
added `datatype`), and `docs/architecture-agent-reference.md`. Everything
else separates by path: studio files, `field_table` and `population_slice.rs`
belong to A; `dataset_card*`, `bridge_types`, `command_list.rs`, permissions,
`packages/api` and the `datasetCard` UI belong to B. Use `git add -p` on the
shared files.

## 6. Suggested order of work

1. Re-run the verification in section 4 to confirm the tree is as described
   (all of it passed on 2026-11-10).
2. Build the app and look at the dataset cards before anything else: the UI
   has never been seen rendered.
3. Independent review in a fresh context: all of feature B, plus the
   feature A review fixes (opacity, cross-tab template, cancellation,
   latest-wins, affine comparison, header-only local audit). Fix what it
   finds.
4. Build the app and ask the owner to try both features on the Trillium
   mount. Expect a round of fixes: nothing here has run against real data.
5. Visual pass on the dataset cards against the artboards.
6. Clean the stray files, split, and commit when the owner asks.

## 7. Context that is not in the code

- The owner's test data: `brad@trillium.alliancecan.ca:/scratch/brad/dsets`,
  set at `pcmri/derivatives/glm_recog` (35 subjects, maps such as
  `enc_rep/maps/same_item`). Connecting needs the owner (Duo).
- The discovery scan limit the owner first hit: "Maximum images" defaults to
  500 and depth to 4 (`ui2/src/stores/setStudio/importMachine.ts`); a remote
  scan stops at 8 x that many neuroimaging files or 32 x that many directory
  entries. Unchanged by this work.
- New UI in this repo follows: design on a canvas, build to functional
  checks, visual hill-climb, then owner acceptance.

## 8. Update, 2026-11-10 second session

Done from section 6: steps 1, 2 and 3, and a first pass at 5. Still nothing
committed.

- **Checks on the fixed tree:** 3,809 UI tests pass (one timing test,
  `useBidsPaletteCommands` "stays fast at 10,000 runs", failed once in the
  full run and passes alone; the file is untouched). `tsc -b`, the filtered
  Rust tests, clippy, fmt and the permissions check are clean.
- **Dataset cards seen natively** (debug `.app`, local fixture): markers,
  collection card, analysis card, README, sidecar inheritance and level
  tags, Space to open and close, Escape, "Details" and back, "Open as set"
  into the folder review. Not seen: hover placement, anything on a remote
  mount, a small window, the Files tab docked elsewhere.
- **Three independent reviews** (dataset-card backend, dataset-card UI, set
  studio fix wave) and their fixes are applied. Not fixed, by choice:
  - Space opens a card on every image row, sidecar or not (owner decision).
  - Escape with a card pinned and focus outside the card and the Files
    panel is left to its owner but arrives `defaultPrevented`, so
    `RefusalAlert` and `KeyboardShortcutService` ignore it. A full fix needs
    the card built without Radix's dismissable layer.
  - A set whose only problem is a 4D member now reads "could not be
    checked" with a Check action that gives the same answer.
  - Remote symlinked folders with a dotted name are not counted as skipped.
  - A README read failure is reported under "The description file could not
    be read in full"; a failed `derivatives/` listing marks contents as
    floors. Both want a wire field of their own.
- **Seen in the app and not addressed:**
  - A folder holding `derivatives/` and `derivatives` itself both carry the
    "N analyses" marker.
  - The folder review treats each subject's file name as its own image
    column (`sub-01_..._stat.nii.gz`, `sub-02_...`), so "Open as set" on a
    BIDS-named analysis shows every cell as missing. The card's image kinds
    are subject-normalized; the folder review is not.
  - Nested list items in a README render flat.
  - The tree does not pick up files added after a folder was first listed.
- **Fixture:** `tools/make_dataset_cards_fixture.py <dest> <small.nii.gz>`
  writes a three-analysis tree. A copy is at
  `test-data/_dataset_cards_fixture/` (listed in `.git/info/exclude`; delete
  it when done). Background computer-use cannot drive the native folder
  picker, so the fixture sits under the pinned `test-data` mount.
- **Next:** section 6 steps 4 to 6. The stray files in section 5 are still
  in the tree.

### Trillium run, same day

Mounted `/scratch/brad/dsets` (SSH agent, Duo push) and opened `pcmri`.

- Worked: remote markers; the `pcmri` collection card (52 analyses);
  the `enc_rep_rsa` analysis card (35 subjects, 3 image kinds x 35);
  "Open as set" into the folder review (35 members x 3 images, all
  available, with the busy copy); the set opened in the Deck.
- Slow: the `pcmri` card took about 30 s and the analysis card about 10 s.
- Defects seen:
  - The card's path line repeats the remote root:
    `brad@trillium...:/scratch/brad/dsets:/scratch/brad/dsets/pcmri`.
  - The marker reads "24+analyses" (no space) while the card counts 52.
  - The collection header carries a "1+ subject" chip.
- Not tried on the mount: sidecar card, Population, Compare, Background,
  "Check image grids" (the Inspector showed "headers not sampled").

## 9. Update, 2026-11-10 third pass (after the owner's critique)

Still nothing committed. Checks on the final tree: 4,514 UI tests pass (the
five `SurfaceLoading.selection` rejections remain), `tsc -b`, filtered Rust
tests, clippy, fmt and the permissions check are clean; the debug `.app` at
`target/debug/bundle/macos/` is built from this tree.

Built since section 8, each reviewed in a fresh context and the findings
fixed unless noted:

- **Background from the image grid.** `studioBackground.ts`
  (`matchTemplateLattice`): a set whose grid is a known MNI152 lattice gets
  that template with a note; a declared space still wins; the user's choice,
  "None" included, wins over both. Seen on Trillium.
- **Automatic grid check** on open, cancellable, with one readiness model
  (`studioReadiness.ts`). A remote audit stopped by the two-minute ticket
  keeps the headers it read; "Continue checking" resumes. Seen on Trillium
  (about 30 s for 105 headers).
- **Studio cleanup:** set named after its folder, wrapping toolbar,
  "Waiting"/"Unavailable" distinct from "Failed", plain wording, compare
  pane chrome, legend never over the image in the Deck and pane A (a strip
  beside the slice slider when there is no margin), first member on open.
- **One-step open** (`folderOpenDecision.ts`): a complete, unambiguous folder
  opens straight into the Deck; otherwise the review says why it is shown.
  A study holding Population work, a chosen background or computed maps is
  never replaced without the review. NOT yet seen working natively: the
  first attempt fell to the review (a per-file reading counted as a rival);
  fixed and unit-tested against a recorded scan of a replica.
- **Dataset cards:** two-phase loading (`phase: descriptions | full`), the
  analyses table (`AnalysesTable.tsx`), one totals line plus image-kinds
  table, cache keyed by browse root, read budgets. Seen on Trillium: the
  `pcmri` list in about 5 s (was about 30 s).
- **Subjects panel** (`designPanelModel.ts`): "N members · M images each"
  with short image names; no filter for all-identical or all-unique
  columns. The owner said "roles" is acceptable as a word; the panel says
  "images" for folder sets pending their preference.
- **Population and Compare on a remote set** (`studio_source_fetch.rs`,
  `StudioSourceFetchService.ts`): member files are fetched into the mount
  cache before computing, with a count, Cancel/Continue, a 2 GiB
  confirmation and a cache-budget refusal (8257). Not seen natively.
- **Reconnect after a dropped session** (`RemoteReconnectService.ts`,
  `remoteConnectionError.ts`, code 8266): Reconnect on the Deck card, Files
  header, status bar, dataset card, grid check and fetch notice; a fresh
  sign-in replaces a dead mount (`register_remote_mount`). Not seen
  natively.
- **Tab titles** no longer wrap (`index.css`). Seen.

Open, for the owner:

- **Crosshair on splitter resize** is fixed only on
  `fix/ortho-splitter-crosshair` (PR #63, open). Not in this tree.
- **Artboards awaiting approval:** "Dataset cards in the Inspector"
  (card docked in the Inspector, thumbnails, subjects x kinds grid, checks,
  diverging default). The owner has edited the canvas; re-read it first.
- The last Trillium attempt timed out waiting for Duo. To check on the
  mount: one-step open, the Subjects panel, Population/Compare fetch, the
  legend strip and note, a forced disconnect and Reconnect.
- Scratch files to delete (deletion is blocked for agents):
  `ui2/src/services/studio/__tests__/tmpReal.test.ts`,
  `core/field_table/tests/tmp_enc_rep_dump.rs`.
- Known gaps left: a brief old-template window when paging from an MNI-grid
  member to a native-grid one; one missing remote member blocks Population;
  no proactive "disconnected" signal (no polling added); "cohort" vs
  "group" vocabulary.

### Trillium run of the final build (2026-11-10, late)

Seen working on `pcmri/derivatives/enc_rep_rsa`:

- Card by Space, then "Open as set": straight to the Deck, "Opened 35
  members × 3 images from enc_rep_rsa." with "Review…"; first member
  (`sub-1002`, "1 of 35"); "Ready to compare" within the open.
- Background filled in with the full note on its own row; legend in the
  side margin in the Deck and as a strip beside the slider in Compare
  pane A.
- Subjects panel: "35 members · 3 images each", three image tokens, plain
  member list, no Filters section.
- Population: "Checking images on …", then "Fetching images from … 27 of
  35" (also in the status bar), then "Mean · 35 observations" with no click.
- Compare: mean, residual and z-score maps computed over the template.

Defect seen: the three computed Compare panes carry "Out of date", and all
four panes read "Pending / Nothing to show yet." for 10 to 20 s first. A fix
is in progress.

Not exercised on the mount: a forced disconnect and Reconnect, Cancel and
Continue mid-fetch, a set switch mid-fetch, the size prompt.
