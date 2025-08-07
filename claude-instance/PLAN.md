# MosaicView Quarter-Image Bug: Super Detailed Resolution Plan

## Executive Summary

After analyzing both the INVESTIGATION_REPORT.md and FLOW_REPORT.md, along with thorough examination of all relevant source files, I have identified a complex multi-layered bug involving:

1. **Incorrect canvas drawing parameters** in MosaicCell.tsx (9-parameter vs 5-parameter drawImage)
2. **Backend dimension adjustment behavior** that returns smaller dimensions than requested
3. **Frontend-backend dimension coordination mismatch** causing 2× scaling factors
4. **Missing shared utility usage** in MosaicCell crosshair redraw logic

The bug manifests as only the top-left quarter (25%) of brain images being visible in MosaicView, while SliceView works correctly.

## Root Cause Analysis Summary

### Primary Issues
1. **MosaicCell.tsx Canvas Drawing Bug**: Lines 179-183 and 202-206 use incorrect 9-parameter `ctx.drawImage()` calls instead of the proven `drawScaledImage()` utility
2. **Backend Dimension Adjustment**: The backend's `recalculate_view_for_dimensions` function returns different dimensions (e.g., 128×128) than requested (256×256) for aspect ratio preservation
3. **Scaling Amplification**: Frontend scaling up smaller backend images creates 2× factor that reveals only the top-left quarter

### Secondary Issues
1. **Architecture Inconsistency**: MosaicCell doesn't use the same proven utilities as SliceView
2. **Dimension Coordination Gap**: No negotiation between frontend cell sizes and backend calculated dimensions

## Detailed Solution Plan

### Phase 1: Immediate Critical Fix - Canvas Drawing Parameters
**Priority: CRITICAL - Direct bug causing quarter-image display**

#### File: `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/MosaicCell.tsx`

**Issue Analysis:**
- Lines 179-183: Manual `ctx.drawImage()` with 9 parameters treating params as source cropping
- Lines 202-206: Same issue in crosshair settings update handler
- Both locations should use the proven `drawScaledImage()` utility from `canvasUtils.ts`

**Required Changes:**

1. **Add Import** (Line ~12):
   ```typescript
   import { drawScaledImage } from '@/utils/canvasUtils';
   ```

2. **Replace First Manual DrawImage Call** (Lines 174-186):
   ```typescript
   // BEFORE (Lines 174-186):
   // Clear and redraw the image
   ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
   
   // Redraw the image
   const placement = imagePlacementRef.current;
   ctx.drawImage(
     lastImageRef.current,
     0, 0, lastImageRef.current.width, lastImageRef.current.height,
     placement.x, placement.y, placement.width, placement.height
   );

   // AFTER:
   // Clear and redraw the image  
   ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
   
   // Use shared utility for consistent image drawing
   const newPlacement = drawScaledImage(
     ctx, 
     lastImageRef.current, 
     canvasRef.current.width, 
     canvasRef.current.height
   );
   // Update placement reference for crosshair calculations
   imagePlacementRef.current = newPlacement;
   ```

3. **Replace Second Manual DrawImage Call** (Lines 198-210):
   ```typescript
   // BEFORE (Lines 200-206):
   // Redraw the image
   const placement = imagePlacementRef.current;
   ctx.drawImage(
     lastImageRef.current,
     0, 0, lastImageRef.current.width, lastImageRef.current.height,
     placement.x, placement.y, placement.width, placement.height
   );

   // AFTER:
   // Use shared utility for consistent image drawing
   const newPlacement = drawScaledImage(
     ctx, 
     lastImageRef.current, 
     canvasRef.current.width, 
     canvasRef.current.height
   );
   // Update placement reference for crosshair calculations
   imagePlacementRef.current = newPlacement;
   ```

**Expected Impact:** This should immediately fix the quarter-image display by using the same proven image scaling logic as SliceView.

### Phase 2: Backend-Frontend Dimension Coordination
**Priority: HIGH - Prevents backend dimension adjustments from causing scaling issues**

#### Understanding the Backend Behavior

**File Analysis: `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/apiService.ts` (Lines 642-659)**

The backend's `recalculate_view_for_dimensions` function deliberately adjusts dimensions:
- Requested: 256×256
- Backend returns: 128×128 (for aspect ratio preservation and square pixels)
- Frontend scaling: 2× (128×128 → 256×256)
- Result: Quarter-image visible

#### Solution Options

**Option A: Frontend Dimension Negotiation (RECOMMENDED)**

Modify the MosaicRenderService to query actual backend dimensions before creating cells.

**File: `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/MosaicRenderService.ts`**

**Changes Required:**

1. **Add New Method** (Around line 130):
   ```typescript
   /**
    * Get actual render dimensions that backend will use
    * This prevents dimension mismatch scaling issues
    */
   private async getActualRenderDimensions(
     viewState: ViewState,
     axis: 'axial' | 'sagittal' | 'coronal',
     requestedWidth: number,
     requestedHeight: number
   ): Promise<[number, number]> {
     const visibleLayers = viewState.layers.filter(l => l.visible && l.opacity > 0);
     if (visibleLayers.length === 0) {
       return [requestedWidth, requestedHeight];
     }
     
     const primaryVolumeId = visibleLayers[0].volumeId;
     if (!primaryVolumeId) {
       return [requestedWidth, requestedHeight];
     }
     
     try {
       const viewPlane = await this.apiService.recalculateViewForDimensions(
         primaryVolumeId,
         axis,
         [requestedWidth, requestedHeight],
         viewState.crosshair.world_mm
       );
       return viewPlane.dim_px;
     } catch (error) {
       console.warn('[MosaicRenderService] Failed to get actual dimensions, using requested:', error);
       return [requestedWidth, requestedHeight];
     }
   }
   ```

2. **Modify renderMosaicCell Method** (Lines 37-129):
   
   Add dimension negotiation before rendering:
   ```typescript
   async renderMosaicCell(request: MosaicRenderRequest): Promise<void> {
     const { sliceIndex, axis, cellId, width, height } = request;
     
     // ... existing code until line ~56 ...
     
     // Get current view state
     const currentViewState = useViewStateStore.getState().viewState;
     
     // NEW: Get actual dimensions backend will use
     const [actualWidth, actualHeight] = await this.getActualRenderDimensions(
       currentViewState,
       axis,
       width,
       height
     );
     
     console.log(`[MosaicRenderService] Dimension negotiation for ${cellId}:`, {
       requested: [width, height],
       actual: [actualWidth, actualHeight],
       scaleFactor: [width / actualWidth, height / actualHeight]
     });
     
     // Create a modified view state for this specific slice
     const modifiedViewState = await this.createSliceViewState(
       currentViewState,
       axis,
       sliceIndex,
       actualWidth,  // Use actual dimensions
       actualHeight  // Use actual dimensions
     );
     
     // ... rest of existing code ...
   }
   ```

**Option B: Backend Parameter for Mosaic Mode (ALTERNATIVE)**

Add a backend parameter to disable dimension adjustment for mosaic rendering.

**File: `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/apiService.ts`**

Modify the `recalculateViewForDimensions` method to accept a `strictDimensions` flag:

1. **Method Signature Change** (Line 586):
   ```typescript
   async recalculateViewForDimensions(
     volumeId: string,
     viewType: 'axial' | 'sagittal' | 'coronal',
     dimensions: [number, number],
     crosshairMm: [number, number, number],
     strictDimensions = false  // NEW: Prevent dimension adjustment for mosaic
   ): Promise<ViewPlane>
   ```

2. **Backend Call Modification** (Line 611):
   ```typescript
   const result = await this.transport.invoke<any>('recalculate_view_for_dimensions', {
     ...request,
     strictDimensions
   });
   ```

### Phase 3: Architecture Consistency Improvements
**Priority: MEDIUM - Prevent future similar issues**

#### File: `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/MosaicCell.tsx`

**Changes for Long-term Maintainability:**

1. **Consolidate Image Rendering Logic** (Lines 165-186):
   
   Create a shared method to eliminate code duplication:
   ```typescript
   // Add as class method around line 63
   const redrawImageWithCrosshair = useCallback((ctx: CanvasRenderingContext2D) => {
     if (!lastImageRef.current) return;
     
     // Clear canvas
     ctx.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
     
     // Draw image using shared utility
     const placement = drawScaledImage(
       ctx, 
       lastImageRef.current, 
       canvasRef.current!.width, 
       canvasRef.current!.height
     );
     
     // Update placement reference
     imagePlacementRef.current = placement;
     
     // Draw crosshair
     customRender(ctx, placement);
   }, [customRender]);
   ```

2. **Simplify Effect Handlers** (Lines 167-187 and 189-211):
   
   Replace both effects with calls to the shared method:
   ```typescript
   // Effect 1 (Lines 167-187)
   useEffect(() => {
     if (!canvasRef.current || !lastImageRef.current) return;
     
     const ctx = canvasRef.current.getContext('2d');
     if (!ctx) return;
     
     redrawImageWithCrosshair(ctx);
   }, [viewState.crosshair, crosshairSettings, redrawImageWithCrosshair]);
   
   // Effect 2 (Event handler, Lines 189-211)
   useEvent('crosshair.settings.updated', (newSettings) => {
     console.log('[MosaicCell] Crosshair settings updated:', newSettings);
     
     if (canvasRef.current && lastImageRef.current) {
       const ctx = canvasRef.current.getContext('2d');
       if (!ctx) return;
       
       redrawImageWithCrosshair(ctx);
     }
   });
   ```

### Phase 4: Enhanced Error Handling and Monitoring
**Priority: LOW - Debugging and maintenance**

#### File: `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/MosaicRenderService.ts`

**Add Dimension Tracking and Warning System:**

1. **Add Dimension Monitoring** (Around line 95):
   ```typescript
   // Before emitting render.complete
   if (imageBitmap) {
     // Monitor for dimension mismatches
     const expectedSize = `${width}×${height}`;
     const actualSize = `${imageBitmap.width}×${imageBitmap.height}`;
     const scaleFactor = width / imageBitmap.width;
     
     if (scaleFactor > 1.5) {
       console.warn(`[MosaicRenderService] Large scaling detected for ${cellId}:`, {
         expected: expectedSize,
         actual: actualSize,
         scaleFactor: `${scaleFactor.toFixed(1)}×`,
         impact: scaleFactor > 2 ? 'CRITICAL - Quarter image likely' : 'HIGH - Quality degradation'
       });
     }
     
     // ... existing emit code ...
   }
   ```

#### File: `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/MosaicViewPromise.tsx`

**Add Cell Size Optimization** (Lines 142-149):

1. **Improve Cell Size Calculation** to account for backend adjustments:
   ```typescript
   // Replace existing calculation
   const cellWidth = Math.floor(availableWidth / cols);
   const cellHeight = Math.floor(availableHeight / rows);
   
   // NEW: Round to backend-friendly dimensions
   const roundToBackendFriendly = (size: number) => {
     // Backend prefers dimensions divisible by 8 for GPU efficiency
     return Math.floor(size / 8) * 8;
   };
   
   const cellSizeValue = Math.min(cellWidth, cellHeight, 512);
   const backendFriendlySize = roundToBackendFriendly(cellSizeValue);
   const finalSize = Math.max(backendFriendlySize, 128);
   ```

## Implementation Priority and Timeline

### Immediate (Day 1) - Critical Bug Fix
1. **Fix MosaicCell.tsx** - Replace manual drawImage calls with drawScaledImage utility
   - Lines 179-183: Main redraw logic
   - Lines 202-206: Crosshair settings handler
   - Add import for drawScaledImage

**Expected Result**: MosaicView should display full brain images instead of quarter-images

### Short Term (Day 2-3) - Dimension Coordination
1. **Implement Option A** - Frontend dimension negotiation in MosaicRenderService
   - Add getActualRenderDimensions method
   - Modify renderMosaicCell to use actual dimensions
   - Add dimension mismatch monitoring

**Expected Result**: Eliminate scaling factors that cause quarter-image effects

### Medium Term (Week 1) - Architecture Consistency
1. **Refactor MosaicCell.tsx** - Consolidate image rendering logic
   - Create shared redrawImageWithCrosshair method
   - Simplify effect handlers
   - Improve code maintainability

### Long Term (Week 2) - Prevention and Monitoring
1. **Add enhanced monitoring** in MosaicRenderService
2. **Optimize cell size calculation** in MosaicViewPromise
3. **Consider backend strictDimensions parameter** if needed

## Verification Steps

After each phase, verify the fix by:

1. **Load a volume** in the application
2. **Open MosaicView** and switch between different grid sizes (2×2, 3×3, 4×4)
3. **Verify full brain images** are displayed (not cropped to quarter)
4. **Test crosshair functionality** - clicks should update global crosshair correctly
5. **Compare with SliceView** to ensure identical image quality and behavior
6. **Monitor console logs** for dimension mismatch warnings
7. **Test different brain volumes** to ensure consistency across datasets

## Risk Assessment

### Low Risk Changes
- Phase 1 (Canvas drawing fix): Uses proven existing utility, minimal risk
- Phase 4 (Monitoring): Logging only, no functional changes

### Medium Risk Changes  
- Phase 2 (Dimension coordination): Changes rendering pipeline but maintains existing APIs
- Phase 3 (Code consolidation): Refactoring with same functionality

### Mitigation Strategies
1. **Incremental deployment**: Implement Phase 1 first, verify, then proceed
2. **Fallback ready**: Keep original code in comments until verification complete
3. **Comprehensive testing**: Test with multiple volumes and grid configurations
4. **Performance monitoring**: Watch for any performance impact from dimension negotiation

## Files Modified Summary

### Primary Changes (Critical)
1. `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/MosaicCell.tsx`
   - Replace manual drawImage calls with drawScaledImage utility
   - Add import from canvasUtils
   - Fix both redraw locations (lines ~179-183 and ~202-206)

### Secondary Changes (High Priority)
1. `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/MosaicRenderService.ts`
   - Add getActualRenderDimensions method
   - Modify renderMosaicCell for dimension negotiation
   - Add dimension mismatch monitoring

### Optional Changes (Medium Priority)
1. `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/apiService.ts`
   - Add strictDimensions parameter (if Option B chosen)
2. `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/MosaicViewPromise.tsx`
   - Optimize cell size calculation for backend compatibility

## Technical Insights

### Why SliceView Works But MosaicView Doesn't
- **SliceView**: Uses larger containers (512×512+), backend adjustments minimal, scaling factor ~1.07×
- **MosaicView**: Uses smaller cells (256×256), backend adjustments significant, scaling factor ~2×
- **The difference**: Scaling factor magnitude makes the quarter-image effect prominent in MosaicView

### Backend Dimension Adjustment Rationale
The backend adjusts dimensions to:
- Preserve aspect ratios of anatomical structures
- Ensure square pixels (medical imaging standard)  
- Optimize for GPU memory alignment
- Maintain consistent world-to-pixel transforms

### Long-term Architecture Direction
This fix aligns with the architectural principle of:
- **Heavy computation in Rust**: Dimension calculations stay in backend
- **TypeScript uses handles**: Frontend adapts to backend-calculated dimensions
- **Shared utilities**: Consistent canvas rendering across all slice views
- **Medical imaging standards**: Square pixels and proper aspect ratios preserved

## Conclusion

This plan addresses the MosaicView quarter-image bug through a multi-layered approach:

1. **Immediate fix**: Correct canvas drawing parameters for instant results
2. **Structural fix**: Coordinate dimensions between frontend and backend  
3. **Architectural consistency**: Use proven shared utilities throughout
4. **Prevention**: Add monitoring and optimize for backend behavior

The solution maintains the medical imaging standards (square pixels, aspect ratio preservation) while ensuring the frontend properly handles backend dimension adjustments. The fix is backward compatible and follows the existing codebase patterns.

The most critical change is Phase 1 - replacing the incorrect 9-parameter `drawImage` calls with the proven `drawScaledImage` utility. This should immediately resolve the quarter-image display issue and align MosaicView with the working SliceView architecture.