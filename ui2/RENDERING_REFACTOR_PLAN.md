# Rendering System Refactoring Plan

## Overview
This plan addresses the critical brittleness in the MosaicView/SliceView rendering system through surgical, incremental improvements. Each ticket is designed to be completed independently while keeping the system functional.

## Guiding Principles
- **Never break working code** - System must work after each ticket
- **Test after each change** - Run `cargo tauri dev` and verify all views work
- **Commit after each ticket** - Create atomic, reversible changes
- **Add before removing** - New code coexists with old during migration

---

## Phase 1: Type-Safe Event System (Foundation)

### Ticket 1.1: Create Event Type Definitions
**Goal**: Define all event types as TypeScript discriminated unions

**Files to create**:
- `ui2/src/types/events.ts`

**Implementation**:
```typescript
// ui2/src/types/events.ts
export type RenderEvent = 
  | { type: 'render.start'; viewType?: string; tag?: string }
  | { type: 'render.complete'; viewType?: string; tag?: string; imageBitmap: ImageBitmap }
  | { type: 'render.error'; viewType?: string; tag?: string; error: Error }
  | { type: 'crosshair.updated'; world_mm: [number, number, number] }
  | { type: 'crosshair.settings.updated'; settings: CrosshairSettings }
  | { type: 'mouse.worldCoordinate'; world_mm: [number, number, number]; viewType: string }
  | { type: 'mouse.leave'; viewType: string };

export type EventPayload<T extends RenderEvent['type']> = 
  Extract<RenderEvent, { type: T }>;
```

**Testing**: 
- Verify TypeScript compiles without errors
- No runtime changes yet

**Commit message**: 
```
feat(ui): Add typed event definitions for render system

- Define RenderEvent discriminated union
- Add type-safe event payload extraction
- Foundation for removing string-based events
```

---

### Ticket 1.2: Create TypedEventBus Implementation
**Goal**: Build type-safe event bus that wraps existing EventBus

**Files to create**:
- `ui2/src/events/TypedEventBus.ts`

**Implementation**:
```typescript
// ui2/src/events/TypedEventBus.ts
import { EventBus } from './EventBus';
import type { RenderEvent, EventPayload } from '@/types/events';

export class TypedEventBus {
  private eventBus: EventBus;
  
  constructor() {
    this.eventBus = new EventBus();
  }
  
  emit<T extends RenderEvent['type']>(
    type: T, 
    payload: Omit<EventPayload<T>, 'type'>
  ): void {
    this.eventBus.emit(type, payload);
  }
  
  on<T extends RenderEvent['type']>(
    type: T,
    handler: (payload: EventPayload<T>) => void
  ): () => void {
    return this.eventBus.on(type, handler);
  }
  
  // Backward compatibility
  getLegacyBus(): EventBus {
    return this.eventBus;
  }
}

// Singleton
let typedEventBus: TypedEventBus | null = null;
export function getTypedEventBus(): TypedEventBus {
  if (!typedEventBus) {
    typedEventBus = new TypedEventBus();
  }
  return typedEventBus;
}
```

**Testing**:
- Create test file that emits and receives typed events
- Verify backward compatibility with legacy EventBus

**Commit message**:
```
feat(ui): Implement TypedEventBus with backward compatibility

- Type-safe emit and on methods
- Wraps existing EventBus for compatibility
- Singleton pattern matching existing code
```

---

### Ticket 1.3: Add useTypedEvent Hook
**Goal**: Create React hook for type-safe event subscriptions

**Files to create**:
- `ui2/src/hooks/useTypedEvent.ts`

**Implementation**:
```typescript
// ui2/src/hooks/useTypedEvent.ts
import { useEffect } from 'react';
import { getTypedEventBus } from '@/events/TypedEventBus';
import type { RenderEvent, EventPayload } from '@/types/events';

export function useTypedEvent<T extends RenderEvent['type']>(
  type: T,
  handler: (payload: EventPayload<T>) => void
): void {
  useEffect(() => {
    const unsubscribe = getTypedEventBus().on(type, handler);
    return unsubscribe;
  }, [type, handler]);
}
```

**Testing**:
- Test in a simple component
- Verify proper cleanup on unmount

**Commit message**:
```
feat(ui): Add useTypedEvent hook for React components

- Type-safe event subscriptions in components
- Automatic cleanup on unmount
- Maintains same pattern as useEvent
```

---

### Ticket 1.4: Migrate SliceView to Typed Events
**Goal**: Convert SliceView to use typed events as proof of concept

**Files to modify**:
- `ui2/src/components/views/SliceView.tsx`

**Changes**:
1. Import `useTypedEvent` instead of `useEvent`
2. Import `getTypedEventBus` instead of `getEventBus`
3. Replace event emissions with typed versions
4. Update event handlers with proper types

**Testing**:
- Load a volume
- Verify SliceView still renders
- Check crosshair updates work
- Test mouse interactions

**Commit message**:
```
refactor(ui): Migrate SliceView to typed events

- Replace string-based events with typed versions
- Maintain full backward compatibility
- First component using new event system
```

---

## Phase 2: ViewPlane Service (Remove Duplication)

### Ticket 2.1: Create ViewPlaneService
**Goal**: Centralize all ViewPlane calculations

**Files to create**:
- `ui2/src/services/ViewPlaneService.ts`

**Implementation**:
```typescript
// ui2/src/services/ViewPlaneService.ts
import type { ViewPlane, ViewType } from '@/types/coordinates';

export class ViewPlaneService {
  /**
   * Calculate uniform pixel size for medical imaging (square pixels)
   */
  calculatePixelSize(
    widthMm: number, 
    heightMm: number, 
    widthPx: number, 
    heightPx: number
  ): number {
    return Math.max(widthMm / widthPx, heightMm / heightPx);
  }
  
  /**
   * Calculate centering offsets for non-square volumes
   */
  calculateCenteringOffsets(
    volumeWidthMm: number,
    volumeHeightMm: number,
    viewWidthPx: number,
    viewHeightPx: number,
    pixelSize: number
  ): { x: number; y: number } {
    const actualWidthPx = volumeWidthMm / pixelSize;
    const actualHeightPx = volumeHeightMm / pixelSize;
    
    return {
      x: (viewWidthPx - actualWidthPx) * pixelSize / 2,
      y: (viewHeightPx - actualHeightPx) * pixelSize / 2
    };
  }
  
  /**
   * Create ViewPlane for specific slice position
   */
  createSliceViewPlane(
    axis: ViewType,
    slicePositionMm: number,
    bounds: { min: [number, number, number]; max: [number, number, number] },
    viewDimensions: [number, number]
  ): ViewPlane {
    // Implementation extracted from MosaicRenderService
    // ... (full implementation)
  }
}

// Singleton
let viewPlaneService: ViewPlaneService | null = null;
export function getViewPlaneService(): ViewPlaneService {
  if (!viewPlaneService) {
    viewPlaneService = new ViewPlaneService();
  }
  return viewPlaneService;
}
```

**Testing**:
- Unit tests for pixel size calculation
- Unit tests for centering offsets
- Integration test with known ViewPlane values

**Commit message**:
```
feat(ui): Create ViewPlaneService for coordinate calculations

- Centralize pixel size calculations
- Extract centering logic for non-square volumes
- Single source of truth for ViewPlane creation
```

---

### Ticket 2.2: Update MosaicRenderService to Use ViewPlaneService
**Goal**: Replace duplicated calculations with service calls

**Files to modify**:
- `ui2/src/services/MosaicRenderService.ts`

**Changes**:
1. Import `getViewPlaneService`
2. Replace inline pixel size calculations
3. Replace inline centering calculations
4. Use service for ViewPlane creation

**Testing**:
- Open MosaicView
- Verify grid renders correctly
- Test with non-square volumes
- Check slice positions are correct

**Commit message**:
```
refactor(ui): Use ViewPlaneService in MosaicRenderService

- Remove duplicated coordinate calculations
- Use centralized ViewPlane creation
- Maintain exact same behavior
```

---

### Ticket 2.3: Update SliceNavigationService
**Goal**: Use ViewPlaneService for coordinate transforms

**Files to modify**:
- `ui2/src/services/SliceNavigationService.ts`

**Changes**:
1. Import ViewPlaneService
2. Use service for any ViewPlane operations
3. Remove any duplicated calculations

**Testing**:
- Test slice slider navigation
- Verify bounds are correct
- Check crosshair updates

**Commit message**:
```
refactor(ui): Use ViewPlaneService in SliceNavigationService

- Consolidate coordinate transform logic
- Remove calculation duplication
- Consistent behavior across services
```

---

## Phase 3: Unified Render Events

### Ticket 3.1: Create Unified RenderRequest Type
**Goal**: Merge tag and viewType patterns into single type

**Files to modify**:
- `ui2/src/types/events.ts`

**Changes**:
```typescript
export interface RenderRequest {
  // Identifier for this render (either tag or viewType)
  id: string;
  // Type helps with debugging
  idType: 'tag' | 'viewType';
  // Optional metadata
  metadata?: {
    sliceIndex?: number;
    axis?: ViewType;
  };
}
```

**Testing**:
- TypeScript compilation
- No runtime changes

**Commit message**:
```
feat(ui): Add unified RenderRequest type

- Merge tag and viewType patterns
- Add metadata for debugging
- Foundation for unified rendering
```

---

### Ticket 3.2: Update useRenderCanvas for Unified Handling
**Goal**: Support both patterns through unified interface

**Files to modify**:
- `ui2/src/hooks/useRenderCanvas.ts`

**Changes**:
1. Accept RenderRequest instead of tag/viewType
2. Add debug logging for request routing
3. Maintain backward compatibility with both patterns

**Testing**:
- Test SliceView (viewType pattern)
- Test MosaicView (tag pattern)
- Verify no visual changes

**Commit message**:
```
refactor(ui): Unify render event handling in useRenderCanvas

- Support both tag and viewType through RenderRequest
- Add debug logging for event routing
- Maintain full backward compatibility
```

---

## Phase 4: Render State Store

### Ticket 4.1: Create RenderStateStore
**Goal**: Centralize rendering state management

**Files to create**:
- `ui2/src/stores/renderStateStore.ts`

**Implementation**:
```typescript
// ui2/src/stores/renderStateStore.ts
import { create } from 'zustand';

interface RenderState {
  isRendering: boolean;
  error: Error | null;
  lastImage: ImageBitmap | null;
}

interface RenderStateStore {
  // State per identifier (tag or viewType)
  states: Map<string, RenderState>;
  
  // Actions
  setRendering: (id: string, isRendering: boolean) => void;
  setError: (id: string, error: Error | null) => void;
  setImage: (id: string, image: ImageBitmap | null) => void;
  getState: (id: string) => RenderState;
  clearState: (id: string) => void;
}

export const useRenderStateStore = create<RenderStateStore>((set, get) => ({
  states: new Map(),
  
  setRendering: (id, isRendering) => {
    // Implementation
  },
  
  setError: (id, error) => {
    // Implementation
  },
  
  setImage: (id, image) => {
    // Implementation
  },
  
  getState: (id) => {
    // Implementation with defaults
  },
  
  clearState: (id) => {
    // Implementation
  }
}));
```

**Testing**:
- Unit tests for state management
- Test state isolation between IDs

**Commit message**:
```
feat(ui): Create RenderStateStore for centralized state

- Per-view/tag state tracking
- Replace scattered component state
- Foundation for consistent state management
```

---

### Ticket 4.2: Migrate SliceView to RenderStateStore
**Goal**: Replace local state with store

**Files to modify**:
- `ui2/src/components/views/SliceView.tsx`

**Changes**:
1. Remove local `isRendering`, `error` state
2. Use `useRenderStateStore` with viewId
3. Update event handlers to use store

**Testing**:
- Verify loading states appear
- Check error handling works
- Test multiple views update independently

**Commit message**:
```
refactor(ui): Use RenderStateStore in SliceView

- Replace local state with centralized store
- Consistent state management across views
- Maintain all existing functionality
```

---

## Phase 5: Image Lifecycle Service

### Ticket 5.1: Create ImageLifecycleService
**Goal**: Centralize ImageBitmap management

**Files to create**:
- `ui2/src/services/ImageLifecycleService.ts`

**Implementation**:
```typescript
// ui2/src/services/ImageLifecycleService.ts
export class ImageLifecycleService {
  private cache: WeakMap<string, ImageBitmap>;
  private memoryMonitor: {
    allocatedBitmaps: number;
    totalMemoryBytes: number;
  };
  
  store(id: string, bitmap: ImageBitmap): void {
    // Store with memory tracking
  }
  
  retrieve(id: string): ImageBitmap | null {
    // Get from cache
  }
  
  dispose(id: string): void {
    // Proper disposal with checks
  }
  
  checkMemoryPressure(): void {
    // Automatic cleanup if needed
  }
}
```

**Testing**:
- Test storage and retrieval
- Verify automatic cleanup
- Check memory tracking

**Commit message**:
```
feat(ui): Create ImageLifecycleService for bitmap management

- Centralized ImageBitmap lifecycle
- Automatic memory pressure handling
- WeakMap for GC integration
```

---

### Ticket 5.2: Integrate ImageLifecycleService
**Goal**: Use service in components

**Files to modify**:
- `ui2/src/hooks/useRenderCanvas.ts`
- `ui2/src/components/views/SliceView.tsx`

**Changes**:
1. Replace manual bitmap management
2. Use service for storage/disposal
3. Remove manual cleanup code

**Testing**:
- Long running session (memory leaks)
- Rapid view switching
- Component unmount cleanup

**Commit message**:
```
refactor(ui): Use ImageLifecycleService in components

- Replace manual bitmap management
- Consistent disposal patterns
- Prevent memory leaks
```

---

## Phase 6: Component Simplification

### Ticket 6.1: Merge SliceRenderer into useRenderCanvas
**Goal**: Reduce component layers

**Files to modify**:
- `ui2/src/hooks/useRenderCanvas.ts`
- Delete: `ui2/src/components/views/SliceRenderer.tsx`

**Changes**:
1. Move SliceRenderer logic into hook
2. Update components using SliceRenderer
3. Remove SliceRenderer file

**Testing**:
- All views still render
- Overlays work correctly
- No visual regressions

**Commit message**:
```
refactor(ui): Merge SliceRenderer into useRenderCanvas

- Reduce component hierarchy depth
- Simplify rendering pipeline
- Maintain all functionality
```

---

### Ticket 6.2: Consolidate Overlay Components
**Goal**: Unify overlay rendering

**Files to create**:
- `ui2/src/components/ui/UnifiedOverlays.tsx`

**Changes**:
1. Merge common overlay patterns
2. Create single overlay component
3. Update all views to use unified version

**Testing**:
- Loading overlays appear
- Error states display
- Coordinate overlays work

**Commit message**:
```
refactor(ui): Consolidate overlay components

- Single source for overlay rendering
- Consistent styling and behavior
- Cleaner component structure
```

---

## Testing Protocol After Each Ticket

1. **Start the app**: `cargo tauri dev`
2. **Load a volume**: File → Open
3. **Test SliceView**: 
   - All three views render
   - Crosshair updates
   - Mouse interactions work
4. **Test MosaicView**: 
   - View → Workspace → Mosaic
   - Grid renders correctly
   - Images are centered
5. **Test interactions**:
   - Slice slider navigation
   - Resize panels
   - Time navigation (if 4D)

## Rollback Protocol

If any ticket breaks the system:
1. `git reset --hard HEAD~1` (undo last commit)
2. Debug the issue
3. Fix and retry
4. If blocked, skip to next ticket and document

## Success Criteria

After all tickets:
- [ ] No string-based event errors
- [ ] No duplicated calculations
- [ ] Consistent render patterns
- [ ] Centralized state management
- [ ] No memory leaks
- [ ] Cleaner component hierarchy
- [ ] All existing features work

## Notes

- Each ticket should take 30-60 minutes
- Commit immediately after testing passes
- Keep extensive logs during migration
- Feature flag risky changes if needed
- Document any deviations from plan