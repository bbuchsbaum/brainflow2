# Flow Report: MosaicView vs SliceView Rendering Analysis

## Executive Summary

This report traces the complete execution flow for both SliceView (working) and MosaicView (broken - showing black squares) components. The investigation reveals a critical architectural divergence: SliceView uses a centralized rendering pipeline through the coalescing middleware and RenderCoordinator, while MosaicView bypasses this system entirely and attempts direct batch rendering.

## 1. SliceView Rendering Flow (Working)

### 1.1 Event-Driven Architecture
SliceView follows a completely passive, event-driven architecture:

```
ViewStateStore → Coalescing Middleware → useServicesInit → RenderCoordinator → Backend → EventBus → SliceView
```

### 1.2 Detailed Flow

1. **State Updates** (`/ui2/src/stores/viewStateStore.ts`)
   - User interactions update ViewStateStore (crosshair, layers, dimensions)
   - All updates go through the coalescing middleware

2. **Coalescing Middleware** (`/ui2/src/stores/middleware/coalesceUpdatesMiddleware.ts`)
   - Batches rapid state changes using `requestAnimationFrame`
   - Prevents overwhelming backend during slider drags or rapid updates
   - Calls the backend update callback set by `useServicesInit`

3. **Backend Callback** (`/ui2/src/hooks/useServicesInit.ts:99-178`)
   ```typescript
   coalesceUtils.setBackendCallback(async (viewState) => {
     // Skips if no layers
     // Renders each view type (axial, sagittal, coronal) separately
     // Uses RenderCoordinator for ALL renders
     const imageBitmap = await renderCoordinator.requestRender({
       viewState,
       viewType,
       width,
       height,
       reason: 'layer_change',
       priority: 'normal'
     });
     // Emits render.complete event
     eventBus.emit('render.complete', { viewType, imageBitmap });
   });
   ```

4. **RenderCoordinator** (`/ui2/src/services/RenderCoordinator.ts`)
   - Queues render jobs with debouncing for resizes
   - Validates view parameters
   - Calls `apiService.applyAndRenderViewStateCore`

5. **API Service** (`/ui2/src/services/apiService.ts:951-975`)
   - `applyAndRenderViewState` wraps `applyAndRenderViewStateCore`
   - Sends FrontendViewState JSON to backend
   - Can use binary IPC or JSON path
   - Returns ImageBitmap

6. **Backend Processing** (`/core/api_bridge/src/lib.rs:2679-2878`)
   - `apply_and_render_view_state_internal`:
     - Parses FrontendViewState JSON
     - Creates per-view render target
     - Checks `layer_to_atlas_map` for GPU resources
     - Allocates GPU resources on-demand if missing
     - Renders using the imperative API
     - Returns PNG or raw RGBA data

7. **Event Distribution** (`/ui2/src/events/EventBus.ts`)
   - `render.complete` event fired with ImageBitmap
   - SliceView listens and updates canvas

8. **SliceView Display** (`/ui2/src/components/views/SliceView.tsx:142-188`)
   ```typescript
   useEvent('render.complete', handleRenderComplete);
   
   const handleRenderComplete = React.useCallback((data: any) => {
     if (data.viewType === viewId && canvasRef.current) {
       // Draws ImageBitmap to canvas
       // Stores for redrawing on resize
     }
   });
   ```

### 1.3 Key Characteristics
- **Passive**: SliceView never initiates renders
- **Centralized**: All renders go through RenderCoordinator
- **Event-driven**: Uses EventBus for loose coupling
- **Coalesced**: Batches rapid updates efficiently

## 2. MosaicView Rendering Flow (Broken)

### 2.1 Direct API Architecture
MosaicView bypasses the entire centralized rendering system:

```
MosaicView → Direct API Call → Backend (different path) → Black images
```

### 2.2 Detailed Flow

1. **Local State Management** (`/ui2/src/components/views/MosaicView.tsx:174-181`)
   ```typescript
   const [viewState, setViewState] = useState<MosaicViewState>({
     sliceAxis: 'axial',
     currentPage: 0,
     gridSize: { rows: 3, cols: 3 },
     sliceIndices: [],
     totalSlices: 0,
     sliceSpacing: 1,
   });
   ```

2. **View State Building** (`MosaicView.tsx:316-409`)
   - `buildViewStates()` creates FrontendViewState array
   - Gets layers from ViewStateStore (same as SliceView)
   - Correctly preserves intensity values from ViewLayers
   - Builds proper view planes for each slice

3. **Direct Batch Rendering** (`MosaicView.tsx:437-515`)
   ```typescript
   const renderSlices = useCallback(async () => {
     const viewStates = buildViewStates();
     // Directly calls apiService.batchRenderSlices
     const buffer = await apiService.batchRenderSlices(
       viewStates,
       cellDimensions.width,
       cellDimensions.height
     );
   });
   ```

4. **API Service Batch Call** (`/ui2/src/services/apiService.ts:778-945`)
   - `batchRenderSlices` transforms FrontendViewState to render_loop ViewState format
   - Different transformation logic than single rendering
   - Sends as JSON string to backend

5. **Backend Batch Processing** (`/core/api_bridge/src/lib.rs:3340-3519`)
   ```rust
   async fn batch_render_slices(
     batch_request: BatchRenderRequest,
     state: State<'_, BridgeState>
   ) -> Result<tauri::ipc::Response, BridgeError> {
     // Parses ViewStates from JSON
     // For each ViewState:
     let frame_result = service.request_frame(
       render_loop::view_state::ViewId::new(format!("batch_slice_{}", idx)),
       view_state.clone()
     ).await
   ```

   **CRITICAL DIFFERENCE**: Uses `request_frame` (declarative API) instead of the imperative API used by `apply_and_render_view_state_internal`

6. **Missing GPU Resource Lookup**
   - `request_frame` expects volumes in the `volumes` registry
   - `apply_and_render_view_state_internal` uses `layer_to_atlas_map`
   - These are different registries!

7. **Result Processing** (`MosaicView.tsx:467-509`)
   - Receives concatenated buffer with header
   - Extracts individual RGBA slices
   - Displays black images despite correct buffer structure

### 2.3 Key Issues
- **Bypasses RenderCoordinator**: No queuing, debouncing, or centralized control
- **Different Backend Path**: Uses declarative `request_frame` vs imperative rendering
- **Registry Mismatch**: Volumes not registered in the expected location
- **No Event Integration**: Doesn't participate in the event-driven architecture

## 3. Critical Differences

### 3.1 API Call Differences

**SliceView** (via RenderCoordinator):
```typescript
await apiService.applyAndRenderViewStateCore(
  viewState,      // Full ViewState
  viewType,       // Single view type
  width,
  height,
  sliceOverride   // Optional
);
```

**MosaicView** (direct):
```typescript
await apiService.batchRenderSlices(
  viewStates,     // Array of ViewStates
  widthPerSlice,  // Fixed dimensions
  heightPerSlice
);
```

### 3.2 Backend Processing Differences

**SliceView Backend**:
- Uses `apply_and_render_view_state_internal`
- Checks `layer_to_atlas_map` for GPU resources
- Allocates on-demand if missing
- Direct control over rendering

**MosaicView Backend**:
- Uses `batch_render_slices` → `request_frame`
- Expects volumes in `volumes` registry
- No on-demand allocation
- Delegates to declarative ViewState system

### 3.3 ViewState Structure Differences

**SliceView**: Sends FrontendViewState directly as JSON

**MosaicView**: Transforms to render_loop::ViewState format with different field names:
- `volume_id` instead of `volumeId`
- `intensity_window` instead of `intensity`
- `colormap_id` (number) instead of `colormap` (string)
- Different threshold handling

## 4. Root Cause Analysis

The black squares in MosaicView are caused by:

1. **Volume Registration Mismatch**: 
   - Single rendering path registers volumes in `layer_to_atlas_map`
   - Batch rendering expects them in the `volumes` registry
   - Volumes are never registered in the second location

2. **API Divergence**:
   - Two completely different rendering paths evolved independently
   - Batch rendering uses newer declarative API
   - Single rendering uses older imperative API
   - No shared code or resource management

3. **Architectural Bypass**:
   - MosaicView doesn't participate in the centralized render flow
   - Misses critical setup steps performed by RenderCoordinator
   - No integration with the event-driven architecture

## 5. Data Flow Diagrams

### SliceView Flow
```
User Input
    ↓
ViewStateStore.setState()
    ↓
coalesceUpdatesMiddleware (batches updates)
    ↓
useServicesInit callback
    ↓
RenderCoordinator.requestRender()
    ↓
apiService.applyAndRenderViewStateCore()
    ↓
Backend: apply_and_render_view_state_internal
    ↓
GPU Rendering (with resource allocation)
    ↓
ImageBitmap
    ↓
EventBus.emit('render.complete')
    ↓
SliceView.handleRenderComplete()
    ↓
Canvas Display
```

### MosaicView Flow
```
Component State Change
    ↓
buildViewStates() (local)
    ↓
apiService.batchRenderSlices() (direct)
    ↓
Backend: batch_render_slices
    ↓
Loop: request_frame() (missing volumes!)
    ↓
Black RGBA data
    ↓
MosaicCell displays black
```

## 6. Recommendations

### Immediate Fix
Modify `batch_render_slices` to use the same rendering path as single slices:
```rust
// Instead of:
let frame_result = service.request_frame(...);

// Use:
let json = serde_json::to_string(&frontend_view_state)?;
let rgba = apply_and_render_view_state_internal(json, state, true).await?;
```

### Long-term Solution
1. **Unify Rendering Pipelines**: Both single and batch should use the same backend code
2. **Integrate MosaicView**: Make it use RenderCoordinator like SliceView
3. **Consolidate Registries**: Use a single source of truth for volume/layer GPU resources
4. **Standardize ViewState**: Use consistent structures throughout the codebase

## 7. Key Files and Functions

### Frontend
- `/ui2/src/components/views/SliceView.tsx` - Event-driven view component
- `/ui2/src/components/views/MosaicView.tsx` - Direct API view component
- `/ui2/src/stores/middleware/coalesceUpdatesMiddleware.ts` - State batching
- `/ui2/src/hooks/useServicesInit.ts` - Centralized render setup
- `/ui2/src/services/RenderCoordinator.ts` - Render orchestration
- `/ui2/src/services/apiService.ts` - Backend API calls

### Backend
- `/core/api_bridge/src/lib.rs:2679` - `apply_and_render_view_state_internal`
- `/core/api_bridge/src/lib.rs:3340` - `batch_render_slices`
- `/core/render_loop/src/lib.rs` - GPU rendering service

## 8. Conclusion

The MosaicView black squares issue stems from an architectural divergence where MosaicView bypasses the centralized rendering system that makes SliceView work. The solution requires either adapting the batch rendering backend to use the same resource lookup as single rendering, or fully integrating MosaicView into the event-driven architecture used by SliceView.

The investigation reveals a broader architectural issue: having two separate rendering pathways leads to maintenance problems and bugs. A unified approach would eliminate these issues and make the codebase more maintainable.