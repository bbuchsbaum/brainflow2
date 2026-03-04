<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# ui2/src/stores

## Purpose
Zustand state management stores for cross-component state sharing. Contains 33 stores managing layers, surfaces, views, rendering, UI state, and application workflow. Includes middleware for batching updates and selectors for optimized state access. Critical for cross-panel communication since GoldenLayout creates isolated React roots.

## Key Files
| File | Description |
|------|-------------|
| MIGRATION_NOTES.md | Phase 2 migration notes for loading state |
| SELECTORS_GUIDE.md | Guide for using typed selectors to prevent runtime errors |
| layerStore.ts | Layer management (volumes, surfaces, overlays) - 16KB |
| surfaceStore.ts | Surface geometry and data visualization - 16KB |
| viewStateStore.ts | View state (slice positions, orientations, zoom) - 23KB |
| renderStateStore.ts | Render state and frame tracking - 9KB |
| crosshairSettingsStore.ts | Crosshair configuration and visibility |
| mouseCoordinateStore.ts | Mouse position tracking across views |
| loadingQueueStore.ts | File loading queue and progress - 10KB |
| progressStore.ts | Progress tracking for async operations |
| fileBrowserStore.ts | File browser state and navigation - 14KB |
| workspaceStore.ts | Workspace and session management - 11KB |
| annotationStore.ts | Annotation data and tools |
| statusBarStore.ts | Status bar content and updates |
| activePanelStore.ts | Active panel tracking |
| activeRenderContextStore.ts | Active render context |
| clusterStore.ts | Cluster analysis state |
| contextMenuStore.ts | Context menu state |
| displayOptionsStore.ts | Display options |
| dragSourceStore.ts | Drag-and-drop source tracking |
| exportDialogStore.ts | Export dialog state |
| featureFlagStore.ts | Feature flags |
| hoverSettingsStore.ts | Hover tooltip settings |
| hoverSettingsPopoverStore.ts | Hover settings popover state |
| layoutDragStore.ts | Layout drag state |
| layoutStateStore.ts | Layout state tracking |
| renderStore.ts | Additional render state |
| tooltipStore.ts | Tooltip state |
| viewLayoutStore.ts | View layout configuration |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| middleware/ | Zustand middleware (coalesceUpdatesMiddleware.ts - 15KB) |
| selectors/ | Typed selectors for type-safe store access |
| __tests__/ | Store unit tests |

## For AI Agents

### Working In This Directory
- ALL stores use Zustand with TypeScript
- Use typed selectors (see SELECTORS_GUIDE.md) to prevent runtime errors
- Stores are global singletons - work across GoldenLayout's isolated React roots
- Use middleware for performance (coalescing, batching)
- Keep stores focused on state, logic goes in services
- Use Immer for immutable updates (built into Zustand)
- Document store structure and methods
- Add selectors for common access patterns
- Follow migration notes when updating stores

### Testing Requirements
- Test store state updates
- Test selectors return correct data
- Test middleware behavior (coalescing, batching)
- Test store subscriptions
- Mock stores for component tests
- Test initial state
- Test store reset functionality

### Common Patterns
- Store creation: `create<StoreType>()((set, get) => ({ ... }))`
- State updates: `set(state => ({ ...state, field: value }))`
- Computed values: Use selectors, not stored state
- Store subscription: `useStore(selector)` in components
- Non-reactive access: `useStore.getState().method()`
- Middleware: Wrap store with middleware functions
- Type safety: Define interface, use typed selectors
- Cross-store communication: Stores can access each other via getState()

## Dependencies

### Internal
- ../types/ - Type definitions
- @brainflow/api - API types

### External
- zustand - State management
- immer - Immutable updates (via zustand middleware)

<!-- MANUAL: Use typed selectors! See SELECTORS_GUIDE.md to avoid the 3-hour debugging session. -->
