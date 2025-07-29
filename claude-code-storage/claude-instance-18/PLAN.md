# MosaicView with Batch Rendering - Implementation Plan

## Overview

This plan details the implementation of a MosaicView component with GPU batch rendering for the Brainflow2 neuroimaging application. The MosaicView will display multiple brain slices in a grid layout with optimized rendering performance.

## 1. Backend Implementation Steps

### 1.1 Add Volume Metadata Query Command

**File**: `/core/api_bridge/src/lib.rs`

**Implementation**:
```rust
#[command]
async fn query_slice_axis_meta(
    volume_id: String,
    axis: String, // "axial", "sagittal", or "coronal"
    state: State<'_, BridgeState>
) -> BridgeResult<SliceAxisMeta> {
    let volume_registry = state.volume_registry.lock().await;
    let volume = volume_registry.get(&volume_id)
        .ok_or_else(|| BridgeError::NotFound { 
            code: 5001, 
            details: format!("Volume {} not found", volume_id) 
        })?;
    
    let shape = volume.shape();
    let (slice_count, slice_spacing, axis_length) = match axis.as_str() {
        "axial" => (shape[2], volume.voxel_size()[2], shape[2] as f32 * volume.voxel_size()[2]),
        "sagittal" => (shape[0], volume.voxel_size()[0], shape[0] as f32 * volume.voxel_size()[0]),
        "coronal" => (shape[1], volume.voxel_size()[1], shape[1] as f32 * volume.voxel_size()[1]),
        _ => return Err(BridgeError::InvalidInput { 
            code: 5002, 
            details: "Invalid axis. Must be axial, sagittal, or coronal".to_string() 
        })
    };
    
    Ok(SliceAxisMeta {
        slice_count: slice_count as u32,
        slice_spacing,
        axis_length_mm: axis_length,
    })
}
```

**Type Definition** - Add to `/core/bridge_types/src/lib.rs`:
```rust
#[derive(Serialize, Deserialize, TS, Clone)]
pub struct SliceAxisMeta {
    pub slice_count: u32,
    pub slice_spacing: f32,
    pub axis_length_mm: f32,
}
```

### 1.2 Implement Batch Render Command

**File**: `/core/api_bridge/src/lib.rs`

**Implementation**:
```rust
#[command]
async fn batch_render_slices(
    batch_request: BatchRenderRequest,
    state: State<'_, BridgeState>
) -> Result<tauri::ipc::Response, BridgeError> {
    // Validate batch size
    if batch_request.view_states.is_empty() {
        return Err(BridgeError::InvalidInput {
            code: 7001,
            details: "Empty batch request".to_string()
        });
    }
    
    if batch_request.view_states.len() > 25 {
        return Err(BridgeError::Internal {
            code: 7010,
            details: "Batch size exceeds GPU limits (max 25)".to_string()
        });
    }
    
    // Ensure GPU resources for all layers
    let layer_ids: HashSet<String> = batch_request.view_states.iter()
        .flat_map(|vs| vs.visible_layers.iter().map(|l| l.id.clone()))
        .collect();
    
    for layer_id in layer_ids {
        if let Some(layer) = state.layer_registry.lock().await.get(&layer_id) {
            allocate_gpu_resources_for_layer(&state, &layer).await?;
        }
    }
    
    // Render batch
    let mut render_loop = state.render_loop.lock().await;
    let results = render_loop.render_batch(
        batch_request.view_states,
        batch_request.width_per_slice,
        batch_request.height_per_slice
    ).map_err(|e| BridgeError::RenderError {
        code: 6000,
        details: format!("Batch render failed: {}", e)
    })?;
    
    // Combine results into single buffer
    let slice_size = (batch_request.width_per_slice * batch_request.height_per_slice * 4) as usize;
    let total_size = 12 + (results.len() * slice_size); // 12 bytes header
    let mut combined_buffer = Vec::with_capacity(total_size);
    
    // Header: width, height, slice_count
    combined_buffer.extend_from_slice(&batch_request.width_per_slice.to_le_bytes());
    combined_buffer.extend_from_slice(&batch_request.height_per_slice.to_le_bytes());
    combined_buffer.extend_from_slice(&(results.len() as u32).to_le_bytes());
    
    // Concatenate all slice data
    for result in results {
        combined_buffer.extend_from_slice(&result);
    }
    
    Ok(tauri::ipc::Response::new(combined_buffer))
}
```

**Type Definition** - Add to `/core/bridge_types/src/lib.rs`:
```rust
#[derive(Serialize, Deserialize, TS, Clone)]
pub struct BatchRenderRequest {
    pub view_states: Vec<ViewState>,
    pub width_per_slice: u32,
    pub height_per_slice: u32,
}
```

### 1.3 Extend RenderLoopService for Batch Rendering

**File**: `/core/render_loop/src/lib.rs`

**Add method**:
```rust
pub fn render_batch(
    &mut self,
    view_states: Vec<ViewState>,
    width: u32,
    height: u32
) -> Result<Vec<Vec<u8>>, RenderLoopError> {
    let mut results = Vec::with_capacity(view_states.len());
    
    // Get or create render targets for batch
    let key = RenderTargetKey {
        width,
        height,
        format: self.surface_format,
    };
    
    // Create command encoder for entire batch
    let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("Batch Render Encoder"),
    });
    
    // Pre-allocate staging buffers for readback
    let buffer_size = (width * height * 4) as usize;
    let mut staging_buffers = Vec::with_capacity(view_states.len());
    
    for (i, view_state) in view_states.iter().enumerate() {
        // Update view state
        self.view_state = view_state.clone();
        self.frame_ubo.update(&self.queue, &self.view_state);
        
        // Get or create render target
        let (texture, view) = self.render_target_pool.get_or_create(
            &self.device,
            key.clone(),
            Some(&format!("Batch Target {}", i))
        )?;
        
        // Render to target
        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some(&format!("Batch Render Pass {}", i)),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            
            // Draw fullscreen quad
            render_pass.set_pipeline(&self.pipeline);
            render_pass.set_bind_group(0, &self.global_bind_group, &[]);
            if let Some(layer_bind_group) = &self.layer_bind_group {
                render_pass.set_bind_group(1, layer_bind_group, &[]);
            }
            if let Some(texture_bind_group) = &self.texture_bind_group {
                render_pass.set_bind_group(2, texture_bind_group, &[]);
            }
            render_pass.draw(0..6, 0..1);
        }
        
        // Create staging buffer for this slice
        let staging_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some(&format!("Batch Staging Buffer {}", i)),
            size: buffer_size as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        
        // Copy texture to buffer with Y-flip
        encoder.copy_texture_to_buffer(
            wgpu::ImageCopyTexture {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::ImageCopyBuffer {
                buffer: &staging_buffer,
                layout: wgpu::ImageDataLayout {
                    offset: 0,
                    bytes_per_row: Some(width * 4),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        );
        
        staging_buffers.push((staging_buffer, buffer_size));
    }
    
    // Submit all renders at once
    self.queue.submit(std::iter::once(encoder.finish()));
    
    // Read back all buffers
    for (buffer, size) in staging_buffers {
        let buffer_slice = buffer.slice(..);
        let (tx, rx) = oneshot::channel();
        
        buffer_slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result);
        });
        
        self.device.poll(wgpu::Maintain::Wait);
        
        rx.blocking_recv()
            .map_err(|_| RenderLoopError::BufferReadError)?
            .map_err(|_| RenderLoopError::BufferReadError)?;
        
        let data = buffer_slice.get_mapped_range();
        
        // Y-flip during copy
        let mut flipped = vec![0u8; size];
        for y in 0..height {
            let src_offset = (y * width * 4) as usize;
            let dst_offset = ((height - 1 - y) * width * 4) as usize;
            flipped[dst_offset..dst_offset + (width * 4) as usize]
                .copy_from_slice(&data[src_offset..src_offset + (width * 4) as usize]);
        }
        
        results.push(flipped);
        drop(data);
        buffer.unmap();
    }
    
    Ok(results)
}
```

### 1.4 Command Registration

**File**: `/core/api_bridge/build.rs`
Add to `COMMANDS` array:
```rust
const COMMANDS: &[&str] = &[
    // ... existing commands ...
    "batch_render_slices",
    "query_slice_axis_meta",
];
```

**File**: `/core/api_bridge/src/lib.rs`
Add to `generate_handler!` macro:
```rust
generate_handler![
    // ... existing commands ...
    batch_render_slices,
    query_slice_axis_meta,
]
```

**File**: `/ui2/src/services/transport.ts`
Add to `apiBridgeCommands`:
```typescript
const apiBridgeCommands = [
    // ... existing commands ...
    'batch_render_slices',
    'query_slice_axis_meta'
];
```

## 2. Frontend Implementation Steps

### 2.1 Create MosaicView Component

**File**: `/ui2/src/components/views/MosaicView.tsx`

```typescript
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useLayerStore } from '../../stores/layerStore';
import { useViewStateStore } from '../../stores/viewStateStore';
import { apiService } from '../../services/apiService';
import { EventBus } from '../../events/EventBus';
import { ViewState } from '@brainflow/api';
import './MosaicView.css';

interface MosaicViewProps {
  workspaceId: string;
  rows: number;
  columns: number;
  orientation: 'axial' | 'sagittal' | 'coronal';
}

interface SliceGridCell {
  id: string;
  row: number;
  col: number;
  sliceIndex: number;
  canvasRef: React.RefObject<HTMLCanvasElement>;
}

export const MosaicView: React.FC<MosaicViewProps> = React.memo(({
  workspaceId,
  rows,
  columns,
  orientation
}) => {
  const [sliceMetadata, setSliceMetadata] = useState<{
    sliceCount: number;
    sliceSpacing: number;
    axisLength: number;
  } | null>(null);
  
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const cellsRef = useRef<Map<string, SliceGridCell>>(new Map());
  const imageBitmapsRef = useRef<Map<string, ImageBitmap>>(new Map());
  
  const visibleLayers = useLayerStore(state => 
    state.layers.filter(l => l.visible && l.workspaceId === workspaceId)
  );
  
  const crosshairPosition = useViewStateStore(state => 
    state.viewStates[workspaceId]?.crosshairPosition || [0, 0, 0]
  );
  
  // Calculate grid dimensions
  const cellWidth = useMemo(() => Math.floor(dimensions.width / columns), [dimensions.width, columns]);
  const cellHeight = useMemo(() => Math.floor(dimensions.height / rows), [dimensions.height, rows]);
  
  // Query slice metadata when layers change
  useEffect(() => {
    const queryMetadata = async () => {
      if (visibleLayers.length === 0) return;
      
      const primaryLayer = visibleLayers[0];
      try {
        const meta = await apiService.querySliceAxisMeta(
          primaryLayer.volumeId,
          orientation
        );
        setSliceMetadata(meta);
      } catch (err) {
        console.error('Failed to query slice metadata:', err);
        setError('Failed to load volume metadata');
      }
    };
    
    queryMetadata();
  }, [visibleLayers, orientation]);
  
  // Initialize grid cells
  const gridCells = useMemo(() => {
    if (!sliceMetadata) return [];
    
    const cells: SliceGridCell[] = [];
    const totalCells = rows * columns;
    const sliceStep = Math.max(1, Math.floor(sliceMetadata.sliceCount / totalCells));
    
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const index = row * columns + col;
        const sliceIndex = Math.min(
          index * sliceStep,
          sliceMetadata.sliceCount - 1
        );
        
        cells.push({
          id: `mosaic-${orientation}-${row}-${col}`,
          row,
          col,
          sliceIndex,
          canvasRef: React.createRef()
        });
      }
    }
    
    // Store refs for easy access
    cellsRef.current.clear();
    cells.forEach(cell => cellsRef.current.set(cell.id, cell));
    
    return cells;
  }, [rows, columns, orientation, sliceMetadata]);
  
  // Generate view states for batch rendering
  const generateBatchViewStates = useCallback((): ViewState[] => {
    if (!sliceMetadata || gridCells.length === 0) return [];
    
    return gridCells.map(cell => {
      // Calculate position along axis for this slice
      const position = (cell.sliceIndex / sliceMetadata.sliceCount) * sliceMetadata.axisLength;
      
      // Create view state based on orientation
      const viewState: ViewState = {
        id: cell.id,
        viewType: orientation,
        dimensions: { width: cellWidth, height: cellHeight },
        crosshairPosition: [...crosshairPosition] as [number, number, number],
        visibleLayers: visibleLayers.map(layer => ({
          id: layer.id,
          opacity: layer.opacity,
          colormap: layer.colormap,
          intensityRange: layer.intensityRange
        }))
      };
      
      // Update position along appropriate axis
      switch (orientation) {
        case 'axial':
          viewState.crosshairPosition[2] = position;
          break;
        case 'sagittal':
          viewState.crosshairPosition[0] = position;
          break;
        case 'coronal':
          viewState.crosshairPosition[1] = position;
          break;
      }
      
      return viewState;
    });
  }, [gridCells, sliceMetadata, orientation, cellWidth, cellHeight, crosshairPosition, visibleLayers]);
  
  // Batch render all slices
  const renderMosaic = useCallback(async () => {
    if (!sliceMetadata || gridCells.length === 0 || cellWidth === 0 || cellHeight === 0) {
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const viewStates = generateBatchViewStates();
      
      // Call batch render
      const startTime = performance.now();
      const result = await apiService.batchRenderSlices({
        viewStates,
        widthPerSlice: cellWidth,
        heightPerSlice: cellHeight
      });
      
      const renderTime = performance.now() - startTime;
      console.log(`Batch rendered ${viewStates.length} slices in ${renderTime.toFixed(2)}ms`);
      
      // Parse result header
      const dataView = new DataView(result.buffer);
      const width = dataView.getUint32(0, true);
      const height = dataView.getUint32(4, true);
      const sliceCount = dataView.getUint32(8, true);
      
      if (sliceCount !== gridCells.length) {
        throw new Error('Slice count mismatch');
      }
      
      // Clean up old bitmaps
      imageBitmapsRef.current.forEach(bitmap => bitmap.close());
      imageBitmapsRef.current.clear();
      
      // Create ImageBitmaps for each slice
      const sliceSize = width * height * 4;
      const promises = gridCells.map(async (cell, index) => {
        const offset = 12 + (index * sliceSize);
        const sliceData = new Uint8ClampedArray(
          result.buffer,
          offset,
          sliceSize
        );
        
        const imageData = new ImageData(sliceData, width, height);
        const bitmap = await createImageBitmap(imageData);
        
        imageBitmapsRef.current.set(cell.id, bitmap);
        
        // Draw to canvas
        const canvas = cell.canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          }
        }
      });
      
      await Promise.all(promises);
      
      // Emit render complete event
      EventBus.emit('mosaic.render.complete', {
        workspaceId,
        renderTime,
        sliceCount: gridCells.length
      });
      
    } catch (err) {
      console.error('Mosaic render failed:', err);
      setError('Failed to render mosaic');
      
      EventBus.emit('mosaic.render.error', {
        workspaceId,
        error: err
      });
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, gridCells, cellWidth, cellHeight, generateBatchViewStates]);
  
  // Handle resize
  useEffect(() => {
    if (!containerRef.current) return;
    
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({ width, height });
      }
    });
    
    resizeObserver.observe(containerRef.current);
    
    return () => {
      resizeObserver.disconnect();
    };
  }, []);
  
  // Re-render on dimension or layer changes
  useEffect(() => {
    if (dimensions.width > 0 && dimensions.height > 0) {
      renderMosaic();
    }
  }, [dimensions, renderMosaic]);
  
  // Handle cell interactions
  const handleCellClick = useCallback((cell: SliceGridCell, event: React.MouseEvent) => {
    const canvas = cell.canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Calculate normalized coordinates
    const normX = x / canvas.width;
    const normY = y / canvas.height;
    
    // Emit click event with slice information
    EventBus.emit('mosaic.cell.click', {
      workspaceId,
      cellId: cell.id,
      sliceIndex: cell.sliceIndex,
      orientation,
      normalizedCoords: { x: normX, y: normY },
      canvasCoords: { x, y }
    });
  }, [workspaceId, orientation]);
  
  // Render loading state
  if (isLoading && gridCells.length === 0) {
    return (
      <div className="mosaic-view mosaic-loading">
        <div className="loading-spinner">Loading mosaic view...</div>
      </div>
    );
  }
  
  // Render error state
  if (error) {
    return (
      <div className="mosaic-view mosaic-error">
        <div className="error-message">{error}</div>
      </div>
    );
  }
  
  // Render grid
  return (
    <div ref={containerRef} className="mosaic-view">
      <div 
        className="mosaic-grid"
        style={{
          gridTemplateRows: `repeat(${rows}, 1fr)`,
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
        }}
      >
        {gridCells.map(cell => (
          <div
            key={cell.id}
            className="mosaic-cell"
            data-slice-index={cell.sliceIndex}
          >
            <canvas
              ref={cell.canvasRef}
              width={cellWidth}
              height={cellHeight}
              className="mosaic-canvas"
              onClick={(e) => handleCellClick(cell, e)}
            />
            <div className="mosaic-cell-info">
              Slice {cell.sliceIndex + 1}
            </div>
          </div>
        ))}
      </div>
      
      {isLoading && (
        <div className="mosaic-overlay">
          <div className="loading-bar">Rendering slices...</div>
        </div>
      )}
    </div>
  );
});

MosaicView.displayName = 'MosaicView';
```

### 2.2 Create MosaicView Styles

**File**: `/ui2/src/components/views/MosaicView.css`

```css
.mosaic-view {
  width: 100%;
  height: 100%;
  position: relative;
  background-color: #1a1a1a;
  overflow: hidden;
}

.mosaic-grid {
  width: 100%;
  height: 100%;
  display: grid;
  gap: 2px;
  padding: 2px;
}

.mosaic-cell {
  position: relative;
  background-color: #000;
  overflow: hidden;
  border: 1px solid #333;
  transition: border-color 0.2s;
}

.mosaic-cell:hover {
  border-color: #666;
}

.mosaic-canvas {
  width: 100%;
  height: 100%;
  cursor: crosshair;
  image-rendering: pixelated;
  image-rendering: -moz-crisp-edges;
  image-rendering: crisp-edges;
}

.mosaic-cell-info {
  position: absolute;
  bottom: 2px;
  right: 2px;
  font-size: 10px;
  color: #888;
  background-color: rgba(0, 0, 0, 0.7);
  padding: 2px 4px;
  border-radius: 2px;
  pointer-events: none;
  user-select: none;
}

.mosaic-loading,
.mosaic-error {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ccc;
}

.loading-spinner {
  font-size: 14px;
}

.error-message {
  color: #ff6666;
  font-size: 14px;
}

.mosaic-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.loading-bar {
  background-color: rgba(0, 0, 0, 0.8);
  color: #fff;
  padding: 8px 16px;
  border-radius: 4px;
  font-size: 14px;
}
```

### 2.3 Extend API Service

**File**: `/ui2/src/services/apiService.ts`

Add new methods:
```typescript
async querySliceAxisMeta(volumeId: string, axis: 'axial' | 'sagittal' | 'coronal'): Promise<{
  sliceCount: number;
  sliceSpacing: number;
  axisLength: number;
}> {
  const result = await this.transport.invoke<{
    slice_count: number;
    slice_spacing: number;
    axis_length_mm: number;
  }>('query_slice_axis_meta', {
    volumeId,
    axis
  });
  
  return {
    sliceCount: result.slice_count,
    sliceSpacing: result.slice_spacing,
    axisLength: result.axis_length_mm
  };
}

async batchRenderSlices(request: {
  viewStates: ViewState[];
  widthPerSlice: number;
  heightPerSlice: number;
}): Promise<Uint8Array> {
  if (!this.useRawRGBA) {
    throw new Error('Batch rendering requires raw RGBA mode');
  }
  
  const result = await this.transport.invoke<Uint8Array>('batch_render_slices', {
    viewStates: request.viewStates,
    widthPerSlice: request.widthPerSlice,
    heightPerSlice: request.heightPerSlice
  });
  
  return result;
}
```

### 2.4 Update ViewRegistry

**File**: `/ui2/src/services/ViewRegistry.ts`

Ensure MosaicView is imported and factory creates proper layout:
```typescript
import { MosaicView } from '../components/views/MosaicView';

export class MosaicViewFactory implements ViewFactory {
  create(config: ViewConfig): GoldenLayout.ComponentConfig {
    return {
      type: 'react-component',
      component: 'MosaicView',
      props: {
        workspaceId: config.workspaceId,
        rows: config.rows || 3,
        columns: config.columns || 3,
        orientation: config.sliceOrientation || 'axial'
      },
      title: `Mosaic (${config.sliceOrientation || 'axial'})`,
      id: config.id || `mosaic-${Date.now()}`
    };
  }
  
  getDefaultConfig(): Partial<WorkspaceConfig> {
    return {
      rows: 3,
      columns: 3,
      sliceOrientation: 'axial'
    };
  }
}

// Register component with GoldenLayout
GoldenLayoutWrapper.registerComponent('MosaicView', MosaicView);
```

## 3. Integration Steps

### 3.1 TypeScript Type Generation

Run after adding Rust types:
```bash
cargo xtask ts-bindings
```

This will generate TypeScript interfaces in `/ui2/src/types/rust/` for:
- `SliceAxisMeta`
- `BatchRenderRequest`

### 3.2 Update Transport Layer

Already covered in section 1.4 - ensure `apiBridgeCommands` includes new commands.

### 3.3 Error Handling Strategy

1. **Backend Errors**:
   - GPU resource allocation failures
   - Batch size exceeded
   - Invalid view states
   
2. **Frontend Errors**:
   - Network timeouts for large batches
   - ImageBitmap creation failures
   - Canvas context loss

3. **Recovery Strategy**:
   - Fallback to individual slice rendering
   - Progressive loading for large grids
   - Automatic retry with smaller batch size

## 4. Performance Optimizations

### 4.1 GPU Resource Pooling

**Optimization**: Pre-allocate render targets for common grid sizes

In `RenderTargetPool`:
```rust
// Pre-warm cache with common mosaic sizes
pub fn prewarm_for_mosaic(&mut self, device: &wgpu::Device, cell_size: (u32, u32), grid_size: (u32, u32)) {
    let count = grid_size.0 * grid_size.1;
    for i in 0..count.min(25) {
        let key = RenderTargetKey {
            width: cell_size.0,
            height: cell_size.1,
            format: self.default_format,
        };
        self.get_or_create(device, key, Some(&format!("Mosaic Prewarm {}", i)))?;
    }
}
```

### 4.2 Memory Management

**Frontend Optimizations**:
1. **Bitmap Lifecycle**:
   ```typescript
   // Clean up off-screen bitmaps
   useEffect(() => {
     return () => {
       imageBitmapsRef.current.forEach(bitmap => bitmap.close());
     };
   }, []);
   ```

2. **Virtual Scrolling** (for large grids):
   ```typescript
   // Only render visible cells + buffer
   const visibleRange = calculateVisibleRange(scrollPosition, containerSize, cellSize);
   const cellsToRender = gridCells.filter(cell => 
     isInRange(cell, visibleRange, BUFFER_CELLS)
   );
   ```

### 4.3 React Optimization

1. **Memoization**:
   - Use `React.memo` for MosaicView
   - `useMemo` for expensive calculations
   - `useCallback` for event handlers

2. **Batch State Updates**:
   ```typescript
   // Use unstable_batchedUpdates for multiple state changes
   import { unstable_batchedUpdates } from 'react-dom';
   
   unstable_batchedUpdates(() => {
     setSliceMetadata(meta);
     setIsLoading(false);
     setError(null);
   });
   ```

### 4.4 Caching Strategies

1. **View State Caching**:
   ```typescript
   const viewStateCache = useRef(new Map<string, ViewState>());
   
   // Cache generated view states
   const getCachedViewState = (cellId: string) => {
     if (!viewStateCache.current.has(cellId)) {
       viewStateCache.current.set(cellId, generateViewState(cellId));
     }
     return viewStateCache.current.get(cellId);
   };
   ```

2. **Render Result Caching**:
   - Cache render results for unchanged view states
   - Invalidate on layer/crosshair changes

## 5. Implementation Order

### Phase 1: Backend Foundation (2-3 days)
1. **Day 1**:
   - [ ] Add `SliceAxisMeta` and `BatchRenderRequest` types
   - [ ] Implement `query_slice_axis_meta` command
   - [ ] Register command in all 4 locations
   - [ ] Run type generation

2. **Day 2**:
   - [ ] Implement `batch_render_slices` command
   - [ ] Add initial `render_batch` method to RenderLoopService
   - [ ] Test with hardcoded batch of 2-3 slices

3. **Day 3**:
   - [ ] Optimize `render_batch` with proper buffer management
   - [ ] Add render target pre-warming
   - [ ] Handle edge cases and error conditions

### Phase 2: Frontend Components (2-3 days)
4. **Day 4**:
   - [ ] Create basic MosaicView component structure
   - [ ] Implement grid layout and canvas management
   - [ ] Add resize handling

5. **Day 5**:
   - [ ] Integrate with API service methods
   - [ ] Implement batch rendering flow
   - [ ] Add ImageBitmap management

6. **Day 6**:
   - [ ] Add interaction handlers
   - [ ] Implement error and loading states
   - [ ] Style with CSS

### Phase 3: Integration & Testing (2 days)
7. **Day 7**:
   - [ ] End-to-end testing with real volumes
   - [ ] Performance profiling
   - [ ] Fix integration issues

8. **Day 8**:
   - [ ] Add progressive loading for large grids
   - [ ] Implement virtual scrolling (if needed)
   - [ ] Final optimizations

### Phase 4: Polish & Documentation (1 day)
9. **Day 9**:
   - [ ] Add unit tests for critical paths
   - [ ] Document API additions
   - [ ] Create example usage

## Testing Milestones

### Unit Tests
1. **Backend**:
   - Test slice index calculations
   - Verify batch buffer layout
   - Test error conditions

2. **Frontend**:
   - Test view state generation
   - Verify grid calculations
   - Test resize behavior

### Integration Tests
1. **E2E Tests**:
   ```typescript
   test('renders 3x3 mosaic grid', async ({ page }) => {
     await page.goto('/');
     await loadTestVolume(page);
     await openMosaicView(page, { rows: 3, columns: 3 });
     
     const cells = await page.locator('.mosaic-cell').count();
     expect(cells).toBe(9);
     
     // Verify all canvases rendered
     const canvases = await page.locator('.mosaic-canvas').count();
     expect(canvases).toBe(9);
   });
   ```

### Performance Tests
1. **Benchmarks**:
   - Time to render 3×3 grid: < 100ms
   - Time to render 5×5 grid: < 250ms
   - Memory usage for 5×5 grid: < 200MB

2. **Load Tests**:
   - Maximum grid size before performance degradation
   - GPU memory limits
   - Concurrent mosaic views

## Risk Mitigation

### Technical Risks
1. **GPU Memory Exhaustion**:
   - Limit maximum batch size to 25 slices
   - Implement progressive loading
   - Monitor GPU memory usage

2. **IPC Data Transfer Size**:
   - Current limit ~50MB should handle 5×5 grid at 512×512
   - Consider compression for larger grids

3. **React Performance**:
   - Use virtualization for grids > 5×5
   - Implement intersection observer for visibility

### Fallback Strategies
1. **Batch Failure**: Fall back to individual rendering
2. **GPU Limit**: Reduce batch size and retry
3. **Memory Pressure**: Implement LRU cache for ImageBitmaps

## Conclusion

This implementation plan provides a comprehensive approach to adding MosaicView with batch rendering to Brainflow2. The phased approach allows for incremental development and testing, while the performance optimizations ensure the feature scales well. The integration follows established patterns in the codebase, maintaining architectural consistency.

Key success factors:
- Efficient GPU batch rendering
- Proper memory management
- Responsive UI with smooth interactions
- Robust error handling

Following this plan should result in a production-ready MosaicView component that enhances the neuroimaging workflow with efficient multi-slice visualization.