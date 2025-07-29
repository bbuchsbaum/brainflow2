# Detailed Plan to Fix Crosshair Update Error in SliceViewRefactored

## Overview
This plan addresses the TypeError that occurs when clicking in SliceViewRefactored to update the crosshair position. The error is caused by passing incorrect parameters to the `setCrosshair` function.

## Root Cause Summary
- **Error**: `TypeError: undefined is not a function (near '...[x, y, z]...')`
- **Location**: viewStateStore.ts line 170 (reported as line 106 in error message due to code shifts)
- **Cause**: SliceViewRefactored passes an object `{ world_mm: worldCoord, visible: true }` instead of the expected array `[x, y, z]`

## Phase 1: Immediate Fix for SliceViewRefactored

### 1.1 Fix the setCrosshair Call
**File**: `/ui2/src/components/views/SliceViewRefactored.tsx`
**Line**: 228
**Current Code**:
```typescript
setCrosshair({ world_mm: worldCoord, visible: true });
```
**Fixed Code**:
```typescript
try {
  await setCrosshair(worldCoord, true);
  console.log(`[SliceViewRefactored ${viewId}] Crosshair updated successfully`);
} catch (error) {
  console.error(`[SliceViewRefactored ${viewId}] Failed to update crosshair:`, error);
}
```

### 1.2 Update Function Signature
**File**: `/ui2/src/components/views/SliceViewRefactored.tsx`
**Line**: 174
**Current**: `const handleMouseDown = useCallback(async (event: React.MouseEvent<HTMLDivElement>) => {`
**Action**: Ensure the function remains async (it already is)

### 1.3 Import Verification
**File**: `/ui2/src/components/views/SliceViewRefactored.tsx`
**Lines**: Check imports section
**Verify**: Ensure `setCrosshair` is properly imported from `useViewStateStore`
**Expected Import**:
```typescript
import { useViewStateStore } from '../../stores/viewStateStore';
```

## Phase 2: Type Safety Improvements

### 2.1 Add Type Annotations
**File**: `/ui2/src/components/views/SliceViewRefactored.tsx`
**Action**: Add explicit type annotation when destructuring setCrosshair
**Code**:
```typescript
const { setCrosshair }: { 
  setCrosshair: (
    position: [number, number, number], 
    updateViews?: boolean, 
    immediate?: boolean
  ) => Promise<void> 
} = useViewStateStore();
```

### 2.2 Verify WorldCoordinates Type
**File**: `/ui2/src/types/coordinates.ts`
**Action**: Verify the WorldCoordinates type definition exists and is correctly imported
**Expected**:
```typescript
export type WorldCoordinates = [number, number, number];
```

## Phase 3: Consistency Check Across Codebase

### 3.1 Search for Other Incorrect Usage
**Files to Check**:
- All files that import and use `setCrosshair`
- Search pattern: `setCrosshair\s*\(\s*{`

**Known Correct Usage Examples**:
- `/ui2/src/components/views/SliceView.tsx` (line 256)
- `/ui2/src/services/StoreSyncService.ts`
- `/ui2/src/services/FileLoadingService.ts`
- `/ui2/src/services/SliceNavigationService.ts`

### 3.2 Document Function Signature
**File**: `/ui2/src/stores/viewStateStore.ts`
**Line**: Above the setCrosshair function definition (around line 150)
**Add JSDoc**:
```typescript
/**
 * Updates the crosshair position in world coordinates
 * @param position - World coordinates as [x, y, z] array
 * @param updateViews - Whether to update slice positions to show crosshair (default: false)
 * @param immediate - Bypass coalescing for immediate update (default: false)
 */
setCrosshair: async (position: WorldCoordinates, updateViews = false, immediate = false) => {
```

## Phase 4: Testing and Validation

### 4.1 Manual Testing Steps
1. Run the application: `cargo tauri dev`
2. Load a NIfTI volume
3. Click in each view (axial, sagittal, coronal) of SliceViewRefactored
4. Verify:
   - No console errors
   - Crosshair updates to clicked position
   - All views update to show new crosshair position
   - Crosshair coordinates display correctly in status bar

### 4.2 Add Debug Logging
**File**: `/ui2/src/stores/viewStateStore.ts`
**Line**: Inside setCrosshair function (after line 150)
**Add**:
```typescript
console.log('[viewStateStore] setCrosshair called with:', {
  position,
  updateViews,
  immediate,
  positionType: Array.isArray(position) ? 'array' : typeof position
});
```

### 4.3 Error Boundary
**File**: `/ui2/src/components/views/SliceViewRefactored.tsx`
**Action**: Consider wrapping the component in an error boundary to catch any runtime errors gracefully

## Phase 5: Backend Communication Verification

### 5.1 Verify Backend Update
**File**: `/ui2/src/stores/viewStateStore.ts`
**Line**: Inside setCrosshair, after state update
**Verify**: The backendUpdateCallback is called correctly
**Expected Flow**:
1. State update triggers middleware
2. Coalescing middleware batches update (unless immediate=true)
3. Backend receives update via `plugin:api-bridge|update_view_state`

### 5.2 Check Rust Side
**File**: `/core/api_bridge/src/lib.rs`
**Function**: `update_view_state`
**Verify**: The function correctly handles crosshair updates from the frontend

## Phase 6: Performance Considerations

### 6.1 Immediate Flag Usage
**Consider**: For mouse interactions, using `immediate=true` for responsive updates
**Update Line 228 in SliceViewRefactored.tsx**:
```typescript
await setCrosshair(worldCoord, true, true); // third parameter for immediate update
```

### 6.2 Event Throttling
**File**: `/ui2/src/components/views/SliceViewRefactored.tsx`
**Consider**: Adding throttling to prevent excessive updates during rapid clicking
**Implementation**:
```typescript
import { throttle } from 'lodash';

const handleMouseDownThrottled = useMemo(
  () => throttle(handleMouseDown, 50),
  [handleMouseDown]
);
```

## Phase 7: Documentation and Code Quality

### 7.1 Update Component Comments
**File**: `/ui2/src/components/views/SliceViewRefactored.tsx`
**Add comment above handleMouseDown**:
```typescript
/**
 * Handles mouse click to update crosshair position
 * Transforms screen coordinates to world coordinates and updates global crosshair
 */
```

### 7.2 Migration Guide
**Create**: `/ui2/src/docs/SLICEVIEW_MIGRATION.md`
**Content**: Document the differences between SliceView and SliceViewRefactored, including this crosshair fix

## Implementation Order

1. **Immediate Fix** (Phase 1.1) - Fix the critical error
2. **Testing** (Phase 4.1) - Verify the fix works
3. **Type Safety** (Phase 2) - Prevent future errors
4. **Consistency** (Phase 3) - Ensure no other components have similar issues
5. **Performance** (Phase 6) - Optimize user experience
6. **Documentation** (Phase 7) - Maintain code quality

## Success Criteria

- ✅ No TypeError when clicking in SliceViewRefactored
- ✅ Crosshair updates to clicked position
- ✅ All orthogonal views update to show new crosshair
- ✅ Console shows success logs instead of errors
- ✅ Consistent behavior with original SliceView
- ✅ Proper async handling with error recovery
- ✅ Type-safe implementation preventing future errors

## Risk Mitigation

1. **Backward Compatibility**: The fix maintains the same external API
2. **Error Handling**: Try-catch prevents crashes if setCrosshair fails
3. **Logging**: Debug logs help diagnose any remaining issues
4. **Type Safety**: Explicit types prevent similar errors in the future
5. **Testing**: Manual test plan ensures functionality works end-to-end

## Notes

- The error message shows line 106 but the actual error is at line 170 due to code changes
- The "visible" property in the incorrect call doesn't exist in the function signature - visibility is always set to true internally
- The coalescing middleware may affect update timing unless immediate=true is used
- This fix aligns SliceViewRefactored with the working implementation in SliceView