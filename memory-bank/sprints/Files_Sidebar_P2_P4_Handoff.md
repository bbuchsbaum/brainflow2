# Files Sidebar — P2 / P3 / P4 Handoff

Handoff for whoever (future-Claude or human) picks up the Files-sidebar
reimagining after P1 ships. This is the single page to read before
opening any of the child beads.

## Context

- Umbrella bead: **bd-01KQNVEMRWW85AYQPSTA6A9W2N** — *Files sidebar: reimagine left rail*. Read its decision notes for the product-level rationale (load-vs-render split, why no fake recents, BIDS-on-demand, etc.) before changing anything structural.
- Design source of truth: `resdesign/Design.md` and `ui2/CLAUDE.md`. The 320 px left-rail target plus the `--bf-*` token set live there.
- P1 baseline commit: **`c9ac50b5`** on `main` (local). Diff: +1581 / −650 across 10 files.

## What P1 already gave you

P1 landed the MVP shell. When you start P2/P3, you can assume **all of**:

- `ui2/src/components/panels/files/` exists with:
  - `FileTreeRow.tsx` (extracted from the old monolith — drop-in for `react-arborist`'s row render prop).
  - `FilesStartPanel.tsx`, `RecentLocationsList.tsx`, `PinnedLocationsList.tsx`, `DropTargetFooter.tsx` — start state when nothing is mounted.
  - `shared/inferFileType.ts` — pure helper returning `{ kind, badge, iconColor, description }` for any path. **Use this everywhere** instead of re-inferring file type. It already understands the 4D opt-in flag.
  - `shared/FileTypeBadge.tsx` — short uppercase chip (NII / 4D / GII / SURF / FUNC / TSV / DCM / MGZ / …).
  - `files-panel.css` — start-state and badge styles. Still on `--app-*` tokens; P4 migrates to `--bf-*`.
- `ui2/src/components/panels/FileBrowserPanel.tsx` is the slim router (≈458 lines). Branches:
  1. `loading && treeData.length === 0` → spinner
  2. `error` → error state
  3. `!hasMountedDirectory` → `<FilesStartPanel/>`
  4. `isSearchEmptyState && treeData.length === 0` → small "no matching files" card
  5. otherwise → `<Tree>` with `FileTreeRow` rows
- Search/sort row only renders when `hasMountedDirectory === true`.
- `ui2/src/stores/fileBrowserStore.ts` exposes a stable persistence contract:
  - `recents: RecentLocation[]` (LRU≤10, auto-filled by `mountDirectory`)
  - `pinned: PinnedLocation[]` (≤12)
  - `fourDPaths: Set<string>`
  - Actions: `recordOpenedFile`, `clearRecents`, `pinLocation`, `unpinLocation`, `isPinned`, `markFourD(path, isFourD?)`
  - localStorage key: **`bf.fileBrowser.v1`** (version-gated; bump if shape changes).
- `markFourD` is exposed but **not yet wired** at file-open time. Wiring it lives in P2 or alongside the Backend bead — see below.

Tests that must stay green throughout the rest of the work:

```bash
cd ui2 && pnpm exec vitest run \
  src/components/panels/__tests__/FileBrowserPanel.remoteOrigin.test.tsx \
  src/components/panels/__tests__/FileBrowserPanel.unmount.test.tsx
```

(Plus `pnpm exec tsc --noEmit` from `ui2/`.)

## Open beads at a glance

| Bead | P | Title | Depends on |
|---|---|---|---|
| bd-01KQNVFSVAATHJ02D5GBTST3T2 | 2 | P2 — mounted explorer scaffolding | P1 |
| bd-01KQNVG8DQ1FRFVDPMDCQSAWED | 2 | Backend — `peek_volume_metadata` bridge | independent |
| bd-01KQNVFY0Q3A0GSQDRWEQG92F8 | 2 | P3 — view modes (Tree / BIDS / Images / Loaded) | P2 |
| bd-01KQNVG4C6TG4DNVFT0K9MT8KM | 3 | P4 — responsive + keyboard + `--bf-*` migration | P2 (preferably P3 too) |

Read each bead's `[decision]` notes via `mote show <id>` before coding — they pin scope choices that aren't obvious from the code.

---

## P2 — Mounted explorer scaffolding (bd-01KQNVFSVAATHJ02D5GBTST3T2)

**Goal:** when a directory is mounted, the panel becomes a dense explorer:
`SourceHeader → FilterBar → ViewModeTabs → FileTree → SelectedFileSummary → FilesFooterStatus`.

**Suggested entry points**

- Add to `ui2/src/components/panels/files/`:
  - `SourceHeader.tsx` — current root path + mount kind chip + breadcrumb. Pull from `entries[0]` / `selectedRootMount`.
  - `FilterBar.tsx` — wraps the existing search input + sort. Lift the search/sort JSX out of `FileBrowserPanel.tsx` (lines ~278–333 today) without changing behavior; the `fb-controls` block already keys off `hasMountedDirectory`.
  - `SelectedFileSummary.tsx` — async + cancellable preview of the currently selected file. **Must be cancellable** (use `AbortController` or a request-id ref); the umbrella bead calls this out specifically. Falls back to `name + size + type` when the backend probe is missing — i.e., it works today even before the Backend bead lands.
  - `FilesFooterStatus.tsx` — count of files in current root, mount kind, "n recent", "n pinned".
- `FileBrowserPanel.tsx` becomes ~200 lines, just wiring those into the mounted branch.

**Store touches**

- No new persisted state. `selectedPath` already drives the summary.
- When the file-loader pipeline detects 4D, call `useFileBrowserStore.getState().markFourD(path)` (the action already exists). Likely caller: `ui2/src/services/FileLoadingService.ts` after the volume registers — confirm there before plumbing.

**Tests to add**

- `FileBrowserPanel.sourceHeader.test.tsx` — header renders host label for remote roots and basename for local.
- `FileBrowserPanel.preview.test.tsx` — selecting a file fires the cancellable probe and renders fallback when `peek_volume_metadata` rejects.

**Risks**

- GoldenLayout panel-local React Context — keep all cross-component state in the Zustand store, not Context (already the rule in `ui2/CLAUDE.md`).
- Render-phase invariants — do not write to the store from render. Schedule via `requestAnimationFrame` if the summary needs a side effect on selection change.

---

## Backend — `peek_volume_metadata` (bd-01KQNVG8DQ1FRFVDPMDCQSAWED)

Independent of P2. Surface a fast Tauri command that returns NIfTI / GIfTI header metadata (dims, voxel size, datatype, 4D flag) without loading the volume into the GPU.

**Touchpoints** (all in `core/api_bridge`):

1. New command function in `core/api_bridge/src/lib.rs` (or a new `peek.rs` submodule).
2. Add the command name to `COMMANDS` in `core/api_bridge/build.rs`.
3. Add it to the `generate_handler!` macro in `src-tauri/src/main.rs` and any other entrypoint.
4. Add permission `allow-peek-volume-metadata` to `core/api_bridge/permissions/default.toml`.
5. Add to `apiBridgeCommands` in `ui2/src/services/transport.ts`.
6. Run `cargo xtask ts-bindings` and check the `packages/api/src/generated` diff.

See `core/api_bridge/ADDING_COMMANDS.md` before touching the surface.

The frontend should treat this command as **optional** — `SelectedFileSummary` must already work without it (P1's contract).

---

## P3 — View modes (bd-01KQNVFY0Q3A0GSQDRWEQG92F8)

**Goal:** `ViewModeTabs` switches the row-list source between `tree`, `bids`, `images`, `loaded`. Single letters when the panel is narrow (320 px and below).

**Store changes**

- Add `viewMode: 'tree' | 'bids' | 'images' | 'loaded'` to the persisted slice (`bf.fileBrowser.v1`). Bump the schema version if you also need `bidsDetection: Map<root, { isBids; checkedAt }>`.
- 'loaded' view derives from `useLayerStore` + the volume registry. Read-only join — do **not** introduce a new store.

**Per-mode notes**

- `tree`: existing `react-arborist` tree. Reuse `FileTreeRow`.
- `bids`: only run a full scan when the tab is opened. Use the existing `check_bids_directory` Tauri command for the cheap detection probe; the existing `useBidsStore` already owns the heavy load. Render as a custom tree (still using `FileTreeRow` for individual rows).
- `images`: flat list of files matching `inferFileType().kind in {nii, niiGz, fourDNii, gii, surfGii, funcGii, mgz, mgh, dicom}`.
- `loaded`: each row maps to a current layer in `useLayerStore`. Selecting it should focus the matching layer in the inspector (dispatch the same selection action the layer panel uses today).

**Don't:**

- Don't seed any of these views from cached data — empty is a real state.
- Don't add a render-time subscription that crosses stores (per `ui2/CLAUDE.md` core stability rules).

---

## P4 — Polish (bd-01KQNVG4C6TG4DNVFT0K9MT8KM)

**Three independent strands; ship as one bead.**

1. **Responsive rules** at the 320 px target and a 280 px stress test:
   - Preview collapses to 1 line + Load button.
   - Mode tabs use single letters.
   - Footer trims secondary items.
2. **Keyboard model**:
   - `⌘O` / `Ctrl+O` → mount dialog (already today).
   - `Enter` on selected file → default load.
   - `Space` on selected file → preview.
   - `⌘⌫` / `Ctrl+Backspace` → unmount selected root.
   - Wire via a single panel-level `onKeyDown` handler; don't sprinkle into rows.
3. **`--bf-*` token migration**:
   - Sweep `ui2/src/components/panels/FileBrowserPanel.css` and `ui2/src/components/panels/files/files-panel.css` for `var(--app-*)` and replace with the canonical `--bf-*` token from `resdesign/Design.md` §3.1.
   - At this point also do the per-component CSS split that the umbrella bead called out: `FileTreeRow.css`, `FilesStartPanel.css`, etc.
   - Run `pnpm exec eslint src/components/panels/files src/components/panels/FileBrowserPanel.tsx` afterwards — the project ESLint config flags raw hex literals (`no-restricted-syntax`). The 5 hex warnings inside `inferFileType.ts` (10b981, 8b5cf6, blue-500-ish) need to migrate to tokens here.

---

## Quality gates for every commit in this stream

1. `cd ui2 && pnpm exec tsc --noEmit` — clean.
2. `pnpm exec vitest run src/components/panels/__tests__ src/stores/` — broader regression sweep before merge; the targeted pair above for fast feedback.
3. `cargo tauri dev` once per phase — eyeball the launch state, mounted explorer, and view modes; the umbrella bead notes that visual polish only emerges with a real backend.
4. Lint: only chase **new** errors. P1 left 4 pre-existing `any` errors and 6 `no-restricted-syntax` warnings; clearing them is P4's job.

## Out of scope across the whole stream

- Full BIDS UI lives in `useBidsStore` and the BIDS workspace, not the Files panel.
- Remote-mount lifecycle (auth, recovery) stays in `RemoteMountService` / `useMountListener`.
- Right Inspector and Layers panel are untouched — Files panel only owns "where / what / loaded".
