# MosaicView Fix Implementation Plan

## Executive Summary

This plan addresses three critical issues in the MosaicView component:
1. **Aspect Ratio Distortion**: Axial images appear horizontally compressed due to missing aspect-preserving logic
2. **Image Centering**: Images are not centered within their grid cells
3. **Hover Border Display**: CSS hover borders only show on left and top edges due to overflow clipping

The root cause is that MosaicCell lacks the sophisticated image rendering logic that SliceView implements correctly. This plan provides a step-by-step solution to bring MosaicCell up to parity with SliceView's rendering quality.

## Issue Analysis

### 1. Aspect Ratio Problem

**Root Cause**: MosaicCell directly stretches images to fill the canvas without calculating proper scaling:
```typescript
// Current problematic code in MosaicView.tsx, line 87:
ctx.drawImage(imageBitmap, 0, 0, width, height);
```

**Why This Matters**: Medical imaging requires square pixels to preserve anatomical proportions. The backend correctly calculates uniform pixel sizes, but MosaicCell's naive rendering destroys this careful calculation.

### 2. Centering Problem

**Root Cause**: MosaicCell always draws from position (0, 0) without calculating centered placement when the image aspect ratio doesn't match the canvas.

### 3. CSS Border Problem

**Root Cause**: 
- Using Tailwind's `ring` utility (box-shadow) with `overflow-hidden` causes clipping
- The parent container clips the box-shadow on right and bottom edges

## Implementation Plan

### Phase 1: Fix Aspect Ratio and Centering

#### Step 1.1: Add Image Placement Tracking to MosaicCell

**File**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/MosaicView.tsx`

Add a ref to track image placement (after line 37):
```typescript
const imagePlacementRef = useRef<{
  x: number;
  y: number;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
} | null>(null);
```

#### Step 1.2: Implement Aspect-Preserving Drawing Logic

Replace the current `drawImage` implementation (lines 82-89) with:

```typescript
// Clear canvas first
ctx.clearRect(0, 0, width, height);

// Calculate aspect ratios
const imageWidth = imageBitmap.width;
const imageHeight = imageBitmap.height;
const imageAspectRatio = imageWidth / imageHeight;
const canvasAspectRatio = width / height;

let drawX = 0;
let drawY = 0;
let drawWidth = width;
let drawHeight = height;

if (imageAspectRatio > canvasAspectRatio) {
  // Image is wider than canvas - fit to width
  drawWidth = width;
  drawHeight = drawWidth / imageAspectRatio;
  drawX = 0;
  drawY = (height - drawHeight) / 2;
} else {
  // Image is taller than canvas - fit to height
  drawHeight = height;
  drawWidth = drawHeight * imageAspectRatio;
  drawX = (width - drawWidth) / 2;
  drawY = 0;
}

// Draw the image with calculated dimensions
ctx.drawImage(imageBitmap, drawX, drawY, drawWidth, drawHeight);

// Store placement for coordinate transforms
imagePlacementRef.current = {
  x: drawX,
  y: drawY,
  width: drawWidth,
  height: drawHeight,
  imageWidth: imageWidth,
  imageHeight: imageHeight
};
```

#### Step 1.3: Update Canvas CSS Classes

**Current Issue**: The `className="w-full h-full"` on the canvas element can cause additional stretching.

**Fix**: Remove these classes and use inline styles to match the exact pixel dimensions (line 116):

```typescript
<canvas
  ref={canvasRef}
  width={width}
  height={height}
  style={{ width: `${width}px`, height: `${height}px` }}
/>
```

### Phase 2: Fix CSS Border Display

#### Step 2.1: Replace Ring with Border

**File**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/MosaicView.tsx`

Replace the ring utilities with actual borders (line 102):

```typescript
// Old:
isActive ? 'ring-2 ring-blue-500' : 'hover:ring-2 hover:ring-blue-400'

// New:
isActive ? 'border-2 border-blue-500' : 'hover:border-2 hover:border-blue-400'
```

#### Step 2.2: Adjust Container Styling

To prevent border clipping while maintaining the rounded corners, modify the container classes (line 103):

```typescript
// Old:
className="relative bg-gray-800 rounded overflow-hidden"

// New:
className="relative bg-gray-800 rounded"
```

Then add `overflow-hidden` only to the canvas wrapper to maintain the rounded corners effect without clipping the border.

### Phase 3: Optional Enhancements

#### Step 3.1: Add Click Coordinate Transformation

If MosaicCell needs to handle clicks (for crosshair updates), add coordinate transformation using the stored image placement:

```typescript
const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
  if (!imagePlacementRef.current) return;
  
  const rect = canvasRef.current?.getBoundingClientRect();
  if (!rect) return;
  
  const canvasX = e.clientX - rect.left;
  const canvasY = e.clientY - rect.top;
  
  const { x, y, width, height, imageWidth, imageHeight } = imagePlacementRef.current;
  
  // Check if click is within the image bounds
  if (canvasX >= x && canvasX <= x + width && 
      canvasY >= y && canvasY <= y + height) {
    // Transform to image coordinates
    const imageX = ((canvasX - x) / width) * imageWidth;
    const imageY = ((canvasY - y) / height) * imageHeight;
    
    // Handle the click with proper coordinates
    handleCellClick(imageX, imageY);
  }
};
```

#### Step 3.2: Extract Common Rendering Logic

For long-term maintainability, consider extracting the aspect-preserving logic into a shared hook:

```typescript
// New file: ui2/src/hooks/useAspectPreservingCanvas.ts
export function useAspectPreservingCanvas() {
  const drawImagePreservingAspect = (
    ctx: CanvasRenderingContext2D,
    image: ImageBitmap,
    canvasWidth: number,
    canvasHeight: number
  ) => {
    // Aspect preservation logic here
    // Returns placement info
  };
  
  return { drawImagePreservingAspect };
}
```

## File Changes Summary

### Primary Changes Required:

1. **`/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/MosaicView.tsx`**:
   - Add `imagePlacementRef` for tracking image placement
   - Replace direct `drawImage` with aspect-preserving logic (lines 82-89)
   - Update canvas CSS to use fixed pixel dimensions (line 116)
   - Change from `ring` to `border` classes (line 102)
   - Remove `overflow-hidden` from container or restructure to prevent border clipping (line 103)

### No Backend Changes Required

The backend already correctly implements aspect ratio preservation in:
- `/Users/bbuchsbaum/code/brainflow2/core/neuro-types/src/view_rect.rs` (SliceGeometry::full_extent)
- The `recalculateViewForDimensions` API endpoint

The issue is purely in the frontend rendering implementation.

## Testing Plan

1. **Visual Testing**:
   - Load a dataset with known square anatomy (e.g., sphere phantom)
   - Verify circles appear as circles, not ellipses
   - Check all three orientations maintain proper proportions

2. **Centering Verification**:
   - Load images with different aspect ratios
   - Verify images are centered within their grid cells
   - Check for consistent padding on all sides

3. **Border Testing**:
   - Hover over cells and verify border appears on all four sides
   - Test with different grid sizes
   - Verify active cell border displays correctly

4. **Regression Testing**:
   - Ensure click interactions still work correctly
   - Verify grid navigation remains functional
   - Check that overlays (labels, coordinates) display properly

## Implementation Order

1. **First**: Implement aspect ratio and centering fixes (Phase 1)
   - This is the most critical issue affecting medical image accuracy
   
2. **Second**: Fix the CSS border display (Phase 2)
   - This is a visual polish issue but important for user experience
   
3. **Optional**: Add enhancements (Phase 3)
   - These improve code quality but aren't critical for functionality

## Expected Outcome

After implementing these changes:
- Medical images will display with anatomically correct proportions
- Images will be properly centered within their grid cells
- Hover borders will display consistently on all edges
- The MosaicView will match the rendering quality of SliceView

This maintains the architectural principle that heavy computation (calculating proper view dimensions) stays in Rust while the frontend handles display concerns properly.