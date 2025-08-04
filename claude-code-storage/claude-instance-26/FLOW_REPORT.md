# Flow Report: Execution Paths from File Loading to Image Display

## Executive Summary

The investigation has identified a critical runtime error in FlexibleOrthogonalView.tsx where `useViewStateStore` is used without being imported. This causes the component to fail during mounting, preventing proper initialization of the slice views and blocking the render event flow.

## 1. File Loading Flow

### 1.1 User Interaction → File Selection
```
FileBrowserPanel.tsx (line 124-130)
↓
User double-clicks file
↓
EventBus.emit('filebrowser.file.doubleclick', { path })
```

### 1.2 File Loading Service Processing
```
FileLoadingService.ts (line 31-34)
↓
Listens for 'filebrowser.file.doubleclick' event
↓
loadFile(path) called (line 40)
↓
Validates file extension (.nii, .nii.gz, .gii)
↓
apiService.loadFile(path) - Backend loads file (line 76)
↓
Returns VolumeHandle with id, dims, name
```

### 1.3 Layer Creation and Store Updates
```
FileLoadingService.ts (line 90-98)
↓
Creates Layer object with:
- id: volumeHandle.id
- visible: true (explicitly set)
- order: based on current layer count
↓
layerService.addLayer(layer) (line 128)
↓
Updates both stores:
- layerStore.layers
- viewStateStore.viewState.layers
```

### 1.4 View Initialization
```
FileLoadingService.ts (line 198-269)
↓
initializeViewsForVolume(volumeHandle)
↓
Gets volume bounds from backend
↓
Sets crosshair to volume center
↓
Calculates field of view
↓
Updates each view (axial, sagittal, coronal) with proper geometry
```

## 2. Rendering Flow

### 2.1 ViewState Change Detection
```
viewStateStore updates trigger coalesceUpdatesMiddleware.ts
↓
State changes are queued in pendingState (line 199)
↓
requestAnimationFrame scheduled to flush changes (line 212)
```

### 2.2 Backend Communication
```
coalesceUpdatesMiddleware.ts flushState() (line 66)
↓
Checks if dragging (skips if true)
↓
Calls backendUpdateCallback(pendingState) (line 107)
↓
Backend processes ViewState and renders images
```

### 2.3 Render Complete Events
```
Backend emits 'render.complete' events with:
- viewType: 'axial' | 'sagittal' | 'coronal'
- imageBitmap: ImageBitmap object
↓
EventBus distributes to all listeners
```

## 3. Component Mounting Flow

### 3.1 FlexibleOrthogonalView Structure
```
FlexibleOrthogonalView.tsx
├── ViewToolbar (line 104)
└── Allotment container (line 106)
    ├── Axial pane → FlexibleSlicePanel
    └── Bottom pane
        ├── Sagittal pane → FlexibleSlicePanel
        └── Coronal pane → FlexibleSlicePanel
```

### 3.2 Critical Error - Missing Import
```
FlexibleOrthogonalView.tsx (line 90)
const hasLayers = useViewStateStore.getState().viewState.layers.length > 0;
                  ^^^^^^^^^^^^^^^^^^ NOT IMPORTED!
```

**Impact**: Runtime error prevents component from mounting, blocking all child components.

### 3.3 FlexibleSlicePanel Mounting
```
FlexibleSlicePanel.tsx
↓
ResizeObserver tracks container size (line 103)
↓
Updates local dimensions state (line 127)
↓
Throttled update to viewStateStore (line 31)
↓
Renders SliceView with dimensions
```

### 3.4 SliceView Event Registration
```
SliceView.tsx
↓
useEvent('render.complete', handleRenderComplete) (line 188)
↓
Waits for events matching its viewId
↓
On event: draws ImageBitmap to canvas (line 163)
```

## 4. Event Handling Flow

### 4.1 Event Registration Timing
```
1. SliceView mounts and registers listener
2. useEffect in EventBus.ts sets up subscription (line 261)
3. Handler added to EventBus handlers Map
```

### 4.2 Event Distribution
```
EventBus.emit('render.complete', data) (line 110)
↓
Iterates through handlers for event type (line 122)
↓
Each SliceView checks if viewType matches (line 147)
↓
Matching view draws image to canvas
```

## 5. Root Cause Analysis

### 5.1 Primary Issue: Missing Import
The missing `useViewStateStore` import in FlexibleOrthogonalView.tsx causes:
1. JavaScript runtime error on component mount
2. Component tree fails to render
3. SliceView components never mount
4. Event listeners never register
5. No canvases exist to display images

### 5.2 Why Only Coronal View Sometimes Works
If the error is caught/suppressed somehow:
- The component might partially render
- Coronal view (bottom-right) might mount last
- It could register its event listener successfully
- Axial and Sagittal fail earlier in the render tree

### 5.3 Layout Impact of ViewToolbar
The ViewToolbar addition changed the flex structure:
```html
Before:
<div class="h-full w-full"> <!-- Full height -->
  <Allotment>...</Allotment>
</div>

After:
<div class="h-full w-full flex flex-col">
  <ViewToolbar /> <!-- Takes vertical space -->
  <div class="flex-1"> <!-- Should take remaining space -->
    <Allotment>...</Allotment>
  </div>
</div>
```

## 6. Canvas Drawing Flow

### 6.1 Image Receipt and Storage
```
SliceView handleRenderComplete (line 139)
↓
Validates event.viewType matches component viewId
↓
Stores ImageBitmap in lastImageRef (line 162)
↓
Calls redrawCanvas()
```

### 6.2 Canvas Drawing Process
```
SliceView redrawCanvasImpl (line 308)
↓
Gets 2D context from canvas
↓
drawScaledImage() utility scales and centers image
↓
Updates imagePlacementRef for coordinate transforms
↓
Optionally draws crosshair on top
```

## 7. Critical Fix Required

Add the missing import to FlexibleOrthogonalView.tsx:
```typescript
import { useViewStateStore } from '@/stores/viewStateStore';
```

This single line fix will:
1. Allow the component to mount properly
2. Enable all child components to render
3. Register all event listeners
4. Restore the complete render flow

## 8. Additional Observations

### 8.1 Event Flow is Intact
- File loading service properly creates layers with visible=true
- Coalescing middleware correctly batches and sends ViewState
- Backend successfully renders and emits events
- SliceView event handlers are properly implemented

### 8.2 Dimension Handling is Robust
- FlexibleSlicePanel uses ResizeObserver effectively
- Throttled updates prevent excessive re-renders
- Dimension changes trigger proper backend updates
- Canvas redraw on resize works correctly

### 8.3 State Management is Sound
- Layer creation updates both stores atomically
- ViewState changes are properly coalesced
- Crosshair updates trigger re-renders appropriately
- Drag state properly delays renders during resize

## Conclusion

The flow from file loading to image display is well-architected and properly implemented. The single point of failure is the missing import in FlexibleOrthogonalView.tsx, which breaks the component mounting chain and prevents the entire render flow from executing. Once this import is added, the system should function correctly.