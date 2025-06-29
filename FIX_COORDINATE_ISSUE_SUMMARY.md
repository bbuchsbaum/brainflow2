# Fix for Coordinate Transformation Issue

## Problem
The brain volume was appearing at the bottom of all three orthogonal views instead of being centered. This was because:
1. The crosshair was defaulting to world coordinates [0, 0, 0]
2. The toy test volume (10x10x10) with 2mm spacing is actually located at world coordinates from [-45, -63, -31] to [-27, -45, -13]
3. The volume center is at [-36, -54, -22] in world coordinates

## Root Cause
When the crosshair is at [0, 0, 0], it maps to voxel coordinates [22.5, 31.5, 15.5], which is completely outside the volume bounds of [0-9, 0-9, 0-9]. This caused the view plane to show empty space with the volume appearing compressed at the edge.

## Solution
1. **Automatic Crosshair Initialization**: Modified `layerStore.ts` to automatically initialize the crosshair to the volume center when GPU resources are loaded for the first volume.

2. **Increased Field of View**: Changed the base field of view from 100mm to 256mm to better accommodate typical brain volumes.

3. **Debug Logging**: Added logging to help diagnose coordinate transformation issues in the future.

## Changes Made

### 1. `ui/src/lib/stores/layerStore.ts`
- Added import for `crosshairSlice`
- Modified `setGpuInfo` to calculate volume center in world coordinates
- Automatically sets crosshair when first volume is loaded

### 2. `ui/src/lib/components/views/OrthogonalViewGPU.svelte`
- Increased base field of view from 100mm to 256mm
- Removed hardcoded crosshair position

### 3. `core/render_loop/src/lib.rs`
- Added debug logging to track coordinate transformations
- Logs view parameters, crosshair position, and volume metadata

## Testing
To verify the fix:
1. Load the toy volume: `test-data/unit/toy_t1w.nii.gz`
2. The volume should appear centered in all three views
3. The crosshair should be initialized to the volume center at [-36, -54, -22]
4. Check console logs for debug information about coordinate transformations

## Future Improvements
1. Consider adding a "center on volume" button in the UI
2. Add support for multiple volumes with different coordinate spaces
3. Implement proper handling of volumes with different orientations (RAS, LAS, etc.)