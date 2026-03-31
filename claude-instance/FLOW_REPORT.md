# File Loading to Rendered Image: Complete Data Flow Analysis

## Executive Summary

This report traces every step of the neuroimaging file loading pipeline in brainflow2, from user interaction to rendered pixels on screen. The system follows a unidirectional data flow:

```
User Action --> EventBus / Service Call
  --> DisplayLifecycleOrchestrator (routing)
    --> VolumeLoadingService or SurfaceLoadingService (orchestration)
      --> Tauri backend commands via transport.ts (I/O)
        --> layerStore / surfaceStore / viewStateStore (state)
          --> coalesceUpdatesMiddleware (batching)
            --> OptimizedRenderService (diff detection)
              --> RenderCoordinator --> apiService.render_view (GPU render)
                --> renderStateStore (image storage)
                  --> useRenderCanvas --> Canvas DOM (display)
```

---

## 1. User Double-Clicks a File in FileBrowserPanel

### Source File
`/Users/bbuchsbaum/code/brainflow2/ui2/src/components/panels/FileBrowserPanel.tsx`

### Click Handler (line 211)

```typescript
function handleDoubleClick() {
  if (!isDirectory) {
    const eventBus = getEventBus();
    eventBus.emit('filebrowser.file.doubleclick', { path: data.path });
  }
}
```

The `FileTreeItem` component is rendered inside a `react-arborist` `Tree`. The `onDoubleClick` handler on each tree row (line 326) calls `handleDoubleClick()`. For files (not directories), it emits the `'filebrowser.file.doubleclick'` event on the global EventBus with the file's absolute path.

### Context Menu (lines 239-311)

Right-clicking a file opens a context menu with four intent options. Each emits `'filebrowser.file.open'` with a typed `DisplayOpenIntent`:

| Menu Item | Event Payload `intent` | Effect |
|---|---|---|
| "Open" | `'default'` | Orchestrator decides based on file type |
| "Add As Layer" | `'add-layer'` | Add as overlay to current workspace |
| "Open In New Tab" | `'new-workspace'` | Create a new workspace tab first |
| "Open In Comparison View" | `'comparison'` | Open in comparison workspace |

### Drag Start (lines 219-237)

Files (not directories) are draggable. `handleDragStart` serializes a `DragFileData` JSON payload into three MIME types on the DataTransfer:

- `application/x-brainflow-file+json` (primary, custom MIME from `FILE_DRAG_MIME`)
- `application/json` (fallback)
- `text/plain` (path string fallback)

---

## 2. DisplayLifecycleOrchestrator: The Central Router

### Source File
`/Users/bbuchsbaum/code/brainflow2/ui2/src/services/DisplayLifecycleOrchestrator.ts`

### How It Listens

In its constructor (`initializeIngressListeners`, line 133), the orchestrator subscribes to two EventBus events:

```typescript
// Double-click (default intent)
this.eventBus.on('filebrowser.file.doubleclick', ({ path }) => {
  void this.loadFile({ path, ingress: 'file-browser' });
});

// Context menu with explicit intent
this.eventBus.on('filebrowser.file.open', ({ path, intent }) => {
  void this.loadFile({ path, ingress: 'file-browser', intent: intent ?? 'default' });
});
```

### The loadFile Method (line 71)

This is the **canonical entry point** for all file loads. It:

1. **Validates the path** -- non-empty, has a supported extension (`.nii`, `.nii.gz`, `.gii`, `.gifti`)
2. **Routes to exactly one flow** via `resolveLoadRoute()` (line 257):

```
resolveLoadRoute(path, filename) --> 'surface-overlay' | 'surface' | 'volume'
```

The routing logic:
- **surface-overlay**: `SurfaceOverlayService.detectGiftiType(filename)` returns `'overlay'` for `.func.gii`, `.shape.gii`, `.label.gii`
- **surface**: `SurfaceLoadingService.isSupportedSurfaceFile(path)` returns true for `.gii` / `.gifti` that are NOT overlays (e.g., `.surf.gii` or plain `.gii`)
- **volume**: everything else (`.nii`, `.nii.gz`)

3. **Dispatches** to the appropriate service:

| Route | Dispatch |
|---|---|
| `'surface-overlay'` | `this.loadSurfaceOverlay(path, filename)` |
| `'surface'` | `this.surfaceLoadingService.loadSurfaceFile({ path, displayName, autoActivate: true, validateMesh: true })` |
| `'volume'` | `this.loadVolumeForIntent(path, filename, startTime, intent)` |

### Intent Handling for Volumes (line 152)

The `loadVolumeForIntent` method routes the volume load based on the `DisplayOpenIntent`:

| Intent | Behavior |
|---|---|
| `'default'` / `'add-layer'` | Loads volume normally. If active workspace is comparison type, auto-creates a comparison panel for the new layer. |
| `'new-workspace'` | Calls `workspaceStore.createWorkspace('orthogonal-locked')` first, then loads volume. |
| `'comparison'` | Ensures a comparison workspace exists (creates one if needed), loads volume, then calls `comparisonStore.ensurePanelsForLayers()`. |

---

## 3. FileLoadingService: Thin Facade

### Source File
`/Users/bbuchsbaum/code/brainflow2/ui2/src/services/FileLoadingService.ts`

This is a **compatibility facade** that delegates entirely to `DisplayLifecycleOrchestrator`:

```typescript
class FileLoadingService {
  async loadFile(path, ingress = 'programmatic', intent = 'default') {
    await getDisplayLifecycleOrchestrator().loadFile({ path, ingress, intent });
  }
  async loadDroppedFile(file, intent = 'add-layer') {
    await getDisplayLifecycleOrchestrator().loadDroppedFile(file, intent);
  }
}
```

**Key insight for BIDS integration**: Any code that wants to programmatically load a file should call either:
- `getFileLoadingService().loadFile(path, 'programmatic', intent)` -- for facade convenience
- `getDisplayLifecycleOrchestrator().loadFile({ path, ingress: 'programmatic', intent })` -- for direct access

Both are equivalent. The `ingress` parameter is used only for logging.

---

## 4. Volume Loading Flow (NIfTI)

### Step 4a: Backend File Load

In `DisplayLifecycleOrchestrator.loadVolume()` (line 281):

```typescript
const volumeHandle = await this.apiService.loadFile(path);
```

This calls `ApiService.loadFile()` which delegates to `VolumeApiService.loadFile()`:

```typescript
// VolumeApiService.ts line 54
async loadFile(path: string): Promise<VolumeHandle> {
  return this.transport.invoke<VolumeHandle>('load_file', { path });
}
```

This invokes the Tauri command `plugin:api-bridge|load_file` on the Rust backend. The backend:
1. Opens the NIfTI file
2. Parses header, extracts dimensions, dtype, affine
3. Creates a volume handle in the Rust registry
4. Returns a `VolumeHandle` object:

```typescript
interface VolumeHandle {
  id: string;              // Unique handle ID
  name: string;            // Filename
  dims: [number, number, number];
  dtype: string;
  volume_type?: string;    // 'Volume3D' | 'TimeSeries4D'
  time_series_info?: { num_timepoints, tr, temporal_unit, acquisition_time }
  path?: string;
}
```

### Step 4b: VolumeLoadingService.loadVolume()

**Source**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/VolumeLoadingService.ts`

Called by `DisplayLifecycleOrchestrator.loadVolume()` (line 304):

```typescript
const addedLayer = await this.volumeLoadingService.loadVolume({
  volumeHandle,
  displayName: volumeHandle.name || filename,
  source: 'file',
  sourcePath: path,
  layerType: this.inferLayerType(filename),
  visible: true,
});
```

The `loadVolume()` method (line 71) executes this sequence:

1. **Store volume handle** (line 98):
   ```typescript
   VolumeHandleStore.setVolumeHandle(volumeHandle.id, volumeHandle);
   ```

2. **Get volume bounds from backend** (line 102):
   ```typescript
   const volumeBounds = await this.getVolumeBounds(volumeHandle);
   // Calls: this.apiService.getVolumeBounds(volumeHandle.id)
   // Tauri command: plugin:api-bridge|get_volume_bounds
   ```
   Returns `{ min, max, center, dims }` in world coordinates (mm).

3. **Create LayerInfo object** (line 115):
   ```typescript
   const layer: LayerInfo = {
     id: volumeHandle.id,
     name: displayName,
     volumeId: volumeHandle.id,
     type: layerType || this.inferLayerType(displayName, source),
     visible: true,
     order: currentLayerCount,
     volumeType: ...,
     timeSeriesInfo: ...,
     currentTimepoint: 0
   };
   ```

4. **Set layer metadata** in layerStore (line 154):
   ```typescript
   useLayerStore.getState().setLayerMetadata(layer.id, {
     worldBounds: { min: volumeBounds.min, max: volumeBounds.max },
     source, sourcePath, loadedAt: new Date().toISOString()
   });
   ```

5. **Emit `'volume.loaded'` event** (line 165):
   ```typescript
   this.eventBus.emit('volume.loaded', { volumeId: volumeHandle.id, metadata: volumeHandle });
   ```

6. **Initialize views** (line 172):
   ```typescript
   await this.initializeViews(volumeHandle, volumeBounds);
   ```
   This:
   - Sets crosshair to volume center: `useViewStateStore.getState().setCrosshair(bounds.center, true)`
   - Calls `apiService.getInitialViews(volumeHandle.id, maxPx)` (Tauri command: `plugin:api-bridge|get_initial_views`)
   - Updates each view (axial/sagittal/coronal) in viewStateStore: `useViewStateStore.getState().updateView(viewType, plane)`

7. **Add layer through LayerService** (line 176):
   ```typescript
   addedLayer = await this.layerService.addLayer(layer);
   ```

8. **Emit `'volume.load.complete'` event** (line 198)

### Step 4c: LayerService.addLayer() and LayerApiImpl

**LayerService** (`/ui2/src/services/LayerService.ts` line 55) calls `this.api.addLayer(layer)` which is the `LayerApiImpl`.

**LayerApiImpl** (`/ui2/src/services/LayerApiImpl.ts` line 103) does:

1. **Request GPU resources** (line 123):
   ```typescript
   const gpuInfo = await this.apiService.requestLayerGpuResources(newLayer.id, newLayer.volumeId);
   // Tauri command: plugin:api-bridge|request_layer_gpu_resources
   ```
   This uploads the volume texture to the GPU and returns data range, center, dimensions, spacing, transforms, etc.

2. **Compute render properties** from GPU info (lines 139-151):
   - intensity range (20th-80th percentile for scalars, full range for labels)
   - threshold
   - colormap ('gray' default)
   - interpolation ('linear' for scalars, 'nearest' for labels)

3. **Store enriched metadata** in layerStore (line 177):
   ```typescript
   useLayerStore.getState().setLayerMetadata(newLayer.id, {
     ...existingMetadata,
     dataRange, centerWorld, isBinaryLike,
     dimensions, spacing, origin, voxelToWorld, worldToVoxel,
     renderProps
   });
   ```

4. **Wait for backend readiness** (line 206):
   ```typescript
   await this.apiService.waitForLayerReady(newLayer.id, 500, 20);
   // Tauri command: plugin:api-bridge|wait_for_layer_ready
   ```

5. **Add to layerStore** (line 236):
   ```typescript
   useLayerStore.getState().addLayer(newLayer);
   ```

6. **Upsert ViewLayer into viewStateStore** (line 238):
   ```typescript
   this.upsertViewLayer(newLayer);
   ```
   This creates a `ViewLayer` object with render properties (opacity, colormap, intensity, threshold, blendMode, interpolation) and pushes it into `viewStateStore.viewState.layers[]`.

7. **LayerService emits** `'layer.added'` event (line 63).

### Step 4d: layerStore.addLayer()

**Source**: `/ui2/src/stores/layerStore.ts` line 138

```typescript
addLayer: (layer) => {
  set((state) => {
    state.layers.push(layer);
    if (state.selectedLayerId === null && state.layers.length === 1) {
      state.selectedLayerId = layer.id;  // Auto-select first layer
    }
  });
}
```

The store uses Zustand with Immer middleware. It does NOT emit lifecycle events; those are owned by LayerService.

---

## 5. Surface Loading Flow (GIfTI)

### Source File
`/Users/bbuchsbaum/code/brainflow2/ui2/src/services/SurfaceLoadingService.ts`

When `DisplayLifecycleOrchestrator` routes to the surface path (line 103):

```typescript
await this.surfaceLoadingService.loadSurfaceFile({
  path, displayName: filename, autoActivate: true, validateMesh: true
});
```

### SurfaceLoadingService.loadSurfaceFile() (line 73)

1. **Validate** file extension (`.gii` / `.gifti`)
2. **Enqueue** in `loadingQueueStore`
3. **Emit** `'surface.loading'` event
4. **Load from backend** (line 119):
   ```typescript
   const loadedSurface = await this.loadSurfaceFromPath(path);
   // Calls: this.transport.invoke('load_surface', { path })
   // Tauri command: plugin:api-bridge|load_surface
   ```
   Returns: `{ type: 'Surface', handle, vertex_count, face_count, hemisphere, surface_type }`

5. **Add to surfaceStore** (line 121):
   ```typescript
   surfaceStore.addSurface(loadedSurface, false);
   ```

6. **Fetch geometry** (line 123):
   ```typescript
   const geometry = await this.fetchSurfaceGeometry(loadedSurface.handle);
   // Calls: this.transport.invoke('get_surface_geometry', { handle })
   // Tauri command: plugin:api-bridge|get_surface_geometry
   ```
   Returns `{ vertices: number[], faces: number[] }` which are converted to `Float32Array` / `Uint32Array`.

7. **Store geometry** (line 124):
   ```typescript
   surfaceStore.setSurfaceGeometry(loadedSurface.handle, geometry);
   ```

8. **Activate** surface selection (line 132)
9. **Emit** `'surface.loaded'` event (line 139)
10. **Open surface viewer panel** via GoldenLayout (line 153):
    ```typescript
    layoutService.ensureSurfaceView(loadedSurface.handle, path);
    layoutService.focusSurfacePanel();
    ```

**Key difference from volumes**: Surfaces do NOT go through layerStore or viewStateStore. They have their own `surfaceStore` and are rendered via Three.js in a separate `SurfaceViewPanel`, not through the WebGPU slice rendering pipeline.

---

## 6. Surface Overlay Loading Flow

When a `.func.gii`, `.shape.gii`, or `.label.gii` file is loaded, `resolveLoadRoute()` returns `'surface-overlay'` and `loadSurfaceOverlay()` is called (line 341):

1. Checks that at least one surface is loaded in `surfaceStore`
2. Determines the target surface (uses `getActiveSurfaceCommandContext()` or falls back to first/only surface)
3. Calls `surfaceOverlayService.loadSurfaceOverlay(path, targetSurfaceId)`
   - Tauri command: `plugin:api-bridge|load_surface_overlay`
4. The overlay data is stored in `surfaceStore` as a data layer on the target surface

---

## 7. How Layers Trigger Rendering (The Rendering Pipeline)

This is the critical bridge between "data is loaded in stores" and "pixels appear on screen."

### Step 7a: ViewState Change Triggers Coalescing

When `LayerApiImpl.upsertViewLayer()` pushes a new layer into `viewStateStore.viewState.layers`, the viewStateStore uses a **coalescing middleware** (`/ui2/src/stores/middleware/coalesceUpdatesMiddleware.ts`).

The middleware:
1. Captures the new `ViewState` as `pendingState`
2. Schedules a `requestAnimationFrame` callback
3. On the next frame, calls the **backend callback** with the latest state

### Step 7b: Backend Callback Invokes OptimizedRenderService

The callback is set up in two places (belt-and-suspenders):
- `useServicesInit.ts` (line 142): `coalesceUtils.setBackendCallback(async (viewState, revisions) => { ... })`
- `useBackendSync.ts` (line 46): `coalesceUtils.setBackendCallback(updateBackend)`

Both call:
```typescript
await optimizedRenderService.renderChangedViews(viewState, undefined, revisions);
```

### Step 7c: OptimizedRenderService Diffs and Dispatches

**Source**: `/ui2/src/services/OptimizedRenderService.ts`

`renderChangedViews()` (line 135):
1. Detects which views changed (crosshair, layers, view planes)
2. For changed views, calls `RenderCoordinator.requestRender()` or `requestMultiViewRender()`
3. Stores resulting `ImageBitmap` in `renderStateStore`:
   ```typescript
   const { setImage } = useRenderStateStore.getState();
   setImage(viewType, imageBitmap);
   ```

### Step 7d: RenderCoordinator Calls Backend

**Source**: `/ui2/src/services/RenderCoordinator.ts`

`requestRender()` (line 85) queues a job that ultimately calls:
```typescript
const imageBitmap = await apiService.applyAndRenderViewState(viewState, viewType, width, height);
```

`ApiService.applyAndRenderViewState()` (line 568) calls `applyAndRenderViewStateCore()` (line 213) which:
1. Serializes the complete ViewState to JSON
2. Invokes Tauri command `plugin:api-bridge|render_view` with `{ stateJson, format: 'rgba' }`
3. Receives raw pixel bytes from the Rust backend
4. Decodes into an `ImageBitmap`
5. Returns the bitmap

### Step 7e: renderStateStore to Canvas

**renderStateStore** (`/ui2/src/stores/renderStateStore.ts`) stores the `ImageBitmap` keyed by view ID (e.g., `'axial'`, `'sagittal'`, `'coronal'`).

**useRenderCanvas** hook (`/ui2/src/hooks/useRenderCanvas.ts`) subscribes to renderStateStore:
```typescript
const { lastImage } = useRenderState(storeKey);
```

When `lastImage` changes, the hook's `redrawCanvas()` is called, which:
1. Gets the 2D canvas context
2. Calls `drawScaledImage(ctx, image, canvasWidth, canvasHeight)` to render with proper aspect ratio
3. Calls `customRender` callback (used for crosshair overlay)

This hook is used by `SliceRenderer` component, which is used by `SliceViewport`, which is used by `SliceViewCanvas` (the actual orthogonal view component).

---

## 8. Drag-and-Drop File Loading

### 8a. MosaicViewPromise Drop Handler

**Source**: `/ui2/src/components/views/MosaicViewPromise.tsx` (line 80)

```typescript
const handleDrop = useCallback(async (e: React.DragEvent) => {
  const fileLoadingService = getFileLoadingService();
  const intent = resolveDropOpenIntent(e);  // shift=comparison, alt=new-workspace, else=add-layer

  // Native OS files (from Finder/Explorer)
  const files = Array.from(e.dataTransfer.files);
  for (const file of files) {
    if (lower.endsWith('.nii') || lower.endsWith('.nii.gz') || lower.endsWith('.gii')) {
      await fileLoadingService.loadDroppedFile(file, intent);
    }
  }

  // Internal file browser drag
  const draggedFile = readFileDragData(e.dataTransfer);
  if (draggedFile?.path) {
    await fileLoadingService.loadFile(draggedFile.path, 'drag-drop', intent);
  }
});
```

Both paths ultimately call `DisplayLifecycleOrchestrator.loadFile()`, entering the same pipeline as double-click.

### 8b. ComparisonWorkspace Drop Handlers

**Source**: `/ui2/src/components/views/ComparisonWorkspace.tsx`

ComparisonWorkspace has multiple drop targets:

1. **Existing Panel Drop** (`handleDroppedFilePathToPanel`, line 165):
   - Loads the file via `getFileLoadingService().loadFile(path, 'drag-drop', 'add-layer')`
   - Then adds the resulting layer to the specific panel: `addLayerToPanel(workspaceId, panelId, loadedLayerId)`

2. **New Panel Drop** (`handleDroppedFilePathToNewPanel`, line 185):
   - Loads the file
   - Creates a new comparison panel: `addPanel(workspaceId, [loadedLayerId])`

3. **NewPanelDropZone** (`/ui2/src/components/views/NewPanelDropZone.tsx`):
   - Accepts both layer drags (`readLayerDragData`) and file drags (`readFileDragData`)
   - Calls `onDrop(layerId)`, `onFileDrop(path)`, or `onNativeFileDrop(file)` callbacks

4. **useViewportDropTarget** hook (`/ui2/src/components/views/viewport/useViewportDropTarget.ts`):
   - Shared hook providing `handleDragOver` and `handleDrop`
   - Tries native files first, then layer drag data, then file drag data
   - Used by ComparisonWorkspace for whole-workspace drops

### 8c. Modifier-Key Intent Resolution

**Source**: `/ui2/src/types/loadIntent.ts` (line 30)

```typescript
function resolveDropOpenIntent(modifiers: { altKey?, shiftKey? }): DisplayOpenIntent {
  if (modifiers.shiftKey) return 'comparison';
  if (modifiers.altKey) return 'new-workspace';
  return 'add-layer';
}
```

---

## 9. Complete Event Timeline (Volume Load)

Here is the exact sequence of events for a double-click on `sub-01_T1w.nii.gz`:

```
1.  [FileBrowserPanel]     handleDoubleClick()
2.  [EventBus]             emit('filebrowser.file.doubleclick', { path })
3.  [DLO]                  loadFile({ path, ingress: 'file-browser' })
4.  [DLO]                  resolveLoadRoute() --> 'volume'
5.  [DLO]                  loadVolumeForIntent(path, filename, startTime, 'default')
6.  [loadingQueueStore]    enqueue({ type: 'file', path, displayName })
7.  [EventBus]             emit('file.loading', { path })
8.  [ApiService]           loadFile(path)
9.  [VolumeApiService]     transport.invoke('load_file', { path })
10. [Tauri Backend]        Parses NIfTI, creates handle, returns VolumeHandle
11. [DLO]                  loadVolume() proceeds with volumeHandle
12. [VolumeLoadingService] loadVolume(config)
13. [VolumeHandleStore]    setVolumeHandle(id, handle)
14. [VolumeApiService]     transport.invoke('get_volume_bounds', { volumeId })
15. [Tauri Backend]        Returns { min, max, center, dims }
16. [layerStore]           setLayerMetadata(id, { worldBounds, source, sourcePath })
17. [EventBus]             emit('volume.loaded', { volumeId, metadata })
18. [viewStateStore]       setCrosshair(bounds.center, true)
19. [VolumeApiService]     transport.invoke('get_initial_views', { volumeId, maxPx })
20. [Tauri Backend]        Returns ViewPlane for each orientation
21. [viewStateStore]       updateView('axial', plane)
22. [viewStateStore]       updateView('sagittal', plane)
23. [viewStateStore]       updateView('coronal', plane)
24. [LayerService]         addLayer(layer)
25. [LayerApiImpl]         addLayer(layer)
26. [ApiService]           requestLayerGpuResources(layerId, volumeId)
27. [Tauri Backend]        Uploads texture to GPU, returns data_range, metadata
28. [layerStore]           setLayerMetadata(id, { dataRange, renderProps, ... })
29. [ApiService]           waitForLayerReady(layerId)
30. [layerStore]           addLayer(newLayer)        // <-- Layer appears in UI list
31. [LayerApiImpl]         upsertViewLayer(newLayer)  // <-- ViewLayer into viewStateStore
32. [viewStateStore]       setViewState(state => state.layers.push(viewLayer))
33. [EventBus]             emit('layer.added', { layer })
34. [EventBus]             emit('volume.load.complete', { volumeId, layerId })
35. [EventBus]             emit('file.loaded', { path, volumeId })
36. [EventBus]             emit('ui.notification', { type: 'info', message: 'Loaded: ...' })

--- Rendering pipeline (triggered by step 32) ---

37. [coalesceMiddleware]   pendingState = viewState; scheduleRAF()
38. [rAF callback]         backendCallback(viewState, revisions)
39. [OptimizedRenderService] renderChangedViews(viewState)
40. [OptimizedRenderService] detectChangedViews() --> all views (new layer)
41. [RenderCoordinator]    requestMultiViewRender({ viewState, viewTypes: [axial, sagittal, coronal] })
42. [ApiService]           applyAndRenderViewState(viewState, viewType, w, h) per view
43. [TauriTransport]       invoke('plugin:api-bridge|render_view', { stateJson, format })
44. [Rust Backend]         GPU renders slice, returns RGBA bytes
45. [ApiService]           Decodes bytes to ImageBitmap
46. [renderStateStore]     setImage('axial', imageBitmap)
47. [renderStateStore]     setImage('sagittal', imageBitmap)
48. [renderStateStore]     setImage('coronal', imageBitmap)
49. [useRenderCanvas]      Detects lastImage change
50. [SliceRenderer]        Redraws canvas with drawScaledImage()
51. [SliceViewCanvas]      Overlays crosshair via customRender callback
52. [Screen]               User sees rendered slice images
```

---

## 10. Key Stores and Their Roles

| Store | File | Role |
|---|---|---|
| `layerStore` | `stores/layerStore.ts` | Layer metadata, selection, loading state. Shared across GoldenLayout roots via `window.__layerStore`. |
| `viewStateStore` | `stores/viewStateStore.ts` | Complete ViewState (crosshair, views, layers with render props). Single source of truth for rendering. |
| `renderStateStore` | `stores/renderStateStore.ts` | Per-view `ImageBitmap` results from backend rendering. |
| `surfaceStore` | `stores/surfaceStore.ts` | Surface geometry, handles, data layers. Separate from volume pipeline. |
| `loadingQueueStore` | `stores/loadingQueueStore.ts` | File loading queue with progress tracking. |
| `workspaceStore` | `stores/workspaceStore.ts` | Workspace tabs (orthogonal, mosaic, comparison, set-studio). |
| `comparisonStore` | `stores/comparisonStore.ts` | Per-panel layer assignments and view types for comparison workspace. |

---

## 11. Key Tauri Commands (Backend RPC)

| Command | Namespaced As | Purpose |
|---|---|---|
| `load_file` | `plugin:api-bridge\|load_file` | Parse NIfTI, create volume handle |
| `get_volume_bounds` | `plugin:api-bridge\|get_volume_bounds` | World-space bounding box |
| `get_initial_views` | `plugin:api-bridge\|get_initial_views` | Compute ViewPlane per orientation |
| `request_layer_gpu_resources` | `plugin:api-bridge\|request_layer_gpu_resources` | Upload volume to GPU, get data range |
| `wait_for_layer_ready` | `plugin:api-bridge\|wait_for_layer_ready` | Poll until GPU resources are ready |
| `render_view` | `plugin:api-bridge\|render_view` | Render a single view to RGBA bytes |
| `render_views` | `plugin:api-bridge\|render_views` | Batch render multiple views |
| `load_surface` | `plugin:api-bridge\|load_surface` | Parse GIfTI surface geometry |
| `get_surface_geometry` | `plugin:api-bridge\|get_surface_geometry` | Get vertex/face arrays |
| `load_surface_overlay` | `plugin:api-bridge\|load_surface_overlay` | Load .func.gii/.shape.gii overlay |
| `patch_layer` | `plugin:api-bridge\|patch_layer` | Update render properties on backend |

---

## 12. How a BIDS Workspace Can Trigger the Same Flow

Based on this analysis, a BIDS workspace component can open a file in an existing viewer workspace by calling:

### Option A: Programmatic (recommended)

```typescript
import { getFileLoadingService } from '@/services/FileLoadingService';

// Load into active workspace as a new layer
await getFileLoadingService().loadFile(absolutePath, 'programmatic', 'add-layer');

// Load into a new workspace tab
await getFileLoadingService().loadFile(absolutePath, 'programmatic', 'new-workspace');

// Load into comparison workspace
await getFileLoadingService().loadFile(absolutePath, 'programmatic', 'comparison');
```

### Option B: EventBus (decoupled)

```typescript
import { getEventBus } from '@/events/EventBus';

// Same as double-click behavior
getEventBus().emit('filebrowser.file.doubleclick', { path: absolutePath });

// With explicit intent
getEventBus().emit('filebrowser.file.open', {
  path: absolutePath,
  intent: 'add-layer'
});
```

### Option C: Direct orchestrator (most control)

```typescript
import { getDisplayLifecycleOrchestrator } from '@/services/DisplayLifecycleOrchestrator';

await getDisplayLifecycleOrchestrator().loadFile({
  path: absolutePath,
  ingress: 'programmatic',
  intent: 'add-layer',
});
```

All three options enter the same pipeline and will:
1. Route to the correct loader (volume vs. surface vs. overlay)
2. Create the appropriate store entries
3. Trigger rendering automatically via the viewStateStore --> coalesceMiddleware --> OptimizedRenderService pipeline

---

## 13. File Inventory

All source files referenced in this analysis:

| File | Role |
|---|---|
| `ui2/src/components/panels/FileBrowserPanel.tsx` | User interaction: double-click, context menu, drag start |
| `ui2/src/services/DisplayLifecycleOrchestrator.ts` | Central router: file type detection, intent handling |
| `ui2/src/services/FileLoadingService.ts` | Thin facade delegating to orchestrator |
| `ui2/src/services/VolumeLoadingService.ts` | Volume lifecycle: bounds, views, layer creation |
| `ui2/src/services/SurfaceLoadingService.ts` | Surface lifecycle: load, geometry fetch, viewer panel |
| `ui2/src/services/SurfaceOverlayService.ts` | GIfTI type detection, overlay application |
| `ui2/src/services/LayerService.ts` | Layer CRUD, render property batching |
| `ui2/src/services/LayerApiImpl.ts` | Backend integration: GPU resources, metadata enrichment |
| `ui2/src/services/apiService.ts` | Tauri command wrappers, render_view calls |
| `ui2/src/services/volume/VolumeApiService.ts` | Volume-specific Tauri commands |
| `ui2/src/services/transport.ts` | Tauri invoke abstraction, command namespacing |
| `ui2/src/services/UnifiedLayerService.ts` | Facade over layerStore + surfaceStore |
| `ui2/src/services/OptimizedRenderService.ts` | View diff detection, selective rendering |
| `ui2/src/services/RenderCoordinator.ts` | Render job queue, debouncing |
| `ui2/src/stores/layerStore.ts` | Layer state: CRUD, metadata, selection |
| `ui2/src/stores/viewStateStore.ts` | ViewState: crosshair, views, layer render props |
| `ui2/src/stores/renderStateStore.ts` | Per-view ImageBitmap storage |
| `ui2/src/stores/workspaceStore.ts` | Workspace tab management |
| `ui2/src/stores/middleware/coalesceUpdatesMiddleware.ts` | RAF-based state batching |
| `ui2/src/events/EventBus.ts` | Type-safe pub/sub event system |
| `ui2/src/types/loadIntent.ts` | DisplayOpenIntent type, modifier-key resolution |
| `ui2/src/utils/layerDrag.ts` | Drag MIME types, serialization/deserialization |
| `ui2/src/hooks/useRenderCanvas.ts` | renderStateStore to canvas bridge |
| `ui2/src/hooks/useSliceViewModel.ts` | viewStateStore to component props |
| `ui2/src/hooks/useBackendSync.ts` | viewStateStore to OptimizedRenderService |
| `ui2/src/hooks/useServicesInit.ts` | Service initialization, coalesce callback setup |
| `ui2/src/components/views/SliceRenderer.tsx` | Canvas rendering component |
| `ui2/src/components/views/SliceViewport.tsx` | Shared viewport with drag-drop |
| `ui2/src/components/views/SliceViewCanvas.tsx` | Orthogonal slice view with overlays |
| `ui2/src/components/views/MosaicViewPromise.tsx` | Mosaic grid with drop handler |
| `ui2/src/components/views/ComparisonWorkspace.tsx` | Multi-panel comparison with drop handlers |
| `ui2/src/components/views/NewPanelDropZone.tsx` | Drop zone for creating new comparison panels |
| `ui2/src/components/views/viewport/useViewportDropTarget.ts` | Shared drop target hook |
| `ui2/src/components/views/viewport/useSliceViewportController.ts` | Crosshair overlay rendering |
