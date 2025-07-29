# MosaicView Fix Plan

## Overview
This plan addresses the critical issues in MosaicView that cause all cells to show the same slice, grid resizing on mouse movement, and display of only the top-left quarter of slices. The fix will follow architectural patterns from the working OrthogonalView component while maintaining proper separation of concerns.

## Phase 1: Fix Shared Crosshair Modification (Critical)

### Issue
All MosaicCell components modify the same viewState.crosshair position, causing a race condition where the last cell to render determines the slice shown in all cells.

### Solution
Implement slice-specific rendering without modifying global state.

### Files to Modify

#### 1. `/ui2/src/services/RenderCoordinator.ts`
- Add `sliceOverride` field to `RenderRequest` interface:
  ```typescript
  interface RenderRequest {
    // ... existing fields
    sliceOverride?: {
      axis: 'x' | 'y' | 'z';
      position: number;  // in world coordinates (mm)
    };
  }
  ```
- Update `executeRenderJob` to pass sliceOverride to apiService

#### 2. `/ui2/src/services/apiService.ts`
- Modify `applyAndRenderViewStateCore` to accept optional sliceOverride parameter
- When sliceOverride is present, create a local copy of viewState with the specified slice position
- Ensure the override only affects the render call, not the global state

#### 3. `/ui2/src/components/views/MosaicView.tsx`
- Remove lines 152-153 that modify `modifiedViewState.crosshair.world_mm[axisIndex]`
- Instead, pass sliceOverride to RenderCoordinator:
  ```typescript
  const axisKey = orientation === 'axial' ? 'z' : orientation === 'sagittal' ? 'x' : 'y';
  await renderCoordinator.requestRender({
    // ... existing params
    sliceOverride: {
      axis: axisKey,
      position: slicePosition
    }
  });
  ```

## Phase 2: Stabilize ResizeObserver System

### Issue
Individual ResizeObservers per cell create cascading updates on mouse movement.

### Solution
Implement centralized resize observation at the grid container level.

### Files to Modify

#### 1. `/ui2/src/components/views/MosaicView.tsx` (Parent Component)
- Move ResizeObserver logic from MosaicCell to parent MosaicView
- Calculate cell dimensions at parent level:
  ```typescript
  const cellWidth = Math.floor((containerDimensions.width - padding) / columns);
  const cellHeight = Math.floor((containerDimensions.height - padding) / rows);
  ```
- Pass dimensions as props to MosaicCell components
- Add throttling (30ms) to dimension updates to match OrthogonalView pattern

#### 2. `/ui2/src/components/views/MosaicView.tsx` (MosaicCell Component)
- Remove individual ResizeObserver (lines 58-72)
- Remove local dimensions state
- Accept dimensions as props from parent
- Remove dimensions from useEffect dependencies

## Phase 3: Fix Canvas Sizing and Rendering

### Issue
Canvas uses inline styles tied to state, causing layout recalculations and showing only top-left quarter.

### Solution
Implement proper canvas sizing with CSS-based layout and correct buffer dimensions.

### Files to Modify

#### 1. `/ui2/src/components/views/MosaicView.tsx` (MosaicCell)
- Remove inline styles from canvas element
- Use CSS classes for layout:
  ```typescript
  <canvas
    ref={canvasRef}
    width={dimensions.width}
    height={dimensions.height}
    className="w-full h-full"
    onClick={handleCanvasClick}
  />
  ```
- Ensure canvas buffer dimensions match actual rendered size

#### 2. Create utility function for proper image scaling
- Add to `/ui2/src/utils/canvasUtils.ts` (create if doesn't exist):
  ```typescript
  export function drawScaledImage(
    ctx: CanvasRenderingContext2D,
    image: ImageBitmap,
    canvasWidth: number,
    canvasHeight: number
  ) {
    // Calculate proper scaling to fit entire image
    const scale = Math.min(
      canvasWidth / image.width,
      canvasHeight / image.height
    );
    const scaledWidth = image.width * scale;
    const scaledHeight = image.height * scale;
    const x = (canvasWidth - scaledWidth) / 2;
    const y = (canvasHeight - scaledHeight) / 2;
    
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.drawImage(image, x, y, scaledWidth, scaledHeight);
    
    return { x, y, width: scaledWidth, height: scaledHeight };
  }
  ```

## Phase 4: Optimize Re-render Dependencies

### Issue
All cells re-render when any viewState property changes due to excessive dependencies.

### Solution
Minimize effect dependencies and use memoization.

### Files to Modify

#### 1. `/ui2/src/components/views/MosaicView.tsx` (MosaicCell)
- Remove viewState from render effect dependencies
- Extract only necessary values before the effect:
  ```typescript
  const { volumeId, colormap } = viewState.layers[0] || {};
  const windowLevel = viewState.layers[0]?.windowLevel;
  
  useEffect(() => {
    // Use extracted values instead of full viewState
  }, [volumeId, colormap, windowLevel, orientation, slicePosition, dimensions, /* ... */]);
  ```

#### 2. Use React.memo for MosaicCell
- Wrap MosaicCell export with React.memo and custom comparison:
  ```typescript
  export const MosaicCell = React.memo(MosaicCellComponent, (prevProps, nextProps) => {
    // Custom comparison logic
    return (
      prevProps.slicePosition === nextProps.slicePosition &&
      prevProps.orientation === nextProps.orientation &&
      prevProps.dimensions.width === nextProps.dimensions.width &&
      prevProps.dimensions.height === nextProps.dimensions.height &&
      // ... other relevant comparisons
    );
  });
  ```

## Phase 5: Implement Render Coordination

### Issue
No coordination between cells leads to redundant renders and poor performance.

### Solution
Implement batched rendering and caching for mosaic views.

### Files to Modify

#### 1. Create `/ui2/src/services/MosaicRenderCoordinator.ts`
- Extend or compose with existing RenderCoordinator
- Implement slice-level caching:
  ```typescript
  class MosaicRenderCoordinator {
    private sliceCache = new Map<string, ImageBitmap>();
    
    getCacheKey(volumeId: string, orientation: string, position: number, width: number, height: number) {
      return `${volumeId}-${orientation}-${position}-${width}x${height}`;
    }
    
    async renderSlice(params: MosaicRenderParams): Promise<ImageBitmap> {
      const key = this.getCacheKey(/* ... */);
      if (this.sliceCache.has(key)) {
        return this.sliceCache.get(key)!;
      }
      // ... render and cache
    }
  }
  ```

#### 2. Update `/ui2/src/components/views/MosaicView.tsx`
- Use MosaicRenderCoordinator instead of regular RenderCoordinator
- Batch render requests when switching pages
- Clear cache on data changes

## Phase 6: Follow OrthogonalView Patterns

### Issue
MosaicView doesn't follow successful patterns from OrthogonalView.

### Solution
Align architecture with proven patterns.

### Files to Modify

#### 1. `/ui2/src/components/views/MosaicView.tsx`
- Implement throttled updates (30ms) for dimension changes
- Use coalescing middleware patterns for state updates
- Follow similar component structure to FlexibleSlicePanel

#### 2. Add proper event handling
- Implement hover state management similar to SliceView
- Use proper coordinate transforms from OrthogonalView

## Implementation Order

1. **Phase 1** - Fix shared crosshair (Critical - fixes main issue)
2. **Phase 3** - Fix canvas sizing (fixes quarter-view issue)
3. **Phase 2** - Stabilize ResizeObserver (fixes grid resizing)
4. **Phase 4** - Optimize re-renders (improves performance)
5. **Phase 5** - Implement coordination (enhances performance)
6. **Phase 6** - Align with patterns (ensures consistency)

## Testing Strategy

### Unit Tests
1. Test that each cell renders different slice positions
2. Test that mouse movement doesn't trigger grid resizing
3. Test that full slice is visible, not just quarter

### Integration Tests
1. Test interaction between cells (clicking one shouldn't affect others)
2. Test performance with 9+ cells
3. Test memory usage with slice caching

### Manual Testing Checklist
- [ ] Load volume and open mosaic view
- [ ] Verify each cell shows different slice
- [ ] Move mouse across grid - no resizing
- [ ] Click on cells - crosshair updates correctly
- [ ] Resize window - grid adjusts smoothly
- [ ] Switch pages - renders quickly with caching
- [ ] Change colormap - all cells update
- [ ] Toggle layers - all cells reflect changes

## Rollback Plan

If issues arise during implementation:
1. Keep original MosaicView.tsx as MosaicView.old.tsx
2. Implement changes incrementally with feature flags if needed
3. Test each phase independently before proceeding

## Success Criteria

1. Each mosaic cell displays a unique slice position
2. Grid remains stable during mouse movements
3. Full slice content is visible (not cropped)
4. Performance is acceptable with 9+ cells
5. Memory usage remains reasonable with caching
6. Code follows established patterns from OrthogonalView

## Edge Cases to Consider

1. Very small grid cells (< 100px)
2. Non-square volumes
3. Rapid page switching
4. Multiple mosaic views open simultaneously
5. Dynamic grid size changes
6. Volumes with different dimensions/orientations

## Long-term Improvements (Future)

1. Virtual scrolling for very large grids
2. Progressive loading of slices
3. WebWorker-based rendering for better performance
4. Shared slice cache across all views
5. Configurable grid layouts (not just square grids)