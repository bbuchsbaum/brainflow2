# Investigation Report — "Loading surface…" stuck forever (fsaverage white (left) job stalls at 10%)

**Date:** 2026-06-23
**Repo:** `/Users/bbuchsbaum/code/brainflow2` (UI under `ui2/`)
**Branch:** `feat/plot-grammar-sample-frame`
**Mode:** Read-only investigation (no files modified)

## Symptom

User loads an MNI152 T1w volume, switches the center workspace to **Integrated** mode (ortho + surface). A surface load is kicked off; the ACTIVITY/job panel shows **"fsaverage white (left)" stuck at 10%**, and the surface pane shows a spinner reading **"Loading surface…"** that never resolves. Volume ortho views render fine.

---

## TL;DR — Root cause

The surface template load reaches the backend `load_surface_template` Tauri command, which for an **uncached** fsaverage surface must **download the `.surf.gii` from TemplateFlow S3 over the network**. The fsaverage surface geometry is **not bundled in the repo and not present in the local cache** (M7 "offline fsaverage assets" is genuinely OPEN). Two compounding defects turn that network dependency into a permanent UI hang:

1. **The frontend `SurfaceLoadingService` has no completion safety net** — no `finally`, no client-side timeout, no abort, and no completion event. `isLoading` is cleared *only* in the success tail or the `catch`. The job progress is pinned to the hardcoded **10%** set immediately before the `invoke()` and only advances *after* the invoke resolves. The backend emits **no incremental progress events for surfaces at all**, so 10% is the highest it ever shows. If the `invoke('load_surface_template')` promise is slow or never settles, the spinner and the 10% freeze with no UI escape hatch.

2. **The TemplateFlow dependency stack can block in a way the timeout cannot cancel.** On a *fresh* machine (no skeleton index cached), `get_async` → synchronous `ls()` → `ensure_layout()` → `s3::update_skeleton_sync()` runs `futures::executor::block_on(...)` **inside the async command future**, before any `.await`. That synchronous block defeats `neuroatlas`'s 20s `tokio::time::timeout`, so the command blocks the tokio worker indefinitely (inner reqwest timeout is 300s) and the `invoke()` promise never settles — the literal "forever" case.

**The single most load-bearing defect is the missing frontend safety net** (item 1): it converts *any* slow/stuck backend call into a permanent spinner. The dependency block (item 2) is the mechanism by which the backend can actually never return.

**Important correction:** the Integrated mode-switch does **not** trigger this load. The M8 auto-mount is genuinely unwired (dead code). The "fsaverage white (left)" job is minted by a native Surface-menu selection or an atlas surface projection that co-occurs with the user's actions (see §4).

---

## 1. What renders "Loading surface…" and the exact gate

**File:** `ui2/src/components/views/SurfaceViewPanel.tsx`

- Spinner JSX at **lines 343–352**, gated **solely** by `isLoading`:
  ```jsx
  {isLoading && (
    <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <span className="text-sm text-muted-foreground">Loading surface...</span>
    </div>
  )}
  ```
- Gate source: `const isLoading = useSurfaceStore((s) => s.isLoading);` — **line 175**. This is a **single global flag**, not per-view/per-handle; it covers every mounted `SurfaceViewPanel`.
- The empty state ("No surface loaded" + Load-surface CTA) at **line 405** requires `!activeSurface && !isLoading && !loadError`. While `isLoading` is stuck `true`, the empty state/CTA is suppressed — **no UI escape hatch**.
- `loadError` **is** rendered (lines 176, 355–363). So a backend *error* would replace the spinner with a visible error banner. The user seeing a permanent spinner ⇒ neither `isLoading=false` nor `loadError` was set ⇒ the load promise has not settled (or has not yet settled, e.g. during a long network wait).

**Precise stuck condition:** `isLoading === true` while `loadError === null`. `isLoading` is owned exclusively by `SurfaceLoadingService.setLoadingState` (§3).

## 2. surfaceStore `isLoading` lifecycle

**File:** `ui2/src/stores/surfaceStore.ts`

- Fields: `isLoading` (init `false`, line 308), `loadError` (init `null`, line 309), `surfaces: Map` (304), `activeSurfaceId` (305). No progress/job field here (progress lives in `loadingQueueStore`).
- **Only** mutator of `isLoading` is `setLoadingState(isLoading, loadError=null)` (316–326), with a no-op guard. `addSurface`/`setSurfaceGeometry`/etc. never touch `isLoading`.
- `surfaces` gains entries only via `addSurface` (328–338); `activeSurfaceId` set there (when `activate=true`) and by a few selection actions.

## 3. The load job, the "10%", and the missing safety net

**File:** `ui2/src/services/SurfaceLoadingService.ts`

- Two entry points: `loadSurfaceFile` (73–193) and `loadSurfaceTemplate` (323–465), same shape.
- **Completion is promise-based** — every step is `await this.transport.invoke(...)`. There is **no `listen()`** in the file; `eventBus.emit(...)` calls are fire-and-forget UI notifications, not completion gates.
- `loadSurfaceTemplate` flow (the one that produces this job):
  - **line 346:** `setLoadingState(true, null)` → global `isLoading=true`.
  - **line 385:** `updateProgress(queueId, 10)` → the hardcoded **10%** the user sees frozen.
  - **line 388:** `await invoke('load_surface_template', { request })` — the long/blocking step.
  - **line ~393:** progress bumps to 50% **only after** the invoke resolves.
  - **line 410:** `await invoke('get_surface_geometry', { handle })`.
  - **line 412:** `setLoadingState(false, null)` on success.
  - **line 450 (catch):** `setLoadingState(false, <message>)` on error.
  - Note: `normalizeTemplateRequest` (545–567) rewrites fsaverage `inflated`→`pial`; `white` passes through unchanged.
- The queue `displayName` (340–343) and surface `name` (519) are `${space} ${geometry_type} (${hemisphere})` → with `fsaverage/white/left` = exactly **"fsaverage white (left)"**.

**The structural defect:** there is **no `finally`, no `Promise.race`/timeout, no `AbortController`**. `setLoadingState(false)` lives only in the success tail (412) and the `catch` (450). The job sits at 10% (385) for the *entire* duration of the invoke at 388 and only advances after it resolves. If that invoke is slow (network) or never settles, `isLoading` stays `true` and progress stays at 10 — exactly the observed symptom. A `finally { setLoadingState(false) }` plus a `Promise.race` timeout would make this self-healing; their absence is what turns a backend stall into a permanent hang.

## 4. The trigger — Integrated mode-switch is NOT the cause (M8 unwired)

Verified:
- `IntegratedVolumeSurfaceWorkspace.tsx` is a pure layout shell — **no `useEffect`, no service calls** — it only arranges `OrthogonalPanelsWorkspace`, `SurfaceViewPanel`, `SurfaceAssociationBadge`.
- The M8 decision logic `resolveSurfaceProjectionTarget`/`isMniSpace` in `ui2/src/components/views/surfaceProjectionResolution.ts` is **dead code** — referenced only by its own test file, **zero production call sites**. Matches handoff doc: M8 async auto-mount "NOT written (deliberately, pending M4/M7)" (`memory-bank/vol2surf_handoff.md:19`, Phase 3 at 136–138).
- Mode-switch path `DisplayModeSelector.handleClick` → `workspaceStore.setActiveWorkspaceMode` (`workspaceStore.ts:268–300`) only mutates workspace `type`/`presetId`.

**`loadSurfaceTemplate` has exactly two production callers** that mint a "fsaverage white (left)" job:
1. **Native Surface menu click** → `ui2/src/hooks/useSurfaceTemplateMenuListener.ts:77`, fired by the `surface-template-menu-action` Tauri event from `src-tauri/src/main.rs:818–837` (native menu item id prefix `surface_`). Strongest match for the exact label.
2. **Atlas surface load** → `ui2/src/hooks/atlasMenuSurfaceLoader.ts:65` inside `ensureFsaverageSurface(...)` (hardcoded `space:'fsaverage'`), via `useAtlasMenuListener`.

**Implication:** the job the user associates with "switching to Integrated" is actually originated by a menu/atlas action (or default/last-used menu state) co-occurring with the mode switch. The *stall* is independent of the trigger and lives in §3 + §5. To confirm the originating action in the running app, check the console for `[useSurfaceTemplateMenuListener] Surface template menu action received` vs `[atlasMenuSurfaceLoader] Auto-loading fsaverage …`.

## 5. Backend + dependency chain — why the invoke is slow / can never settle

**Command:** `core/api_bridge/src/lib.rs:11096–11236`, `load_surface_template`.
- Fully registered: `generate_handler!` at `lib.rs:12576`, `COMMANDS` at `build.rs:75`, permission file autogenerated, FE allow-list `transport.ts:102`. (Unregistered-command fast-reject is ruled out.)
- Signature takes only `request` + `state` — **no `AppHandle`/`Window`**, so it **cannot and does not emit progress events**. The surface region of `lib.rs` (11094–11300) contains no `emit`/`progress`/`window`. (The progress emitters in `core/templates/src/service.rs:246–324` belong to the unrelated **volume** `download_template` path.)
- **line 11151–11166:** `neuroatlas::surface::templates::global_surface_manager().get_surface(...).await`, with the M7-hardened error wrapper (code 7033) explaining the network requirement.

**Dependency `neuroatlas` (`/Users/bbuchsbaum/code/rust/neuroatlas-rs`):**
- `global_surface_manager()` (`src/surface/templates.rs:361–374`) is an **unsynchronized `static mut` + `Once`** returning `&'static mut SurfaceTemplateManager`; `get_surface` takes `&mut self`. Two concurrent fetches (left+right hemisphere, or two panels) are a **data-race / aliasing hazard** — secondary suspect for nondeterministic hangs/UB under concurrency.
- `get_surface` (137) → `download_surface` (179). The per-file S3 download at **212** *is* wrapped in `tokio::time::timeout(20s /* DEFAULT_TEMPLATEFLOW_TIMEOUT_SECS, line 16 */, get_async(...))`.

**Dependency `templateflow-rs` (`/Users/bbuchsbaum/code/rust/templateflow-rs/templateflow-rs`):**
- `get_async()` (`src/api_optimized.rs:192–218`): **line 197** `let files = ls(template, query)?;` — `ls` is **synchronous, not awaited**; then for any uncached file `s3::download_file(...).await` (213).
- `ls()` (135) → `ensure_layout()` (20). If the skeleton index zip is missing, `ensure_layout` calls `s3::update_skeleton_sync()`.
- `update_skeleton_sync()` (`src/s3.rs:268–283`):
  ```rust
  if let Ok(handle) = tokio::runtime::Handle::try_current() {
      futures::executor::block_on(handle.spawn(update_skeleton()))   // BLOCKS the async worker
  } else { /* own current-thread rt + block_on */ }
  ```
  Reached **synchronously** from inside the async `get_async` future (no `.await` before it), this `block_on` **defeats `neuroatlas`'s 20s `tokio::time::timeout`** — a timeout only cancels at `.await` points; the worker is parked in `block_on`.
- `update_skeleton()` (`src/s3.rs:206`) and `download_file` (`src/s3.rs:40–60`, `190+`) use reqwest with `.timeout(CONFIG.timeout)`; `CONFIG.timeout` default = **300s** (`src/config.rs:8 DEFAULT_TIMEOUT_SECS = 300`). So even bounded HTTP can stall up to 5 minutes.

**Cache / asset state (key evidence):**
- **No fsaverage / `.surf.gii` assets are bundled in the repo** — `find ... -iname '*fsaverage*' -o -iname '*.gii'` returns only test fixtures (`test-data/surfaces/fslr32k/*`, `tetrahedron.gii`, etc.). M7 offline assets is genuinely OPEN; **no offline fallback exists**.
- On *this* machine: `~/.cache/templateflow/templateflow-skel.zip` **is present** (so the `update_skeleton_sync` `block_on` path is **not** triggered here, and `ls()` reads the local skeleton fast), but `~/.cache/templateflow/tpl-fsaverage/` **contains ZERO `*.surf.gii` and ZERO `white` files**. So "fsaverage white" requires a **live S3 download** of the surface geometry. That download is inside the 20s timeout, so on this box the backend would error in ~20s on a dead network rather than literally forever.
- On a *fresh* machine with no skeleton zip: the `block_on` path in §5 is hit and the command can hang far longer than 20s (up to the 300s reqwest timeout, or indefinitely if the spawned task wedges) — the literal "forever" case.

---

## Conclusion

### (a) Trigger → load → stall chain (file:line)
1. A Surface-menu selection (`useSurfaceTemplateMenuListener.ts:77`) or atlas projection (`atlasMenuSurfaceLoader.ts:65`) calls `SurfaceLoadingService.loadSurfaceTemplate` — **not** the Integrated mode switch (M8 auto-mount unwired; `surfaceProjectionResolution.ts` is dead code).
2. `SurfaceLoadingService.ts:346` sets global `isLoading=true`; `:385` sets job progress to **10**; `:388` `await invoke('load_surface_template')`.
3. Backend `core/api_bridge/src/lib.rs:11151` `manager.get_surface(...).await` → `neuroatlas .../templates.rs:179 download_surface` → `:212 timeout(20s, get_async)`.
4. `templateflow-rs api_optimized.rs:197 ls()` → `ensure_layout()`; on a cold machine → `s3.rs:270 update_skeleton_sync` → `futures::executor::block_on(...)` (synchronous block inside the async future, defeating the 20s timeout; inner reqwest timeout 300s). On this machine (skeleton cached) it instead proceeds to a live `s3::download_file` of the missing `.surf.gii`.
5. The `invoke()` is slow or never settles. Backend emits no progress events, so the job is frozen at the 10 set on `:385`. Control never returns past `SurfaceLoadingService.ts:388`; neither the success tail (`:412`) nor the `catch` (`:450`) runs; `isLoading` stays `true`. `SurfaceViewPanel.tsx:343` shows "Loading surface…" with the empty-state CTA (`:405`) suppressed — no escape hatch.

### (b) Single most likely root cause (evidenced)
**The fsaverage surface geometry is not bundled or cached and must be fetched from TemplateFlow over the network, while the frontend has no completion safety net.** `SurfaceLoadingService.loadSurfaceTemplate` (`ui2/src/services/SurfaceLoadingService.ts`) sets `isLoading=true` and progress 10, then `await`s a single backend invoke that performs a network download — with no `finally`, no client timeout, no abort, and no incremental progress (the backend emits none for surfaces). On a missing/slow/hung network the invoke does not settle promptly, so the global `isLoading` flag and the 10% are stranded with no UI recovery. The deeper backend enabler is the `futures::executor::block_on` inside `templateflow-rs::s3::update_skeleton_sync` (reached synchronously from `get_async`), which defeats `neuroatlas`'s 20s timeout on cold machines and makes the backend able to hang indefinitely.

Evidence the invoke is unsettled rather than fast-erroring: `SurfaceViewPanel` renders `loadError` (lines 355–363); the user sees a spinner, not an error.

### (c) Secondary suspects
- **Missing offline assets (M7 OPEN):** `tpl-fsaverage` cache has the index but no `*.surf.gii`; nothing bundled in-repo; no offline fallback. Even the "fast" path requires a live network download.
- **Unsynchronized global manager:** `global_surface_manager()` `static mut` + `&'static mut self` (`neuroatlas templates.rs:361–374`) under concurrent left/right or multi-panel loads is a data-race/UB/deadlock hazard.
- **No backend surface progress events:** the command has no `AppHandle`/`Window`, so the 10% can never advance during the download — guarantees a "frozen at 10%" appearance for any non-trivial load.
- **Frontend dedup race:** `loadSurfaceFile`/`loadSurfaceTemplate` set `isLoading` true at the top *before* the queue-dedup check, so a concurrent same-path call can clear the global flag for an in-flight load (inverse bug; confirms the flag is global and racy).

### (d) Concrete fix recommendation (exact locations)
1. **Frontend safety net (highest leverage, smallest blast radius).** In `ui2/src/services/SurfaceLoadingService.ts`, wrap the body of `loadSurfaceTemplate` (~323–465) and `loadSurfaceFile` (~73–193) in `try { … } finally { setLoadingState(false) }`, and `Promise.race` the `invoke('load_surface_template')` (line 388) and `get_surface_geometry` (410) against a client-side timeout (e.g. 30–60s) that rejects, so a never-settling/slow invoke becomes a `loadError`. This guarantees the spinner always clears and the user gets an actionable message even when the backend hangs. Also surface real progress: have the backend emit progress (see fix 3) or move the job to an indeterminate state past 10% while the download is in flight.
2. **Dependency fix (true root cause of the indefinite hang).** In `templateflow-rs`, never call `futures::executor::block_on` from inside an async future: make `ensure_layout`/`ls` async and `.await` a `tokio::task::spawn_blocking` for the synchronous index build (`src/api_optimized.rs:20,135,197`; `src/s3.rs:268–283`). Lower `CONFIG.timeout` from 300s for interactive use (`src/config.rs:8`). Alternatively, in `neuroatlas` `download_surface` (`/Users/bbuchsbaum/code/rust/neuroatlas-rs/src/surface/templates.rs:212`) run the whole `get_async` via `spawn_blocking` wrapped in the timeout so the timeout can actually fire.
3. **Backend hardening + progress.** In `core/api_bridge/src/lib.rs:11151`, wrap `manager.get_surface(...).await` in an explicit `tokio::time::timeout` at the bridge boundary (defense-in-depth so the command always returns `Err`, which the FE already renders), and add an `AppHandle`/`Window` parameter to emit surface-download progress so the job badge can advance past 10%.
4. **Fix the unsynchronized global manager.** Replace `static mut GLOBAL_MANAGER` / `&'static mut` in `neuroatlas templates.rs:361–374` with a `tokio::sync::Mutex<SurfaceTemplateManager>` (or per-call instance) to remove the data race under concurrent hemisphere/panel loads.
5. **M7 / offline assets decision.** Bundle a minimal fsaverage `white/pial/inflated` `surf.gii` set and load from disk (no network), OR gate the Surface menu / future M8 auto-mount behind a connectivity/availability check with an explicit offline message. Relevant: `core/atlases/src/service.rs` (`to_templateflow_surface_type`, surface loading), `memory-bank/vol2surf_handoff.md` M7 notes, and the inert M8 resolver `ui2/src/components/views/surfaceProjectionResolution.ts` for when auto-mount is wired.

---

## Key file references
- `ui2/src/components/views/SurfaceViewPanel.tsx` — spinner (343–352, gate line 175), loadError (355–363), empty-state suppression (405).
- `ui2/src/stores/surfaceStore.ts` — `isLoading` + `setLoadingState` (308–326), `addSurface` (328–338).
- `ui2/src/services/SurfaceLoadingService.ts` — `loadSurfaceTemplate` (323–465): isLoading true 346, progress 10 at 385, invoke 388/410, success-clear 412, catch-clear 450; `normalizeTemplateRequest` 545–567; **no `finally`/timeout**.
- `ui2/src/hooks/useSurfaceTemplateMenuListener.ts:77` — menu-driven template load (likely trigger).
- `ui2/src/hooks/atlasMenuSurfaceLoader.ts:65` — atlas-driven fsaverage load (alt trigger).
- `ui2/src/components/views/IntegratedVolumeSurfaceWorkspace.tsx` — pure layout shell, no auto-mount.
- `ui2/src/components/views/surfaceProjectionResolution.ts` — M8 resolver, **dead/tests-only**.
- `core/api_bridge/src/lib.rs:11096–11236` — `load_surface_template` (no progress events); registered at `lib.rs:12576`, `build.rs:75`, `transport.ts:102`.
- `/Users/bbuchsbaum/code/rust/neuroatlas-rs/src/surface/templates.rs` — `get_surface` (137), `download_surface` (179) + 20s `timeout` (212), default timeout const (16), `global_surface_manager` `static mut` (361–374).
- `/Users/bbuchsbaum/code/rust/templateflow-rs/templateflow-rs/src/api_optimized.rs` — `get_async` (192) calls sync `ls` (197); `ls` (135) → `ensure_layout` (20).
- `/Users/bbuchsbaum/code/rust/templateflow-rs/templateflow-rs/src/s3.rs` — `update_skeleton_sync` `block_on` (268–283), `update_skeleton` (206), `download_file` (40+/190+), client timeout = `CONFIG.timeout`.
- `/Users/bbuchsbaum/code/rust/templateflow-rs/templateflow-rs/src/config.rs:8` — `DEFAULT_TIMEOUT_SECS = 300`.
- `~/.cache/templateflow/tpl-fsaverage/` — exists, **0 `surf.gii` files** (white surface not cached ⇒ first-use network download required). No fsaverage/`.surf.gii` bundled in-repo.
- `memory-bank/vol2surf_handoff.md` — M7 (offline assets, OPEN) and M8 (auto-mount, unwired) status.
