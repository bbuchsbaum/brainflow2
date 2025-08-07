# Crosshair Settings Update Investigation Report

## Problem Summary
When users change crosshair settings (color, thickness, style) in the CrosshairSettingsDialog, the changes are saved and appear on app restart, but they don't update immediately in the current session. The crosshair appearance only reflects the new settings after restarting the application.

## Root Cause Analysis

### 1. Missing Event Type Definition
**PRIMARY ISSUE**: The `crosshair.settings.updated` event is emitted but NOT defined in the EventMap interface.

**Evidence:**
- `CrosshairContext.tsx:166` emits: `getEventBus().emit('crosshair.settings.updated', newSettings);`
- `SliceView.tsx:446` listens: `useEvent('crosshair.settings.updated', (newSettings) => { ... });`
- But in `events/EventBus.ts`, there is NO `'crosshair.settings.updated'` event defined in the `EventMap` interface

**Impact:** TypeScript allows the code to compile because the EventBus uses generic types, but the event system may not be properly handling this undefined event type, causing the listener in SliceView to never receive the event.

### 2. Event Flow Analysis

#### Current Flow (BROKEN):
1. **Settings Dialog**: User changes setting → `updateLocalSetting()` called
2. **CrosshairContext**: `updateSettings()` called → localStorage updated → event emitted
3. **EventBus**: `crosshair.settings.updated` event emitted (but not in EventMap)
4. **SliceView**: Listener registered but never receives event due to missing type definition
5. **Crosshair Rendering**: Never redraws with new settings

#### Expected Flow (SHOULD WORK):
1. Settings Dialog → CrosshairContext → Event emitted
2. SliceView receives event → Forces canvas redraw with new settings
3. Crosshair immediately updates with new appearance

### 3. SliceView Crosshair Rendering Mechanism

**The rendering architecture is actually well-designed:**
- SliceView stores crosshair settings in `crosshairSettingsRef.current` to avoid stale closures
- The `renderCrosshairImpl()` function always reads from the ref to get latest settings
- There's a proper event listener for `crosshair.settings.updated` that triggers `redrawCanvasImpl()`
- The redraw mechanism exists and works correctly

**The problem is simply that the event never arrives.**

### 4. Persistence vs Runtime Update

**Why persistence works but runtime doesn't:**
- **Persistence**: CrosshairContext properly saves to localStorage in `updateSettings()`
- **App Restart**: CrosshairContext loads from localStorage on mount, providing fresh settings
- **Runtime**: Event emission fails silently due to missing EventMap definition

### 5. Code Evidence

#### CrosshairContext.tsx (Lines 152-169):
```typescript
const updateSettings = (updates: Partial<CrosshairSettings>) => {
  console.log('[CrosshairContext] updateSettings called with:', updates);
  setSettings(prev => {
    const newSettings = { ...prev, ...updates };
    
    // ... visibility sync logic ...
    
    // Emit an event to force views to redraw with new settings
    // This ensures the crosshair appearance updates immediately
    getEventBus().emit('crosshair.settings.updated', newSettings);  // ← EVENT EMITTED
    
    return newSettings;
  });
};
```

#### SliceView.tsx (Lines 445-452):
```typescript
// Listen for crosshair settings updates to force redraw
useEvent('crosshair.settings.updated', (newSettings) => {  // ← EVENT LISTENER
  if (lastImageRef.current && canvasRef.current) {
    requestAnimationFrame(() => {
      redrawCanvasImpl();
    });
  }
});
```

#### EventBus.ts (Lines 10-95) - EventMap interface:
```typescript
export interface EventMap {
  // Crosshair events
  'crosshair.updated': { world_mm: [number, number, number] };
  'crosshair.clicked': { world_mm: [number, number, number]; button: number };
  'crosshair.visibility': { visible: boolean };
  
  // ❌ MISSING: 'crosshair.settings.updated' event definition
  
  // ... other events ...
}
```

## Solution

### Immediate Fix
Add the missing event type to the EventMap interface in `/ui2/src/events/EventBus.ts`:

```typescript
export interface EventMap {
  // Crosshair events
  'crosshair.updated': { world_mm: [number, number, number] };
  'crosshair.clicked': { world_mm: [number, number, number]; button: number };
  'crosshair.visibility': { visible: boolean };
  'crosshair.settings.updated': CrosshairSettings;  // ← ADD THIS LINE
  
  // ... rest of events
}
```

### Import Required
The `CrosshairSettings` type needs to be imported in EventBus.ts:

```typescript
import type { CrosshairSettings } from '@/contexts/CrosshairContext';
```

## Testing Strategy

After implementing the fix:

1. **Immediate Update Test**: Open crosshair settings, change color/thickness/style → should update immediately
2. **Persistence Test**: Change settings → restart app → settings should persist
3. **Multiple Views Test**: Ensure all orthogonal views (axial, sagittal, coronal) update simultaneously
4. **Event Integrity Test**: Verify no other event listeners are affected

## Risk Assessment

**Low Risk**: This is a simple type definition addition that doesn't change any runtime behavior, just enables the existing event system to work correctly.

**No Breaking Changes**: All existing functionality will continue to work as before.

## Additional Observations

### Well-Architected Components
1. **CrosshairContext**: Properly manages settings state and persistence
2. **SliceView**: Correctly uses refs to avoid stale closures
3. **Event System**: Robust EventBus implementation with proper error handling
4. **Settings Dialog**: Implements real-time preview (calls `updateSettings` immediately)

### Performance Considerations
The current approach of redrawing the entire canvas when settings change is appropriate because:
- Crosshair settings don't change frequently
- Canvas redraws are fast for the size of typical slice views
- It ensures visual consistency across all UI states

## Conclusion

This is a classic case of a missing type definition causing a runtime failure in an otherwise well-architected system. The fix is simple and surgical - just adding one line to the EventMap interface will restore the intended real-time crosshair settings update functionality.

The system was designed correctly from the beginning; it just had one missing type definition preventing the event from being properly handled by TypeScript's type system.