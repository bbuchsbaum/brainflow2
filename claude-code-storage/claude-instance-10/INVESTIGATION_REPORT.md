# MosaicView Aspect Ratio and Centering Investigation Report

## Overview
This report investigates issues with the MosaicView component not preserving aspect ratio and images not being centered properly, as well as CSS hover border display issues.

## Key Findings

### 1. MosaicView Canvas Rendering Issues

The MosaicView component (`/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/MosaicView.tsx`) has several issues in how it renders images:

#### a) Canvas Sizing vs Image Sizing
- **Line 114-116**: The canvas element is set with fixed pixel dimensions:
  ```tsx
  <canvas
    ref={canvasRef}
    width={width}
    height={height}
    className="w-full h-full"
  />
  ```
- The `className="w-full h-full"` causes the canvas to stretch to fill its container, which can distort the aspect ratio if the container's aspect ratio doesn't match the canvas's pixel dimensions.

#### b) Image Drawing Without Aspect Preservation
- **Line 87**: Images are drawn directly to canvas without preserving aspect ratio:
  ```tsx
  ctx.drawImage(imageBitmap, 0, 0, width, height);
  ```
- This forces the image to fill the entire canvas dimensions, causing distortion if the image's aspect ratio doesn't match.

### 2. SliceView's Proper Implementation

In contrast, SliceView (`/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/SliceView.tsx`) properly handles aspect ratio and centering:

#### a) Aspect Ratio Preservation (Lines 334-350)
```tsx
const imageAspectRatio = imageWidth / imageHeight;
const canvasAspectRatio = canvasRef.current.width / canvasRef.current.height;

if (imageAspectRatio > canvasAspectRatio) {
  // Image is wider than canvas - fit to width
  drawWidth = canvasRef.current.width;
  drawHeight = drawWidth / imageAspectRatio;
  drawX = 0;
  drawY = (canvasRef.current.height - drawHeight) / 2;
} else {
  // Image is taller than canvas - fit to height
  drawHeight = canvasRef.current.height;
  drawWidth = drawHeight * imageAspectRatio;
  drawX = (canvasRef.current.width - drawWidth) / 2;
  drawY = 0;
}
```

#### b) Centered Drawing
The SliceView calculates `drawX` and `drawY` to center the image within the canvas when there's extra space.

### 3. Backend Aspect Ratio Handling

The backend properly calculates uniform pixel sizes to maintain square pixels:

#### ViewRectMm::full_extent (Lines 96-98 in view_rect.rs)
```rust
// Choose pixel size so pixels are square
let pixel_size = (width_mm / screen_px_max[0] as f32)
    .max(height_mm / screen_px_max[1] as f32);
```

This ensures that medical images maintain anatomically correct proportions.

### 4. updateDimensionsAndPreserveScale Implementation

The `updateDimensionsAndPreserveScale` method in viewStateStore properly recalculates views:

1. **Backend Path** (Line 335-351): Calls `recalculateViewForDimensions` API
2. **Frontend Fallback** (Line 389): Calculates uniform pixel size:
   ```typescript
   const pixelSize = Math.max(widthMm / newWidth, heightMm / newHeight);
   ```

Both paths ensure square pixels are maintained.

### 5. CSS Hover Border Issue

The MosaicCell uses Tailwind's `ring` classes for borders (Line 102):
```tsx
isActive ? 'ring-2 ring-blue-500' : 'hover:ring-2 hover:ring-blue-400'
```

The `ring` utility in Tailwind creates a box-shadow, not a border. This can sometimes display incorrectly if:
- The parent container has `overflow-hidden` (which it does on line 103)
- Z-index stacking issues
- Browser rendering quirks with box-shadows

## Root Causes

1. **MosaicView doesn't implement aspect-preserving image drawing** - It simply stretches the image to fill the canvas dimensions.

2. **No centering logic in MosaicView** - Images are drawn from (0,0) to (width, height) without calculating proper placement.

3. **CSS class conflicts** - The `w-full h-full` class on the canvas element can cause aspect ratio distortion at the CSS level.

4. **Ring shadow clipping** - The `overflow-hidden` on the container can clip the ring (box-shadow) on certain sides.

## Recommendations

1. **Implement aspect-preserving drawing in MosaicCell** - Copy the drawing logic from SliceView's `redrawCanvasImpl` method.

2. **Remove or adjust CSS classes** - Either remove `w-full h-full` from the canvas or ensure the container has the same aspect ratio.

3. **Use border instead of ring** - Replace the ring classes with actual border classes for more reliable rendering:
   ```tsx
   isActive ? 'border-2 border-blue-500' : 'hover:border-2 hover:border-blue-400'
   ```

4. **Store image placement info** - Like SliceView does with `imagePlacementRef`, store the actual image placement for proper coordinate transformation.

5. **Consider using a shared rendering component** - Extract the common canvas rendering logic into a reusable component that both SliceView and MosaicCell can use.

## Files Examined

- `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/MosaicView.tsx`
- `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/SliceView.tsx`
- `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/FlexibleSlicePanel.tsx`
- `/Users/bbuchsbaum/code/brainflow2/ui2/src/stores/viewStateStore.ts`
- `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/apiService.ts`
- `/Users/bbuchsbaum/code/brainflow2/core/neuro-types/src/view_rect.rs`
- `/Users/bbuchsbaum/code/brainflow2/core/api_bridge/src/lib.rs`