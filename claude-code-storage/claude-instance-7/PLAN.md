# Comprehensive Plan: Fix Layer Compositing for Same Image Loaded Multiple Times

## Problem Summary

When loading the same image file twice as separate layers, the second layer's intensity and alpha adjustments don't affect the visual output. The investigation reveals this is caused by layer ID management issues and potential GPU resource allocation conflicts during the rendering pipeline.

## Root Causes

1. **Layer ID Lookup Failures**: The backend's layer-to-atlas mapping lookup fails during rendering for the second layer
2. **Inconsistent ID Usage**: Potential mismatch between IDs used for storage vs. retrieval in `layer_to_atlas_map`
3. **On-Demand GPU Allocation**: Failed lookups trigger re-allocation attempts, causing lost references
4. **Layer State Synchronization**: GPU layer storage buffer may not properly reflect updates for all layers

## Solution Plan

### Phase 1: Diagnose and Fix Layer ID Management

#### 1.1 Add Comprehensive Debug Logging
**Files to modify:**
- `/core/api_bridge/src/lib.rs`

**Changes needed:**
1. In `request_layer_gpu_resources`:
   - Log the exact layer ID being stored in the map
   - Log all existing entries in `layer_to_atlas_map` after insertion
   - Add checksum/hash of the layer ID to detect any transformation

2. In `apply_and_render_view_state_internal`:
   - Log the exact layer.id and layer.volume_id received from frontend
   - Log all keys currently in `layer_to_atlas_map` before lookup
   - Log which key (if any) successfully matches

3. In `patch_layer`:
   - Log the layer ID received for patching
   - Log the atlas index retrieved
   - Log the actual GPU update calls made

#### 1.2 Ensure Consistent Layer ID Usage
**Files to modify:**
- `/ui2/src/services/LayerApiImpl.ts`
- `/ui2/src/stores/layerStore.ts`
- `/ui2/src/components/views/OrthogonalViewContainer.tsx`

**Changes needed:**
1. Verify that `LayerState` sent to backend always has matching `id` and `volumeId` fields
2. Add validation to ensure layer IDs remain consistent throughout the frontend
3. Log layer IDs at every transformation point in the frontend

### Phase 2: Fix GPU Resource Management

#### 2.1 Prevent Duplicate GPU Allocations
**Files to modify:**
- `/core/api_bridge/src/lib.rs`

**Changes needed:**
1. In `apply_and_render_view_state_internal`:
   ```rust
   // Before attempting on-demand allocation, check if we're in the middle of allocation
   let allocation_in_progress = state.gpu_allocation_locks.get(&layer.id).is_some();
   if allocation_in_progress {
       warn!("GPU allocation already in progress for layer {}, skipping", layer.id);
       continue;
   }
   
   // Add a lock to prevent concurrent allocations
   state.gpu_allocation_locks.insert(layer.id.clone());
   
   // After allocation completes, remove the lock
   state.gpu_allocation_locks.remove(&layer.id);
   ```

2. Add a new field to `ApiState`:
   ```rust
   pub gpu_allocation_locks: Arc<Mutex<HashSet<String>>>,
   ```

#### 2.2 Improve Layer-to-Atlas Mapping Robustness
**Files to modify:**
- `/core/api_bridge/src/lib.rs`

**Changes needed:**
1. Create a helper function for layer lookup that tries multiple strategies:
   ```rust
   async fn find_layer_atlas_index(
       state: &ApiState,
       layer_id: &str,
       volume_id: &str,
   ) -> Option<u32> {
       let layer_map = state.layer_to_atlas_map.lock().await;
       
       // Try exact matches first
       if let Some(&idx) = layer_map.get(layer_id) {
           return Some(idx);
       }
       
       if let Some(&idx) = layer_map.get(volume_id) {
           return Some(idx);
       }
       
       // Try case-insensitive match as fallback
       for (key, &idx) in layer_map.iter() {
           if key.eq_ignore_ascii_case(layer_id) || key.eq_ignore_ascii_case(volume_id) {
               warn!("Found layer via case-insensitive match: {} -> {}", key, idx);
               return Some(idx);
           }
       }
       
       None
   }
   ```

### Phase 3: Ensure Proper Layer State Synchronization

#### 3.1 Verify GPU Buffer Updates
**Files to modify:**
- `/core/render_loop/src/lib.rs`
- `/core/render_loop/src/render_service.rs`

**Changes needed:**
1. In `update_layer_intensity` and `update_layer`:
   - Add logging to confirm the layer storage buffer is updated
   - Add a flag to force GPU buffer synchronization
   - Verify the correct atlas index is being updated

2. Add a method to dump current GPU layer state for debugging:
   ```rust
   pub fn debug_dump_layer_state(&self) -> Vec<LayerDebugInfo> {
       // Return current state of all layers in GPU memory
   }
   ```

#### 3.2 Fix Layer Storage Buffer Updates
**Files to modify:**
- `/core/render_loop/src/layer_manager.rs` (if exists, otherwise in render_service.rs)

**Changes needed:**
1. Ensure layer updates are immediately written to GPU storage buffer
2. Add memory barriers if needed to ensure updates are visible to shaders
3. Verify that the layer count in the storage buffer matches active layers

### Phase 4: Add Validation and Testing

#### 4.1 Add Layer Validation Command
**Files to modify:**
- `/core/api_bridge/src/lib.rs`
- `/core/api_bridge/build.rs`
- `/ui2/src/services/transport.ts`

**Changes needed:**
1. Create a new Tauri command `validate_layer_state`:
   ```rust
   #[command]
   async fn validate_layer_state(
       state: State<'_, ApiState>,
   ) -> Result<LayerValidationReport, BridgeError> {
       // Return detailed report of:
       // - All layers in layer_to_atlas_map
       // - All volumes in volume_registry
       // - Current GPU layer states
       // - Any inconsistencies found
   }
   ```

#### 4.2 Add Frontend Layer Debugging
**Files to modify:**
- `/ui2/src/hooks/useLayerDebug.ts` (new file)
- `/ui2/src/components/panels/LayerPanel.tsx`

**Changes needed:**
1. Create a debug hook that periodically validates layer state
2. Add visual indicators when layer state is inconsistent
3. Add a debug panel showing layer ID mappings

### Phase 5: Implement Fixes for Specific Issues

#### 5.1 Fix ViewState Layer Serialization
**Files to modify:**
- `/ui2/src/utils/viewStateUtils.ts`
- `/ui2/src/services/ViewStateManager.ts` (if exists)

**Changes needed:**
1. Ensure `LayerState` objects sent to backend have all required fields
2. Add validation before sending ViewState to backend
3. Log the exact structure being sent

#### 5.2 Fix Race Conditions
**Files to modify:**
- `/ui2/src/services/LayerService.ts`
- `/ui2/src/hooks/useLayerManager.ts` (if exists)

**Changes needed:**
1. Add proper async/await handling for GPU resource requests
2. Ensure layer property updates wait for GPU allocation to complete
3. Add retry logic with exponential backoff for failed operations

### Phase 6: Testing and Verification

#### 6.1 Create Automated Tests
**Files to create:**
- `/ui2/src/services/__tests__/LayerService.test.ts`
- `/e2e/tests/multi-layer-compositing.spec.ts`

**Test scenarios:**
1. Load same file twice, verify both layers visible
2. Adjust intensity/alpha of second layer, verify visual changes
3. Toggle visibility of each layer independently
4. Delete first layer, verify second layer still renders correctly

#### 6.2 Add Manual Test Procedure
**Files to create:**
- `/docs/testing/multi-layer-compositing-test.md`

**Test steps:**
1. Load a NIfTI file
2. Load the same file again
3. Adjust intensity window of second layer
4. Adjust alpha of second layer
5. Verify visual changes are applied

## Implementation Order

1. **Immediate fixes** (Phase 1.1, 1.2): Add logging to diagnose the exact issue
2. **Critical fixes** (Phase 2.1, 2.2): Prevent duplicate allocations and improve lookup
3. **Core fixes** (Phase 3.1, 3.2): Ensure GPU state synchronization
4. **Validation** (Phase 4.1, 4.2): Add tools to detect and prevent future issues
5. **Polish** (Phase 5.1, 5.2): Fix remaining edge cases
6. **Testing** (Phase 6.1, 6.2): Ensure the fix is robust

## Success Criteria

1. Loading the same file twice creates two independent layers
2. Each layer's intensity and alpha can be adjusted independently
3. Visual output correctly shows the composited result
4. No GPU resource leaks or duplicate allocations
5. Layer operations remain performant with multiple layers

## Risk Mitigation

1. **Performance Impact**: Layer lookups should use efficient data structures (HashMap)
2. **Memory Leaks**: Ensure GPU resources are properly cleaned up when layers are removed
3. **Breaking Changes**: Maintain backward compatibility with existing layer APIs
4. **Race Conditions**: Use proper locking mechanisms for shared state

## Additional Considerations

1. Consider adding a layer "fingerprint" that combines various IDs for more robust matching
2. Implement a layer registry service that centralizes all layer ID management
3. Add metrics/telemetry to track layer operation success rates
4. Consider caching frequently accessed layer mappings for performance

## Monitoring and Maintenance

1. Add performance metrics for layer operations
2. Monitor GPU memory usage with multiple layers
3. Add alerts for layer lookup failures
4. Regular testing with edge cases (many layers, rapid updates, etc.)

This plan addresses the root causes identified in the investigation and provides a systematic approach to fixing the layer compositing issue while improving the overall robustness of the layer management system.