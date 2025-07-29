# Code Execution Flow Analysis: Aspect Ratio and Centering in Rendering Pipeline

## Executive Summary

This report traces the complete execution flow for aspect ratio preservation and image centering through the Brainflow rendering pipeline. The analysis reveals two distinct rendering pathways with different approaches to aspect ratio handling:

1. **SliceView** - Properly preserves aspect ratio and centers images
2. **MosaicView** - Does NOT preserve aspect ratio, causing image distortion

## 1. FlexibleSlicePanel → SliceView Canvas Drawing Flow

### 1.1 Dimension Tracking and Updates

```
FlexibleSlicePanel (Component Mount)
├── ResizeObserver → tracks container size changes
├── Clamps dimensions via clampDimensions()
├── Throttled update (30ms) → updateDimensionsAndPreserveScale()
└── Passes dimensions to SliceView as props
```

**Key Points:**
- FlexibleSlicePanel acts as a container that tracks its own size
- Uses ResizeObserver for reactive size monitoring
- Throttles dimension updates to prevent excessive re-renders
- Passes exact pixel dimensions to SliceView

### 1.2 Backend Dimension Calculation

When dimensions change, the backend recalculates view parameters:

```rust
// view_rect.rs - SliceGeometry::full_extent()
// Lines 96-98: Critical aspect ratio preservation
let pixel_size = (width_mm / screen_px_max[0] as f32)
    .max(height_mm / screen_px_max[1] as f32);
```

This ensures:
- **Square pixels** are maintained (uniform pixel_size)
- Medical images retain anatomically correct proportions
- The entire anatomical extent fits within the view

## 2. SliceView handleRenderComplete Flow

### 2.1 Image Receipt and Storage

```
SliceView.handleRenderComplete (Lines 141-187)
├── Receives ImageBitmap from render.complete event
├── Stores in lastImageRef for future redraws
└── Calls redrawCanvasImpl()
```

### 2.2 Aspect-Preserving Image Drawing

The `redrawCanvasImpl` function (Lines 301-405) implements proper aspect ratio preservation:

```typescript
// Lines 334-350: Aspect ratio calculation
const imageAspectRatio = imageWidth / imageHeight;
const canvasAspectRatio = canvasRef.current.width / canvasRef.current.height;

if (imageAspectRatio > canvasAspectRatio) {
  // Image wider than canvas - fit to width
  drawWidth = canvasRef.current.width;
  drawHeight = drawWidth / imageAspectRatio;
  drawX = 0;
  drawY = (canvasRef.current.height - drawHeight) / 2; // Center vertically
} else {
  // Image taller than canvas - fit to height
  drawHeight = canvasRef.current.height;
  drawWidth = drawHeight * imageAspectRatio;
  drawX = (canvasRef.current.width - drawWidth) / 2; // Center horizontally
  drawY = 0;
}
```

**Result:** Images are:
- Scaled to fit within canvas while preserving aspect ratio
- Centered when there's extra space
- Never distorted

### 2.3 Image Placement Storage

```typescript
// Lines 392-399: Store placement for coordinate transforms
imagePlacementRef.current = {
  x: drawX,
  y: drawY,
  width: drawWidth,
  height: drawHeight,
  imageWidth: imageWidth,
  imageHeight: imageHeight
};
```

This placement info is crucial for:
- Mouse click coordinate transformation
- Crosshair rendering within image bounds

## 3. MosaicCell Rendering Flow (Missing Aspect Preservation)

### 3.1 Direct Canvas Drawing Without Scaling

```typescript
// MosaicView.tsx, Line 87: Direct drawing without aspect preservation
ctx.drawImage(imageBitmap, 0, 0, width, height);
```

**Problems:**
1. Forces image to fill entire canvas dimensions
2. No aspect ratio calculation
3. No centering logic
4. Results in stretched/squashed images

### 3.2 Canvas CSS Conflicts

```typescript
// Line 116: CSS classes that can cause additional distortion
className="w-full h-full"
```

This causes:
- Canvas element stretches to fill container via CSS
- Double distortion: first in drawImage, then in CSS
- Unpredictable final aspect ratio

## 4. CSS Styling Flow

### 4.1 Grid Layout Structure

```
MosaicView Container
├── Grid Container (flex-1 grid gap-2)
│   └── MosaicCell (relative bg-gray-800 rounded overflow-hidden)
│       ├── Canvas (w-full h-full) ← Problem: CSS stretching
│       └── Overlays (absolute positioned)
└── Navigation Controls
```

### 4.2 Hover State Implementation

```typescript
// Line 102: Ring utility for borders
isActive ? 'ring-2 ring-blue-500' : 'hover:ring-2 hover:ring-blue-400'
```

**Issue:** The `ring` utility creates box-shadow, not border:
- Can be clipped by `overflow-hidden` on parent
- May not display consistently across browsers
- Z-index stacking can hide the effect

## 5. Canvas vs Image Bitmap Dimension Relationships

### 5.1 SliceView (Correct Implementation)

```
Canvas Dimensions (from props) → Fixed pixel buffer
    ↓
ImageBitmap (from backend) → May have different aspect ratio
    ↓
fitImageToCanvas logic → Calculates scale and position
    ↓
Drawn with proper aspect ratio and centering
```

### 5.2 MosaicCell (Incorrect Implementation)

```
Canvas Dimensions (fixed) → Set by grid layout
    ↓
ImageBitmap (from backend) → Aspect ratio ignored
    ↓
Direct drawImage → Stretches to fill canvas
    ↓
CSS w-full h-full → Additional stretching
```

## 6. Render Pipeline Integration

### 6.1 Unified Render Flow

```
ViewState Change
    ↓
RenderCoordinator.requestRender()
    ↓
Backend Render (with per-view dimensions)
    ↓
ImageBitmap Created
    ↓
SliceView: Aspect-preserving draw
MosaicCell: Direct stretch draw ← PROBLEM
```

### 6.2 Backend View Calculation

For MosaicView, each cell requests a custom view:

```typescript
// Lines 233-238: Per-cell view calculation
const view = await apiService.recalculateViewForDimensions(
  primaryLayer.volumeId,
  orientation,
  [cellWidth, cellHeight],
  cellCrosshair
);
```

Backend properly calculates square pixels, but MosaicCell's rendering negates this.

## 7. Critical Issues Identified

### 7.1 MosaicCell Rendering
- **No aspect ratio preservation logic**
- **Direct stretch drawing** distorts medical images
- **CSS conflicts** with w-full h-full classes

### 7.2 CSS Border Display
- **Ring utility issues** with overflow-hidden
- **Box-shadow clipping** on container edges

### 7.3 Missing Coordinate Transform
- **No imagePlacementRef** equivalent in MosaicCell
- **Click coordinates** won't map correctly to world space

## 8. Recommendations

### 8.1 Immediate Fixes for MosaicCell

1. **Copy SliceView's aspect-preserving logic:**
```typescript
// Replace line 87 in MosaicCell with SliceView's approach
const imageAspectRatio = imageBitmap.width / imageBitmap.height;
const canvasAspectRatio = width / height;
// ... (implement full fitImageToCanvas logic)
```

2. **Remove CSS stretching:**
```typescript
// Remove or modify className="w-full h-full"
// Use fixed dimensions or maintain aspect ratio in CSS
```

3. **Fix border display:**
```typescript
// Replace ring with border
isActive ? 'border-2 border-blue-500' : 'hover:border-2 hover:border-blue-400'
```

### 8.2 Long-term Improvements

1. **Extract common rendering logic** into a shared component/hook
2. **Store image placement** for proper coordinate transforms
3. **Ensure CSS and canvas dimensions** work together harmoniously
4. **Add aspect ratio tests** to prevent regression

## Conclusion

The investigation reveals that SliceView implements a sophisticated aspect-preserving rendering pipeline that maintains medical image integrity, while MosaicCell uses a naive approach that distorts images. The fix requires implementing SliceView's fitImageToCanvas logic in MosaicCell and addressing CSS conflicts that cause additional distortion.