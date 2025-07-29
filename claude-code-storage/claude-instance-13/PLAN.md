# Comprehensive Plan to Fix MosaicView Blank Display Issue

## Overview
This plan addresses all critical issues preventing MosaicView from rendering images, based on thorough investigation and flow analysis. The fixes are organized by priority and dependency order to ensure systematic resolution.

## Phase 1: Critical Import and Syntax Fixes (Immediate)

### 1.1 Fix Missing React Hook Import
**File**: `/ui2/src/components/views/MosaicView.tsx`
**Line**: 6
**Action**: Add `useCallback` to the React import statement
```tsx
// Change from:
import React, { useState, useEffect, useMemo, useRef } from 'react';
// To:
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
```
**Impact**: Prevents runtime error that blocks entire component mount

### 1.2 Fix CoordinateTransform Method Call
**File**: `/ui2/src/components/views/MosaicView.tsx`
**Lines**: 95-98
**Action**: Update `screenToWorld` call to use separate parameters instead of array
```tsx
// Change from:
const worldCoords = CoordinateTransform.screenToWorld(
  [imageX, imageY],
  cellView
);
// To:
const worldCoords = CoordinateTransform.screenToWorld(
  imageX,
  imageY,
  cellView
);
```
**Impact**: Fixes click handling and coordinate transformations

### 1.3 Remove Unused Imports
**File**: `/ui2/src/components/views/MosaicView.tsx`
**Line**: 12
**Action**: Remove unused `getEventBus` import
```tsx
// Remove:
import { getEventBus } from '../../events/EventBus';
```
**Impact**: Cleans up code and removes confusion

## Phase 2: Data Flow and Initialization Fixes

### 2.1 Add Layer Loading Checks
**File**: `/ui2/src/components/views/MosaicView.tsx`
**Location**: After line 327 (primaryLayer calculation)
**Action**: Add loading state and empty state handling
```tsx
// Add new state after existing state declarations (around line 297):
const [isInitializing, setIsInitializing] = useState(true);

// Modify primaryLayer effect (around line 330):
useEffect(() => {
  if (!layers || layers.length === 0) {
    setIsInitializing(false);
    setVolumeBounds(null);
    setCellViewCache({});
    return;
  }

  if (primaryLayer?.volumeId) {
    setIsInitializing(true);
    apiService.getVolumeBounds(primaryLayer.volumeId)
      .then(bounds => {
        setVolumeBounds(bounds);
        setCellViewCache({});
        setIsInitializing(false);
      })
      .catch(error => {
        console.error('[MosaicView] Failed to fetch volume bounds:', error);
        setIsInitializing(false);
      });
  } else {
    setIsInitializing(false);
  }
}, [primaryLayer?.volumeId, apiService, layers]);
```

### 2.2 Add Empty State UI
**File**: `/ui2/src/components/views/MosaicView.tsx`
**Location**: Before main return statement (around line 465)
**Action**: Add conditional rendering for empty/loading states
```tsx
// Add before the main return statement:
if (isInitializing) {
  return (
    <div className="flex items-center justify-center h-full bg-gray-900">
      <div className="text-gray-400">Loading mosaic view...</div>
    </div>
  );
}

if (!primaryLayer) {
  return (
    <div className="flex items-center justify-center h-full bg-gray-900">
      <div className="text-gray-400">No layers loaded. Please load a volume to use mosaic view.</div>
    </div>
  );
}

if (!volumeBounds) {
  return (
    <div className="flex items-center justify-center h-full bg-gray-900">
      <div className="text-gray-400">Failed to load volume bounds. Please check the console for errors.</div>
    </div>
  );
}
```

### 2.3 Add View Calculation Error Handling
**File**: `/ui2/src/components/views/MosaicView.tsx`
**Location**: In calculateAllCellViews function (around line 395)
**Action**: Add validation for calculated views
```tsx
// Inside the calculateAllCellViews function, after line 420:
if (view && view.world_to_pixel && view.pixel_to_world) {
  newCache[cacheKey] = view;
} else {
  console.error(`[MosaicView] Invalid view returned for ${cacheKey}:`, view);
}
```

## Phase 3: MosaicCell Robustness Improvements

### 3.1 Add Null Checks for Cell View
**File**: `/ui2/src/components/views/MosaicView.tsx`
**Location**: In MosaicCell component (around line 180)
**Action**: Add defensive checks before using cellView
```tsx
// Add validation after line 186:
if (cellView && cellView.world_to_pixel && cellView.pixel_to_world) {
  modifiedViewState.views = {
    ...viewState.views,
    [orientation]: cellView
  };
} else {
  console.warn(`[MosaicCell] No valid cellView for ${orientation} at position ${slicePosition}`);
  // Fallback to global view if available
  if (viewState.views[orientation]) {
    modifiedViewState.views = {
      ...viewState.views,
      [orientation]: viewState.views[orientation]
    };
  }
}
```

### 3.2 Add Error Boundary for Cell Rendering
**File**: `/ui2/src/components/views/MosaicView.tsx`
**Location**: Around MosaicCell usage (line 520)
**Action**: Wrap each cell in error handling
```tsx
// Create error boundary component at top of file:
const MosaicCellErrorBoundary: React.FC<{
  children: React.ReactNode;
  cellKey: string;
}> = ({ children, cellKey }) => {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [cellKey]);

  if (hasError) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-800 border border-gray-700">
        <div className="text-xs text-red-400">Failed to render</div>
      </div>
    );
  }

  return (
    <ErrorBoundary
      onError={() => setHasError(true)}
      fallback={<div>Error</div>}
    >
      {children}
    </ErrorBoundary>
  );
};

// Wrap MosaicCell usage:
<MosaicCellErrorBoundary cellKey={`${currentPage}-${index}-${slicePos}`}>
  <MosaicCell
    // ... existing props
  />
</MosaicCellErrorBoundary>
```

## Phase 4: Canvas Rendering Improvements

### 4.1 Add Canvas Initialization Checks
**File**: `/ui2/src/components/views/MosaicView.tsx`
**Location**: In MosaicCell render effect (around line 114)
**Action**: Add more detailed error logging
```tsx
// Enhance the guard clause:
if (!canvasRef.current) {
  console.error('[MosaicCell] Canvas ref not available');
  return;
}

if (dimensions.width <= 0 || dimensions.height <= 0) {
  console.error('[MosaicCell] Invalid dimensions:', dimensions);
  return;
}

const ctx = canvasRef.current.getContext('2d');
if (!ctx) {
  console.error('[MosaicCell] Failed to get 2D context');
  setError('Failed to get canvas context');
  return;
}
```

### 4.2 Add Debug Visualization
**File**: `/ui2/src/components/views/MosaicView.tsx`
**Location**: In canvas drawing section (around line 180)
**Action**: Add debug border when no image is rendered
```tsx
// After attempting to draw image:
if (!imageBitmap) {
  // Draw debug border to show canvas is active
  ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, dimensions.width, dimensions.height);
  
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.font = '12px monospace';
  ctx.fillText(`No image`, 10, 20);
  ctx.fillText(`Pos: ${slicePosition.toFixed(1)}`, 10, 35);
}
```

## Phase 5: Service Integration Verification

### 5.1 Add Service Initialization Checks
**File**: `/ui2/src/components/views/MosaicView.tsx`
**Location**: After service imports (around line 310)
**Action**: Verify services are available
```tsx
// Add after getting services:
useEffect(() => {
  if (!apiService) {
    console.error('[MosaicView] ApiService not available');
  }
  if (!sliceNavService) {
    console.error('[MosaicView] SliceNavigationService not available');
  }
  if (!renderCoordinator) {
    console.error('[MosaicView] RenderCoordinator not available');
  }
}, [apiService, sliceNavService, renderCoordinator]);
```

### 5.2 Add Backend Communication Validation
**File**: `/ui2/src/components/views/MosaicView.tsx`
**Location**: In recalculateViewForDimensions calls
**Action**: Add response validation
```tsx
// Inside the try block where recalculateViewForDimensions is called:
const view = await apiService.recalculateViewForDimensions(
  primaryLayer.volumeId,
  orientation,
  [cellWidth, cellHeight],
  cellCrosshair
);

// Validate the response
if (!view) {
  throw new Error('Received null view from backend');
}

if (!view.world_to_pixel || !view.pixel_to_world) {
  throw new Error('View missing required transformation matrices');
}

if (!view.pixel_extent || view.pixel_extent[0] <= 0 || view.pixel_extent[1] <= 0) {
  throw new Error('Invalid pixel extent in view');
}
```

## Phase 6: Testing and Validation

### 6.1 Add Development Mode Diagnostics
**File**: `/ui2/src/components/views/MosaicView.tsx`
**Location**: At component level
**Action**: Add debug logging when in development
```tsx
// Add after state declarations:
useEffect(() => {
  if (process.env.NODE_ENV === 'development') {
    console.log('[MosaicView] Debug info:', {
      hasPrimaryLayer: !!primaryLayer,
      volumeId: primaryLayer?.volumeId,
      hasVolumeBounds: !!volumeBounds,
      cellViewCacheSize: Object.keys(cellViewCache).length,
      slicePositions: slicePositions.length,
      viewsLoading,
      orientation
    });
  }
}, [primaryLayer, volumeBounds, cellViewCache, slicePositions, viewsLoading, orientation]);
```

### 6.2 Create Test Component
**File**: Create new `/ui2/src/components/views/__tests__/MosaicView.test.tsx`
**Action**: Add basic rendering tests
```tsx
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MosaicView } from '../MosaicView';
import { useLayerStore } from '../../../stores/layerStore';
import { getApiService } from '../../../services/ApiService';

jest.mock('../../../stores/layerStore');
jest.mock('../../../services/ApiService');

describe('MosaicView', () => {
  it('shows loading state initially', () => {
    (useLayerStore as jest.Mock).mockReturnValue({ layers: [] });
    
    render(<MosaicView />);
    
    expect(screen.getByText('Loading mosaic view...')).toBeInTheDocument();
  });

  it('shows empty state when no layers', async () => {
    (useLayerStore as jest.Mock).mockReturnValue({ layers: [] });
    
    render(<MosaicView />);
    
    await waitFor(() => {
      expect(screen.getByText(/No layers loaded/)).toBeInTheDocument();
    });
  });
});
```

## Implementation Order

1. **Immediate (Phase 1)**: Apply all critical fixes to restore basic functionality
   - Fix missing import (1.1)
   - Fix coordinate transform (1.2)
   - Remove unused imports (1.3)

2. **High Priority (Phase 2-3)**: Add robustness and error handling
   - Layer loading checks (2.1)
   - Empty state UI (2.2)
   - View calculation validation (2.3)
   - Cell view null checks (3.1)

3. **Medium Priority (Phase 4-5)**: Improve debugging and diagnostics
   - Canvas initialization checks (4.1)
   - Debug visualization (4.2)
   - Service validation (5.1)

4. **Low Priority (Phase 6)**: Add testing and long-term maintainability
   - Development diagnostics (6.1)
   - Unit tests (6.2)

## Success Criteria

1. MosaicView renders without errors when layers are loaded
2. Shows meaningful messages when no data is available
3. Handles edge cases gracefully without crashing
4. Provides clear error messages in console for debugging
5. Canvas elements show images when render data is available

## Risk Mitigation

1. **Test in isolation**: Create a test scene with known-good data
2. **Incremental deployment**: Apply fixes one phase at a time
3. **Monitor console**: Watch for new errors after each change
4. **Fallback options**: Ensure graceful degradation when services fail
5. **Version control**: Commit after each successful phase

## Verification Steps

After implementing each phase:

1. Start the application with `cargo tauri dev`
2. Load a test volume
3. Switch to mosaic view
4. Verify:
   - No console errors
   - Images appear in grid
   - Click interactions work
   - Performance is acceptable
   - Loading states show appropriately

## Notes

- The missing `useCallback` import is the most critical issue preventing any rendering
- The component was recently added and lacks comprehensive testing
- Consider adding integration tests with the RenderCoordinator service
- Monitor performance with large grid sizes (many cells)
- Consider implementing progressive loading for better UX with many slices