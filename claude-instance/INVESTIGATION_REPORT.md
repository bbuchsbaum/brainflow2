# Crosshair Settings Runtime Update Investigation Report

## Problem Statement
The crosshair settings persist to localStorage and appear correctly after app restart, but do NOT update in the views during runtime. When users trigger a reslice (which causes a full backend render), the crosshair appearance doesn't change, indicating the settings are not reaching the components that need them.

## Investigation Findings

### 1. Data Flow Analysis

#### Context Provider Chain:
```
App.tsx
├── CrosshairProvider (creates context)
│   ├── CrosshairContext (useState for settings)
│   └── Children components
└── MosaicViewPromise → MosaicCell → useViewCrosshairSettings()
```

#### Settings Update Flow:
1. User changes settings in CrosshairSettingsPopover
2. Calls `updateSettings({ activeColor: newColor })` 
3. CrosshairContext.updateSettings() executes
4. Updates local state with `setSettings(prev => newSettings)`
5. Emits event: `getEventBus().emit('crosshair.settings.updated', newSettings)`
6. Components should re-render with new settings

### 2. Key Components Analysis

#### CrosshairContext.tsx (Lines 152-170)
```typescript
const updateSettings = (updates: Partial<CrosshairSettings>) => {
  console.log('[CrosshairContext] updateSettings called with:', updates);
  setSettings(prev => {
    const newSettings = { ...prev, ...updates };
    
    // Sync visibility with view state if it changed
    if (updates.visible !== undefined) {
      setViewCrosshairVisible(updates.visible);
    }
    
    // Emit an event to force views to redraw with new settings
    getEventBus().emit('crosshair.settings.updated', newSettings);
    
    return newSettings;
  });
};
```

**Issue 1**: The event is emitted INSIDE the setState callback, which means it fires before the state has actually updated in React's reconciliation cycle.

#### MosaicCell.tsx (Lines 49-56)
```typescript
const crosshairSettings = useViewCrosshairSettings(axis);

// Keep crosshair settings in a ref so we always have latest values
const crosshairSettingsRef = useRef(crosshairSettings);
useEffect(() => {
  crosshairSettingsRef.current = crosshairSettings;
}, [crosshairSettings]);
```

The component correctly gets settings and uses a ref to avoid stale closures, BUT it depends on the context to re-render the component when settings change.

#### useViewCrosshairSettings Hook (Lines 206-231)
```typescript
export function useViewCrosshairSettings(viewType?: 'axial' | 'sagittal' | 'coronal') {
  const { settings } = useCrosshairSettings();
  
  // Debug: Track when hook updates
  React.useEffect(() => {
    console.log('[useViewCrosshairSettings] Hook updated for', viewType, 'with settings:', settings);
  }, [settings, viewType]);
  
  return settings; // or settings with overrides
}
```

This hook correctly subscribes to context changes via `useCrosshairSettings()`.

### 3. Event Handling Analysis

#### Event Emission (CrosshairContext.tsx Line 166)
```typescript
getEventBus().emit('crosshair.settings.updated', newSettings);
```

#### Event Consumption (MosaicCell.tsx Lines 196-205)
```typescript
useEvent('crosshair.settings.updated', (newSettings) => {
  console.log('[MosaicCell] Crosshair settings updated:', newSettings);
  
  if (redrawCanvasRef.current) {
    console.log(`[MosaicCell ${tag}] Triggering redraw from settings event`);
    redrawCanvasRef.current();
  }
});
```

The event is properly listened to, but this is a **BACKUP mechanism**. The primary mechanism should be React context re-renders.

### 4. Root Cause Analysis

#### Primary Issue: Event Timing
The `crosshair.settings.updated` event is emitted **inside** the `setSettings()` callback. This means:

1. User calls `updateSettings({ activeColor: '#ff0000' })`
2. `setSettings(prev => { ... })` is called
3. **IMMEDIATELY** `emit('crosshair.settings.updated')` fires
4. Components receive event with new settings
5. **LATER** React re-renders components with context changes

The problem is that when the event fires, the consuming components haven't re-rendered yet, so they may still have stale settings in their render cycle.

#### Secondary Issue: React Context Update Timing
React Context updates are **asynchronous**. When `setSettings()` is called:
1. The state update is scheduled
2. The callback runs immediately (synchronously)
3. Components don't re-render until the next React update cycle
4. Event listeners fire immediately but components may not have latest context values

### 5. Evidence from Code

#### The Stale Closure Fix Attempts
Both MosaicCell and SliceView have tried to work around stale closure issues:

**MosaicCell.tsx (Lines 51-56):**
```typescript
// Keep crosshair settings in a ref so we always have latest values
// This solves the stale closure problem in event handlers
const crosshairSettingsRef = useRef(crosshairSettings);
useEffect(() => {
  crosshairSettingsRef.current = crosshairSettings;
}, [crosshairSettings]);
```

**SliceView.tsx (Lines 36-42):**
```typescript
// Keep crosshair settings in a ref so render function always gets latest values
// This solves the stale closure problem when the function is stored in a ref
const crosshairSettingsRef = useRef(crosshairSettings);
useEffect(() => {
  console.log(`[SliceView ${viewId}] Updating crosshairSettingsRef:`, crosshairSettings);
  crosshairSettingsRef.current = crosshairSettings;
}, [crosshairSettings, viewId]);
```

These fixes acknowledge the stale closure problem exists, but they don't solve the root cause.

### 6. The Real Problem

The issue is **React Context Update Ordering**:

1. **Synchronous Event Emission**: Event fires immediately in setState callback
2. **Asynchronous Context Updates**: React context consumers don't update until next render cycle
3. **Race Condition**: Event handlers may execute before components have latest context values

### 7. Debugging Evidence Needed

To confirm this analysis, we should look for these console logs:

1. `[CrosshairContext] updateSettings called with:` - Should appear
2. `[CrosshairContext] New settings:` - Should appear  
3. `[useViewCrosshairSettings] Hook updated for` - **May be missing or delayed**
4. `[MosaicCell] Crosshair settings updated:` - Event fires immediately
5. `[SliceView] Updating crosshairSettingsRef:` - **May be missing or delayed**

If steps 3 and 5 are missing or significantly delayed, it confirms the timing issue.

## Recommended Solutions

### Solution 1: Move Event Emission Outside setState (Recommended)
```typescript
const updateSettings = (updates: Partial<CrosshairSettings>) => {
  console.log('[CrosshairContext] updateSettings called with:', updates);
  
  setSettings(prev => {
    const newSettings = { ...prev, ...updates };
    
    // Sync visibility with view state if it changed
    if (updates.visible !== undefined) {
      setViewCrosshairVisible(updates.visible);
    }
    
    return newSettings;
  });
  
  // Move event emission outside setState to happen after React update
  // Use useEffect to emit event after state has actually updated
};

// Add separate useEffect for event emission
useEffect(() => {
  if (!isLoading) { // Only emit after initial load
    getEventBus().emit('crosshair.settings.updated', settings);
  }
}, [settings, isLoading]);
```

### Solution 2: Use flushSync for Synchronous Updates
```typescript
import { flushSync } from 'react-dom';

const updateSettings = (updates: Partial<CrosshairSettings>) => {
  flushSync(() => {
    setSettings(prev => {
      const newSettings = { ...prev, ...updates };
      // ... other logic
      return newSettings;
    });
  });
  
  // Event emitted after React has definitely updated
  getEventBus().emit('crosshair.settings.updated', settings);
};
```

### Solution 3: Remove Event Dependency (Simplest)
Since React Context should handle re-renders automatically, we could:
1. Remove the `crosshair.settings.updated` event emission
2. Remove event listeners in components
3. Rely solely on React Context updates
4. Fix any remaining stale closure issues

## Additional Investigation Findings

### Component Re-render Dependencies

#### MosaicCell Dependencies (Line 185)
```typescript
}, [axis, sliceIndex, viewState.crosshair, viewState.views, mosaicRenderService, crosshairSettings]);
```

The `customRender` callback depends on `crosshairSettings`, so when context updates, this should trigger a re-render.

#### SliceView Dependencies (Line 453)
```typescript
}, [crosshair, crosshairSettings, viewId]);
```

The redraw effect also depends on `crosshairSettings`.

### Context Provider Structure

Looking at the grep results, CrosshairProvider appears in:
- `App.tsx` - Top level
- `GoldenLayoutRoot.tsx` - Multiple instances(??)

This could indicate **multiple context providers**, which would isolate updates.

### Potential Additional Issues

1. **Multiple CrosshairProvider instances**: If there are multiple providers, updates in one don't propagate to consumers of another
2. **React.StrictMode**: May be causing double-renders that mask the timing issue in development
3. **Zustand store conflicts**: ViewStateStore also has crosshair visibility state that could interfere
4. **Event bus issues**: The event might be firing but not reaching all listeners

## Files Investigated

### Primary Issue Files
1. `/Users/bbuchsbaum/code/brainflow2/ui2/src/contexts/CrosshairContext.tsx` (Lines 152-170) - Event timing issue
2. `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/MosaicCell.tsx` (Lines 49-56, 196-205) - Context consumer
3. `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/SliceView.tsx` (Lines 36-42, 456-466) - Context consumer
4. `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/ui/CrosshairSettingsPopover.tsx` (Lines 28, 65, 90, 104) - Settings updater

### Context Provider Files
5. `/Users/bbuchsbaum/code/brainflow2/ui2/src/App.tsx` - Top-level provider
6. `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/layout/GoldenLayoutRoot.tsx` - Potential duplicate providers

### Event System Files
7. `/Users/bbuchsbaum/code/brainflow2/ui2/src/events/EventBus.ts` - Event emission/consumption
8. `/Users/bbuchsbaum/code/brainflow2/ui2/src/stores/viewStateStore.ts` - Crosshair visibility state

## Conclusion

The crosshair settings are not updating during runtime due to a **React Context update timing issue**. The event-based backup mechanism fires before React Context consumers have updated, creating a race condition.

The primary fix is to ensure events are emitted **after** React has processed the context update, not during the setState callback.

Secondary investigation should check for multiple context providers that could be isolating updates.

**RECOMMENDED IMMEDIATE FIX**: Move event emission to a useEffect that fires after settings state updates, ensuring React context consumers have the latest values when the event fires.