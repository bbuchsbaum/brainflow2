# MosaicView Fix Implementation Plan

## Executive Summary

The MosaicView component has two critical rendering issues:
1. **Partial Brain Display**: Only the upper-left portion of the brain is visible in each grid cell
2. **Identical Slices**: All cells show the same slice despite different position labels

Both issues stem from incorrect view parameter calculations and missing slice-specific view adjustments.

## Root Cause Analysis

### Issue 1: Partial Brain Display

**Root Cause**: MosaicCell uses global view parameters designed for 512x512 main panels, but renders into smaller cells (e.g., 250x180). This causes:
- Incorrect pixel-to-mm scaling
- Only a portion of the anatomical extent being visible
- The portion shown is always upper-left because the origin_mm remains unchanged

**Technical Details**:
- Global view vectors (u_mm, v_mm) define per-pixel displacement in mm
- When these vectors are used with smaller dimensions, each pixel covers more mm than intended
- The view "zooms in" unintentionally, showing only part of the brain

### Issue 2: All Cells Show Same Slice

**Root Cause**: The current implementation only modifies the crosshair position, not the actual view plane:
- The renderer uses view.origin_mm to determine which slice to render
- Changing crosshair.world_mm doesn't affect the rendered slice
- All cells use the same view.origin_mm from the global viewState

## Solution Architecture

### Core Principle
Each MosaicCell must calculate its own view parameters that:
1. Show the full anatomical extent within the cell dimensions
2. Position the view plane at the correct slice
3. Maintain uniform pixel size (square pixels) for accurate anatomy

### Implementation Strategy

We'll follow the pattern established by FlexibleSlicePanel, which correctly handles view recalculation:

1. **Backend Integration**: Use the existing `recalculateViewForDimensions` API
2. **Per-Cell Views**: Calculate unique view parameters for each cell
3. **Proper Slice Positioning**: Adjust origin_mm based on slice position
4. **Caching**: Store calculated views to avoid redundant API calls

## Detailed Implementation Plan

### Phase 1: Add Backend Integration for View Calculation

#### 1.1 Update MosaicView Component State

**File**: `ui2/src/components/panels/MosaicView.tsx`

**Changes**:
1. Add state for volume bounds and calculated cell views:
```typescript
interface CellView {
  origin_mm: [number, number, number];
  u_mm: [number, number, number];
  v_mm: [number, number, number];
  dim_px: [number, number];
}

interface CellViewCache {
  [key: string]: CellView; // key: `${orientation}-${slicePosition}-${width}x${height}`
}

// In MosaicView component:
const [volumeBounds, setVolumeBounds] = useState<BoundingBox | null>(null);
const [cellViewCache, setCellViewCache] = useState<CellViewCache>({});
```

2. Add effect to fetch volume bounds when primary layer changes:
```typescript
useEffect(() => {
  if (primaryLayer?.volumeId) {
    // Fetch volume metadata to get bounds
    apiService.getVolumeMetadata(primaryLayer.volumeId)
      .then(metadata => {
        setVolumeBounds(metadata.bounds);
        // Clear cache when volume changes
        setCellViewCache({});
      });
  }
}, [primaryLayer?.volumeId]);
```

#### 1.2 Create View Calculation Hook

**File**: `ui2/src/hooks/useCellView.ts` (new file)

**Implementation**:
```typescript
import { useEffect, useState } from 'react';
import { ViewType } from '@brainflow/api';
import { apiService } from '../services/apiService';

export function useCellView(
  volumeId: string | undefined,
  orientation: ViewType,
  slicePosition: number,
  width: number,
  height: number,
  enabled: boolean = true
) {
  const [cellView, setCellView] = useState<CellView | null>(null);
  const [loading, setLoading] = useState(false);
  
  useEffect(() => {
    if (!enabled || !volumeId || width === 0 || height === 0) {
      return;
    }
    
    setLoading(true);
    
    // Calculate the position for this slice
    const position: [number, number, number] = [0, 0, 0];
    const axisIndex = orientation === 'axial' ? 2 : 
                     orientation === 'sagittal' ? 0 : 1;
    position[axisIndex] = slicePosition;
    
    // Request backend to calculate view for these dimensions
    apiService.recalculateViewForDimensions(
      volumeId,
      orientation,
      [width, height],
      position
    ).then(view => {
      setCellView(view);
      setLoading(false);
    }).catch(error => {
      console.error('Failed to calculate cell view:', error);
      setLoading(false);
    });
  }, [volumeId, orientation, slicePosition, width, height, enabled]);
  
  return { cellView, loading };
}
```

### Phase 2: Update MosaicCell to Use Calculated Views

#### 2.1 Modify MosaicCell Component

**File**: `ui2/src/components/panels/MosaicView.tsx` (MosaicCell component)

**Changes**:
1. Accept cellView as a prop:
```typescript
interface MosaicCellProps {
  orientation: ViewType;
  slicePosition: number;
  width: number;
  height: number;
  cellView?: CellView; // Add this
}
```

2. Update the render effect to use cellView:
```typescript
useEffect(() => {
  if (!renderCoordinator || !viewState || !cellView) return;
  
  // Create modified viewState with the cell-specific view
  const modifiedViewState: ViewState = {
    ...viewState,
    views: {
      ...viewState.views,
      [orientation]: cellView // Use calculated view for this cell
    },
    crosshair: {
      ...viewState.crosshair,
      world_mm: [...viewState.crosshair.world_mm] as [number, number, number]
    }
  };
  
  // Update crosshair to match slice position
  const axisIndex = orientation === 'axial' ? 2 : 
                   orientation === 'sagittal' ? 0 : 1;
  modifiedViewState.crosshair.world_mm[axisIndex] = slicePosition;
  
  // Request render with modified state
  renderCoordinator.requestRender({
    viewState: modifiedViewState,
    viewType: orientation,
    width,
    height,
    reason: 'layer_change',
    priority: 'normal'
  }).then(imageBitmap => {
    // ... existing canvas drawing code
  });
}, [viewState, orientation, slicePosition, width, height, cellView, renderCoordinator]);
```

#### 2.2 Update MosaicView Grid Rendering

**File**: `ui2/src/components/panels/MosaicView.tsx` (main component)

**Changes**:
1. Calculate cell views for each grid position:
```typescript
// In the grid rendering loop
{slicePositions.map((position, index) => {
  const cacheKey = `${orientation}-${position}-${cellWidth}x${cellHeight}`;
  const cellView = cellViewCache[cacheKey];
  
  return (
    <div key={index} className="relative border border-gray-700">
      <MosaicCell
        orientation={orientation}
        slicePosition={position}
        width={cellWidth}
        height={cellHeight}
        cellView={cellView}
      />
      {/* ... position label ... */}
    </div>
  );
})}
```

2. Add effect to pre-calculate all cell views:
```typescript
useEffect(() => {
  if (!primaryLayer?.volumeId || !volumeBounds) return;
  
  const calculateAllCellViews = async () => {
    const newCache: CellViewCache = {};
    
    for (const position of slicePositions) {
      const cacheKey = `${orientation}-${position}-${cellWidth}x${cellHeight}`;
      
      if (cellViewCache[cacheKey]) {
        newCache[cacheKey] = cellViewCache[cacheKey];
        continue;
      }
      
      try {
        const cellPosition: [number, number, number] = [0, 0, 0];
        const axisIndex = orientation === 'axial' ? 2 : 
                         orientation === 'sagittal' ? 0 : 1;
        cellPosition[axisIndex] = position;
        
        const view = await apiService.recalculateViewForDimensions(
          primaryLayer.volumeId,
          orientation,
          [cellWidth, cellHeight],
          cellPosition
        );
        
        newCache[cacheKey] = view;
      } catch (error) {
        console.error(`Failed to calculate view for ${cacheKey}:`, error);
      }
    }
    
    setCellViewCache(newCache);
  };
  
  calculateAllCellViews();
}, [primaryLayer?.volumeId, volumeBounds, orientation, slicePositions, cellWidth, cellHeight]);
```

### Phase 3: Fallback Frontend Calculation (Optional Enhancement)

#### 3.1 Create Frontend View Calculator

**File**: `ui2/src/utils/mosaicViewCalculator.ts` (new file)

**Implementation**:
```typescript
import { ViewType, BoundingBox } from '@brainflow/api';

export function calculateCellView(
  orientation: ViewType,
  slicePosition: number,
  width: number,
  height: number,
  bounds: BoundingBox
): CellView {
  // Calculate anatomical extent for this orientation
  let widthMm: number, heightMm: number;
  let origin_mm: [number, number, number];
  let u_mm: [number, number, number];
  let v_mm: [number, number, number];
  
  switch (orientation) {
    case 'axial':
      widthMm = bounds.max[0] - bounds.min[0]; // Left-Right
      heightMm = bounds.max[1] - bounds.min[1]; // Anterior-Posterior
      
      // Origin at top-left of the view
      origin_mm = [
        bounds.min[0],      // Left edge
        bounds.max[1],      // Anterior edge (top)
        slicePosition       // At the requested slice
      ];
      
      // Vectors for pixel displacement
      u_mm = [1, 0, 0];    // Right
      v_mm = [0, -1, 0];   // Posterior (down)
      break;
      
    case 'sagittal':
      widthMm = bounds.max[1] - bounds.min[1]; // Anterior-Posterior  
      heightMm = bounds.max[2] - bounds.min[2]; // Inferior-Superior
      
      origin_mm = [
        slicePosition,      // At the requested slice
        bounds.max[1],      // Anterior edge
        bounds.max[2]       // Superior edge (top)
      ];
      
      u_mm = [0, -1, 0];   // Posterior (right)
      v_mm = [0, 0, -1];   // Inferior (down)
      break;
      
    case 'coronal':
      widthMm = bounds.max[0] - bounds.min[0]; // Left-Right
      heightMm = bounds.max[2] - bounds.min[2]; // Inferior-Superior
      
      origin_mm = [
        bounds.min[0],      // Left edge
        slicePosition,      // At the requested slice
        bounds.max[2]       // Superior edge (top)
      ];
      
      u_mm = [1, 0, 0];    // Right
      v_mm = [0, 0, -1];   // Inferior (down)
      break;
  }
  
  // Calculate uniform pixel size to maintain aspect ratio
  const pixelSize = Math.max(widthMm / width, heightMm / height);
  
  // Scale unit vectors by pixel size
  u_mm = u_mm.map(v => v * pixelSize) as [number, number, number];
  v_mm = v_mm.map(v => v * pixelSize) as [number, number, number];
  
  // Center the view if aspect ratios don't match
  const actualWidthMm = width * pixelSize;
  const actualHeightMm = height * pixelSize;
  
  if (actualWidthMm > widthMm) {
    const offset = (actualWidthMm - widthMm) / 2;
    origin_mm = origin_mm.map((v, i) => v - u_mm[i] * offset / pixelSize) as [number, number, number];
  }
  
  if (actualHeightMm > heightMm) {
    const offset = (actualHeightMm - heightMm) / 2;
    origin_mm = origin_mm.map((v, i) => v - v_mm[i] * offset / pixelSize) as [number, number, number];
  }
  
  return {
    origin_mm,
    u_mm,
    v_mm,
    dim_px: [width, height]
  };
}
```

### Phase 4: Performance Optimizations

#### 4.1 Add Loading States

**File**: `ui2/src/components/panels/MosaicView.tsx`

**Changes**:
1. Show loading indicator while views are being calculated:
```typescript
const [viewsLoading, setViewsLoading] = useState(true);

// In the view calculation effect
setViewsLoading(true);
// ... calculate views ...
setViewsLoading(false);

// In render
if (viewsLoading) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-gray-400">Calculating views...</div>
    </div>
  );
}
```

#### 4.2 Implement View Caching Strategy

**Changes**:
1. Cache views across orientation changes if dimensions remain the same
2. Implement LRU cache to limit memory usage
3. Clear cache on volume change or significant dimension changes

### Phase 5: Testing and Validation

#### 5.1 Create Test Cases

**File**: `ui2/src/components/panels/__tests__/MosaicView.test.tsx` (new file)

**Test scenarios**:
1. Verify each cell shows different slices
2. Verify full anatomical extent is visible
3. Verify aspect ratio is maintained
4. Test performance with large grids
5. Test cache invalidation on volume change

#### 5.2 Visual Validation

1. Compare mosaic cell output with main view panels at same positions
2. Verify anatomical structures are not distorted
3. Check edge cases (first/last slices, odd dimensions)

## Implementation Order

1. **Phase 1.1-1.2**: Add backend integration (~2 hours)
   - Critical for correct view calculation
   - Establishes foundation for fixes

2. **Phase 2.1-2.2**: Update MosaicCell (~3 hours)
   - Core fix for both issues
   - Most complex part of implementation

3. **Phase 4.1**: Add loading states (~30 min)
   - Improves UX during view calculation

4. **Phase 5.1-5.2**: Testing (~2 hours)
   - Validate fixes work correctly

5. **Phase 3** (Optional): Frontend calculation (~2 hours)
   - Performance optimization
   - Can be added later if needed

6. **Phase 4.2** (Optional): Advanced caching (~1 hour)
   - Further performance optimization

## Risk Mitigation

1. **API Call Volume**: Pre-calculate all views at once rather than per-cell
2. **Memory Usage**: Implement cache size limits if needed
3. **Backward Compatibility**: Ensure changes don't affect other view components
4. **Performance**: Monitor render times, implement debouncing if needed

## Success Criteria

1. Each mosaic cell displays the full anatomical extent
2. Each cell shows the correct slice based on its position label
3. Anatomical proportions are preserved (square pixels)
4. Performance remains acceptable (<100ms per cell render)
5. No regression in other view components

## Alternative Approaches Considered

1. **Modifying RenderCoordinator**: Rejected - would affect all renders
2. **Creating separate render pipeline**: Rejected - too complex
3. **Pre-rendering all slices**: Rejected - memory intensive
4. **Using CSS transforms**: Rejected - wouldn't fix slice position issue

The chosen approach follows established patterns in the codebase and leverages existing backend capabilities while maintaining clean separation of concerns.