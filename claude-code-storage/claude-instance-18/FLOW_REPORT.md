# MosaicView with Batch Rendering - Code Execution Flow Analysis

## Executive Summary

This report provides a detailed execution flow analysis for implementing MosaicView with batch rendering in the Brainflow2 neuroimaging application. The analysis traces data flow from backend GPU rendering through IPC to frontend display, identifies performance bottlenecks, and maps the integration points for new batch rendering commands.

## Table of Contents

1. [Backend Batch Rendering Flow](#1-backend-batch-rendering-flow)
2. [Frontend Rendering Pipeline](#2-frontend-rendering-pipeline)
3. [New Command Integration Flow](#3-new-command-integration-flow)
4. [Performance Critical Paths](#4-performance-critical-paths)

---

## 1. Backend Batch Rendering Flow

### 1.1 Single View Rendering (`apply_and_render_view_state_raw`)

The current single-view rendering flow follows this execution path:

```
Frontend Request → Tauri Command → Rust Handler → GPU Render → Raw RGBA → Frontend
```

#### Detailed Flow:

1. **Command Entry** (`/core/api_bridge/src/lib.rs:803-815`)
   ```rust
   #[command]
   async fn apply_and_render_view_state_raw(
       view_state_json: String,
       state: State<'_, BridgeState>
   ) -> Result<tauri::ipc::Response, BridgeError>
   ```

2. **Internal Processing** (`apply_and_render_view_state_internal`)
   - Parses JSON ViewState from frontend
   - Checks layer visibility and GPU resource allocation
   - Ensures GPU resources via `allocate_gpu_resources_for_layer` if needed
   - Calls render loop service

3. **GPU Rendering** (`/core/render_loop/src/lib.rs:render_to_buffer`)
   ```rust
   pub fn render_to_buffer(&mut self) -> Result<Vec<u8>, RenderLoopError> {
       // 1. Get render target from pool
       let (offscreen_texture, offscreen_view) = pool.get_current_target(key)?;
       
       // 2. Create command encoder
       let mut encoder = self.device.create_command_encoder(...);
       
       // 3. Begin render pass
       let mut render_pass = encoder.begin_render_pass(...);
       render_pass.set_pipeline(pipeline);
       render_pass.set_bind_group(0, &global_bind_group, &[]);
       render_pass.set_bind_group(1, &layer_bind_group, &[]);
       render_pass.set_bind_group(2, &texture_bind_group, &[]);
       render_pass.draw(0..6, 0..1); // Fullscreen quad
       
       // 4. Copy texture to buffer with Y-flip
       encoder.copy_texture_to_buffer(...);
       
       // 5. Submit and read back
       self.queue.submit(std::iter::once(encoder.finish()));
   }
   ```

4. **Data Return Format** (Raw RGBA)
   - Header: `[width: u32][height: u32]` (8 bytes)
   - Data: Raw RGBA pixels (width × height × 4 bytes)
   - No PNG encoding overhead

### 1.2 GPU Command Buffer Creation

The render loop uses wgpu for GPU command submission:

1. **Command Encoder**: Created per frame for batching GPU operations
2. **Render Pass**: Contains draw calls and state bindings
3. **Resource Bindings**:
   - Bind Group 0: Frame UBO (view matrix, crosshair)
   - Bind Group 1: Layer uniforms (opacity, colormap, intensity)
   - Bind Group 2: Texture atlas or multi-texture array

### 1.3 Texture/Render Target Management

#### Render Target Pool (`/core/render_loop/src/render_target_pool.rs`)
- **LRU Cache**: Maintains pool of render targets by (width, height, format)
- **Reuse Strategy**: Avoids expensive texture creation during resizes
- **Eviction**: Removes least recently used targets when at capacity

```rust
pub struct RenderTargetPool {
    cache: HashMap<RenderTargetKey, RenderTargetEntry>,
    lru_order: VecDeque<RenderTargetKey>,
    max_entries: usize,
}
```

#### Texture Atlas
- **3D Texture**: Stores volume slices for GPU sampling
- **Layer Management**: Maps layer IDs to texture coordinates
- **Multi-texture Support**: For world-space rendering

### 1.4 Data Flow from Rust to TypeScript

1. **Tauri IPC Response**:
   ```rust
   Ok(tauri::ipc::Response::new(raw_data))
   ```
   - Uses binary IPC to avoid JSON serialization
   - Zero-copy transfer of Uint8Array

2. **Transport Layer** (`/ui2/src/services/transport.ts`)
   - Maps commands to namespaced plugin format
   - Returns raw Uint8Array without conversion

---

## 2. Frontend Rendering Pipeline

### 2.1 SliceView Component Flow

The SliceView component (`/ui2/src/components/views/SliceView.tsx`) handles display:

1. **Canvas Rendering**:
   ```typescript
   // Listen for render complete events
   useEvent('render.complete', (data) => {
     if (data.viewType === viewId && data.imageBitmap) {
       ctx.drawImage(imageBitmap, drawX, drawY, drawWidth, drawHeight);
     }
   });
   ```

2. **Image Placement Tracking**:
   - Maintains aspect ratio with centered display
   - Tracks placement for coordinate transformation
   - Handles crosshair overlay rendering

### 2.2 Event Flow

```
User Interaction → ViewState Update → Coalescing Middleware → Backend Call → Render Event → Canvas Update
```

1. **User Actions**:
   - Mouse click → Update crosshair position
   - Slider drag → Update slice position
   - Panel resize → Update dimensions

2. **State Management**:
   - ViewStateStore manages view configurations
   - Updates trigger coalescing middleware

3. **Event Bus**:
   - `render.start`: Rendering initiated
   - `render.complete`: Image ready with ImageBitmap
   - `render.error`: Rendering failed

### 2.3 ViewState Updates and Coalescing

The coalescing middleware (`/ui2/src/stores/middleware/coalesceUpdatesMiddleware.ts`) batches updates:

```typescript
function flushState(forceDimensionUpdate = false) {
  if (pendingState && backendUpdateCallback && isEnabled) {
    // Skip if dragging (unless forced)
    if (isDragging && !forceDimensionUpdate) {
      rafId = requestAnimationFrame(() => flushState());
      return;
    }
    
    // Send to backend
    backendUpdateCallback(pendingState);
    pendingState = null;
  }
}
```

**Key Features**:
- Uses `requestAnimationFrame` for 60fps updates
- Skips updates during drag operations
- Forces flush on drag end for final state

### 2.4 Component Lifecycle in FlexibleOrthogonalView

```
FlexibleOrthogonalView
├── Allotment (vertical split)
│   ├── FlexibleSlicePanel (axial)
│   │   └── SliceView
│   └── Allotment (horizontal split)
│       ├── FlexibleSlicePanel (sagittal)
│       │   └── SliceView
│       └── FlexibleSlicePanel (coronal)
│           └── SliceView
```

**Dimension Tracking**:
1. **ResizeObserver** in FlexibleSlicePanel detects size changes
2. **Throttled Updates** (30ms) prevent overwhelming backend
3. **Drag Detection** delays renders during active resizing

---

## 3. New Command Integration Flow

### 3.1 Adding Tauri Commands

To add `query_slice_axis_meta` and `batch_render_slices`, follow this 4-step process:

#### Step 1: Define Command in `lib.rs`
```rust
#[command]
async fn batch_render_slices(
    batch_request: BatchRenderRequest,
    state: State<'_, BridgeState>
) -> Result<tauri::ipc::Response, BridgeError> {
    // Implementation
}
```

#### Step 2: Add to `COMMANDS` array in `build.rs`
```rust
const COMMANDS: &[&str] = &[
    // ... existing commands ...
    "batch_render_slices",
    "query_slice_axis_meta",
];
```

#### Step 3: Add to `generate_handler!` macro in `lib.rs`
```rust
generate_handler![
    // ... existing commands ...
    batch_render_slices,
    query_slice_axis_meta,
]
```

#### Step 4: Add to `apiBridgeCommands` in `transport.ts`
```typescript
const apiBridgeCommands = [
    // ... existing commands ...
    'batch_render_slices',
    'query_slice_axis_meta'
];
```

### 3.2 Type Marshalling

#### Rust Types (with `#[derive(Serialize, Deserialize, TS)]`)
```rust
#[derive(Serialize, Deserialize, TS)]
pub struct BatchRenderRequest {
    pub view_states: Vec<ViewState>,
    pub width_per_slice: u32,
    pub height_per_slice: u32,
}
```

#### TypeScript Types (auto-generated)
```typescript
interface BatchRenderRequest {
    viewStates: ViewState[];
    widthPerSlice: number;
    heightPerSlice: number;
}
```

**Naming Convention**:
- Rust: `snake_case`
- TypeScript: `camelCase`
- Tauri automatically converts between them

### 3.3 Error Handling Across Bridge

1. **Rust Side**:
   ```rust
   return Err(BridgeError::Internal {
       code: 7010,
       details: "Batch size exceeds GPU limits".to_string()
   });
   ```

2. **TypeScript Side**:
   ```typescript
   try {
     const result = await invoke('batch_render_slices', request);
   } catch (error) {
     // Handle BridgeError
   }
   ```

---

## 4. Performance Critical Paths

### 4.1 GPU Resource Allocation

**Hot Path**: Layer GPU resource allocation
```rust
// Check cache first
let atlas_idx = {
    let layer_map = state.layer_to_atlas_map.lock().await;
    layer_map.get(&layer.id).copied()
};

if atlas_idx.is_none() {
    // Allocate on-demand (expensive)
    allocate_gpu_resources_for_layer(...).await?;
}
```

**Optimization**: Pre-allocate resources for visible layers

### 4.2 IPC Data Transfer

**Current Flow** (Raw RGBA):
1. GPU → CPU: `copy_texture_to_buffer` with Y-flip
2. CPU → Frontend: Binary IPC (zero-copy Uint8Array)
3. Frontend: Create ImageBitmap from RGBA data

**Bottlenecks**:
- GPU readback is synchronous (`device.poll(Maintain::Wait)`)
- Large data transfer (width × height × 4 bytes per view)

**Batch Optimization**:
- Single GPU submission for multiple views
- Combined buffer transfer
- Parallel ImageBitmap creation

### 4.3 React Re-render Optimization

**Current Optimizations**:
1. **Memoization**: FlexibleSlicePanel uses `React.memo`
2. **Stable Callbacks**: `useCallback` for event handlers
3. **Local State**: Dimensions tracked locally, batch updates to store

**MosaicView Considerations**:
- Use `React.memo` for grid cells
- Virtualize off-screen slices
- Single batch render call for all visible slices

### 4.4 Memory Management

**ImageBitmap Lifecycle**:
```typescript
// Store last image for redraw
lastImageRef.current = data.imageBitmap;

// Cleanup on new image
if (lastImageRef.current) {
    lastImageRef.current.close(); // Release GPU memory
}
```

**Batch Considerations**:
- Limit concurrent ImageBitmaps
- Implement progressive loading for large grids
- Release off-screen bitmaps

---

## Implementation Recommendations

### Backend Batch Rendering

1. **Extend RenderLoopService**:
   ```rust
   pub fn render_batch(&mut self, requests: Vec<ViewState>) -> Result<Vec<Vec<u8>>, Error> {
       let mut results = Vec::new();
       let mut encoder = self.device.create_command_encoder(...);
       
       for request in requests {
           // Update UBO for this slice
           // Render to section of large buffer or array texture
           results.push(rendered_data);
       }
       
       self.queue.submit(std::iter::once(encoder.finish()));
       // Single GPU wait for all renders
   }
   ```

2. **Use Array Textures**: For efficient batch target management

### Frontend MosaicView

1. **Grid Management**:
   ```typescript
   const sliceIndices = calculateSliceIndices(volumeMetadata, orientation, rows, cols);
   const batchRequest = {
       viewStates: sliceIndices.map(idx => generateViewState(idx)),
       widthPerSlice: cellWidth,
       heightPerSlice: cellHeight
   };
   ```

2. **Canvas Grid**:
   - Use CSS Grid for layout
   - Individual canvas per slice for independent updates
   - Shared crosshair synchronization

### Performance Targets

- **Batch Rendering**: < 100ms for 3×3 grid
- **Memory Usage**: < 200MB for typical MRI volume mosaic
- **Interaction**: 60fps during scrolling/navigation

---

## Conclusion

The MosaicView implementation requires coordinated changes across the rendering pipeline. The existing architecture provides solid foundations with render target pooling, efficient IPC, and coalesced updates. The main implementation challenges are:

1. Efficient GPU batch rendering without overwhelming memory
2. Managing multiple ImageBitmaps in the frontend
3. Synchronizing interactions across grid cells
4. Progressive loading for large grids

Following the traced execution flows and integration patterns will ensure a performant implementation that maintains the application's architectural integrity.