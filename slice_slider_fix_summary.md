# Slice Slider Fix Summary

## Problem
When using the slice slider in the axial view, the image was panning (moving down) instead of advancing to the next slice. The crosshair position in X and Y should remain fixed while only the Z coordinate changes.

## Root Cause
The `update_frame_for_synchronized_view` function was using the full crosshair position as the origin for the view. When the Z slice changed, it was changing the origin, causing the view to pan.

## Solution
Implemented a separation between "view center" (which stays fixed) and "slice position" (which changes with the slider):

1. **Added view center tracking**: Track a separate `viewCenter` state that is initialized to the crosshair position but doesn't change when the slider moves.

2. **Modified frame center calculation**: When setting up view parameters, use:
   - View center coordinates for the in-plane dimensions (X,Y for axial)
   - Slider position for the out-of-plane dimension (Z for axial)

3. **Updated slider handler**: The slider now:
   - Updates only the local `slicePosition` state
   - Does NOT update the global crosshair (commented out)
   - Triggers a re-render with the new slice position

## Code Changes

### OrthogonalViewGPU.svelte
- Added `viewCenter` state variable
- Initialize `viewCenter` to crosshair position on first setup
- Modified `setupViewParameters` to use view center + slice position
- Updated `handleSliderChange` to not update global crosshair
- Frame center calculation now preserves view position while changing slice

## Result
The slice slider now correctly advances through slices without panning the image. The view stays centered on the same anatomical location while moving through different Z slices.