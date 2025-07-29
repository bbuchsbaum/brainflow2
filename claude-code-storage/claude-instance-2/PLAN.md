# Comprehensive Plan to Fix Render Loop Issue

## Problem Summary

The application is experiencing a critical render loop where the `AppContent` component renders 107+ times before the safety bailout mechanism triggers. This issue was introduced when implementing status bar updates for crosshair and mouse position tracking. The render loop severely impacts performance and user experience.

### Core Issue
The `useStatusBarService` hook violates React's Rules of Hooks by using `statusUpdater` inside a `useEffect` with an empty dependency array. This creates a stale closure and triggers a cascade of re-renders through React Context updates.

## Root Cause Analysis

### Primary Causes

1. **Missing Dependency in useEffect** (`ui2/src/hooks/useStatusBarService.ts:23`)
   - The hook uses `statusUpdater` but doesn't include it in the dependency array
   - This violates React's exhaustive-deps rule and creates a stale closure

2. **Frequent Status Updates**
   - Mouse movements, crosshair changes, and FPS updates fire continuously
   - Each update triggers a React Context state change
   - Context changes cause all consumers (including AppContent) to re-render

3. **Unstable Hook References**
   - `useStatusUpdater()` creates a new memoized object on each render
   - Even though functionally identical, the object reference changes
   - This can trigger unnecessary re-initializations

### Circular Dependency Chain
```
AppContent render → useStatusBarService() → useStatusUpdater() [new object]
→ useEffect with [] deps [stale closure] → StatusBarService subscriptions
→ Events fire → statusUpdater.setValue() → Context dispatch
→ State change → AppContent re-render (loop continues)
```

## Proposed Solution

### Solution Architecture

The solution involves a multi-layered approach:

1. **Immediate Fix**: Correct the hook dependency
2. **Stabilize References**: Ensure statusUpdater reference stability
3. **Optimize Updates**: Implement debouncing/throttling for frequent events
4. **Architectural Improvement**: Separate status bar state from main app state
5. **Performance Optimization**: Use React.memo and selective subscriptions

### Detailed Solutions

#### 1. Fix Hook Dependencies (Critical - Immediate Fix)

**File**: `ui2/src/hooks/useStatusBarService.ts`

```typescript
export function useStatusBarService() {
  const statusUpdater = useStatusUpdater();

  useEffect(() => {
    const service = getStatusBarService();
    service.initialize(statusUpdater);

    return () => {
      service.cleanup();
    };
  }, [statusUpdater]); // Add statusUpdater to dependencies
}
```

#### 2. Stabilize StatusUpdater Reference

**File**: `ui2/src/contexts/StatusContext.tsx`

```typescript
// Create a stable identity for the updater functions
const useStatusUpdater = () => {
  const dispatch = useSetStatus();
  
  // Use useCallback to ensure stable function references
  const setValue = useCallback((id: string, value: string | ReactNode) => {
    dispatch({ type: 'SET', id, value });
  }, [dispatch]);
  
  const setBatch = useCallback((entries: StatusBatchUpdate) => {
    dispatch({ type: 'BATCH', entries });
  }, [dispatch]);
  
  const removeValue = useCallback((id: string) => {
    dispatch({ type: 'REMOVE', id });
  }, [dispatch]);
  
  const clear = useCallback(() => {
    dispatch({ type: 'CLEAR' });
  }, [dispatch]);
  
  // Return a stable object reference
  return useMemo(() => ({
    setValue,
    setBatch,
    removeValue,
    clear
  }), [setValue, setBatch, removeValue, clear]);
};
```

#### 3. Prevent Unnecessary Re-initializations

**File**: `ui2/src/services/StatusBarService.ts`

```typescript
class StatusBarService {
  private statusUpdater: StatusUpdater | null = null;
  private subscriptions: (() => void)[] = [];
  private isInitialized = false;
  private initializationId: symbol | null = null;

  initialize(statusUpdater: StatusUpdater) {
    // Create a unique ID for this initialization
    const currentInitId = Symbol('init');
    
    // If already initialized with the same updater, skip
    if (this.isInitialized && this.statusUpdater === statusUpdater) {
      console.log('[StatusBarService] Already initialized with same updater, skipping');
      return;
    }
    
    if (this.isInitialized) {
      console.warn('[StatusBarService] Already initialized, cleaning up first');
      this.cleanup();
    }
    
    this.initializationId = currentInitId;
    this.statusUpdater = statusUpdater;
    this.isInitialized = true;
    
    console.log('[StatusBarService] Initializing service');
    
    // Set up subscriptions with initialization check
    this.setupSubscriptions(currentInitId);
  }
  
  private setupSubscriptions(initId: symbol) {
    // Add initialization ID check to prevent stale updates
    const isCurrentInit = () => this.initializationId === initId;
    
    // ... rest of subscription setup with isCurrentInit() checks
  }
}
```

#### 4. Implement Update Throttling

**File**: `ui2/src/services/StatusBarService.ts`

```typescript
import { throttle, debounce } from 'lodash-es';

class StatusBarService {
  // Throttle frequent updates
  private updateMousePosition = throttle((worldMm: number[]) => {
    if (this.statusUpdater && this.isInitialized) {
      this.statusUpdater.setValue('mouse', formatCoord(worldMm));
    }
  }, 50); // Update at most every 50ms
  
  private updateFPS = throttle((fps: number) => {
    if (this.statusUpdater && this.isInitialized) {
      this.statusUpdater.setValue('fps', `${fps.toFixed(1)} fps`);
    }
  }, 250); // Update FPS every 250ms
  
  private updateCrosshair = debounce((worldMm: number[]) => {
    if (this.statusUpdater && this.isInitialized) {
      this.statusUpdater.setValue('crosshair', formatCoord(worldMm));
    }
  }, 10); // Debounce crosshair updates by 10ms
  
  private setupSubscriptions(initId: symbol) {
    const isCurrentInit = () => this.initializationId === initId;
    
    // Mouse coordinate subscription with throttling
    const unsubscribeMouseCoord = eventBus.on('mouse.worldCoordinate', (data) => {
      if (isCurrentInit()) {
        this.updateMousePosition(data.world_mm);
      }
    });
    
    // FPS subscription with throttling
    const unsubscribeFps = eventBus.on('render.fps', (data) => {
      if (isCurrentInit()) {
        this.updateFPS(data.fps);
      }
    });
    
    // Crosshair subscription with debouncing
    const unsubscribeCrosshair = useViewStateStore.subscribe(
      state => state.viewState.crosshair,
      crosshair => {
        if (isCurrentInit()) {
          this.updateCrosshair(crosshair.world_mm);
        }
      }
    );
    
    this.subscriptions.push(
      unsubscribeMouseCoord,
      unsubscribeFps,
      unsubscribeCrosshair
    );
  }
  
  cleanup() {
    // Cancel any pending throttled/debounced calls
    this.updateMousePosition.cancel?.();
    this.updateFPS.cancel?.();
    this.updateCrosshair.cancel?.();
    
    // ... rest of cleanup
  }
}
```

#### 5. Optimize Context Updates with Batching

**File**: `ui2/src/contexts/StatusContext.tsx`

```typescript
// Add a batched update mechanism
export const useStatusUpdater = () => {
  const dispatch = useSetStatus();
  
  // Create a batched update queue
  const updateQueueRef = useRef<Map<string, string | ReactNode>>(new Map());
  const rafIdRef = useRef<number | null>(null);
  
  const flushUpdates = useCallback(() => {
    if (updateQueueRef.current.size > 0) {
      const entries = Object.fromEntries(updateQueueRef.current);
      dispatch({ type: 'BATCH', entries });
      updateQueueRef.current.clear();
    }
    rafIdRef.current = null;
  }, [dispatch]);
  
  const setValue = useCallback((id: string, value: string | ReactNode) => {
    updateQueueRef.current.set(id, value);
    
    // Schedule flush on next animation frame
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(flushUpdates);
    }
  }, [flushUpdates]);
  
  const setValueImmediate = useCallback((id: string, value: string | ReactNode) => {
    dispatch({ type: 'SET', id, value });
  }, [dispatch]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        flushUpdates();
      }
    };
  }, [flushUpdates]);
  
  return useMemo(() => ({
    setValue,          // Batched updates
    setValueImmediate, // For critical updates
    setBatch: (entries: StatusBatchUpdate) => dispatch({ type: 'BATCH', entries }),
    removeValue: (id: string) => dispatch({ type: 'REMOVE', id }),
    clear: () => dispatch({ type: 'CLEAR' })
  }), [setValue, setValueImmediate, dispatch]);
};
```

#### 6. Separate Status Bar State (Optional - Long-term)

Consider moving status bar state out of React Context to avoid triggering React re-renders:

**File**: `ui2/src/stores/statusBarStore.ts` (new file)

```typescript
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

interface StatusBarState {
  values: Record<string, string | ReactNode>;
  setValue: (id: string, value: string | ReactNode) => void;
  setBatch: (entries: Record<string, string | ReactNode>) => void;
  removeValue: (id: string) => void;
  clear: () => void;
}

export const useStatusBarStore = create<StatusBarState>()(
  subscribeWithSelector((set) => ({
    values: {},
    setValue: (id, value) => set((state) => ({
      values: { ...state.values, [id]: value }
    })),
    setBatch: (entries) => set((state) => ({
      values: { ...state.values, ...entries }
    })),
    removeValue: (id) => set((state) => {
      const { [id]: _, ...rest } = state.values;
      return { values: rest };
    }),
    clear: () => set({ values: {} })
  }))
);
```

## Implementation Steps

### Phase 1: Immediate Fixes (Priority: Critical)

1. **Fix useStatusBarService Hook** (`ui2/src/hooks/useStatusBarService.ts`)
   - Add `statusUpdater` to the dependency array
   - Test that the service initializes correctly

2. **Stabilize StatusUpdater Reference** (`ui2/src/contexts/StatusContext.tsx`)
   - Implement `useCallback` for all updater functions
   - Ensure the memoized object has stable dependencies

3. **Add Re-initialization Guards** (`ui2/src/services/StatusBarService.ts`)
   - Check if already initialized with same updater
   - Add initialization ID to prevent stale updates

### Phase 2: Performance Optimization (Priority: High)

4. **Implement Update Throttling** (`ui2/src/services/StatusBarService.ts`)
   - Throttle mouse position updates (50ms)
   - Throttle FPS updates (250ms)
   - Debounce crosshair updates (10ms)

5. **Add Batched Updates** (`ui2/src/contexts/StatusContext.tsx`)
   - Implement requestAnimationFrame-based batching
   - Provide both batched and immediate update methods

### Phase 3: Testing and Validation (Priority: High)

6. **Update Tests**
   - Add tests for hook dependencies
   - Test throttling behavior
   - Verify no memory leaks from subscriptions

7. **Performance Testing**
   - Measure render count reduction
   - Verify status updates still work correctly
   - Check for any regressions

### Phase 4: Long-term Improvements (Priority: Medium)

8. **Consider Architectural Changes**
   - Evaluate moving status bar state to Zustand
   - Separate high-frequency updates from React state
   - Implement selective subscriptions

## Risk Assessment

### Low Risk
- Adding hook dependencies (standard React practice)
- Implementing throttling (common performance optimization)
- Adding initialization guards (defensive programming)

### Medium Risk
- Changing memoization strategy (could affect other components)
- Batching updates (might introduce slight delays)
- Modifying subscription lifecycle (ensure proper cleanup)

### Mitigation Strategies
1. Implement changes incrementally
2. Test each phase thoroughly before proceeding
3. Monitor performance metrics
4. Keep the render loop detection as a safety net
5. Add console logging for debugging

## Testing Strategy

### Unit Tests

1. **Hook Dependency Tests**
   ```typescript
   // Test that useStatusBarService re-initializes when statusUpdater changes
   test('useStatusBarService reinitializes on statusUpdater change', () => {
     const { rerender } = renderHook(() => useStatusBarService());
     // Verify initialization and cleanup behavior
   });
   ```

2. **Throttling Tests**
   ```typescript
   // Test that mouse updates are throttled
   test('mouse position updates are throttled to 50ms', () => {
     // Simulate rapid mouse movements
     // Verify update frequency
   });
   ```

3. **Stability Tests**
   ```typescript
   // Test that statusUpdater reference is stable
   test('statusUpdater maintains stable reference', () => {
     const { result, rerender } = renderHook(() => useStatusUpdater());
     const firstRef = result.current;
     rerender();
     expect(result.current).toBe(firstRef);
   });
   ```

### Integration Tests

1. **Render Count Test**
   - Load the application
   - Move mouse rapidly
   - Verify AppContent renders < 10 times

2. **Status Bar Functionality**
   - Verify all status values update correctly
   - Check crosshair position updates
   - Confirm FPS display works

3. **Performance Regression Test**
   - Measure time to first meaningful paint
   - Check memory usage patterns
   - Monitor subscription cleanup

### Manual Testing Checklist

- [ ] Application loads without render loop
- [ ] Mouse position updates in status bar
- [ ] Crosshair position updates correctly
- [ ] FPS counter shows realistic values
- [ ] No console warnings about re-initialization
- [ ] Performance feels smooth
- [ ] Memory usage remains stable
- [ ] All other features continue working

## Alternative Approaches

### Alternative 1: Event-Driven Status Bar
Instead of React Context, use a pure event-driven approach:
- Status bar components subscribe directly to events
- No React state involved for high-frequency updates
- Updates happen outside React's render cycle

### Alternative 2: Web Worker for Status Updates
Move status formatting to a Web Worker:
- Offload coordinate formatting
- Batch updates from worker
- Reduce main thread work

### Alternative 3: Virtual Status Bar
Implement a virtual DOM for status bar:
- Manual DOM updates for status values
- Bypass React for these specific updates
- Keep React for structural changes only

## Success Criteria

1. **Render Count**: AppContent renders < 10 times on startup
2. **Performance**: No noticeable lag during mouse movement
3. **Functionality**: All status updates work correctly
4. **Memory**: No memory leaks from subscriptions
5. **Code Quality**: Passes all linting rules
6. **Testing**: All tests pass, including new ones

## Timeline

- **Phase 1**: 1-2 hours (immediate fixes)
- **Phase 2**: 2-3 hours (performance optimization)
- **Phase 3**: 2-3 hours (testing and validation)
- **Phase 4**: Optional, based on results

Total estimated time: 5-8 hours for complete implementation