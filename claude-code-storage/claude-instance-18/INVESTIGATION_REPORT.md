# MosaicView Component with Batch Rendering - Investigation Report

## Executive Summary

This report documents the investigation of implementing a MosaicView component with batch rendering capabilities for the Brainflow2 neuroimaging application. The component will display multiple slice views in a grid layout with optimized GPU batch rendering.

## 1. Backend Requirements Analysis

### 1.1 New Rust Commands Needed

#### `query_slice_axis_meta`
- **Purpose**: Query volume metadata to determine the number of slices along a given axis
- **Location**: Add to `/core/api_bridge/src/lib.rs`
- **Registration Points**:
  1. Add function with `#[command]` attribute in `lib.rs`
  2. Add `"query_slice_axis_meta"` to `COMMANDS` array in `/core/api_bridge/build.rs`
  3. Add `query_slice_axis_meta` to `generate_handler!` macro in `lib.rs`
  4. Add `'query_slice_axis_meta'` to `apiBridgeCommands` in `/ui2/src/services/transport.ts`

#### `batch_render_slices`
- **Purpose**: Render multiple slices in a single GPU pass for efficiency
- **Location**: Add to `/core/api_bridge/src/lib.rs`
- **Registration Points**: Same four locations as above

### 1.2 Render Loop Architecture

#### Current Rendering Flow
The current `apply_and_render_view_state_raw` command follows this pattern:
1. Parse view state JSON from frontend
2. Ensure GPU resources for visible layers
3. Set view state in render loop
4. Call `render_to_buffer()` which:
   - Creates GPU encoder and render pass
   - Binds textures and uniforms
   - Draws fullscreen quad
   - Copies texture to buffer with Y-flip
   - Returns raw RGBA data

#### Key Components
- **RenderLoopService** (`/core/render_loop/src/lib.rs`): Main GPU rendering service
- **RenderTargetPool** (`/core/render_loop/src/render_target_pool.rs`): LRU cache for render targets
- **ViewState** (`/core/render_loop/src/view_state.rs`): Manages view configurations
- **LayerStorage** (`/core/render_loop/src/layer_storage.rs`): GPU layer management

#### Batch Rendering Strategy
The RenderTargetPool already supports multiple render targets. For batch rendering:
1. Create multiple render targets for each slice
2. Iterate through slices updating UBO for each
3. Render to separate targets or use array textures
4. Return combined buffer with all slice data

### 1.3 GPU Resource Management

Current patterns show:
- Texture atlas for volume data (`TextureManager`)
- Multi-texture support for world-space rendering
- Layer uniforms via UBO or storage buffers
- Render target pooling to avoid recreation

## 2. Frontend Integration Analysis

### 2.1 Component Location and Structure

The MosaicView component should be added at:
- `/ui2/src/components/views/MosaicView.tsx`

It's already registered in the ViewRegistry (`/ui2/src/services/ViewRegistry.ts`) as:
```typescript
export class MosaicViewFactory implements ViewFactory {
  getDefaultConfig(): Partial<WorkspaceConfig> {
    return {
      rows: 3,
      columns: 3,
      sliceOrientation: 'axial'
    };
  }
  // Creates layout with MosaicView component
}
```

### 2.2 Reference Components

#### FlexibleOrthogonalView Pattern
- Uses Allotment for resizable panes
- Contains multiple FlexibleSlicePanel components
- Manages drag state and dimension updates
- Key pattern: ResizeObserver for dimension tracking

#### FlexibleSlicePanel Pattern
- Renders individual slice views
- Handles canvas rendering and interactions
- Updates on dimension changes
- Uses `useViewCanvas` hook for WebGPU rendering

### 2.3 Raw RGBA Data Handling

The apiService already supports raw RGBA data:
```typescript
// In apiService.ts
if (this.useRawRGBA) {
  const rawResult = await this.transport.invoke<Uint8Array>(
    'apply_and_render_view_state_raw',
    { viewStateJson: JSON.stringify(declarativeViewState) }
  );
  // Direct RGBA data without PNG encoding
}
```

### 2.4 State Management

Key stores involved:
- **workspaceStore**: Manages workspace configurations
- **layerStore**: Tracks layers and visibility
- **viewStateStore**: Manages view states per workspace
- **renderStore**: Coordinates rendering state

## 3. Architecture Patterns

### 3.1 View State Management

- Each view has a unique ID (e.g., "mosaic-axial-0-0" for grid position)
- View states are isolated per workspace to prevent conflicts
- Coalesced updates via middleware for performance

### 3.2 Component Lifecycle

1. **Mount**: Register view IDs, initialize canvases
2. **Resize**: ResizeObserver updates dimensions, triggers re-render
3. **Update**: Layer/crosshair changes trigger view state updates
4. **Unmount**: Cleanup view registrations and GPU resources

### 3.3 Performance Optimizations

- Render coalescing to batch updates
- Shared GPU resources via texture atlas
- Raw RGBA path avoids PNG encoding
- Render target pooling prevents recreation

## 4. Implementation Plan

### 4.1 Backend Implementation

1. **Add `query_slice_axis_meta` command**:
   ```rust
   #[command]
   async fn query_slice_axis_meta(
       volume_id: String,
       axis: String, // "axial", "sagittal", or "coronal"
       state: State<'_, BridgeState>
   ) -> BridgeResult<SliceAxisMeta> {
       // Get volume from registry
       // Calculate number of slices along axis
       // Return slice count and spacing
   }
   ```

2. **Add `batch_render_slices` command**:
   ```rust
   #[command]
   async fn batch_render_slices(
       batch_request: BatchRenderRequest,
       state: State<'_, BridgeState>
   ) -> Result<tauri::ipc::Response, BridgeError> {
       // Parse batch request with multiple view states
       // Allocate buffer for all slices
       // Loop through each slice:
       //   - Update view state
       //   - Render to section of buffer
       // Return combined RGBA data
   }
   ```

3. **Extend RenderLoopService**:
   - Add `render_batch()` method
   - Support rendering to buffer sections
   - Optimize UBO updates for batch operations

### 4.2 Frontend Implementation

1. **Create MosaicView Component**:
   ```typescript
   interface MosaicViewProps {
     workspaceId: string;
     rows: number;
     columns: number;
     orientation: 'axial' | 'sagittal' | 'coronal';
   }
   ```

2. **Implement Slice Grid**:
   - Calculate slice indices based on volume metadata
   - Create canvas grid with proper IDs
   - Handle batch rendering response

3. **Optimize Rendering**:
   - Single batch render call for all visible slices
   - Slice RGBA buffer into individual canvases
   - Synchronize crosshair across slices

### 4.3 Type Definitions

1. **Backend Types** (Rust):
   ```rust
   #[derive(Serialize, Deserialize, TS)]
   pub struct SliceAxisMeta {
       pub slice_count: u32,
       pub slice_spacing: f32,
       pub axis_length_mm: f32,
   }
   
   #[derive(Serialize, Deserialize, TS)]
   pub struct BatchRenderRequest {
       pub view_states: Vec<ViewState>,
       pub width_per_slice: u32,
       pub height_per_slice: u32,
   }
   ```

2. **Frontend Types** (TypeScript):
   ```typescript
   interface MosaicRenderResult {
     data: Uint8Array;  // Combined RGBA data
     sliceWidth: number;
     sliceHeight: number;
     sliceCount: number;
   }
   ```

## 5. Key Considerations

### 5.1 Memory Management
- Batch size limits to prevent excessive GPU memory usage
- Render target pool configuration for multiple targets
- Efficient buffer slicing on frontend

### 5.2 Performance
- GPU batch efficiency vs. memory overhead tradeoff
- Optimal grid size based on GPU capabilities
- Progressive loading for large grids

### 5.3 User Experience
- Smooth scrolling through slices
- Responsive grid resizing
- Consistent crosshair synchronization

## 6. Testing Strategy

1. **Unit Tests**:
   - Test slice index calculations
   - Verify batch render buffer layout
   - Check view state generation

2. **Integration Tests**:
   - Load volume and render mosaic
   - Verify all slices display correctly
   - Test interaction with other views

3. **Performance Tests**:
   - Measure batch vs. individual rendering
   - Profile GPU memory usage
   - Benchmark different grid sizes

## Conclusion

The MosaicView implementation requires coordinated changes across backend Rust commands, GPU rendering pipeline, and frontend React components. The existing architecture provides solid foundations with render target pooling, raw RGBA support, and flexible view management. The main challenges will be efficient batch rendering on the GPU side and proper slice data distribution on the frontend.