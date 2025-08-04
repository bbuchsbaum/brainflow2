# Investigation Report: Images Not Displaying in FlexibleOrthogonalView

## Executive Summary

After investigating the issue where images are not displaying in FlexibleOrthogonalView after loading from FileBrowserPanel, I've identified several critical issues:

1. **Missing Import**: FlexibleOrthogonalView.tsx is missing the import for `useViewStateStore` which causes a runtime error
2. **CSS Layout Issues**: The ViewToolbar may be affecting the flex layout, causing the canvas containers to have 0 height
3. **Event Timing**: There may be timing issues between component mounting and render events

## Detailed Findings

### 1. Missing Import in FlexibleOrthogonalView.tsx

**Location**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/FlexibleOrthogonalView.tsx`

**Issue**: Line 90 uses `useViewStateStore` but it's not imported at the top of the file.

```typescript
// Line 90 in useEffect:
const hasLayers = useViewStateStore.getState().viewState.layers.length > 0;
```

**Impact**: This causes a runtime error that prevents the component from rendering properly.

**Fix Required**: Add the import statement:
```typescript
import { useViewStateStore } from '@/stores/viewStateStore';
```

### 2. CSS Layout Structure Issues

**Location**: FlexibleOrthogonalView component structure

The component has this structure:
```html
<div className="h-full w-full bg-gray-950 split-view-container flex flex-col">
  <ViewToolbar />  <!-- Fixed height toolbar -->
  <div className="flex-1">  <!-- Should take remaining space -->
    <Allotment>...</Allotment>
  </div>
</div>
```

**Potential Issue**: The ViewToolbar is taking up space but the flex-1 container might not be getting proper height due to CSS conflicts.

### 3. Canvas Rendering Flow Analysis

The rendering flow works as follows:

1. **File Loading** (FileLoadingService.ts):
   - File is loaded successfully
   - Layer is created with `visible: true`
   - Views are initialized with proper dimensions
   - Layer is added to both layerStore and viewStateStore

2. **Render Triggering** (coalesceUpdatesMiddleware.ts):
   - State changes are coalesced
   - Backend is notified to render
   - Backend sends `render.complete` events

3. **Canvas Display** (SliceView.tsx):
   - SliceView listens for `render.complete` events
   - When received, it draws the ImageBitmap to canvas
   - The component logs show it's receiving the events

### 4. Why Only Coronal View Renders

This suggests a layout issue where:
- The coronal view (bottom-right) has proper dimensions
- The axial (top) and sagittal (bottom-left) views might have 0 height/width
- This could be due to the flex layout not properly distributing space after adding the toolbar

### 5. Empty Div Issue

The reported empty div `<div style="height: 100%; width: 100%;"></div>` suggests that:
- The canvas element might not be rendering at all
- Or the canvas is rendering but with 0 dimensions
- This aligns with the flex layout hypothesis

## Root Cause Analysis

The most likely root causes are:

1. **Primary**: The missing `useViewStateStore` import is causing a JavaScript error that breaks the component initialization
2. **Secondary**: The addition of ViewToolbar changed the flex layout structure, potentially causing the Allotment container to have insufficient height
3. **Contributing**: The CSS rules in FlexibleOrthogonalView.css might need adjustment for the new layout

## Recommended Fixes

### Immediate Fix (High Priority)

1. Add the missing import to FlexibleOrthogonalView.tsx:
```typescript
import { useViewStateStore } from '@/stores/viewStateStore';
```

### Layout Fixes (Medium Priority)

2. Ensure proper flex layout in FlexibleOrthogonalView:
```tsx
<div className="h-full w-full bg-gray-950 flex flex-col">
  <ViewToolbar className="flex-shrink-0" />
  <div className="flex-1 min-h-0"> {/* Add min-h-0 to prevent flex issues */}
    <Allotment>...</Allotment>
  </div>
</div>
```

3. Check that SliceView canvases are getting proper dimensions by adding debug logging

### Verification Steps

After applying fixes:
1. Check browser console for JavaScript errors
2. Inspect the DOM to verify canvas elements have non-zero dimensions
3. Check that `render.complete` events are being received by all three views
4. Verify that ImageBitmaps are being drawn to all canvases

## Additional Observations

- The file loading service properly sets layers as visible
- The backend rendering seems to work correctly (ImageBitmaps are created)
- The coalescing middleware is functioning and triggering renders
- The issue appears to be purely on the frontend display side

## Conclusion

The primary issue is the missing import causing a runtime error. Once fixed, if issues persist, the flex layout structure should be examined to ensure all views get proper dimensions after the toolbar was added.