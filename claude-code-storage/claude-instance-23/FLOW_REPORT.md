# MosaicView Rendering and Slice Positioning Flow Report

## Executive Summary

This report maps the complete execution flow for MosaicView rendering and slice positioning in the Brainflow2 codebase. The investigation reveals that **MosaicView currently starts at page 0 (slice index 0)** instead of starting at the current crosshair position, which is the expected behavior for medical imaging viewers.

## Key Finding: Missing Initial Page Calculation

Both MosaicView implementations (`MosaicViewSimple.tsx` and `tmp_o3pro/MosaicView.tsx`) hardcode the initial page to 0:

- **MosaicViewSimple.tsx**: `const [currentPage, setCurrentPage] = useState(0);` (line 31)
- **tmp_o3pro/MosaicView.tsx**: `currentPage: 0` (line 176)

Neither implementation calculates which page corresponds to the current crosshair position when the view is initialized.

## Component Architecture

### 1. MosaicViewSimple (Event-Driven Architecture)
Located at: `/ui2/src/components/views/MosaicViewSimple.tsx`

**Key Responsibilities:**
- Uses `RenderCell` components for individual grid cells
- Leverages `MosaicRenderService` for coordinated rendering
- Works with the existing ViewState → Backend pipeline

**State Management:**
```typescript
const [sliceAxis, setSliceAxis] = useState<'axial' | 'sagittal' | 'coronal'>('axial');
const [currentPage, setCurrentPage] = useState(0); // ← Always starts at 0
const [gridSize, setGridSize] = useState({ rows: 2, cols: 2 });
const [totalSlices, setTotalSlices] = useState(100);
```

### 2. MosaicView (Batch Rendering Architecture)
Located at: `/tmp_o3pro/MosaicView.tsx`

**Key Responsibilities:**
- Uses batch rendering via backend API
- Manages its own render cache
- Independent of global render stores

**State Management:**
```typescript
const [viewState, setViewState] = useState<MosaicViewState>({
  sliceAxis: 'axial',
  currentPage: 0,  // ← Always starts at 0
  gridSize: { rows: 3, cols: 3 },
  sliceIndices: [],
  totalSlices: 0,
  sliceSpacing: 1,
});
```

## Execution Flow Analysis

### Phase 1: Component Initialization

1. **MosaicViewSimple Initialization**
   ```
   MosaicViewSimple → useState(0) → currentPage = 0
                   → Get layers from viewStateStore
                   → Filter visible layers
                   → Extract primaryVolumeId
   ```

2. **Fetch Slice Metadata** (lines 51-67 in MosaicViewSimple)
   ```typescript
   useEffect(() => {
     if (!primaryVolumeId) return;
     
     const fetchMetadata = async () => {
       const meta = await apiService.querySliceAxisMeta(primaryVolumeId, sliceAxis);
       if (meta && meta.sliceCount > 0) {
         setTotalSlices(meta.sliceCount);
       }
     };
     
     fetchMetadata();
   }, [primaryVolumeId, sliceAxis, apiService]);
   ```

### Phase 2: Slice Index Calculation

The slice indices for the current page are calculated based on grid size:

```typescript
const sliceIndices = useMemo(() => {
  const slicesPerPage = gridSize.rows * gridSize.cols;
  const startIdx = currentPage * slicesPerPage;
  
  const indices: number[] = [];
  for (let i = 0; i < slicesPerPage; i++) {
    const idx = startIdx + i;
    if (idx < totalSlices) {
      indices.push(idx);
    }
  }
  
  return indices;
}, [currentPage, gridSize, totalSlices]);
```

### Phase 3: Rendering Pipeline

1. **Trigger Renders** (MosaicViewSimple lines 134-165)
   ```
   MosaicViewSimple → mosaicRenderService.renderMosaicGrid(requests)
                    → For each cell: renderMosaicCell()
                    → createSliceViewState()
                    → apiService.applyAndRenderViewState()
   ```

2. **MosaicRenderService Flow** (`/ui2/src/services/MosaicRenderService.ts`)
   
   The service coordinates rendering for multiple slices:
   
   ```typescript
   async renderMosaicCell(request: MosaicRenderRequest) {
     // 1. Emit render start event
     this.eventBus.emit('render.start', { tag: cellId });
     
     // 2. Get current view state
     const currentViewState = useViewStateStore.getState().viewState;
     
     // 3. Create modified view state for specific slice
     const modifiedViewState = await this.createSliceViewState(
       currentViewState,
       axis,
       sliceIndex,
       width,
       height
     );
     
     // 4. Render using normal pipeline
     const imageBitmap = await this.apiService.applyAndRenderViewState(
       modifiedViewState,
       axis,
       width,
       height
     );
   }
   ```

### Phase 4: Slice Position Calculation

The `createSliceViewState` method in MosaicRenderService (lines 183-231) maps slice indices to world positions:

```typescript
// Calculate the range for each axis
let sliceMin: number, sliceMax: number;
switch (axis) {
  case 'axial':
    // For axial slices in LPI, we move inferior to superior (Z axis)
    sliceMin = volumeBounds.min[2];  // Most inferior slice
    sliceMax = volumeBounds.max[2];  // Most superior slice
    break;
  case 'sagittal':
    // For sagittal slices, we move right to left (X axis) 
    sliceMin = volumeBounds.min[0];
    sliceMax = volumeBounds.max[0];
    break;
  case 'coronal':
    // For coronal slices, we move posterior to anterior (Y axis)
    sliceMin = volumeBounds.min[1];
    sliceMax = volumeBounds.max[1];
    break;
}

// Map slice index to actual position
const sliceRange = sliceMax - sliceMin;
const totalSlices = Math.ceil(sliceRange);
const slicePosition_mm = sliceMin + (sliceIndex * (sliceRange / totalSlices));
```

## World Coordinates and Slice Index Relationship

### Coordinate System
- **World Space**: LPI (Left-Posterior-Inferior) coordinates in millimeters
- **Slice Indices**: Integer values from 0 to totalSlices-1

### Mapping Formula
For any axis, the relationship between slice index and world position is:

```
slicePosition_mm = sliceMin + (sliceIndex * (sliceRange / totalSlices))
```

Where:
- `sliceMin` = minimum bound for the axis
- `sliceRange` = sliceMax - sliceMin
- `totalSlices` = total number of slices along the axis

### Inverse Mapping (World to Slice Index)
To convert from world position to slice index:

```
sliceIndex = Math.round((worldPosition - sliceMin) / sliceRange * (totalSlices - 1))
```

## Crosshair Position Management

### ViewStateStore (`/ui2/src/stores/viewStateStore.ts`)

The crosshair position is stored globally:

```typescript
viewState: {
  crosshair: {
    world_mm: [x, y, z],  // World coordinates in millimeters
    visible: boolean
  },
  // ... other state
}
```

### Initial Crosshair Position
When a volume is loaded, the crosshair is set to the volume center (line 49):

```typescript
crosshair: {
  world_mm: [0, 0, 0],  // Default, updated when volume loads
  visible: true
}
```

The actual center calculation happens in various services:
```typescript
const center: WorldCoordinates = [
  (volumeInfo.bounds_mm.min[0] + volumeInfo.bounds_mm.max[0]) / 2,
  (volumeInfo.bounds_mm.min[1] + volumeInfo.bounds_mm.max[1]) / 2,
  (volumeInfo.bounds_mm.min[2] + volumeInfo.bounds_mm.max[2]) / 2
];
```

## Missing Implementation: Initial Page from Crosshair

### Required Functions

1. **World Position to Slice Index**
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

2. **Slice Index to Page**
   ```typescript
   function sliceIndexToPage(sliceIndex: number, slicesPerPage: number): number {
     return Math.floor(sliceIndex / slicesPerPage);
   }
   ```

### Implementation Location
The initialization should happen in the `useEffect` that fetches slice metadata:

```typescript
// After getting totalSlices from metadata
const crosshair = useViewStateStore.getState().viewState.crosshair.world_mm;
const axisIndex = axis === 'axial' ? 2 : axis === 'sagittal' ? 0 : 1;
const currentWorldPosition = crosshair[axisIndex];

// Get volume bounds
const bounds = await apiService.getVolumeBounds(primaryVolumeId);
const sliceMin = bounds.min[axisIndex];
const sliceMax = bounds.max[axisIndex];

// Calculate initial page
const currentSliceIndex = worldPositionToSliceIndex(
  currentWorldPosition,
  sliceMin,
  sliceMax,
  meta.sliceCount
);

const slicesPerPage = gridSize.rows * gridSize.cols;
const initialPage = sliceIndexToPage(currentSliceIndex, slicesPerPage);

setCurrentPage(initialPage);
```

## API Service Integration

### Key Methods

1. **querySliceAxisMeta** (lines 743-748)
   - Returns slice count and spacing for a given axis
   - Used to determine total number of slices

2. **getVolumeBounds** (lines 503-505)
   - Returns min/max coordinates for the volume
   - Essential for calculating slice ranges

3. **applyAndRenderViewState** (lines 55-400+)
   - Core rendering method
   - Handles coordinate transformation and backend communication

## CoordinateTransform Utility

The `CoordinateTransform` class (`/ui2/src/utils/coordinates.ts`) provides essential coordinate transformations:

### createOrthogonalViews (lines 105-140)
Creates standard orthogonal view planes with proper orientation:

```typescript
static createOrthogonalViews(
  center_mm: WorldCoordinates,
  extent_mm: [number, number] = [200, 200],
  dim_px: [number, number] = [512, 512]
): Record<ViewType, ViewPlane>
```

Key insight: Uses **uniform pixel size** to maintain square pixels (line 116):
```typescript
const pixelSize = Math.max(extentX / dimX, extentY / dimY);
```

## Data Flow Summary

```
1. User opens MosaicView
   ↓
2. Component initializes with currentPage = 0 ❌ (Should calculate from crosshair)
   ↓
3. Fetch slice metadata (total slices)
   ↓
4. Calculate slice indices for current page
   ↓
5. For each slice index:
   a. Convert index → world position
   b. Create modified ViewState with slice position
   c. Render via apiService
   ↓
6. Display rendered images in grid
```

## Recommendations

1. **Immediate Fix**: Update both MosaicView implementations to calculate initial page from crosshair position
2. **Add Utility Functions**: Create shared utilities for world↔slice conversions
3. **Handle Edge Cases**: 
   - No volume loaded
   - Crosshair at [0,0,0]
   - Page bounds validation
4. **Axis Changes**: Reset to crosshair position when switching axes
5. **Testing**: Verify with different volume sizes and orientations

## Files Requiring Modification

1. `/ui2/src/components/views/MosaicViewSimple.tsx` - Add initial page calculation
2. `/tmp_o3pro/MosaicView.tsx` - Add initial page calculation
3. Consider creating `/ui2/src/utils/mosaicUtils.ts` for shared conversion functions
4. Update axis change handlers in both components

## Conclusion

The MosaicView components are well-structured but missing the critical initial page calculation based on crosshair position. The infrastructure for proper coordinate transformation exists, but the components don't utilize it during initialization. Implementing the recommended changes will align the behavior with standard medical imaging viewers where slice views start at the current crosshair location.