# React 19 snapshot stability: diagnosis and refactor plan

This document captures root-causes behind the infinite render/update loops in slice views, immediate “first‑aid” fixes, and a safe, incremental refactor plan to simplify the data flow and harden the code against regressions.

## TL;DR
- Do not set Zustand stores during render or while React is computing selectors. Schedule writes via rAF/queueMicrotask inside middleware.
- Make all selectors stable. When a selector returns an object/array, supply an equality fn or refactor to primitives.
- Centralize slice view subscriptions and side‑effects in a controller hook. Keep the canvas presentational.
- Wrap Tauri event listeners with a web‑safe guard to eliminate noisy unlisten errors in non‑Tauri builds.

---

## What’s causing the loops

1) React 19 + useSyncExternalStore snapshot churn
- Error: “The result of getSnapshot should be cached to avoid an infinite loop.” This fires when a store’s snapshot changes between two reads during the same render. This usually means a store write happened during render.
- Hotspots (direct or indirect writes while components are mounting/selecting):
  - Manual coalescing flush calls from components/hooks force immediate backend updates that can cascade into store writes.
    - `ui2/src/components/views/FlexibleSlicePanel.tsx:48` (inside rAF after resize)
    - `ui2/src/components/views/FlexibleOrthogonalView.tsx:59,95` (drag/initial force)
    - `ui2/src/hooks/useLayoutSync.ts:52` (drag end)
    - `ui2/src/stores/viewStateStore.ts:262` (setCrosshair with `immediate`)
  - Selectors returning fresh objects/arrays on every render, without an equality function.
  - Service calls executed in render paths that can synchronously set state.

2) Tauri event cleanup in web builds
- Error: “undefined is not an object (evaluating 'window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener')”
- Cause: calling the unlisten function from `@tauri-apps/api/event` in a non‑Tauri environment.
- Impact: noisy console spam while debugging the real issue.

---

## First‑aid fixes (minimal but effective)

1) Never flush coalesced updates in the render phase
- Current: `coalesceUtils.flush(force)` cancels any scheduled flush and calls `flushState()` immediately.
- Change: Make `flush()` schedule a flush (rAF or microtask) and no‑op if a flush is already scheduled. Do not synchronously invoke the backend callback from `flush()`.
- Rationale: Ensures any backend/store changes run after commit, keeping getSnapshot stable in React 19.

2) Remove component‑initiated forced flushes
- Replace direct `coalesceUtils.flush(true)` calls in:
  - `ui2/src/components/views/FlexibleSlicePanel.tsx:48`
  - `ui2/src/components/views/FlexibleOrthogonalView.tsx:59,95`
  - `ui2/src/hooks/useLayoutSync.ts:52`
  - `ui2/src/stores/viewStateStore.ts:262` (only keep for truly user‑critical, but still scheduled)
- Let middleware scheduling handle batching; if a “nudge” is needed, call a no‑op `requestAnimationFrame(() => {/* noop */})` instead of flush.

3) Idempotent render‑context registration
- In `ui2/src/components/views/SliceViewCanvas.tsx:91` effect, ensure `registerContext` only sets when dimensions actually change. Add store‑level guard:
  - In `ui2/src/stores/renderStateStore.ts`, make `registerContext` check for equal dims/metadata and skip `set()` when there’s no structural change.

4) Stabilize selectors that return objects/arrays
- In `ui2/src/components/views/SliceViewCanvas.tsx`:
  - Crosshair settings: avoid subscribing to an object that’s recreated frequently. Select primitives or supply an equality fn.
  - Anywhere that returns `{ a, b }` or `[]`, add a comparator or return primitives.

5) Web‑safe Tauri event unlisten
- Introduce a guarded wrapper and use it everywhere we listen/unlisten to events (TemplateService, ProgressService, menu listeners, etc.). This removes the noisy rejection in non‑Tauri builds.

---

## Suggested code patterns

- Scheduled flush in middleware (pseudo‑code):
  - Don’t call backend immediately from `flush()`; schedule via `requestAnimationFrame()` and bail if nothing pending. Keep one scheduled job at a time.

- Idempotent set helper for stores:
  - Wrap `set` calls so they only commit when values actually differ (`Object.is` on changed keys). Prevents re‑renders for no‑ops.

- Stable “controller” hook for slice views:
  - Subscribe once per store with tight selectors + equality, then `useMemo` to combine. Place all side‑effects (context registration, resize sync) in one effect and schedule any writes.

- Safe Tauri event wrappers:
  - `safeListen(...)` that no‑ops in non‑Tauri, `safeUnlisten(promiseOrFn)` that catches and suppresses web errors.

---

## Incremental refactor plan (low‑risk)

1) Controller hook for slice views
- Add `useSliceViewModel(viewId, dims)` that returns a stable, memoized object: `{ viewPlane, crosshair, layers, primaryOptions, renderContext }`.
- One subscription per store with equality functions; combine with `useMemo`.
- Single effect for side‑effects: register/sync render context (scheduled), idempotent.

2) Eliminate manual flushes from components
- Remove explicit `coalesceUtils.flush(true)` calls. The coalescing middleware should own all scheduling and batching.
- If a hard “render soon” hint is needed after a resize, rely on the scheduled middleware job and idempotent store updates.

3) RenderContext registry hardening
- In `renderStateStore`, make `registerContext` and related setters no‑op when values are structurally equal (dimensions, metadata). This stops churn during repeated equal updates.

4) Event bus abstraction for Tauri events
- Add an `eventUtils.ts` exporting `safeListen`/`safeUnlisten` and use it in:
  - `ui2/src/services/TemplateService.ts`
  - `ui2/src/services/ProgressService.ts`
  - `ui2/src/hooks/useMountListener.ts`
  - `ui2/src/hooks/useWorkspaceMenuListener.ts`
  - `ui2/src/hooks/usePanelMenuListener.ts`
  - `ui2/src/components/layout/GoldenLayoutRoot.tsx`
  - `ui2/src/components/layout/WorkspaceManager.tsx`

5) Time navigation & hover isolation
- Keep time‑nav callbacks stable via `useRef`/`useEvent` patterns; do not subscribe to broad stores.
- Hover sampling writes at most once per frame; store any transient state in `useRef`.

6) Flexible panels stay presentational
- `FlexibleSlicePanel` measures and passes dimensions only; controller handles context/resize sync with idempotent store writes.

7) Dev guardrails
- Add a tiny dev utility to assert no render‑phase writes (read snapshot twice and warn if it differs).
- Add an internal `setIfChanged` helper and reuse in stores.

---

## File‑level notes and hotspots

- `ui2/src/stores/middleware/coalesceUpdatesMiddleware.ts`
  - `coalesceUtils.flush()` is immediate and can provoke render‑phase writes. Convert to scheduled flush; keep a single scheduled job.

- `ui2/src/components/views/FlexibleSlicePanel.tsx:48`
  - Calls `coalesceUtils.flush(true)` after `updateDimensionsAndPreserveScale`. Remove; rely on middleware scheduling.

- `ui2/src/components/views/FlexibleOrthogonalView.tsx:59,95`
  - Forces flushes on drag/initial mount. Remove; excessive and risks render‑phase writes. Let the controller + middleware handle it.

- `ui2/src/hooks/useLayoutSync.ts:52`
  - Forces flush after syncing dimensions. Remove; idempotent updates + scheduled middleware are sufficient.

- `ui2/src/stores/viewStateStore.ts:262`
  - `setCrosshair(..., immediate=true)` calls `flush(true)`. Keep only if strictly necessary for UX, but change the middleware `flush()` to scheduled so it never runs inside render.

- `ui2/src/components/views/SliceViewCanvas.tsx`
  - Register/update context effect is fine conceptually but depends on store idempotence; add equality guard in `renderStateStore`.
  - Crosshair settings selector subscribes to the full settings object. Prefer primitive field selection + equality or supply a comparator.

- `ui2/src/stores/renderStateStore.ts`
  - `registerContext` always sets; add equality checks to avoid no‑op sets and re‑renders.

- Tauri listeners
  - Replace direct `listen`/unlisten usage with `safeListen`/`safeUnlisten` wrappers to stop web errors.

---

## Acceptance checklist (pre‑merge)
- No calls to `coalesceUtils.flush(...)` remain in components/hooks.
- Middleware `flush()` schedules work; no synchronous backend calls during render.
- All selectors returning `{}` or `[]` have an equality fn or are refactored to primitives.
- `registerContext` and dimension sync are idempotent at the store level.
- Tauri event subscriptions use safe wrappers; no web unlisten errors.
- Rendering a slice view does not trigger store writes in the same tick (dev assert remains quiet).

---

## Validation approach
- Unit test: mount a slice view; assert no store snapshot changes during the same render tick.
- Interaction smoke: resize panels, drag slider, scroll time; confirm no “getSnapshot should be cached” warnings and no “Maximum update depth exceeded”.
- Web build: verify no Tauri unlisten errors in console.
- Performance sanity: ensure resized renders still feel responsive with scheduled flushes.

---

## Next steps (suggested order)
1) Change middleware `flush()` to scheduled; remove all component calls to `flush(true)`.
2) Add idempotent guards in `renderStateStore.registerContext` and `updateDimensions...` paths.
3) Introduce `useSliceViewModel(viewId, dims)` and migrate `SliceViewCanvas` to presentational usage.
4) Add safe Tauri event wrappers and apply across services/hooks.
5) Tighten remaining selectors in hot paths (crosshair settings, display options).
6) Add the dev assert + one test to catch render‑phase writes early.

This sequence is safe, incremental, and should eliminate the React 19 snapshot churn while simplifying the architecture for future work.

