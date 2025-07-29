# MosaicView Slice Positioning Investigation Report

## Problem Statement

The MosaicView component currently starts at the lowest slice (slice index 0) when opened. However, it should start at the current crosshair location for the selected axis (axial, sagittal, or coronal). If no crosshair is set, it should use the center coordinate of the volume.

## Investigation Findings

### 1. Current MosaicView Implementations

There are two MosaicView implementations:

#### a) `MosaicViewSimple.tsx` (Event-driven approach)
- Location: `/ui2/src/components/views/MosaicViewSimple.tsx`
- Uses `MosaicRenderService` for coordinated rendering
- State initialization (line 31): `const [currentPage, setCurrentPage] = useState(0);`
- Always starts at page 0, which shows slices starting from index 0

#### b) `MosaicView.tsx` (Batch rendering approach in tmp_o3pro)
- Location: `/tmp_o3pro/MosaicView.tsx`
- Uses batch rendering via backend API
- State initialization (line 176): `currentPage: 0`
- Also always starts at page 0

### 2. Crosshair Position Storage and Access

The crosshair position is stored in the `viewStateStore`:
- Location: `/ui2/src/stores/viewStateStore.ts`
- Access: `viewState.crosshair.world_mm` (array of [x, y, z] in millimeters)
- The store provides a `setCrosshair()` method to update the position
- When a volume is loaded, the crosshair is set to the volume center (line 49 in initial state)

### 3. Volume Center Calculation

From the investigation:
- When a volume is loaded via `FileLoadingService`, it sets the crosshair to `bounds.center`
- Center calculation is also found in `CrosshairService.ts`:
  ```typescript
  const center: WorldCoordinates = [
    (volumeInfo.bounds_mm.min[0] + volumeInfo.bounds_mm.max[0]) / 2,
    (volumeInfo.bounds_mm.min[1] + volumeInfo.bounds_mm.max[1]) / 2,
    (volumeInfo.bounds_mm.min[2] + volumeInfo.bounds_mm.max[2]) / 2
  ];
  ```

### 4. Slice Index to World Coordinate Mapping

The `MosaicRenderService` has logic for this mapping:
- Lines 183-231 in `MosaicRenderService.ts` show how slice indices map to world positions
- For each axis:
  - **Axial**: Moves inferior to superior (Z axis)
  - **Sagittal**: Moves right to left (X axis)
  - **Coronal**: Moves posterior to anterior (Y axis)
- Formula: `slicePosition_mm = sliceMin + (sliceIndex * (sliceRange / totalSlices))`

### 5. Current Issues

1. **No Initial Page Calculation**: Both MosaicView implementations hardcode `currentPage: 0`
2. **No Crosshair-to-Slice Conversion**: Neither implementation calculates which page/slice corresponds to the current crosshair position
3. **Missing Volume Bounds Check**: The components don't check if a volume is loaded before determining the initial position

## Required Solution

### 1. Calculate Initial Slice Index from Crosshair

Add a function to convert world coordinates to slice index:

```typescript
function worldPositionToSliceIndex(
  worldPosition: number,
  sliceMin: number,
  sliceMax: number,
  totalSlices: number
): number {
  const sliceRange = sliceMax - sliceMin;
  const normalizedPosition = (worldPosition - sliceMin) / sliceRange;
  return Math.round(normalizedPosition * (totalSlices - 1));
}
```

### 2. Calculate Initial Page from Slice Index

```typescript
function sliceIndexToPage(sliceIndex: number, slicesPerPage: number): number {
  return Math.floor(sliceIndex / slicesPerPage);
}
```

### 3. Update MosaicView Initialization

In the useEffect that fetches slice metadata (around line 243 in MosaicView.tsx or line 51 in MosaicViewSimple.tsx), after getting the total slices:

```typescript
// Get current crosshair position
const crosshair = useViewStateStore.getState().viewState.crosshair.world_mm;

// Determine which axis index to use based on slice axis
const axisIndex = axis === 'axial' ? 2 : axis === 'sagittal' ? 0 : 1;
const currentWorldPosition = crosshair[axisIndex];

// Get volume bounds to calculate slice range
const bounds = await apiService.getVolumeBounds(primaryVolumeId);
const sliceMin = bounds.min[axisIndex];
const sliceMax = bounds.max[axisIndex];

// Calculate the slice index for current crosshair position
const currentSliceIndex = worldPositionToSliceIndex(
  currentWorldPosition,
  sliceMin,
  sliceMax,
  meta.sliceCount
);

// Calculate the page that contains this slice
const slicesPerPage = gridSize.rows * gridSize.cols;
const initialPage = sliceIndexToPage(currentSliceIndex, slicesPerPage);

// Update the current page
setCurrentPage(initialPage);
// OR for MosaicView.tsx:
setViewState(prev => ({ ...prev, currentPage: initialPage }));
```

### 4. Handle Edge Cases

1. **No Volume Loaded**: Check if `primaryVolumeId` exists before calculating
2. **No Crosshair Set**: Default to volume center if crosshair is [0, 0, 0]
3. **Page Bounds**: Ensure calculated page is within valid range (0 to maxPage)
4. **Axis Changes**: Reset to crosshair position when switching between axial/sagittal/coronal

## Implementation Recommendations

1. **Add helper functions** to a utility file for reuse between both MosaicView implementations
2. **Update both components** to use the same logic for consistency
3. **Add logging** to help debug the initial position calculation
4. **Consider caching** the volume bounds to avoid repeated API calls
5. **Test with different volumes** to ensure the logic works across various image sizes and orientations

## Files to Modify

1. `/ui2/src/components/views/MosaicViewSimple.tsx` - Update initialization logic
2. `/tmp_o3pro/MosaicView.tsx` - Update initialization logic (if keeping this version)
3. Consider creating `/ui2/src/utils/mosaicUtils.ts` for shared helper functions
4. Update the axis change handlers to recalculate the initial page based on crosshair

## Additional Considerations

- The current implementation in `MosaicRenderService` already handles updating the crosshair position for each rendered slice (line 235), but this is for rendering individual cells, not for determining the initial view
- The slice metadata query (`querySliceAxisMeta`) provides the necessary information about total slices and spacing
- Volume bounds can be obtained via `apiService.getVolumeBounds()` which returns min/max coordinates