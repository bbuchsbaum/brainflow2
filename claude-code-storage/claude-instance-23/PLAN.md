# MosaicView Crosshair-Based Initial Page Implementation Plan

## Executive Summary

This plan details the implementation of crosshair-based initial page selection for MosaicView components. Currently, MosaicView always starts at page 0 (showing the lowest slice indices). This implementation will make MosaicView start at the page containing the current crosshair position, or the volume center if no crosshair is set.

## Architecture Overview

### Components Affected
1. **MosaicViewSimple.tsx** - Event-driven mosaic view using RenderCell components
2. **MosaicView.tsx** (in tmp_o3pro) - Batch rendering mosaic view
3. **New utility file** - Shared functions for coordinate/page calculations

### Key Dependencies
- `viewStateStore` - Provides current crosshair position
- `apiService` - Provides volume bounds and slice metadata
- `MosaicRenderService` - Contains slice-to-world position mapping logic

## Implementation Steps

### Step 1: Create Shared Utility Functions

**File to create**: `/ui2/src/utils/mosaicUtils.ts`

```typescript
import { WorldCoordinates } from '@brainflow/api';

/**
 * Convert a world position (in mm) to a slice index
 * @param worldPosition - Position in world coordinates (mm) along the axis
 * @param sliceMin - Minimum bound for the axis (mm)
 * @param sliceMax - Maximum bound for the axis (mm)
 * @param totalSlices - Total number of slices along the axis
 * @returns Slice index (0-based)
 */
export function worldPositionToSliceIndex(
  worldPosition: number,
  sliceMin: number,
  sliceMax: number,
  totalSlices: number
): number {
  const sliceRange = sliceMax - sliceMin;
  if (sliceRange === 0) return 0;
  
  const normalizedPosition = (worldPosition - sliceMin) / sliceRange;
  const clampedPosition = Math.max(0, Math.min(1, normalizedPosition));
  return Math.round(clampedPosition * (totalSlices - 1));
}

/**
 * Convert a slice index to the page number containing that slice
 * @param sliceIndex - The slice index (0-based)
 * @param slicesPerPage - Number of slices displayed per page
 * @returns Page number (0-based)
 */
export function sliceIndexToPage(sliceIndex: number, slicesPerPage: number): number {
  if (slicesPerPage <= 0) return 0;
  return Math.floor(sliceIndex / slicesPerPage);
}

/**
 * Get the axis index for world coordinates based on slice axis
 * @param axis - The slice axis ('axial', 'sagittal', or 'coronal')
 * @returns Index into world coordinate array [x, y, z]
 */
export function getAxisIndex(axis: 'axial' | 'sagittal' | 'coronal'): number {
  switch (axis) {
    case 'axial': return 2;    // Z axis
    case 'sagittal': return 0;  // X axis
    case 'coronal': return 1;   // Y axis
  }
}

/**
 * Calculate the initial page for MosaicView based on crosshair position
 * @param crosshairPosition - Current crosshair world coordinates [x, y, z] in mm
 * @param volumeBounds - Volume bounds with min/max arrays
 * @param axis - The slice axis
 * @param totalSlices - Total number of slices
 * @param gridRows - Number of rows in the grid
 * @param gridCols - Number of columns in the grid
 * @returns Initial page number
 */
export function calculateInitialPage(
  crosshairPosition: WorldCoordinates,
  volumeBounds: { min: number[], max: number[] },
  axis: 'axial' | 'sagittal' | 'coronal',
  totalSlices: number,
  gridRows: number,
  gridCols: number
): number {
  const axisIndex = getAxisIndex(axis);
  const worldPosition = crosshairPosition[axisIndex];
  const sliceMin = volumeBounds.min[axisIndex];
  const sliceMax = volumeBounds.max[axisIndex];
  
  const sliceIndex = worldPositionToSliceIndex(
    worldPosition,
    sliceMin,
    sliceMax,
    totalSlices
  );
  
  const slicesPerPage = gridRows * gridCols;
  return sliceIndexToPage(sliceIndex, slicesPerPage);
}

/**
 * Calculate volume center coordinates
 * @param volumeBounds - Volume bounds with min/max arrays
 * @returns Center coordinates [x, y, z] in mm
 */
export function calculateVolumeCenter(
  volumeBounds: { min: number[], max: number[] }
): WorldCoordinates {
  return [
    (volumeBounds.min[0] + volumeBounds.max[0]) / 2,
    (volumeBounds.min[1] + volumeBounds.max[1]) / 2,
    (volumeBounds.min[2] + volumeBounds.max[2]) / 2
  ];
}
```

### Step 2: Update MosaicViewSimple.tsx

**File to modify**: `/ui2/src/components/views/MosaicViewSimple.tsx`

#### 2.1 Add imports
```typescript
import { 
  calculateInitialPage, 
  calculateVolumeCenter 
} from '../../utils/mosaicUtils';
import { useViewStateStore } from '../../stores/viewStateStore';
```

#### 2.2 Replace the metadata fetch useEffect (lines 51-67)
```typescript
// Fetch slice metadata and calculate initial page
useEffect(() => {
  if (!primaryVolumeId) return;
  
  const fetchMetadataAndSetInitialPage = async () => {
    try {
      // Get slice metadata
      const meta = await apiService.querySliceAxisMeta(primaryVolumeId, sliceAxis);
      if (!meta || meta.sliceCount <= 0) {
        console.warn('Invalid slice metadata received');
        return;
      }
      
      setTotalSlices(meta.sliceCount);
      
      // Get volume bounds for coordinate calculations
      const volumeBounds = await apiService.getVolumeBounds(primaryVolumeId);
      if (!volumeBounds) {
        console.warn('Could not get volume bounds');
        return;
      }
      
      // Get current crosshair position
      const viewState = useViewStateStore.getState().viewState;
      let crosshairPosition = viewState.crosshair.world_mm;
      
      // If crosshair is at origin [0,0,0], use volume center
      if (crosshairPosition[0] === 0 && 
          crosshairPosition[1] === 0 && 
          crosshairPosition[2] === 0) {
        crosshairPosition = calculateVolumeCenter(volumeBounds);
      }
      
      // Calculate initial page based on crosshair position
      const initialPage = calculateInitialPage(
        crosshairPosition,
        volumeBounds,
        sliceAxis,
        meta.sliceCount,
        gridSize.rows,
        gridSize.cols
      );
      
      // Ensure page is within valid range
      const maxPage = Math.ceil(meta.sliceCount / (gridSize.rows * gridSize.cols)) - 1;
      const validPage = Math.max(0, Math.min(initialPage, maxPage));
      
      console.log(`MosaicView: Setting initial page to ${validPage} for ${sliceAxis} axis`);
      setCurrentPage(validPage);
      
    } catch (error) {
      console.error('Error fetching metadata or calculating initial page:', error);
    }
  };
  
  fetchMetadataAndSetInitialPage();
}, [primaryVolumeId, sliceAxis, gridSize.rows, gridSize.cols, apiService]);
```

#### 2.3 Update axis change handler to recalculate page
Add a new effect to handle axis changes:
```typescript
// Reset to crosshair position when axis changes
useEffect(() => {
  if (!primaryVolumeId || totalSlices === 0) return;
  
  const updatePageForNewAxis = async () => {
    try {
      const volumeBounds = await apiService.getVolumeBounds(primaryVolumeId);
      if (!volumeBounds) return;
      
      const viewState = useViewStateStore.getState().viewState;
      let crosshairPosition = viewState.crosshair.world_mm;
      
      if (crosshairPosition[0] === 0 && 
          crosshairPosition[1] === 0 && 
          crosshairPosition[2] === 0) {
        crosshairPosition = calculateVolumeCenter(volumeBounds);
      }
      
      const newPage = calculateInitialPage(
        crosshairPosition,
        volumeBounds,
        sliceAxis,
        totalSlices,
        gridSize.rows,
        gridSize.cols
      );
      
      const maxPage = Math.ceil(totalSlices / (gridSize.rows * gridSize.cols)) - 1;
      const validPage = Math.max(0, Math.min(newPage, maxPage));
      
      setCurrentPage(validPage);
    } catch (error) {
      console.error('Error updating page for axis change:', error);
    }
  };
  
  updatePageForNewAxis();
}, [sliceAxis]); // Only re-run when axis changes
```

### Step 3: Update MosaicView.tsx (tmp_o3pro version)

**File to modify**: `/tmp_o3pro/MosaicView.tsx`

#### 3.1 Add imports
```typescript
import { 
  calculateInitialPage, 
  calculateVolumeCenter 
} from '../ui2/src/utils/mosaicUtils';
import { useViewStateStore } from '../ui2/src/stores/viewStateStore';
```

#### 3.2 Update the metadata fetch useEffect (around line 243)
```typescript
// Fetch slice metadata when axis or volume changes
useEffect(() => {
  if (!primaryVolumeId) return;
  
  const fetchMetadataAndSetInitialPage = async () => {
    try {
      const meta = await invoke<SliceAxisMeta>('plugin:api-bridge|query_slice_axis_meta', {
        volumeId: primaryVolumeId,
        axis: viewState.sliceAxis
      });
      
      if (meta && meta.sliceCount > 0) {
        // Get volume bounds
        const volumeBounds = await apiService.getVolumeBounds(primaryVolumeId);
        if (!volumeBounds) {
          console.warn('Could not get volume bounds');
          setViewState(prev => ({
            ...prev,
            totalSlices: meta.sliceCount,
            sliceSpacing: meta.sliceSpacing,
            currentPage: 0 // Fallback to 0 if bounds not available
          }));
          return;
        }
        
        // Get current crosshair position
        const globalViewState = useViewStateStore.getState().viewState;
        let crosshairPosition = globalViewState.crosshair.world_mm;
        
        // If crosshair is at origin, use volume center
        if (crosshairPosition[0] === 0 && 
            crosshairPosition[1] === 0 && 
            crosshairPosition[2] === 0) {
          crosshairPosition = calculateVolumeCenter(volumeBounds);
        }
        
        // Calculate initial page
        const initialPage = calculateInitialPage(
          crosshairPosition,
          volumeBounds,
          viewState.sliceAxis,
          meta.sliceCount,
          viewState.gridSize.rows,
          viewState.gridSize.cols
        );
        
        // Ensure page is within valid range
        const maxPage = Math.ceil(meta.sliceCount / (viewState.gridSize.rows * viewState.gridSize.cols)) - 1;
        const validPage = Math.max(0, Math.min(initialPage, maxPage));
        
        console.log(`MosaicView: Setting initial page to ${validPage} for ${viewState.sliceAxis} axis`);
        
        setViewState(prev => ({
          ...prev,
          totalSlices: meta.sliceCount,
          sliceSpacing: meta.sliceSpacing,
          currentPage: validPage
        }));
      }
    } catch (error) {
      console.error('Failed to fetch slice metadata:', error);
    }
  };
  
  fetchMetadataAndSetInitialPage();
}, [primaryVolumeId, viewState.sliceAxis, viewState.gridSize]);
```

#### 3.3 Update handleAxisChange to recalculate page
```typescript
const handleAxisChange = async (newAxis: 'axial' | 'sagittal' | 'coronal') => {
  if (!primaryVolumeId) {
    setViewState(prev => ({ ...prev, sliceAxis: newAxis }));
    return;
  }
  
  try {
    // Fetch new metadata for the axis
    const meta = await invoke<SliceAxisMeta>('plugin:api-bridge|query_slice_axis_meta', {
      volumeId: primaryVolumeId,
      axis: newAxis
    });
    
    if (meta && meta.sliceCount > 0) {
      const volumeBounds = await apiService.getVolumeBounds(primaryVolumeId);
      if (!volumeBounds) {
        setViewState(prev => ({
          ...prev,
          sliceAxis: newAxis,
          totalSlices: meta.sliceCount,
          sliceSpacing: meta.sliceSpacing,
          currentPage: 0
        }));
        return;
      }
      
      const globalViewState = useViewStateStore.getState().viewState;
      let crosshairPosition = globalViewState.crosshair.world_mm;
      
      if (crosshairPosition[0] === 0 && 
          crosshairPosition[1] === 0 && 
          crosshairPosition[2] === 0) {
        crosshairPosition = calculateVolumeCenter(volumeBounds);
      }
      
      const initialPage = calculateInitialPage(
        crosshairPosition,
        volumeBounds,
        newAxis,
        meta.sliceCount,
        viewState.gridSize.rows,
        viewState.gridSize.cols
      );
      
      const maxPage = Math.ceil(meta.sliceCount / (viewState.gridSize.rows * viewState.gridSize.cols)) - 1;
      const validPage = Math.max(0, Math.min(initialPage, maxPage));
      
      setViewState(prev => ({
        ...prev,
        sliceAxis: newAxis,
        totalSlices: meta.sliceCount,
        sliceSpacing: meta.sliceSpacing,
        currentPage: validPage,
        renderCache: new Map() // Clear cache when changing axis
      }));
    }
  } catch (error) {
    console.error('Failed to update axis:', error);
    setViewState(prev => ({ ...prev, sliceAxis: newAxis }));
  }
};
```

### Step 4: Handle Edge Cases

#### 4.1 Add volume bounds caching (optional optimization)
Consider adding volume bounds caching to `apiService` to avoid repeated API calls:

**File to modify**: `/ui2/src/services/apiService.ts`

```typescript
private volumeBoundsCache = new Map<string, { min: number[], max: number[] }>();

async getVolumeBounds(volumeId: string) {
  // Check cache first
  const cached = this.volumeBoundsCache.get(volumeId);
  if (cached) return cached;
  
  // Fetch from backend
  const bounds = await invoke<{ min: number[], max: number[] }>('plugin:api-bridge|get_volume_bounds', {
    volumeId
  });
  
  // Cache the result
  if (bounds) {
    this.volumeBoundsCache.set(volumeId, bounds);
  }
  
  return bounds;
}

// Add method to clear cache when volume is unloaded
clearVolumeBoundsCache(volumeId: string) {
  this.volumeBoundsCache.delete(volumeId);
}
```

### Step 5: Testing Strategy

#### 5.1 Manual Testing Checklist
1. **Initial Load**:
   - Load a volume and open MosaicView
   - Verify it starts at the page containing the volume center
   - Check all three axes (axial, sagittal, coronal)

2. **Crosshair Navigation**:
   - Move crosshair to different positions using SliceView
   - Open MosaicView and verify it starts at the correct page
   - Test near edges of the volume

3. **Axis Switching**:
   - Open MosaicView in one axis
   - Switch to another axis
   - Verify page updates to show crosshair position

4. **Edge Cases**:
   - Test with very small volumes (< 1 page of slices)
   - Test with crosshair at volume boundaries
   - Test with different grid sizes

#### 5.2 Unit Tests to Add
Create `/ui2/src/utils/__tests__/mosaicUtils.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  worldPositionToSliceIndex,
  sliceIndexToPage,
  getAxisIndex,
  calculateInitialPage,
  calculateVolumeCenter
} from '../mosaicUtils';

describe('mosaicUtils', () => {
  describe('worldPositionToSliceIndex', () => {
    it('should convert world position to slice index correctly', () => {
      expect(worldPositionToSliceIndex(0, -100, 100, 200)).toBe(100);
      expect(worldPositionToSliceIndex(-100, -100, 100, 200)).toBe(0);
      expect(worldPositionToSliceIndex(100, -100, 100, 200)).toBe(199);
      expect(worldPositionToSliceIndex(50, -100, 100, 200)).toBe(150);
    });
    
    it('should clamp values outside bounds', () => {
      expect(worldPositionToSliceIndex(-200, -100, 100, 200)).toBe(0);
      expect(worldPositionToSliceIndex(200, -100, 100, 200)).toBe(199);
    });
  });
  
  describe('sliceIndexToPage', () => {
    it('should calculate page number correctly', () => {
      expect(sliceIndexToPage(0, 9)).toBe(0);
      expect(sliceIndexToPage(8, 9)).toBe(0);
      expect(sliceIndexToPage(9, 9)).toBe(1);
      expect(sliceIndexToPage(17, 9)).toBe(1);
      expect(sliceIndexToPage(18, 9)).toBe(2);
    });
  });
  
  describe('calculateInitialPage', () => {
    it('should calculate initial page for axial view', () => {
      const bounds = { min: [-100, -100, -100], max: [100, 100, 100] };
      const crosshair = [0, 0, 0]; // Center
      
      const page = calculateInitialPage(crosshair, bounds, 'axial', 200, 3, 3);
      expect(page).toBe(11); // Middle page for 200 slices / 9 per page
    });
  });
});
```

### Step 6: Documentation Updates

#### 6.1 Update component documentation
Add JSDoc comments to both MosaicView components explaining the crosshair-based initialization:

```typescript
/**
 * MosaicView Component
 * 
 * Displays multiple slices in a grid layout. The initial page is determined
 * by the current crosshair position. If no crosshair is set, it defaults to
 * the volume center.
 * 
 * @param props.width - Component width
 * @param props.height - Component height
 */
```

### Step 7: Rollback Plan

If issues arise:
1. Remove the new utility file
2. Revert changes to both MosaicView components
3. Components will return to starting at page 0

### Implementation Timeline

1. **Phase 1** (Day 1):
   - Create utility file with tests
   - Update MosaicViewSimple.tsx
   - Manual testing

2. **Phase 2** (Day 2):
   - Update MosaicView.tsx (tmp_o3pro)
   - Add volume bounds caching
   - Complete testing

3. **Phase 3** (Day 3):
   - Fix any issues found in testing
   - Update documentation
   - Code review and merge

## Success Criteria

1. MosaicView starts at the page containing the current crosshair position
2. Fallback to volume center when crosshair is at [0,0,0]
3. Page updates correctly when switching axes
4. No performance regression
5. All edge cases handled gracefully

## Risk Mitigation

1. **Performance**: Volume bounds are cached to avoid repeated API calls
2. **Backward Compatibility**: Changes are localized to MosaicView components
3. **Error Handling**: Fallback to page 0 if any calculation fails
4. **Testing**: Comprehensive unit and manual tests ensure reliability

## Files Summary

### Files to Create:
- `/ui2/src/utils/mosaicUtils.ts` - Utility functions for coordinate/page calculations
- `/ui2/src/utils/__tests__/mosaicUtils.test.ts` - Unit tests for utilities

### Files to Modify:
- `/ui2/src/components/views/MosaicViewSimple.tsx` - Add crosshair-based initialization
- `/tmp_o3pro/MosaicView.tsx` - Add crosshair-based initialization
- `/ui2/src/services/apiService.ts` (optional) - Add volume bounds caching

### Key Functions Added:
- `worldPositionToSliceIndex()` - Convert world position to slice index
- `sliceIndexToPage()` - Convert slice index to page number
- `calculateInitialPage()` - Main calculation function
- `calculateVolumeCenter()` - Fallback center calculation
- `getAxisIndex()` - Helper for axis mapping

This implementation ensures MosaicView behaves consistently with standard medical imaging viewers by starting at the current point of interest (crosshair) rather than always beginning at the first slice.