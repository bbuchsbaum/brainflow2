# Histogram Investigation Report

**Date**: 2025-08-04  
**Issue**: Histogram is visible but shows no data even after image loading and display

## Executive Summary

Through comprehensive investigation of the data flow from image loading → layer creation → layer selection → histogram computation, I have identified **multiple root causes** for the histogram data issue. The problem is not a single failure point but rather a combination of architectural and event flow issues.

## Key Findings

### 1. **CRITICAL: PlotPanel Event Dependencies Issue**

**Location**: `/ui2/src/components/panels/PlotPanel.tsx` (line 103)

**Problem**: The PlotPanel only reloads the histogram when `selectedLayerId` changes, but it should also reload when layer render properties (intensity/threshold) change.

```typescript
}, [selectedLayerId]); // ❌ MISSING dependencies
```

**Impact**: 
- Histogram doesn't update when user changes intensity or threshold settings
- If the histogram was empty initially, it stays empty even after render changes

**Fix Needed**: Add dependencies for intensity/threshold changes or implement event listeners.

### 2. **Layer Selection Auto-Selection Logic**

**Location**: `/ui2/src/stores/layerStore.ts` (lines 171-174)

**Current Logic**: 
```typescript
// Auto-select first layer if none selected
if (state.selectedLayerId === null && state.layers.length === 1) {
  console.log(`[layerStore] Auto-selecting first layer: ${layer.id}`);
  state.selectedLayerId = layer.id;
}
```

**Analysis**: This logic appears correct and should auto-select the first layer when added. However, this only works if the layer is added to an empty store.

### 3. **Histogram Service Event Handling**

**Location**: `/ui2/src/services/HistogramService.ts` (lines 24-32)

**Current Events**: The service listens to these events:
- `layer.updated` → Invalidates cache
- `layer.patched` → Clears layer cache

**Issue**: The service invalidates cache but doesn't proactively reload data. The PlotPanel must request new data, but it's not listening to the right events.

### 4. **Backend Layer-to-Volume Mapping**

**Location**: `/core/api_bridge/src/lib.rs` (lines 2972-2984)

**Status**: ✅ **WORKING CORRECTLY**

The backend properly:
1. Establishes layer-to-volume mapping when layers are created (line 1731)
2. Looks up volumes by layer ID during histogram computation (lines 2974-2983)
3. Returns appropriate error codes if mapping fails (BridgeError::VolumeNotFound, code 4044)

### 5. **4D Volume Histogram Support**

**Location**: `/core/api_bridge/src/lib.rs` (lines 3067-3147)

**Status**: ✅ **PARTIALLY FIXED**

The backend now supports histogram computation for:
- ✅ 4D F32 volumes (Vec4DF32) - extracts current timepoint
- ✅ 4D I16 volumes (Vec4DI16) - extracts current timepoint  
- ✅ 4D U8 volumes (Vec4DU8) - extracts current timepoint
- ❌ Other 4D types (I8, U16, I32, U32, F64) - return empty histograms

### 6. **Event Flow Analysis**

**Issue**: Missing event propagation chain for histogram updates

**Current Flow**:
```
User changes intensity/threshold 
→ LayerPanel.handleRenderUpdate() 
→ useViewStateStore.setViewState() 
→ NO EVENT to trigger histogram reload
→ PlotPanel doesn't know to reload
```

**Expected Flow**:
```
User changes intensity/threshold 
→ LayerPanel.handleRenderUpdate() 
→ useViewStateStore.setViewState() 
→ Event: layer.render.changed
→ PlotPanel listens and reloads histogram
```

## Root Cause Analysis

The histogram shows no data due to **two primary issues**:

### Root Cause #1: Missing React Dependencies
The PlotPanel component doesn't re-run its histogram loading effect when layer render properties change, only when the selected layer changes.

### Root Cause #2: Incomplete Event Chain
When users change intensity/threshold settings, no event is emitted that would trigger the PlotPanel to reload the histogram data.

## Additional Considerations

### Layer Selection Timing
The layer selection appears to work correctly based on the code analysis:
- Auto-selection happens when adding the first layer to an empty store
- Selection state is properly managed in the layerStore

### Volume Data Availability
The backend layer-to-volume mapping and volume registry appear to be working correctly:
- Mapping is established during layer creation
- Volume lookup during histogram computation follows proper error handling
- 4D volume support is mostly implemented

## Recommended Fixes

### Immediate Fixes (High Priority)

1. **Fix PlotPanel Dependencies**
   ```typescript
   // In PlotPanel.tsx
   useEffect(() => {
     // ... histogram loading logic
   }, [selectedLayerId, layerRender?.intensity, layerRender?.threshold]);
   ```

2. **Add Event Emission for Render Changes**
   ```typescript
   // In LayerPanel.tsx or appropriate service
   eventBus.emit('layer.render.changed', { layerId, renderProps });
   ```

3. **Add Event Listener in PlotPanel**
   ```typescript
   // Listen for render changes and reload histogram
   useEffect(() => {
     const handleRenderChange = ({ layerId }) => {
       if (layerId === selectedLayerId) {
         loadHistogram();
       }
     };
     eventBus.on('layer.render.changed', handleRenderChange);
     return () => eventBus.off('layer.render.changed', handleRenderChange);
   }, [selectedLayerId]);
   ```

### Medium Priority Fixes

1. **Complete 4D Volume Support**
   - Implement histogram computation for remaining 4D volume types (I8, U16, I32, U32, F64)

2. **Improve Error Handling**
   - Add more specific error messages for histogram computation failures
   - Add user-facing error notifications

### Low Priority Improvements

1. **Add Histogram Caching Strategy**
   - Cache histograms per layer + render properties combination
   - Invalidate cache only when necessary

2. **Add Progress Indicators**
   - Show loading state during histogram computation
   - Add timeout handling for long computations

## Testing Recommendations

1. **Test Auto-Selection**: Load a single volume and verify selectedLayerId is set
2. **Test Histogram Loading**: Check console logs for histogram service calls
3. **Test Render Changes**: Change intensity/threshold and verify histogram updates
4. **Test 4D Volumes**: Load 4D data and verify histogram computation works
5. **Test Error Cases**: Try to compute histogram for non-existent layer IDs

## Console Debug Commands

To help diagnose the issue in the browser console:

```javascript
// Check layer selection state
console.log('Selected Layer ID:', useLayerStore.getState().selectedLayerId);
console.log('All Layers:', useLayerStore.getState().layers);

// Check layer-render mapping
const selectedId = useLayerStore.getState().selectedLayerId;
console.log('Selected Layer Render:', useLayerStore.getState().getLayerRender(selectedId));

// Test histogram service directly
const histogramService = await import('./services/HistogramService');
histogramService.histogramService.computeHistogram({ layerId: selectedId, binCount: 256 })
  .then(data => console.log('Histogram Data:', data))
  .catch(error => console.error('Histogram Error:', error));
```

## Conclusion

The histogram issue is primarily caused by **incomplete event handling** rather than backend failures. The layer-to-volume mapping and histogram computation logic appear to be working correctly. The fixes are straightforward and involve updating the PlotPanel component to respond to render property changes and ensuring appropriate events are emitted when those properties change.

The auto-selection of layers also appears to be implemented correctly, so if histograms are still not showing after implementing the event fixes, the issue may be related to timing or state synchronization during the layer loading process.