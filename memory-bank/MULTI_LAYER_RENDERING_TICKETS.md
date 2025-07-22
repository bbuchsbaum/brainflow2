# Multi-Layer Rendering Architecture Fix - Implementation Tickets

## Overview
This document contains granular tickets for fixing the multi-layer rendering architecture in Brainflow. The core issue is that each view (Axial, Coronal, Sagittal) currently creates its own render layer, leading to backend layer limit errors. The solution implements a "1 volume = 1 layer" architecture with shared layers across views.

## Ticket Categories
- **MLR-BACKEND**: Backend layer management changes
- **MLR-FRONTEND**: Frontend GpuRenderManager integration
- **MLR-COMPONENT**: Component refactoring
- **MLR-TEST**: Testing and validation

---

## Phase 1: Backend Layer Management

### MLR-BACKEND-001: Add Layer Slot Management to Backend
**Priority**: Critical  
**Dependencies**: None  
**Estimated**: 2 hours

**Description**: Implement a layer slot pattern in the backend to manage the fixed 8-layer limit without needing individual layer removal.

**Acceptance Criteria**:
- [ ] Add `is_active: bool` field to `LayerUniforms` struct
- [ ] Initialize all layers with `is_active = false`
- [ ] Update shader to skip rendering when `is_active = false`
- [ ] Modify `add_render_layer` to find first inactive slot
- [ ] Add slot reuse logic when adding new layers

**Implementation Notes**:
- Files: `core/render_loop/src/layer_uniforms.rs`, `core/render_loop/src/lib.rs`
- Update WGSL shader to check `is_active` flag
- No API changes needed - internal implementation only

### MLR-BACKEND-002: Update Render Loop for View-First Architecture
**Priority**: Critical  
**Dependencies**: MLR-BACKEND-001  
**Estimated**: 3 hours

**Description**: Refactor the render loop to iterate views first, then render all active layers for each view.

**Acceptance Criteria**:
- [ ] Change render loop from "for each layer" to "for each view, for each layer"
- [ ] Ensure frame parameters are set per view, not per layer
- [ ] Test that multiple views can render the same layer index
- [ ] Verify no performance regression

**Implementation Notes**:
- Main changes in `render_frame` function
- Each view sets its frame via `update_frame_for_synchronized_view`
- Layers remain constant across views

### MLR-BACKEND-003: Increase Layer Limit (Optional)
**Priority**: Low  
**Dependencies**: MLR-BACKEND-001  
**Estimated**: 1 hour

**Description**: Increase the maximum layer count from 8 to 16 to support more simultaneous volumes.

**Acceptance Criteria**:
- [ ] Update `MAX_LAYERS` constant to 16
- [ ] Update `LayerStateManager::new(16)`
- [ ] Verify GPU memory usage is acceptable
- [ ] Test with 16 simultaneous volumes

**Implementation Notes**:
- Simple constant changes
- May require shader recompilation
- Monitor memory usage

---

## Phase 2: Frontend GpuRenderManager Integration

### MLR-FRONTEND-001: Create Shared GpuRenderManager Service
**Priority**: Critical  
**Dependencies**: None  
**Estimated**: 2 hours

**Description**: Create a service that manages a shared GpuRenderManager instance for all views.

**Acceptance Criteria**:
- [ ] Create `GpuRenderManagerService` in services directory
- [ ] Implement singleton pattern for GpuRenderManager instance
- [ ] Add to DI container at appropriate level
- [ ] Add initialization in app startup

**Implementation Notes**:
```typescript
export class GpuRenderManagerService {
  private renderManager: GpuRenderManager;
  private initialized = false;
  
  async initialize() {
    this.renderManager = new GpuRenderManager();
    await this.renderManager.initialize();
  }
  
  getRenderManager(): GpuRenderManager {
    return this.renderManager;
  }
}
```

### MLR-FRONTEND-002: Move Layer Creation to LayerService
**Priority**: Critical  
**Dependencies**: MLR-FRONTEND-001  
**Estimated**: 3 hours

**Description**: Refactor LayerService to create layers via GpuRenderManager instead of letting views create them.

**Acceptance Criteria**:
- [ ] Remove `add_render_layer` calls from view components
- [ ] Add layer creation logic to LayerService using GpuRenderManager
- [ ] Store layer indices in layer metadata
- [ ] Update layer lifecycle management

**Implementation Notes**:
- LayerService gets GpuRenderManagerService from DI
- When volume loaded: `renderManager.setupLayers([layer])`
- Views receive layer configuration, not create layers

### MLR-FRONTEND-003: Implement Layer State Synchronization
**Priority**: High  
**Dependencies**: MLR-FRONTEND-002  
**Estimated**: 2 hours

**Description**: Ensure layer property changes are synchronized through GpuRenderManager.

**Acceptance Criteria**:
- [ ] Window/level changes update via `renderManager.updateLayer()`
- [ ] Colormap changes update via `renderManager.updateLayer()`
- [ ] Threshold changes update via `renderManager.updateLayer()`
- [ ] Remove redundant GPU calls from components

**Implementation Notes**:
- StoreServiceBridge listens for layer property events
- Calls GpuRenderManagerService to update layers
- Single source of truth for layer state

---

## Phase 3: Component Refactoring

### MLR-COMPONENT-001: Update OrthogonalViewGPU to Use Shared Layers
**Priority**: Critical  
**Dependencies**: MLR-FRONTEND-002  
**Estimated**: 4 hours

**Description**: Refactor OrthogonalViewGPU to use shared layers instead of creating its own.

**Acceptance Criteria**:
- [ ] Remove all `add_render_layer` calls
- [ ] Get GpuRenderManager from service
- [ ] Use `renderManager.render()` with view-specific frame
- [ ] Remove layer index tracking
- [ ] Clean up layer creation attempts logic

**Implementation Notes**:
- Major simplification of component
- Focus on view-specific state only
- No layer management in component

### MLR-COMPONENT-002: Create Shared Layer Renderer Component
**Priority**: Medium  
**Dependencies**: MLR-COMPONENT-001  
**Estimated**: 3 hours

**Description**: Create a base component that handles shared layer rendering logic.

**Acceptance Criteria**:
- [ ] Extract common rendering logic from OrthogonalViewGPU
- [ ] Create reusable base for slice rendering
- [ ] Handle frame management and interactions
- [ ] Support both direct canvas and offscreen rendering

**Implementation Notes**:
- Could be a Svelte component or composable
- Reduces duplication across view components

### MLR-COMPONENT-003: Rename Components for Clarity
**Priority**: Low  
**Dependencies**: MLR-COMPONENT-002  
**Estimated**: 2 hours

**Description**: Rename components to match their actual responsibilities.

**Acceptance Criteria**:
- [ ] Rename OrthogonalViewGPU → SliceViewGPU
- [ ] Create new OrthogonalViewGPU with 3 views
- [ ] Update all imports
- [ ] Update tests

**Implementation Notes**:
- Use IDE refactoring tools
- Update component documentation
- Check for string references

### MLR-COMPONENT-004: Consolidate Duplicate View Containers
**Priority**: Low  
**Dependencies**: MLR-COMPONENT-003  
**Estimated**: 2 hours

**Description**: Remove duplicate code between VolumeView and OrthogonalViewContainer.

**Acceptance Criteria**:
- [ ] Identify shared functionality
- [ ] Create single container component
- [ ] Remove OrthogonalViewContainer
- [ ] Update VolumeView to use new structure

**Implementation Notes**:
- Preserve Golden Layout integration
- Keep drag-drop functionality
- Simplify component tree

---

## Phase 4: Testing and Validation

### MLR-TEST-001: Test Multi-Volume Rendering
**Priority**: Critical  
**Dependencies**: MLR-COMPONENT-001  
**Estimated**: 2 hours

**Description**: Comprehensive test of multiple volumes with all three views.

**Acceptance Criteria**:
- [ ] Load 8 different volumes
- [ ] Verify all views show correct data
- [ ] No layer limit errors
- [ ] Performance is acceptable
- [ ] Layer property changes work correctly

**Test Plan**:
1. Load volume 1, verify 3 views work
2. Load volume 2, verify 6 views work (2 volumes × 3 views)
3. Continue to 8 volumes
4. Test property changes on each volume
5. Test removing volumes

### MLR-TEST-002: Test Layer State Persistence
**Priority**: High  
**Dependencies**: MLR-TEST-001  
**Estimated**: 1 hour

**Description**: Verify layer state persists correctly when switching views.

**Acceptance Criteria**:
- [ ] Set different properties per layer
- [ ] Switch between volumes
- [ ] Properties remain correct
- [ ] No visual glitches

### MLR-TEST-003: Performance Benchmarking
**Priority**: Medium  
**Dependencies**: MLR-TEST-001  
**Estimated**: 2 hours

**Description**: Benchmark the new architecture vs old.

**Acceptance Criteria**:
- [ ] Measure render time per frame
- [ ] Measure memory usage
- [ ] Compare with old architecture
- [ ] Document results

**Metrics to Track**:
- Frame render time (ms)
- GPU memory usage
- Number of GPU state changes
- Time to switch volumes

---

## Implementation Order

1. **Week 1**: Backend Changes
   - MLR-BACKEND-001 (2h)
   - MLR-BACKEND-002 (3h)
   - MLR-FRONTEND-001 (2h)

2. **Week 2**: Frontend Integration
   - MLR-FRONTEND-002 (3h)
   - MLR-FRONTEND-003 (2h)
   - MLR-COMPONENT-001 (4h)

3. **Week 3**: Testing & Polish
   - MLR-TEST-001 (2h)
   - MLR-TEST-002 (1h)
   - MLR-COMPONENT-002 (3h)

4. **Week 4**: Optional Improvements
   - MLR-BACKEND-003 (1h)
   - MLR-COMPONENT-003 (2h)
   - MLR-COMPONENT-004 (2h)
   - MLR-TEST-003 (2h)

**Total Estimated**: ~30 hours

---

## Success Metrics

1. **No Layer Limit Errors**: Can load 8+ volumes without errors
2. **Performance**: No regression in render time
3. **Memory Usage**: Reduced by ~66% (1 layer per volume vs 3)
4. **Code Simplification**: View components reduced by ~40% LOC
5. **Maintainability**: Clear separation of concerns

---

## Risk Mitigation

1. **Backend Compatibility**: Test each backend change independently
2. **State Management**: Careful migration of layer state to GpuRenderManager
3. **Performance**: Profile before and after each major change
4. **Rollback Plan**: Feature flag for old vs new architecture

---

## Notes

- Start with critical tickets first
- Backend and frontend work can proceed in parallel
- Testing should happen continuously, not just at the end
- Component refactoring can be deferred if needed