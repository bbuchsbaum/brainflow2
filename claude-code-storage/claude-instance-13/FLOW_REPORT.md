# MosaicView Rendering Flow Analysis Report

## Overview
This report traces the complete execution flow of MosaicView rendering, from component mount through to canvas display. The analysis reveals multiple critical issues preventing proper image display.

## Critical Issue: Missing React Hook Import
The most critical issue is that MosaicView.tsx uses `useCallback` on line 77 but doesn't import it. This causes an immediate runtime error that prevents the entire component from mounting.

```tsx
// Line 6 - Missing useCallback import
import React, { useState, useEffect, useMemo, useRef } from 'react';
// Should be:
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
```

## Component Mount Flow

### 1. MosaicView Component Initialization
When MosaicView mounts:

```
MosaicView mount
├── useState initializations (orientation, volumeBounds, cellViewCache, etc.)
├── useLayerStore → get layers array
├── useViewStateStore → get current viewState
├── getSliceNavigationService() → singleton service
├── getApiService() → singleton service
└── getRenderCoordinator() → singleton service
```

### 2. Primary Layer Selection
```tsx
// Line 325-327: Get first visible layer
const primaryLayer = useMemo(() => {
  return layers.find(layer => layer.visible);
}, [layers]);
```

**Issue**: If no layers are loaded or visible, `primaryLayer` is undefined, causing cascade failures.

### 3. Volume Bounds Fetching
```tsx
// Lines 330-343: Fetch volume bounds when primary layer changes
useEffect(() => {
  if (primaryLayer?.volumeId) {
    apiService.getVolumeBounds(primaryLayer.volumeId)
      .then(bounds => {
        setVolumeBounds(bounds);
        setCellViewCache({}); // Clear cache on volume change
      })
      .catch(error => {
        console.error('[MosaicView] Failed to fetch volume bounds:', error);
      });
  }
}, [primaryLayer?.volumeId, apiService]);
```

**Flow**: `primaryLayer.volumeId` → `apiService.getVolumeBounds()` → Backend call → `setVolumeBounds()`

### 4. Slice Range Calculation
```tsx
// Lines 350-358: Calculate slice positions from navigation service
const sliceRange = useMemo(() => {
  try {
    return sliceNavService.getSliceRange(orientation);
  } catch (error) {
    console.warn(`[MosaicView] Failed to get slice range for ${orientation}`, error);
    return { min: -100, max: 100, step: 1, current: 0 };
  }
}, [orientation, layers, viewState.crosshair.world_mm]);
```

**Flow**:
```
sliceNavService.getSliceRange(orientation)
├── Gets bottom layer metadata
├── Checks worldBounds
├── Returns min/max/step/current for axis
└── Falls back to defaults if no metadata
```

### 5. View Calculation and Caching
This is where MosaicView pre-calculates view planes for each cell:

```tsx
// Lines 387-433: Pre-calculate views for all visible cells
useEffect(() => {
  if (!primaryLayer?.volumeId || !volumeBounds) return;
  if (cellWidth <= 0 || cellHeight <= 0) return;
  
  const calculateAllCellViews = async () => {
    setViewsLoading(true);
    const newCache: CellViewCache = {};
    
    for (const position of slicePositions) {
      const cacheKey = `${orientation}-${position}-${cellWidth}x${cellHeight}`;
      
      if (cellViewCache[cacheKey]) {
        newCache[cacheKey] = cellViewCache[cacheKey];
        continue;
      }
      
      try {
        const cellCrosshair: [number, number, number] = [...viewState.crosshair.world_mm];
        const axisIndex = orientation === 'axial' ? 2 : 
                         orientation === 'sagittal' ? 0 : 1;
        cellCrosshair[axisIndex] = position;
        
        const view = await apiService.recalculateViewForDimensions(
          primaryLayer.volumeId,
          orientation,
          [cellWidth, cellHeight],
          cellCrosshair
        );
        
        newCache[cacheKey] = view;
      } catch (error) {
        console.error(`[MosaicView] Failed to calculate view for ${cacheKey}:`, error);
      }
    }
    
    setCellViewCache(newCache);
    setViewsLoading(false);
  };
  
  calculateAllCellViews();
}, [primaryLayer?.volumeId, volumeBounds, orientation, slicePositions, cellWidth, cellHeight, viewState.crosshair.world_mm, apiService]);
```

**Flow**:
```
For each slice position:
├── Generate cache key: `${orientation}-${position}-${cellWidth}x${cellHeight}`
├── Check if already cached
├── If not cached:
│   ├── Create cellCrosshair with position for this slice
│   ├── Call apiService.recalculateViewForDimensions()
│   │   └── Backend calculates ViewPlane for specific dimensions
│   └── Store result in cache
└── Update cellViewCache state
```

## MosaicCell Rendering Flow

### 6. Cell View Prop Passing
```tsx
// Lines 520-537: Pass cellView to each MosaicCell
{slicePositions.map((slicePos, index) => {
  const cacheKey = `${orientation}-${slicePos}-${cellWidth}x${cellHeight}`;
  const cellView = cellViewCache[cacheKey];
  
  return (
    <MosaicCell
      key={`${currentPage}-${index}-${slicePos}`}
      orientation={orientation}
      slicePosition={slicePos}
      onClick={() => handleSliceClick(slicePos)}
      isActive={Math.abs(slicePos - currentSlicePos) < sliceRange.step / 2}
      cellView={cellView}  // ← Critical prop
      volumeId={primaryLayer?.volumeId}
      isClickSource={clickSourceCell === `${orientation}-${slicePos}`}
      onCrosshairClick={() => setClickSourceCell(`${orientation}-${slicePos}`)}
    />
  );
})}
```

### 7. MosaicCell Render Request
Inside MosaicCell component:

```tsx
// Lines 112-245: Main render effect
useEffect(() => {
  const renderSlice = async () => {
    if (!canvasRef.current || dimensions.width <= 0 || dimensions.height <= 0) return;
    
    try {
      // Create modified viewState with cell-specific view
      const modifiedViewState: ViewState = {
        ...viewState,
        crosshair: {
          ...viewState.crosshair,
          world_mm: [...viewState.crosshair.world_mm] as [number, number, number]
        }
      };
      
      // Use cellView if available
      if (cellView) {
        modifiedViewState.views = {
          ...viewState.views,
          [orientation]: cellView  // ← Replace view for this orientation
        };
      }
      
      // Update crosshair position for this slice
      const axisIndex = orientation === 'axial' ? 2 : orientation === 'sagittal' ? 0 : 1;
      modifiedViewState.crosshair.world_mm[axisIndex] = slicePosition;
      
      // Request render through coordinator
      const imageBitmap = await renderCoordinator.requestRender({
        viewState: modifiedViewState,
        viewType: orientation,
        width: dimensions.width,
        height: dimensions.height,
        reason: 'layer_change',
        priority: 'normal'
      });
      
      if (imageBitmap && canvasRef.current) {
        // Draw to canvas...
      }
    } catch (err) {
      console.error(`[MosaicCell] Failed to render slice at ${slicePosition}:`, err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };
  
  renderSlice();
}, [viewState, orientation, slicePosition, dimensions, renderCoordinator, cellView, isActive, isHovered, isClickSource]);
```

## Render Coordinator Flow

### 8. Render Request Processing
```
renderCoordinator.requestRender()
├── Create QueuedJob with promise handlers
├── Check if resize operation → debounce 200ms
├── Otherwise enqueue immediate
├── Process queue
│   ├── executeRenderJob()
│   │   ├── apiService.applyAndRenderViewStateCore()
│   │   │   ├── Convert ViewState to DeclarativeViewState
│   │   │   ├── Invoke backend render command
│   │   │   ├── Receive image data (PNG or raw RGBA)
│   │   │   └── Create ImageBitmap
│   │   └── Update render store state
│   └── Resolve promise with ImageBitmap
└── Return ImageBitmap to caller
```

### 9. Canvas Drawing
Back in MosaicCell after receiving ImageBitmap:

```tsx
// Lines 148-191: Draw image to canvas
if (imageBitmap && canvasRef.current) {
  const ctx = canvasRef.current.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, dimensions.width, dimensions.height);
    
    // Calculate aspect-preserving dimensions
    const imageAspectRatio = imageBitmap.width / imageBitmap.height;
    const canvasAspectRatio = dimensions.width / dimensions.height;
    
    // Calculate draw position/size to preserve aspect
    // ... (aspect ratio calculations)
    
    ctx.drawImage(imageBitmap, drawX, drawY, drawWidth, drawHeight);
    
    // Store placement for coordinate transforms
    imagePlacementRef.current = {
      x: drawX, y: drawY,
      width: drawWidth, height: drawHeight,
      imageWidth: imageBitmap.width,
      imageHeight: imageBitmap.height
    };
    
    // Draw crosshair if visible...
  }
}
```

## Critical Failure Points

### 1. Component Mount Failure
- **Issue**: Missing `useCallback` import
- **Effect**: Runtime error prevents entire component from mounting
- **Result**: No rendering occurs at all

### 2. No Layers Loaded
- **Issue**: `primaryLayer` is undefined when no layers exist
- **Effect**: Volume bounds never fetched, view calculation skipped
- **Result**: Empty `cellViewCache`, no views to render

### 3. Missing Volume Bounds
- **Issue**: Backend fails to return volume bounds
- **Effect**: View calculation effect early-returns
- **Result**: No views calculated, empty cells

### 4. Cell View Calculation Failure
- **Issue**: `recalculateViewForDimensions` fails or returns invalid data
- **Effect**: Cell has no view plane
- **Result**: Render uses global view instead of cell-specific view

### 5. Coordinate Transform Error
- **Issue**: `screenToWorld` called with array instead of separate parameters
- **Effect**: Click handling fails
- **Result**: Cannot interact with cells properly

## Data Flow Summary

```
MosaicView Mount
├── Get visible layer
├── Fetch volume bounds
├── Calculate slice range
├── Pre-calculate all cell views
│   └── For each cell: backend calculates ViewPlane
├── Render grid of MosaicCells
│   └── Each cell:
│       ├── Receives pre-calculated cellView
│       ├── Creates modified ViewState
│       ├── Requests render from coordinator
│       ├── Receives ImageBitmap
│       └── Draws to canvas
└── Handle navigation/interaction
```

## Key Insights

1. **Pre-calculation Strategy**: MosaicView pre-calculates all cell views upfront to avoid redundant backend calls
2. **Cache Key Design**: Uses orientation, position, and dimensions to cache views
3. **View Isolation**: Each cell gets its own ViewPlane tailored to its dimensions
4. **Render Coordination**: All renders go through RenderCoordinator for queuing/debouncing
5. **Aspect Preservation**: Canvas drawing preserves image aspect ratio

## Recommendations

1. **Fix Critical Import**: Add `useCallback` to React imports immediately
2. **Add Loading States**: Show meaningful UI when layers/bounds are loading
3. **Error Boundaries**: Wrap cells in error boundaries to isolate failures
4. **Defensive Checks**: Validate cellView before using it
5. **Fix Coordinate Calls**: Update CoordinateTransform method calls to use correct signatures
6. **Add Diagnostics**: Log when cellViewCache is empty or views fail to calculate