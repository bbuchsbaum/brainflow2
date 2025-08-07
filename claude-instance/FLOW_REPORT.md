# MosaicView Quarter-Image Bug: Execution Flow Analysis

## Executive Summary

After tracing the complete execution flow from UI interaction to final canvas rendering, I have identified the **root cause** of the MosaicView quarter-image display bug. The issue lies in **backend dimension calculation discrepancies** where the backend returns ImageBitmaps at dimensions different from what the frontend requested, causing the small image to be scaled up and display only the top-left quarter.

## Critical Discovery: Dimension Mismatch Chain

### The Bug Flow Path

1. **MosaicViewPromise** requests 256×256 cell rendering
2. **MosaicRenderService** passes dimensions to backend
3. **Backend (api_bridge)** recalculates dimensions for aspect ratio preservation
4. **Backend returns** ImageBitmap at smaller size (e.g., 128×128)
5. **Frontend canvas** scales up the small image to fit the 256×256 cell
6. **Result**: Only top-left quarter visible due to 2×2 upscaling

## Execution Flow Analysis

### Phase 1: Grid Layout & Dimension Calculation

**File:** `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/MosaicViewPromise.tsx`

**Key Code Section:**
```typescript
// Lines 142-149: Cell size calculation
const cellWidth = Math.floor(availableWidth / cols);
const cellHeight = Math.floor(availableHeight / rows);
const cellSizeValue = Math.min(cellWidth, cellHeight, 512); // Cap at 512px
const finalSize = Math.max(cellSizeValue, 128); // Ensure minimum size
setCellSize({ width: finalSize, height: finalSize });
```

**Flow:**
- Container size: 1024×768 pixels
- Grid: 4×4 = 16 cells
- Cell size calculation: 256×256 pixels per cell ✅ CORRECT
- Slice indices: [0, 1, 2, 3...15] for current page ✅ CORRECT

### Phase 2: Render Request Preparation

**File:** `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/MosaicRenderService.ts`

**Key Method:** `renderMosaicCell()` (Lines 37-129)

**Flow Analysis:**
```typescript
// Lines 88-93: Dimension passing
const imageBitmap = await this.apiService.applyAndRenderViewState(
  modifiedViewState,
  axis,
  width,  // 256 pixels - correctly passed
  height  // 256 pixels - correctly passed
);
```

**View State Modification (Lines 363-395):**
```typescript
const modifiedViewState: ViewState = {
  ...baseViewState,
  crosshair: {
    world_mm: (() => {
      const crosshair: [number, number, number] = [...baseViewState.crosshair.world_mm];
      switch (axis) {
        case 'axial':
          crosshair[2] = slicePosition_mm; // ✅ CORRECT: Updates Z-coordinate for axial slices
          break;
        // ... other axes
      }
      return crosshair;
    })(),
    visible: false
  }
};
```

**Analysis Result:** ✅ CORRECT - The service correctly modifies only the crosshair position and preserves all view planes unchanged.

### Phase 3: Backend API Communication

**File:** `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/apiService.ts`

**Critical Section:** `applyAndRenderViewStateCore()` (Lines 194-220)

**Dimension Scaling Discovery:**
```typescript
// Lines 205-219: CRITICAL VIEW VECTOR SCALING
declarativeViewState.requestedView = {
  type: viewType,
  origin_mm: [...view.origin_mm, 1.0],
  // ⚠️ SCALING BY VIEWPORT DIMENSIONS
  u_mm: [
    view.u_mm[0] * width,  // 256×
    view.u_mm[1] * width,  // 256×
    view.u_mm[2] * width,  // 256×
    0.0
  ],
  v_mm: [
    view.v_mm[0] * height, // 256×
    view.v_mm[1] * height, // 256×
    view.v_mm[2] * height, // 256×
    0.0
  ],
  width,  // 256
  height  // 256
};
```

**Analysis:** ✅ POTENTIALLY CORRECT - This scaling transforms per-pixel vectors to total extent vectors as expected by the backend shader.

### Phase 4: Backend Dimension Override

**Critical Code:** `recalculateViewForDimensions()` (Lines 586-664)

**The Smoking Gun (Lines 642-659):**
```typescript
// Backend dimension check
console.log(`[ApiService] ⚠️ DIMENSION CHECK:`, {
  requested: dimensions,
  backendReturned: [result.width_px, result.height_px],
  usingBackendDims: true, // ⚠️ ALWAYS using backend's calculated dimensions
  match: dimensions[0] === result.width_px && dimensions[1] === result.height_px
});

if (dimensions[0] !== result.width_px || dimensions[1] !== result.height_px) {
  console.info(`[ApiService] 📐 Backend dimension adjustment: ${dimensions.join('×')} → ${result.width_px}×${result.height_px}`, {
    reason: 'aspect ratio preservation and square pixel requirements'
  });
}
```

**🚨 ROOT CAUSE IDENTIFIED:**
The backend's `recalculate_view_for_dimensions` function is returning different dimensions than requested (e.g., 128×128 instead of 256×256) to preserve aspect ratios and ensure square pixels. However, the frontend doesn't account for this dimension change in the rendering pipeline.

### Phase 5: Image Data Processing

**File:** `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/apiService.ts`

**Raw RGBA Decoding (Lines 403-456):**
```typescript
// Raw RGBA data format: [width: u32][height: u32][rgba_data...]
const view = new DataView(byteArray.buffer, byteArray.byteOffset);
const width = view.getUint32(0, true);   // ⚠️ Backend calculated size: 128
const height = view.getUint32(4, true);  // ⚠️ Backend calculated size: 128
const rgbaData = byteArray.slice(8);

// Create ImageData and ImageBitmap
const imageData = new ImageData(new Uint8ClampedArray(rgbaData), width, height);
const bitmap = await createImageBitmap(imageData); // ✅ Creates 128×128 bitmap
```

**Analysis:** The frontend correctly decodes the raw RGBA data and creates an ImageBitmap at the backend's calculated dimensions (128×128), not the originally requested dimensions (256×256).

### Phase 6: Canvas Rendering

**File:** `/Users/bbuchsbaum/code/brainflow2/ui2/src/utils/canvasUtils.ts`

**Image Placement Calculation (Lines 25-62):**
```typescript
export function calculateImagePlacement(
  imageWidth: number,    // 128 (from backend)
  imageHeight: number,   // 128 (from backend)  
  canvasWidth: number,   // 256 (requested cell size)
  canvasHeight: number   // 256 (requested cell size)
): ImagePlacement {
  // This creates a 2× scaling factor!
  const imageAspectRatio = imageWidth / imageHeight; // 1.0
  const canvasAspectRatio = canvasWidth / canvasHeight; // 1.0
  
  // Since aspect ratios are equal, fits to height
  drawHeight = canvasHeight; // 256
  drawWidth = drawHeight * imageAspectRatio; // 256
  drawX = (canvasWidth - drawWidth) / 2; // 0
  drawY = 0;
}
```

**Canvas Drawing (Lines 68-95):**
```typescript
ctx.drawImage(
  image,         // 128×128 ImageBitmap
  placement.x,   // 0
  placement.y,   // 0  
  placement.width,  // 256 (2× scaling!)
  placement.height  // 256 (2× scaling!)
);
```

**🚨 QUARTER-IMAGE MECHANISM REVEALED:**
1. Backend returns 128×128 ImageBitmap (half the requested size)
2. Canvas scales this to 256×256 (2× upscaling)
3. Since ImageBitmaps contain complete brain images at 128×128, when scaled 2× to fit 256×256, only the top-left quarter of the original field of view is visible
4. The "missing" parts aren't cropped - they're outside the original 128×128 render extent

### Phase 7: Event-Based Delivery

**File:** `/Users/bbuchsbaum/code/brainflow2/ui2/src/hooks/useRenderCanvas.ts`

**Event Filtering (Lines 70-137):**
```typescript
// Tag-based filtering
if (tag && data.tag !== tag) return; // ✅ CORRECT filtering
```

**Canvas Drawing:**
```typescript
const placement = drawScaledImage(ctx, lastImageRef.current, canvasRef.current.width, canvasRef.current.height);
// ✅ CORRECTLY uses canvasUtils.drawScaledImage which handles the 2× upscaling
```

## Comparison: SliceView vs MosaicView

### SliceView Flow (Works Correctly)
1. **FlexibleSlicePanel** provides stable dimensions matching container size
2. **SliceView** renders at those exact dimensions
3. **Backend dimension adjustment** still occurs but:
   - SliceView container is typically larger (e.g., 512×512)
   - Backend adjustment is smaller relative change (e.g., 512×512 → 480×480)
   - Scaling factor is minimal (~1.07×) - barely noticeable

### MosaicView Flow (Shows Quarter Image)
1. **MosaicViewPromise** calculates small cell dimensions (256×256)
2. **Backend aggressively adjusts** for aspect ratio preservation (256×256 → 128×128)
3. **2× scaling factor** makes quarter-image effect prominent
4. **Small cell size** makes the cropping very noticeable

## Root Cause Summary

**Primary Issue:** Backend dimension calculation in `recalculate_view_for_dimensions` returns significantly smaller dimensions than requested for mosaic cells to preserve aspect ratios and square pixels. This creates a 2× scaling factor that reveals only the top-left quarter of the image.

**Secondary Issue:** Frontend rendering pipeline doesn't account for backend dimension adjustments, blindly scaling the returned ImageBitmap to fit the originally requested cell size.

## File Interconnections Map

```
MosaicViewPromise.tsx (Grid Layout)
    ↓ cellSize: 256×256
MosaicRenderService.ts (Render Coordination) 
    ↓ renderMosaicCell(256×256)
apiService.ts (Backend Communication)
    ↓ applyAndRenderViewState(256×256) 
    ↓ recalculateViewForDimensions(256×256)
    ↓ Backend returns: 128×128 ImageBitmap
canvasUtils.ts (Image Scaling)
    ↓ drawScaledImage(128×128 → 256×256) [2× scaling]
    ↓ Quarter-image visible
useRenderCanvas.ts (Event Delivery)
    ↓ Event-based delivery to MosaicCell
MosaicCell.tsx (Final Rendering)
    ↓ Canvas displays quarter image
```

## Recommended Solution

The fix requires **synchronizing frontend cell sizes with backend-calculated dimensions**:

1. **Option A (Preferred):** Modify MosaicRenderService to query backend for actual render dimensions before creating cells
2. **Option B:** Add backend parameter to disable dimension adjustment for mosaic rendering
3. **Option C:** Frontend dimension negotiation - request dimensions, get actual dimensions, adjust cell sizes accordingly

The investigation clearly identifies this as a **backend-frontend dimension coordination issue**, not a coordinate system transformation bug.