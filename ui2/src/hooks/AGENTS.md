<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# ui2/src/hooks

## Purpose
Custom React hooks for reusable logic and component patterns. Contains 29 hooks that encapsulate common functionality including rendering initialization, canvas management, store subscriptions, event listeners, and service integration. Hooks promote code reuse and separation of concerns.

## Key Files
| File | Description |
|------|-------------|
| useRenderCanvas.ts | Canvas rendering setup and image display - 6KB |
| useRenderLoopInit.ts | WebGPU render loop initialization - 3KB |
| useRenderSession.ts | Render session lifecycle management - 5KB |
| useSliceViewModel.ts | Slice view model state management - 6KB |
| useUnifiedLayers.ts | Unified layer access (volumes + surfaces) - 6KB |
| useBackendSync.ts | Backend state synchronization - 3KB |
| useLayoutSync.ts | Layout state synchronization - 3KB |
| useKeyboardShortcuts.ts | Global keyboard shortcuts - 5KB |
| useStatusBarInit.ts | Status bar initialization - 0.5KB |
| useServicesInit.ts | Services initialization on app start - 11KB |
| useAtlasMenuListener.ts | Atlas preset menu listener - 10KB |
| useSurfaceTemplateMenuListener.ts | Surface template menu listener - 7KB |
| useExportMenuListener.ts | Export menu listener - 1KB |
| useWorkspaceMenuListener.ts | Workspace menu listener - 2KB |
| usePanelMenuListener.ts | Panel menu listener - 2KB |
| useMountListener.ts | Mount directory event listener - 2KB |
| useViewContextMenu.ts | View context menu handler - 1KB |
| useHoverInfo.ts | Hover tooltip information - 7KB |
| useVolToSurfProjection.ts | Volume-to-surface projection - 6KB |
| useActiveRenderable.ts | Active renderable tracking - 0.5KB |
| useCanvasDimensions.ts | Canvas dimension tracking - 1KB |
| useFileLoadingStatus.ts | File loading status - 1KB |
| useLayerLoading.ts | Layer loading state - 2KB |
| useLayerPanelServices.ts | Layer panel service injection - 1KB |
| useMetadataShortcut.ts | Metadata keyboard shortcut - 1KB |
| usePerformanceMonitor.ts | Performance monitoring - 4KB |
| useStatusBarService.ts | Status bar service access - 0.6KB |
| useStatusBarUpdates.ts | Status bar update subscription - 2KB |
| useTimeNavigation.ts | 4D time navigation - 5KB |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| __tests__/ | Hook unit tests |

## For AI Agents

### Working In This Directory
- Hooks must follow React rules of hooks
- Hook names MUST start with "use"
- Only call hooks at top level (no conditionals)
- Custom hooks can call other hooks
- Hooks encapsulate reusable logic
- Use TypeScript for type safety
- Return stable references (useMemo, useCallback)
- Clean up side effects in return function
- Document hook parameters and return values
- Keep hooks focused on single responsibility

### Testing Requirements
- Use @testing-library/react-hooks for hook testing
- Test hook return values
- Test hook updates on dependency changes
- Test hook cleanup functions
- Mock stores and services as needed
- Test side effects (useEffect)
- Test custom event listeners
- Verify no memory leaks

### Common Patterns
- Store subscription: `useStore(selector)` inside hook
- Service access: Import and use service directly
- Event listeners: Setup in useEffect, cleanup in return
- Refs: useRef for DOM elements and mutable values
- State: useState for hook-local state
- Side effects: useEffect for setup/cleanup
- Memoization: useMemo for expensive computations
- Callbacks: useCallback for stable function references
- Custom events: addEventListener/removeEventListener pattern

## Dependencies

### Internal
- ../stores/ - Zustand stores
- ../services/ - Services
- ../types/ - Type definitions
- ../utils/ - Utility functions

### External
- react - React hooks (useState, useEffect, etc.)
- zustand - Store subscriptions

<!-- MANUAL: Hooks promote reusability. Extract common patterns from components into hooks. -->
