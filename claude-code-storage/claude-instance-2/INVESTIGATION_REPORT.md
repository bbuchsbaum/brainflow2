# Render Loop Investigation Report

## Problem Summary
The AppContent component is stuck in a render loop, having rendered 107+ times. This occurred after implementing status bar updates for crosshair and mouse position tracking.

## Root Cause Analysis

### Primary Issue: Missing Dependency in useEffect
The `useStatusBarService` hook has a critical bug in `ui2/src/hooks/useStatusBarService.ts`:

```javascript
export function useStatusBarService() {
  const statusUpdater = useStatusUpdater();

  useEffect(() => {
    const service = getStatusBarService();
    
    // Initialize the service with the status updater
    service.initialize(statusUpdater);

    // Cleanup on unmount
    return () => {
      service.cleanup();
    };
  }, []); // Empty deps - we only want to initialize once  <-- PROBLEM HERE
}
```

The `useEffect` has an empty dependency array `[]` but uses `statusUpdater` inside. This violates React's Rules of Hooks and can cause stale closures.

### Secondary Issue: Potential Re-initialization Loop
The `StatusBarService.initialize()` method checks if it's already initialized and cleans up first:

```javascript
initialize(statusUpdater: StatusUpdater) {
  if (this.isInitialized) {
    console.warn('[StatusBarService] Already initialized, cleaning up first');
    this.cleanup();
  }
  // ... rest of initialization
}
```

However, if `statusUpdater` is changing on every render (which it might be due to the `useMemo` in `useStatusUpdater`), this could cause continuous re-initialization.

## How the Render Loop Occurs

1. **AppContent renders** and calls `useStatusBarService()`
2. **useStatusUpdater()** creates a new memoized object containing `setValue`, `setBatch`, etc.
3. The **useEffect with empty deps** runs once and captures the initial `statusUpdater`
4. **StatusBarService subscriptions** to ViewState changes trigger status updates
5. These updates call `dispatch()` which updates the StatusContext state
6. **StatusContext state changes** cause AppContent to re-render (since it's a child of StatusProvider)
7. On re-render, **useStatusUpdater() creates a new memoized object** (even though functionally identical)
8. The cycle continues because the subscriptions keep firing

## Contributing Factors

### 1. StatusContext State Updates
Every status bar update triggers a context state change, which causes all consumers to re-render:

```javascript
// In StatusBarService.initialize()
this.statusUpdater.setValue('crosshair', formatted);  // Triggers context update
this.statusUpdater.setValue('mouse', formatCoord(data.world_mm));  // Another update
this.statusUpdater.setValue('fps', `${data.fps.toFixed(1)} fps`);  // And another
```

### 2. Multiple Components Using useStatusUpdater
- `MetadataStatusBridge` also uses `useStatusUpdater()`
- Each creates its own memoized instance
- Multiple services subscribing and updating status

### 3. Zustand Store Subscriptions
The StatusBarService subscribes directly to Zustand stores:
```javascript
const unsubscribeCrosshair = useViewStateStore.subscribe(
  state => state.viewState.crosshair,
  crosshair => {
    if (this.statusUpdater) {
      const formatted = formatCoord(crosshair.world_mm);
      this.statusUpdater.setValue('crosshair', formatted);
    }
  }
);
```

These subscriptions fire immediately and frequently, especially for mouse movements.

## Why This Wasn't Caught Earlier

1. The ESLint exhaustive-deps rule might be disabled or not catching this specific case
2. The render loop detection at line 86-107 in App.tsx only bails out after 100 renders
3. The issue manifests quickly due to frequent mouse/crosshair updates

## Recommended Fixes

### Fix 1: Correct the useEffect Dependencies
```javascript
export function useStatusBarService() {
  const statusUpdater = useStatusUpdater();

  useEffect(() => {
    const service = getStatusBarService();
    service.initialize(statusUpdater);

    return () => {
      service.cleanup();
    };
  }, [statusUpdater]); // Add statusUpdater to deps
}
```

### Fix 2: Stabilize the statusUpdater Reference
In `StatusContext.tsx`, ensure the dispatch function is stable:
```javascript
export const useStatusUpdater = () => {
  const dispatch = useSetStatus();
  
  // The dispatch function should already be stable from useReducer
  // But the memoized object might be recreated
  return useMemo(() => ({
    setValue: (id: string, value: string | ReactNode) => {
      dispatch({ type: 'SET', id, value });
    },
    // ... other methods
  }), [dispatch]); // dispatch is already stable, so this memo should be stable
};
```

### Fix 3: Prevent Re-initialization in StatusBarService
Add a check to prevent re-initialization with the same updater:
```javascript
private previousUpdater: StatusUpdater | null = null;

initialize(statusUpdater: StatusUpdater) {
  // Skip if initializing with the same updater
  if (this.previousUpdater === statusUpdater && this.isInitialized) {
    return;
  }
  
  if (this.isInitialized) {
    console.warn('[StatusBarService] Already initialized, cleaning up first');
    this.cleanup();
  }
  
  this.previousUpdater = statusUpdater;
  this.statusUpdater = statusUpdater;
  // ... rest of initialization
}
```

### Fix 4: Consider Moving Status Bar Service Initialization
Instead of initializing in a hook that runs on every AppContent render, consider:
1. Initialize once at the app root level
2. Use a more stable initialization pattern
3. Or ensure the hook properly handles re-renders

## Testing the Fix

After implementing the fixes:
1. Check that AppContent renders only a few times on startup
2. Verify status bar updates still work for crosshair/mouse movements
3. Ensure no memory leaks from subscription cleanup
4. Test that status updates are responsive and accurate

## Additional Observations

1. The coalescing middleware is working correctly and not contributing to the render loop
2. The render loop detection mechanism (lines 86-107) is a good safety net
3. Multiple services are trying to update status (MetadataStatusService, StatusBarService)
4. Consider consolidating status updates through a single service to avoid conflicts