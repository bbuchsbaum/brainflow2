# MosaicView vs SliceView Centering & Zoom Investigation Report

## Executive Summary

After a comprehensive line-by-line comparison between the working SliceView and the problematic MosaicView components, I have identified **5 critical differences** that explain why MosaicView shows images slightly off-center and zoomed. The issues stem from dimension handling, backend API usage, and canvas rendering differences.

## Key Files Analyzed

### Working Reference (SliceView)
- `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/SliceView.tsx`
- Uses direct `drawScaledImage` from `canvasUtils.ts`
- Proper dimension validation and handling
- Direct backend API calls with consistent parameters

### Problematic Implementation (MosaicView)  
- `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/MosaicViewPromise.tsx`
- `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/MosaicCell.tsx`
- `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/SliceRenderer.tsx`
- `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/MosaicRenderService.ts`
- Uses layered abstraction with potential dimension inconsistencies

## Critical Differences Found

### 1. Backend API Call Differences (MAJOR ISSUE)

**SliceView (Working):**
- Direct call to `applyAndRenderViewState` with **optional** width/height parameters
- Uses default backend dimensions (512x512) when not specified
- Line 496 in SliceView: `drawScaledImage(ctx, imageBitmap, canvasRef.current.width, canvasRef.current.height)`

**MosaicView (Problematic):**
- MosaicRenderService explicitly avoids passing width/height to backend
- Line 88-92 in MosaicRenderService.ts:
```typescript
const imageBitmap = await this.apiService.applyAndRenderViewState(
  modifiedViewState,
  axis
  // DO NOT pass width/height - they cause incorrect view vector scaling
);
```
- **This is the root cause** - MosaicView gets backend images at 512x512 but tries to display them in smaller cells

### 2. Canvas Dimension Mismatch (MAJOR ISSUE)

**SliceView (Working):**
- Canvas dimensions match container: `width={canvasWidth || validWidth}` (line 692)
- Direct 1:1 relationship between canvas size and display size
- Proper dimension validation: lines 52-61 ensure valid width/height

**MosaicView (Problematic):**  
- MosaicCell requests specific cell dimensions: `width={cellSize.width}` (line 340 in MosaicViewPromise)
- But backend returns 512x512 images regardless
- SliceRenderer canvas set to: `width={width}` (line 176) - uses cell size, not backend image size
- **Dimension mismatch**: 256x256 cell displaying 512x512 backend image causes zoom/centering issues

### 3. Image Scaling Logic Differences (MODERATE ISSUE)

**SliceView (Working):**
- Direct call to `drawScaledImage` utility function
- Line 496: `drawScaledImage(ctx, imageBitmap, canvasRef.current.width, canvasRef.current.height)`
- Uses actual canvas dimensions for scaling calculations

**MosaicView (Problematic):**
- Goes through `useRenderCanvas` hook which calls `drawScaledImage`
- Line 46 in useRenderCanvas.ts: `drawScaledImage(ctx, lastImageRef.current, canvasRef.current.width, canvasRef.current.height)`
- **Same scaling logic BUT different canvas dimensions** - this is where the centering goes wrong

### 4. View State Generation Differences (MODERATE ISSUE)

**SliceView (Working):**
- Uses existing ViewState from store directly
- No modification of view planes or coordinates
- Backend handles all framing automatically

**MosaicView (Problematic):**
- Creates modified ViewState per slice in `createSliceViewState` (line 286-394 in MosaicRenderService)
- Only modifies crosshair position, preserves view planes
- Line 363-384: Complex crosshair position calculation
- **Potential coordinate transform issues** when view planes don't match actual render dimensions

### 5. CSS Layout and Container Structure (MINOR ISSUE)

**SliceView (Working):**
```jsx
<div className="w-full h-full flex items-center justify-center">
  <canvas
    width={canvasWidth || validWidth}
    height={canvasHeight || validHeight}
    className={`block border border-gray-300 cursor-crosshair`}
  />
</div>
```

**MosaicView (Problematic):**
```jsx
<div className="w-full h-full flex items-center justify-center">
  <canvas
    width={width}
    height={height} 
    className={`block ${canvasClassName}`}
  />
</div>
```

**MosaicView CSS (line 45 in MosaicView.css):**
```css
.mosaic-cell canvas {
  border: 1px solid #d1d5db;
  image-rendering: pixelated;
}
```

**Difference**: MosaicView has `image-rendering: pixelated` which may affect how scaled images appear.

## Specific Code Evidence

### Backend Image Size Issue
**MosaicRenderService.ts Line 86:**
```typescript
console.log(`[MosaicRenderService] DEBUG - Calling applyAndRenderViewState for ${cellId} WITHOUT dimensions (cell is ${width}x${height})`);

const imageBitmap = await this.apiService.applyAndRenderViewState(
  modifiedViewState,
  axis
  // DO NOT pass width/height - they cause incorrect view vector scaling
);
```

The comment itself reveals the issue - MosaicView deliberately doesn't pass dimensions to avoid "incorrect view vector scaling", but this means:
1. Backend always returns 512x512 images
2. Frontend tries to display them in smaller cells (typically 256x256 or less)
3. The scaling calculation in `drawScaledImage` operates on mismatched dimensions

### Dimension Calculation Issue
**MosaicViewPromise.tsx Lines 142-149:**
```typescript
// Calculate optimal cell size (maintain square aspect)
const cellWidth = Math.floor(availableWidth / cols);
const cellHeight = Math.floor(availableHeight / rows);
const cellSizeValue = Math.min(cellWidth, cellHeight, 512); // Cap at 512px

// Ensure minimum size
const finalSize = Math.max(cellSizeValue, 128);

setCellSize({ width: finalSize, height: finalSize });
```

This creates cells smaller than 512px, but backend still returns 512x512 images.

## Root Cause Analysis

The fundamental issue is a **dimension synchronization problem** between:

1. **Frontend cell size**: Calculated based on grid layout (typically 128-512px)
2. **Backend render size**: Always 512x512 (default when no dimensions passed)
3. **Canvas display size**: Set to frontend cell size
4. **Image scaling**: Attempts to fit 512px backend image into smaller canvas

This mismatch causes the scaling calculation in `calculateImagePlacement` to:
- Use incorrect aspect ratios
- Position images off-center 
- Apply inappropriate zoom levels

## Recommended Solutions

### Option 1: Pass Cell Dimensions to Backend (Preferred)
Modify MosaicRenderService to pass actual cell dimensions:
```typescript
const imageBitmap = await this.apiService.applyAndRenderViewState(
  modifiedViewState,
  axis,
  width,  // Pass actual cell width
  height  // Pass actual cell height
);
```

### Option 2: Use Fixed Backend Size
Always request 512x512 from backend and set canvas to match:
```typescript
// In MosaicCell
<canvas width={512} height={512} />
```

### Option 3: Post-process Scaling
Add a scaling layer that properly handles the dimension mismatch before calling `drawScaledImage`.

## Impact Assessment

- **Severity**: High - affects core functionality of MosaicView
- **User Experience**: Images appear incorrectly centered and zoomed
- **Data Integrity**: No data corruption, purely display issue
- **Backwards Compatibility**: Fix should not affect existing SliceView functionality

## Files Requiring Changes

If implementing Option 1 (recommended):
1. `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/MosaicRenderService.ts` - Line 88-92
2. Potentially `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/apiService.ts` - Verify view vector scaling logic

## Testing Strategy

1. Load a volume in both SliceView and MosaicView
2. Compare centering and zoom levels
3. Verify crosshair alignment between views
4. Test with different grid sizes (2x2, 3x3, 4x4)
5. Validate on different screen resolutions

## Conclusion

The MosaicView centering and zoom issues are caused by dimension mismatches between the frontend cell size calculations and the backend render dimensions. The backend consistently returns 512x512 images while the frontend attempts to display them in dynamically sized cells, leading to incorrect scaling and positioning. The fix requires synchronizing these dimensions or handling the mismatch appropriately in the scaling logic.