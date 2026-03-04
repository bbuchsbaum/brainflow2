# Display Lifecycle Model (Canonical)

## Goal
Define one explicit, traceable model for how display state changes on:
- load volume
- load surface
- add surface overlay
- unload volume
- unload surface

This document is the contract for the UI lifecycle refactor.

## Lifecycle Owner
`ui2/src/services/DisplayLifecycleOrchestrator.ts` is the single ingress owner for file-driven display lifecycle actions.

All file-originating load requests must pass through this orchestrator, regardless of source:
- file browser double-click
- drag/drop
- programmatic load requests

## State Ownership
Single owner per concern:

| Concern | Owner |
|---|---|
| Operation lifecycle (`queued/loading/complete/error`) | `loadingQueueStore` |
| Volume layer list + volume metadata | `layerStore` |
| Per-view render/display layer state | `viewStateStore` |
| Surface geometry + overlay payloads + active surface | `surfaceStore` |
| Backend handles/resources | backend registries via `apiService` |

## Action Semantics

### 1) Load Volume
1. Orchestrator validates path/type.
2. Orchestrator enqueues in `loadingQueueStore`.
3. Backend file load returns `VolumeHandle`.
4. `VolumeLoadingService` materializes UI layer state.
5. Queue marked complete or error.

### 2) Load Surface
1. Orchestrator validates path/type and routes to `SurfaceLoadingService`.
2. Surface service owns backend call + store update + optional tab creation.
3. Queue marked complete or error.

### 3) Add Surface Overlay
1. Orchestrator resolves target surface (active or sole surface).
2. `SurfaceOverlayService` loads overlay payload and applies it.
3. Surface overlay state is written to `surfaceStore`.

### 4) Unload Volume
1. Backend GPU/resources released.
2. Volume removed from `layerStore`.
3. Corresponding view state entries removed from `viewStateStore`.
4. Any dependent overlays/projections are detached.

### 5) Unload Surface
1. Overlay resources for that surface are released.
2. Surface handle released from backend.
3. Surface and related overlays removed from `surfaceStore`.
4. Surface viewer tab(s) for that surface are closed.

## Invariants
1. Every load request maps to exactly one orchestrator flow.
2. `loadingQueueStore` is the only source of loading progress truth.
3. Stores are pure state containers (no async backend work inside stores).
4. No hidden event-driven cross-store synchronization for required state correctness.
5. Unload is symmetric with load (backend + UI cleanup both mandatory).
6. A display entity ID maps to one canonical representation in state.
7. Overlay attach must validate target surface existence.
8. UI notifications are side effects, not state authority.

## Migration Notes
- Phase 0: this model document (contract).
- Phase 1: orchestrator ingress introduced, file loads routed through one owner.
- Later phases will remove implicit `StoreSyncService` dependencies and complete unload symmetry.
