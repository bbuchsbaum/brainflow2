# Plan to Fix MosaicView Black Squares Issue

## Executive Summary

The MosaicView component displays black squares because it bypasses the centralized rendering architecture that makes SliceView work. This plan outlines a comprehensive approach to fix the issue by aligning MosaicView with the declarative API pattern and centralized rendering system.

## Root Cause

Based on the investigation, the issue stems from:
1. MosaicView uses `batch_render_slices` which calls `request_frame` (declarative API)
2. SliceView uses `apply_and_render_view_state_internal` (imperative API)
3. Volumes are registered in different locations (`layer_to_atlas_map` vs `volumes` registry)
4. MosaicView bypasses the RenderCoordinator and event-driven architecture

## Solution Strategy

The plan follows a two-phase approach:
1. **Phase 1 (Immediate Fix)**: Modify backend to use consistent rendering path
2. **Phase 2 (Architectural Fix)**: Integrate MosaicView with declarative API pattern

## Phase 1: Immediate Backend Fix

### Objective
Make `batch_render_slices` use the same rendering path as single slice rendering to ensure volumes are found correctly.

### Files to Modify

#### 1. `/core/api_bridge/src/lib.rs` (lines 3340-3519)
**Current Implementation:**
```rust
let frame_result = service.request_frame(
    render_loop::view_state::ViewId::new(format!("batch_slice_{}", idx)),
    view_state.clone()
).await
```

**New Implementation:**
```rust
// Transform render_loop::ViewState back to FrontendViewState format
let frontend_view_state = transform_to_frontend_view_state(&view_state, &layers);
let json = serde_json::to_string(&frontend_view_state)?;

// Use the same rendering path as single slices
let rgba_data = apply_and_render_view_state_internal(
    json,
    width,
    height,
    state.clone(),
    true // return_raw_rgba
).await?;

// Convert to FrameResult format expected by batch processing
let frame_result = FrameResult {
    data: rgba_data,
    width,
    height,
    format: FrameFormat::Rgba8,
};
```

#### 2. Add helper function in `/core/api_bridge/src/lib.rs`
```rust
fn transform_to_frontend_view_state(
    view_state: &render_loop::view_state::ViewState,
    layers: &[render_loop::view_state::LayerConfig]
) -> FrontendViewState {
    // Map render_loop format back to frontend format
    // This ensures compatibility with apply_and_render_view_state_internal
    FrontendViewState {
        camera: ViewCamera {
            orientation: view_state.camera.plane.to_string(),
            crosshair: view_state.camera.crosshair_position,
            zoom: 1.0,
        },
        layers: layers.iter().map(|layer| {
            FrontendViewLayer {
                id: layer.volume_id.clone(),
                volumeId: layer.volume_id.clone(),
                render: RenderSettings {
                    visible: layer.visible,
                    opacity: layer.opacity,
                    intensity: [
                        layer.intensity_window.0,
                        layer.intensity_window.1
                    ],
                    colormap: colormap_id_to_name(layer.colormap_id),
                    threshold: layer.threshold,
                }
            }
        }).collect(),
        dimensions: ViewDimensions {
            width: view_state.viewport.width as u32,
            height: view_state.viewport.height as u32,
        },
    }
}
```

### Testing Phase 1
1. Rebuild the application with changes
2. Test MosaicView with a loaded volume
3. Verify that slices now render with proper data instead of black squares
4. Check console logs for any errors

## Phase 2: Architectural Integration

### Objective
Integrate MosaicView with the centralized rendering system to follow the declarative API pattern.

### Files to Modify

#### 1. `/ui2/src/components/views/MosaicView.tsx`
Remove direct API calls and integrate with event system:

```typescript
// Remove the direct render function
// DELETE lines 437-515 (renderSlices function)

// Add event listener for batch renders
useEvent('batchRender.complete', handleBatchRenderComplete);

// Add render request through RenderCoordinator
const requestBatchRender = useCallback(() => {
  const viewStates = buildViewStates();
  
  // Use a service to request batch render
  mosaicService.requestBatchRender({
    viewStates,
    cellWidth: cellDimensions.width,
    cellHeight: cellDimensions.height,
    requestId: generateRequestId(),
  });
}, [buildViewStates, cellDimensions]);

// Handle render completion
const handleBatchRenderComplete = useCallback((data: BatchRenderResult) => {
  if (data.requestId === currentRequestId) {
    updateMosaicCells(data.images);
  }
}, [currentRequestId]);
```

#### 2. Create `/ui2/src/services/MosaicService.ts`
New service to handle MosaicView rendering through the centralized system:

```typescript
export class MosaicService {
  private renderCoordinator: RenderCoordinator;
  private eventBus: EventBus;

  constructor(renderCoordinator: RenderCoordinator, eventBus: EventBus) {
    this.renderCoordinator = renderCoordinator;
    this.eventBus = eventBus;
  }

  async requestBatchRender(request: BatchRenderRequest): Promise<void> {
    // Queue batch render through RenderCoordinator
    const result = await this.renderCoordinator.requestBatchRender({
      viewStates: request.viewStates,
      width: request.cellWidth,
      height: request.cellHeight,
      reason: 'mosaic_update',
      priority: 'normal',
    });

    // Emit completion event
    this.eventBus.emit('batchRender.complete', {
      requestId: request.requestId,
      images: result.images,
    });
  }
}
```

#### 3. Update `/ui2/src/services/RenderCoordinator.ts`
Add batch rendering support:

```typescript
export class RenderCoordinator {
  // Add new method
  async requestBatchRender(request: BatchRenderRequest): Promise<BatchRenderResult> {
    // Apply debouncing and queuing logic
    const jobId = this.queueBatchJob(request);
    
    // Process through the centralized pipeline
    const result = await this.processBatchRender(request);
    
    return result;
  }

  private async processBatchRender(request: BatchRenderRequest): Promise<BatchRenderResult> {
    // Option 1: Use fixed batch_render_slices after Phase 1 fix
    const buffer = await apiService.batchRenderSlices(
      request.viewStates,
      request.width,
      request.height
    );
    
    // Option 2: Use multiple single renders (more aligned with current architecture)
    const images = await Promise.all(
      request.viewStates.map(viewState => 
        this.requestRender({
          viewState,
          viewType: 'mosaic_cell',
          width: request.width,
          height: request.height,
          reason: request.reason,
          priority: request.priority,
        })
      )
    );
    
    return { images };
  }
}
```

#### 4. Update `/ui2/src/hooks/useServicesInit.ts`
Register MosaicService:

```typescript
// Add to service initialization
const mosaicService = new MosaicService(renderCoordinator, eventBus);
serviceRegistry.register('mosaicService', mosaicService);

// Add to ViewStateStore subscription
ViewStateStore.subscribe(
  state => state.viewState,
  viewState => {
    // Existing SliceView rendering...
    
    // Check if MosaicView needs update
    if (shouldUpdateMosaic(viewState)) {
      mosaicService.requestBatchRender({
        viewStates: buildMosaicViewStates(viewState),
        cellWidth: getMosaicCellWidth(),
        cellHeight: getMosaicCellHeight(),
        requestId: generateRequestId(),
      });
    }
  }
);
```

#### 5. Update `/ui2/src/services/apiService.ts`
If keeping batch API, ensure it uses consistent ViewState format:

```typescript
// Update batchRenderSlices to use FrontendViewState format directly
async batchRenderSlices(
  viewStates: FrontendViewState[],
  widthPerSlice: number,
  heightPerSlice: number
): Promise<ArrayBuffer> {
  // Send FrontendViewState format, not transformed
  const response = await invoke<ArrayBuffer>('plugin:api-bridge|batch_render_slices', {
    viewStates: JSON.stringify(viewStates), // Keep original format
    width: widthPerSlice,
    height: heightPerSlice,
  });
  
  return response;
}
```

## Alternative Approach: Single Render Loop

If Phase 1 proves complex, consider this simpler alternative:

### Modify MosaicView to use multiple single renders:

```typescript
// In MosaicView.tsx
const renderSlices = useCallback(async () => {
  const viewStates = buildViewStates();
  
  // Use Promise.all to render all slices in parallel
  const renderedImages = await Promise.all(
    viewStates.map(async (viewState, index) => {
      // Use the same API as SliceView
      const imageBitmap = await apiService.applyAndRenderViewState(
        viewState,
        `mosaic_${viewState.sliceAxis}_${index}`,
        cellDimensions.width,
        cellDimensions.height
      );
      return imageBitmap;
    })
  );
  
  // Update mosaic cells with rendered images
  updateMosaicCells(renderedImages);
}, [buildViewStates, cellDimensions]);
```

This approach:
- Uses the proven single-slice rendering path
- Requires minimal backend changes
- Maintains consistency with SliceView
- May have slightly higher overhead but ensures correctness

## Implementation Order

1. **Day 1**: Implement Phase 1 backend fix
   - Modify `batch_render_slices` to use `apply_and_render_view_state_internal`
   - Test that MosaicView renders correctly
   
2. **Day 2**: Implement Alternative Approach if needed
   - If Phase 1 is complex, switch to multiple single renders
   - This provides immediate working solution
   
3. **Day 3-4**: Implement Phase 2 architectural integration
   - Create MosaicService
   - Update RenderCoordinator
   - Integrate with event system
   
4. **Day 5**: Testing and refinement
   - Comprehensive testing of both views
   - Performance optimization
   - Documentation updates

## Success Criteria

1. MosaicView displays actual image data instead of black squares
2. Both SliceView and MosaicView use consistent rendering paths
3. MosaicView participates in the centralized rendering architecture
4. No regression in SliceView functionality
5. Performance remains acceptable (< 100ms per mosaic update)

## Risk Mitigation

1. **Backend Compatibility**: Test thoroughly that changes don't break existing functionality
2. **Performance**: Monitor render times, especially for large mosaics
3. **State Synchronization**: Ensure MosaicView updates when layers change
4. **Memory Usage**: Watch for memory leaks with multiple ImageBitmaps

## Long-term Benefits

1. **Consistency**: Single rendering pipeline for all views
2. **Maintainability**: Easier to debug and enhance
3. **Performance**: Centralized optimization benefits all views
4. **Features**: New features automatically available to all views

## Conclusion

This plan addresses both the immediate issue (Phase 1) and the architectural debt (Phase 2). The immediate fix ensures MosaicView works correctly, while the architectural integration ensures long-term maintainability and consistency with the declarative API philosophy.