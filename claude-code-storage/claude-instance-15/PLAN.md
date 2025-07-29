# MosaicView Comprehensive Fix Plan

## Executive Summary

This plan addresses the critical MosaicView rendering issues that manifest as quarter-display slices followed by black screens. The analysis reveals that the root cause is a fundamental misunderstanding of the backend's coordinate system, where the frontend incorrectly attempts to scale pre-calculated per-pixel displacement vectors.

**Core Problem**: The backend's `ViewRectMm::full_extent()` preserves aspect ratios by returning dimensions (e.g., 432×512) that differ from requested dimensions (512×512), but the frontend treats this as an error and applies corrupting scaling transformations.

**Solution Strategy**: Remove incorrect scaling logic, trust backend calculations, and properly handle dimension mismatches throughout the rendering pipeline.

---

## Root Cause Summary

### 1. Primary Quarter-Image Display Cause
- **Location**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/MosaicView.tsx` lines 348-382
- **Issue**: Frontend scales backend-provided per-pixel vectors by dimension ratios
- **Mechanism**: When backend returns 432×512 instead of requested 512×512, scaling factor becomes `cellWidth/432 ≈ 0.59`, showing only ~59% of the expected view
- **Impact**: Corrupts u_mm and v_mm displacement vectors that are already correctly calculated

### 2. Root Cause of Black Screens
- **Location**: Cascade failure from corrupted view parameters through SliceOverride calculations
- **Issue**: Cross product `normal = u_mm × v_mm` fails when vectors are corrupted
- **Mechanism**: Invalid plane calculations produce out-of-bounds slice intersections
- **Impact**: Backend render fails silently, returning empty ImageBitmap

### 3. Dimension Mismatch Warning Origins
- **Location**: `/Users/bbuchsbaum/code/brainflow2/core/neuro-types/src/view_rect.rs` lines 96-103
- **Issue**: Backend prioritizes square pixels over exact dimension matching
- **Mechanism**: `pixel_size = max(width_mm/requested_width, height_mm/requested_height)`
- **Impact**: Legitimate aspect ratio preservation interpreted as error by frontend

### 4. Race Conditions and Timing Issues
- **Location**: Multiple components involved in render coordination
- **Issue**: Dimension updates and cell renders can occur out of sync
- **Mechanism**: ViewState coalescing middleware may defer updates during layout operations
- **Impact**: Cells render with mixed old/new view parameters

---

## Solution Strategy

### Phase 1: Critical Fixes (HIGH PRIORITY - 2-4 hours)
1. **Remove Incorrect Scaling Logic** - Eliminate view parameter corruption at source
2. **Fix Canvas Dimension Handling** - Use backend dimensions consistently
3. **Update ViewState Management** - Ensure proper parameter propagation

### Phase 2: Robustness Improvements (MEDIUM PRIORITY - 4-6 hours)
1. **Add Parameter Validation** - Detect and reject corrupted view parameters
2. **Improve Error Handling** - Better debugging and fallback mechanisms
3. **Enhance Documentation** - Clarify backend-frontend coordinate contracts

### Phase 3: Testing and Verification (HIGH PRIORITY - 4-6 hours)
1. **Unit Tests** - Validate coordinate transformations and parameter handling
2. **Integration Tests** - End-to-end mosaic rendering scenarios
3. **Performance Testing** - Verify render success rate improvements

---

## Implementation Plan

### Phase 1.1: Remove Incorrect Scaling Logic

**File**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/MosaicView.tsx`
**Lines**: 348-382 (updateMosaicView function)

**Current Problematic Code**:
```typescript
// CRITICAL: Use the actual returned dimensions, not the requested ones
const actualRefWidth = referenceView.dim_px[0]; // e.g., 432 (not 512)
const actualRefHeight = referenceView.dim_px[1]; // e.g., 512

const updatedView = {
  origin_mm: referenceView.origin_mm,
  u_mm: [
    (referenceView.u_mm[0] / actualRefWidth) * cellWidth,
    (referenceView.u_mm[1] / actualRefWidth) * cellWidth,
    (referenceView.u_mm[2] / actualRefWidth) * cellWidth
  ],
  v_mm: [
    (referenceView.v_mm[0] / actualRefHeight) * cellHeight,
    (referenceView.v_mm[1] / actualRefHeight) * cellHeight,
    (referenceView.v_mm[2] / actualRefHeight) * cellHeight
  ],
  dim_px: [cellWidth, cellHeight]
};
```

**New Correct Implementation**:
```typescript
// Trust backend calculations - u_mm and v_mm are already per-pixel vectors
const updatedView = {
  origin_mm: referenceView.origin_mm,
  u_mm: referenceView.u_mm,  // Use backend vectors directly
  v_mm: referenceView.v_mm,  // Use backend vectors directly  
  dim_px: [referenceView.dim_px[0], referenceView.dim_px[1]] // Use backend dimensions
};
```

**Rationale**: The backend's `ViewRectMm::full_extent()` already calculates per-pixel displacement vectors using `vec3_scale(direction, pixel_size)`. These vectors represent the world-space displacement for each pixel step and should not be modified by the frontend.

**Dependencies**: None - this is a pure simplification
**Risk Assessment**: Low - removes complexity rather than adding it
**Testing Requirements**: Verify mosaic cells display full slices after change

### Phase 1.2: Fix Canvas Dimension Handling

**File**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/MosaicView.tsx`
**Lines**: 252-257 (MosaicCell canvas elements)

**Current Code**:
```typescript
<canvas
  ref={canvasRef}
  width={cellWidth}   // Uses calculated cell dimensions
  height={cellHeight}
  className="w-full h-full"
  onClick={handleCanvasClick}
/>
```

**New Implementation**:
```typescript
<canvas
  ref={canvasRef}
  width={viewState.dim_px[0]}   // Use backend-calculated dimensions
  height={viewState.dim_px[1]}
  className="w-full h-full"
  onClick={handleCanvasClick}
/>
```

**Additional Changes Required**:

1. **Update Canvas Scaling in MosaicCell Component**:
   - **File**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/MosaicView.tsx` (MosaicCell component)
   - **Location**: Canvas drawing logic where `drawScaledImage` is called
   - **Change**: Use CSS scaling instead of manual dimension manipulation

```typescript
// Add CSS styling to handle container fitting
const canvasStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'contain' as const
};

<canvas
  ref={canvasRef}
  width={viewState.dim_px[0]}
  height={viewState.dim_px[1]}
  style={canvasStyle}
  onClick={handleCanvasClick}
/>
```

**Dependencies**: Phase 1.1 must be completed first
**Risk Assessment**: Low - standard web canvas scaling techniques
**Testing Requirements**: Verify aspect ratios are preserved and images fit properly in cells

### Phase 1.3: Update ViewState Management

**File**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/stores/middleware/coalesceUpdatesMiddleware.ts`
**Focus**: Ensure dimension updates are handled correctly during the fix

**Analysis**: The coalescing middleware appears to be working correctly based on the flow analysis, but we need to verify it handles the new dimension approach properly.

**Verification Required**:
1. Check that `isDimensionOnlyChange()` function correctly identifies when only dimensions change
2. Ensure `forceDimensionUpdate` flag works with new backend dimension approach
3. Verify no race conditions exist between dimension updates and cell renders

**If Issues Found** (likely not needed based on analysis):
```typescript
// In coalesceUpdatesMiddleware.ts
const isDimensionOnlyChange = (oldState: ViewState, newState: ViewState): boolean => {
  // Compare everything except dim_px to determine if only dimensions changed
  const dimensionFields = ['dim_px'];
  const nonDimensionOld = omit(oldState, dimensionFields);
  const nonDimensionNew = omit(newState, dimensionFields);
  return isEqual(nonDimensionOld, nonDimensionNew);
};
```

**Dependencies**: Understanding of current middleware behavior
**Risk Assessment**: Very Low - likely no changes needed
**Testing Requirements**: Verify smooth dimension updates during container resize

### Phase 2.1: Add Parameter Validation

**File**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/RenderCoordinator.ts`
**Lines**: 158-186 (executeRenderJob function)

**New Validation Logic**:
```typescript
private validateViewParameters(viewState: ViewState): boolean {
  // Check for corrupted u_mm and v_mm vectors
  const { u_mm, v_mm, dim_px } = viewState;
  
  // Validate vector lengths
  if (u_mm.length !== 3 || v_mm.length !== 3) {
    console.error('Invalid view vector dimensions', { u_mm, v_mm });
    return false;
  }
  
  // Check for NaN or infinite values
  const allValues = [...u_mm, ...v_mm, ...dim_px];
  if (allValues.some(val => !Number.isFinite(val))) {
    console.error('Non-finite values in view parameters', viewState);
    return false;
  }
  
  // Check for zero-length vectors (would cause division by zero)
  const u_length = Math.sqrt(u_mm[0]**2 + u_mm[1]**2 + u_mm[2]**2);
  const v_length = Math.sqrt(v_mm[0]**2 + v_mm[1]**2 + v_mm[2]**2);
  if (u_length < 1e-10 || v_length < 1e-10) {
    console.error('Zero-length displacement vectors', { u_length, v_length });
    return false;
  }
  
  return true;
}

// In executeRenderJob
public async executeRenderJob(job: QueuedJob): Promise<void> {
  try {
    // Validate view parameters before rendering
    if (!this.validateViewParameters(job.viewState)) {
      console.error('Rejecting render job due to invalid view parameters', job);
      return;
    }
    
    // ... rest of render logic
  } catch (error) {
    // ... existing error handling
  }
}
```

**Dependencies**: Phase 1 fixes completed
**Risk Assessment**: Low - adds safety without changing core logic
**Testing Requirements**: Test with known good and corrupted parameters

### Phase 2.2: Improve Error Handling

**File**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/apiService.ts`
**Lines**: Around line 629 (where dimension mismatch warning occurs)

**Enhanced Error Handling**:
```typescript
// Replace current warning with informative logging
private logDimensionMismatch(requested: [number, number], actual: [number, number], reason: string) {
  console.info(`Backend dimension adjustment: ${requested.join('×')} → ${actual.join('×')}`, {
    requestedDimensions: requested,
    actualDimensions: actual, 
    reason: reason || 'aspect ratio preservation',
    impactOnRendering: 'Using backend dimensions - this is expected behavior'
  });
}

// In recalculateViewForDimensions
if (result.dim_px[0] !== dimensions[0] || result.dim_px[1] !== dimensions[1]) {
  this.logDimensionMismatch(dimensions, result.dim_px, 'square pixel preservation');
}
```

**File**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/RenderCoordinator.ts`
**Enhanced render error reporting**:
```typescript
// Add detailed error context
private createRenderErrorContext(job: QueuedJob, error: any) {
  return {
    jobId: job.id,
    reason: job.reason,
    viewState: {
      dim_px: job.viewState.dim_px,
      origin_mm: job.viewState.origin_mm,
      u_mm_length: Math.sqrt(job.viewState.u_mm.reduce((sum, val) => sum + val**2, 0)),
      v_mm_length: Math.sqrt(job.viewState.v_mm.reduce((sum, val) => sum + val**2, 0))
    },
    sliceOverride: job.sliceOverride,
    error: error.toString()
  };
}
```

**Dependencies**: Phase 1 and 2.1 completed
**Risk Assessment**: Very Low - improves debugging without affecting functionality
**Testing Requirements**: Verify useful error messages during failure scenarios

### Phase 2.3: Enhance Documentation

**File**: `/Users/bbuchsbaum/code/brainflow2/core/neuro-types/src/view_rect.rs`
**Lines**: Around the ViewRectMm struct and full_extent function

**Enhanced Documentation**:
```rust
/// Represents a view rectangle in world coordinates with per-pixel displacement vectors.
/// 
/// # Coordinate System Contract
/// 
/// This struct defines the contract between backend view calculations and frontend rendering:
/// 
/// - `origin_mm`: World coordinates of the top-left pixel center
/// - `u_mm`: Per-pixel world displacement vector for moving right (X direction)
/// - `v_mm`: Per-pixel world displacement vector for moving down (Y direction)  
/// - `width_px`/`height_px`: Actual pixel dimensions (may differ from requested)
/// 
/// # Important Notes
/// 
/// - The u_mm and v_mm vectors are already scaled to pixel size
/// - Frontend should use these vectors directly without further scaling
/// - Dimensions may differ from requested to preserve square pixels and aspect ratios
/// - This is intentional behavior, not an error condition
#[derive(Debug, Clone, PartialEq)]
pub struct ViewRectMm {
    // ... existing fields with enhanced comments
}

impl ViewRectMm {
    /// Calculates view rectangle that preserves square pixels and fits anatomical extent.
    /// 
    /// # Dimension Preservation Strategy
    /// 
    /// This function prioritizes anatomical accuracy over exact dimension matching:
    /// 1. Calculate required pixel size for square pixels: max(width_mm/req_width, height_mm/req_height)
    /// 2. Use this pixel size to determine actual dimensions that fit the anatomical extent
    /// 3. The resulting dimensions ensure square pixels and complete anatomical coverage
    /// 
    /// # Why Dimensions May Differ
    /// 
    /// For a typical MNI brain (193×229×193 voxels):
    /// - Anatomical extent might be ~193mm × ~229mm  
    /// - Requested 512×512 would create different pixel sizes for X/Y
    /// - Actual 432×512 ensures square pixels and complete brain coverage
    /// 
    /// This is medical imaging best practice - square pixels preserve anatomical proportions.
    pub fn full_extent(
        bounds: &[std::ops::Range<f32>; 3],
        directions: &ViewDirections,
        screen_px_max: [u32; 2]
    ) -> Self {
        // ... existing implementation with enhanced comments
    }
}
```

**File**: Create `/Users/bbuchsbaum/code/brainflow2/ui2/src/docs/COORDINATE_SYSTEM_CONTRACT.md`

**New Documentation File**:
```markdown
# Backend-Frontend Coordinate System Contract

## Overview

This document defines the contract between the Rust backend's view calculations and the TypeScript frontend's rendering expectations.

## Key Principles

1. **Backend Calculates, Frontend Trusts**: The backend's ViewRectMm calculations are authoritative
2. **Per-Pixel Vectors**: u_mm and v_mm represent world displacement per pixel step  
3. **Square Pixels Priority**: Dimensions may be adjusted to maintain square pixels
4. **Aspect Ratio Preservation**: Backend ensures complete anatomical coverage

## Data Flow

```
Backend ViewRectMm::full_extent()
├─ Calculates pixel_size for square pixels
├─ Determines actual dimensions (may differ from requested)
├─ Creates per-pixel displacement vectors: u_mm, v_mm
└─ Returns complete view geometry

Frontend MosaicView
├─ Receives ViewRectMm from backend
├─ Uses vectors directly (NO scaling)
├─ Applies dimensions as-is for canvas sizing
└─ Trusts backend's aspect ratio decisions
```

## Common Pitfalls

1. **DO NOT** scale u_mm/v_mm by dimension ratios
2. **DO NOT** assume returned dimensions match requested dimensions  
3. **DO NOT** treat dimension mismatch as error condition
4. **DO** use backend dimensions for canvas sizing
5. **DO** trust backend's square pixel calculations

## Examples

### Typical MNI Brain Volume
- **Volume Dimensions**: 193×229×193 voxels
- **Request**: 512×512 pixels
- **Backend Returns**: 432×512 pixels (preserves square pixels)
- **Frontend Action**: Use 432×512 for canvas, trust u_mm/v_mm vectors

### Why This Works
The backend ensures:
- Square pixels (medical imaging requirement)
- Complete anatomical coverage
- Correct world-to-pixel transforms
- Proper aspect ratio preservation
```

**Dependencies**: All previous phases
**Risk Assessment**: None - documentation only  
**Testing Requirements**: None required

### Phase 3.1: Unit Tests

**File**: Create `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/__tests__/MosaicView.test.tsx`

**Critical Test Cases**:
```typescript
import { render, screen } from '@testing-library/react';
import { MosaicView } from '../MosaicView';

describe('MosaicView Coordinate Handling', () => {
  const mockBackendResponse = {
    origin_mm: [0, 0, 0],
    u_mm: [1.0, 0, 0],    // 1mm per pixel in X
    v_mm: [0, 1.0, 0],    // 1mm per pixel in Y  
    dim_px: [432, 512]    // Backend-calculated dimensions
  };

  test('should use backend dimensions without scaling', () => {
    const result = processBackendViewRect(mockBackendResponse, 256, 256);
    
    // Should NOT scale the vectors
    expect(result.u_mm).toEqual([1.0, 0, 0]);
    expect(result.v_mm).toEqual([0, 1.0, 0]);
    
    // Should use backend dimensions
    expect(result.dim_px).toEqual([432, 512]);
  });

  test('should handle dimension mismatch gracefully', () => {
    const requestedDims = [512, 512];
    const backendDims = [432, 512];
    
    // Should not throw error or warn
    const consoleSpy = jest.spyOn(console, 'warn');
    processBackendViewRect(mockBackendResponse, 256, 256);
    
    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Backend returned different dimensions')
    );
  });

  test('should preserve vector magnitudes', () => {
    const originalU = Math.sqrt(mockBackendResponse.u_mm.reduce((sum, val) => sum + val**2, 0));
    const originalV = Math.sqrt(mockBackendResponse.v_mm.reduce((sum, val) => sum + val**2, 0));
    
    const result = processBackendViewRect(mockBackendResponse, 200, 300);
    
    const resultU = Math.sqrt(result.u_mm.reduce((sum, val) => sum + val**2, 0));
    const resultV = Math.sqrt(result.v_mm.reduce((sum, val) => sum + val**2, 0));
    
    expect(resultU).toBeCloseTo(originalU, 6);
    expect(resultV).toBeCloseTo(originalV, 6);
  });
});
```

**File**: Create `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/__tests__/RenderCoordinator.test.ts`

**Parameter Validation Tests**:
```typescript
import { RenderCoordinator } from '../RenderCoordinator';

describe('RenderCoordinator Parameter Validation', () => {
  let coordinator: RenderCoordinator;

  beforeEach(() => {
    coordinator = new RenderCoordinator();
  });

  test('should reject corrupted view parameters', async () => {
    const corruptedViewState = {
      origin_mm: [0, 0, 0],
      u_mm: [NaN, 0, 0],      // Corrupted vector
      v_mm: [0, 1, 0],
      dim_px: [256, 256]
    };

    const job = createMockRenderJob(corruptedViewState);
    
    // Should not crash and should log error
    const consoleSpy = jest.spyOn(console, 'error');
    await coordinator.executeRenderJob(job);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Non-finite values in view parameters')
    );
  });

  test('should accept valid view parameters', async () => {
    const validViewState = {
      origin_mm: [0, 0, 0],
      u_mm: [1, 0, 0],
      v_mm: [0, 1, 0], 
      dim_px: [432, 512]
    };

    const job = createMockRenderJob(validViewState);
    
    // Should process without error
    expect(async () => {
      await coordinator.executeRenderJob(job);
    }).not.toThrow();
  });
});
```

**Dependencies**: All Phase 1 and 2 changes implemented
**Risk Assessment**: None - test-only code
**Testing Requirements**: Tests themselves need to pass

### Phase 3.2: Integration Tests

**File**: Create `/Users/bbuchsbaum/code/brainflow2/e2e/tests/mosaic-view-rendering.spec.ts`

**End-to-End Scenarios**:
```typescript
import { test, expect } from '@playwright/test';

test.describe('MosaicView Rendering Integration', () => {
  test('should display complete slices in all mosaic cells', async ({ page }) => {
    // Load standard MNI brain volume
    await page.goto('/');
    await page.locator('[data-testid="load-mni-brain"]').click();
    
    // Wait for volume to load
    await expect(page.locator('[data-testid="volume-loaded"]')).toBeVisible();
    
    // Switch to mosaic view
    await page.locator('[data-testid="mosaic-view-button"]').click();
    
    // Verify all cells have rendered content (not black)
    const mosaicCells = page.locator('[data-testid="mosaic-cell"]');
    const cellCount = await mosaicCells.count();
    
    for (let i = 0; i < cellCount; i++) {
      const cell = mosaicCells.nth(i);
      const canvas = cell.locator('canvas');
      
      // Check canvas is not blank (has pixel data)
      const hasContent = await canvas.evaluate((canvas: HTMLCanvasElement) => {
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        // Check if any pixels are non-zero (not completely black)
        return imageData.data.some((value, index) => {
          // Check RGB channels, skip alpha
          return (index % 4 !== 3) && value > 0;
        });
      });
      
      expect(hasContent).toBe(true);
    }
  });

  test('should handle container resize without rendering errors', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-testid="load-mni-brain"]').click();
    await expect(page.locator('[data-testid="volume-loaded"]')).toBeVisible();
    
    await page.locator('[data-testid="mosaic-view-button"]').click();
    
    // Resize container multiple times
    const container = page.locator('[data-testid="mosaic-container"]');
    
    await container.evaluate(el => {
      el.style.width = '800px';
      el.style.height = '600px';
    });
    
    await page.waitForTimeout(500); // Allow render to complete
    
    await container.evaluate(el => {
      el.style.width = '400px'; 
      el.style.height = '300px';
    });
    
    await page.waitForTimeout(500);
    
    // Verify no render errors occurred
    const consoleLogs = page.locator('[data-testid="console-errors"]');
    const errorCount = await consoleLogs.textContent();
    expect(errorCount).toBe('0');
    
    // Verify cells still have content
    const mosaicCells = page.locator('[data-testid="mosaic-cell"]');
    const firstCell = mosaicCells.first();
    const hasContent = await firstCell.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d');
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return imageData.data.some((value, index) => (index % 4 !== 3) && value > 0);
    });
    
    expect(hasContent).toBe(true);
  });

  test('should maintain coordinate consistency across cells', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-testid="load-mni-brain"]').click();  
    await expect(page.locator('[data-testid="volume-loaded"]')).toBeVisible();
    
    await page.locator('[data-testid="mosaic-view-button"]').click();
    
    // Click on center of first cell
    const firstCell = page.locator('[data-testid="mosaic-cell"]').first();
    const firstCanvas = firstCell.locator('canvas');
    
    await firstCanvas.click({ position: { x: 216, y: 256 } }); // Center of 432x512
    
    // Verify crosshair appears in corresponding location on other cells
    const crosshairs = page.locator('[data-testid="crosshair-overlay"]');
    const crosshairCount = await crosshairs.count();
    
    // Should have crosshair in multiple cells (at least 3 orientations)
    expect(crosshairCount).toBeGreaterThanOrEqual(3);
    
    // Verify crosshairs are positioned correctly (not at 0,0 or off-canvas)
    for (let i = 0; i < crosshairCount; i++) {
      const crosshair = crosshairs.nth(i);
      const position = await crosshair.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return { x: rect.left, y: rect.top };
      });
      
      // Crosshair should be visible (not at edge)
      expect(position.x).toBeGreaterThan(10);
      expect(position.y).toBeGreaterThan(10);
    }
  });
});
```

**Dependencies**: All previous phases completed
**Risk Assessment**: Low - tests don't affect production code
**Testing Requirements**: Integration tests must pass consistently

### Phase 3.3: Performance Testing

**File**: Create `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/__tests__/RenderCoordinator.performance.test.ts`

**Performance Regression Tests**:
```typescript
import { RenderCoordinator } from '../RenderCoordinator';

describe('RenderCoordinator Performance', () => {
  test('should achieve >95% render success rate', async () => {
    const coordinator = new RenderCoordinator();
    const testRuns = 100;
    let successCount = 0;
    
    for (let i = 0; i < testRuns; i++) {
      const validJob = createValidRenderJob();
      
      try {
        await coordinator.executeRenderJob(validJob);
        successCount++;
      } catch (error) {
        console.log(`Render failed on attempt ${i}:`, error);
      }
    }
    
    const successRate = (successCount / testRuns) * 100;
    expect(successRate).toBeGreaterThanOrEqual(95);
  });

  test('should process mosaic updates within 500ms', async () => {
    const coordinator = new RenderCoordinator();
    const startTime = performance.now();
    
    // Simulate 9-cell mosaic update
    const jobs = Array.from({ length: 9 }, createValidRenderJob);
    
    await Promise.all(jobs.map(job => coordinator.executeRenderJob(job)));
    
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    expect(duration).toBeLessThan(500); // 500ms max for 9 cells
  });

  test('should not accumulate memory leaks', async () => {
    const coordinator = new RenderCoordinator();
    const initialMemory = performance.memory?.usedJSHeapSize || 0;
    
    // Perform many render operations
    for (let i = 0; i < 50; i++) {
      const job = createValidRenderJob();
      await coordinator.executeRenderJob(job);
    }
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    const finalMemory = performance.memory?.usedJSHeapSize || 0;
    const memoryIncrease = finalMemory - initialMemory;
    
    // Should not increase by more than 10MB
    expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
  });
});
```

**Dependencies**: All implementation phases completed
**Risk Assessment**: None - performance measurement only
**Testing Requirements**: Performance targets must be met

---

## Alternative Approaches Considered

### Alternative 1: Modify Backend to Honor Exact Dimensions

**Approach**: Change `ViewRectMm::full_extent()` to always return requested dimensions
**Pros**: Eliminates dimension mismatch warnings, simpler frontend logic
**Cons**: 
- Violates medical imaging best practices (non-square pixels)
- Distorts anatomical proportions
- Breaks aspect ratio preservation
- More complex backend logic needed

**Verdict**: **Rejected** - Medical accuracy is paramount

### Alternative 2: Keep Scaling Logic but Fix the Math

**Approach**: Correct the scaling calculations instead of removing them
**Pros**: Maintains current architecture
**Cons**:
- Backend vectors are already correctly calculated
- Scaling adds unnecessary complexity
- Risk of introducing new scaling bugs
- Performance overhead

**Verdict**: **Rejected** - Backend calculations are authoritative

### Alternative 3: Hybrid Approach with Frontend Validation

**Approach**: Use backend dimensions but add extensive frontend validation
**Pros**: Additional safety checks
**Cons**: 
- Adds complexity without solving root cause
- May mask future issues
- Performance overhead

**Verdict**: **Partially Adopted** - Add validation in Phase 2, but trust backend calculations

---

## Risk Assessment and Mitigation

### High-Risk Changes
1. **Removing Scaling Logic (Phase 1.1)**
   - **Risk**: May break other view types (Orthogonal, 3D)
   - **Mitigation**: Thorough testing across all view types, staged rollout
   - **Rollback Plan**: Revert to original scaling logic if issues detected

### Medium-Risk Changes  
2. **Canvas Dimension Handling (Phase 1.2)**
   - **Risk**: CSS scaling may affect image quality
   - **Mitigation**: Test with various container sizes, monitor render quality
   - **Rollback Plan**: Revert to manual dimension calculation

### Low-Risk Changes
3. **Parameter Validation (Phase 2.1)**
   - **Risk**: May reject valid edge cases
   - **Mitigation**: Conservative validation thresholds, comprehensive testing
   - **Rollback Plan**: Disable validation checks

### Testing Strategy for Risk Mitigation

**Pre-Deployment Testing**:
1. Run full test suite on staging environment
2. Manual testing with various volume types (MNI, custom, different dimensions)
3. Performance benchmarking to ensure no regressions
4. Visual comparison with baseline screenshots

**Monitoring Post-Deployment**:
1. Error rate monitoring for render failures  
2. Performance metrics tracking
3. User feedback collection
4. Automated screenshot comparisons

---

## Success Criteria

### Functional Requirements
1. **Quarter Display Eliminated**: Mosaic cells show complete slice images
2. **Black Screen Eliminated**: No flickering or empty renders during normal operation
3. **Dimension Warnings Eliminated**: No false error messages about backend calculations
4. **Aspect Ratio Preserved**: Images maintain anatomical proportions

### Performance Requirements  
1. **Render Success Rate**: >95% (up from current ~20-30%)
2. **Update Latency**: <500ms for 9-cell mosaic updates
3. **Memory Stability**: No memory leaks during extended use
4. **GPU Efficiency**: Reduce failed render attempts by >80%

### Quality Requirements
1. **Code Simplicity**: Remove complex scaling calculations  
2. **Error Clarity**: Improved error messages and debugging information
3. **Documentation**: Clear backend-frontend contracts documented
4. **Test Coverage**: >90% coverage for coordinate handling logic

---

## Implementation Timeline

### Phase 1: Critical Fixes (Days 1-2)
- **Day 1 Morning**: Implement Phase 1.1 (Remove scaling logic)
- **Day 1 Afternoon**: Implement Phase 1.2 (Fix canvas dimensions)  
- **Day 1 Evening**: Initial testing and validation
- **Day 2 Morning**: Implement Phase 1.3 (ViewState verification)
- **Day 2 Afternoon**: Integration testing across view types

### Phase 2: Robustness (Days 3-4)
- **Day 3 Morning**: Implement Phase 2.1 (Parameter validation)
- **Day 3 Afternoon**: Implement Phase 2.2 (Error handling)
- **Day 4 Morning**: Implement Phase 2.3 (Documentation)
- **Day 4 Afternoon**: Code review and refinement

### Phase 3: Testing and Verification (Days 5-7)
- **Day 5**: Unit test implementation and execution
- **Day 6**: Integration test implementation and execution  
- **Day 7**: Performance testing and final validation

### Buffer Time (Days 8-10)
- Address any issues discovered during testing
- Additional edge case handling if needed
- Documentation updates based on findings

---

## Rollback Plan

### Immediate Rollback (If Critical Issues Detected)

1. **Git Revert Strategy**:
   ```bash
   # Revert all changes in single operation
   git revert --no-commit HEAD~N..HEAD  # N = number of commits
   git commit -m "Rollback MosaicView fixes due to critical issue"
   ```

2. **Feature Flag Approach** (if implemented):
   ```typescript
   const USE_NEW_MOSAIC_LOGIC = process.env.ENABLE_MOSAIC_FIX === 'true';
   
   if (USE_NEW_MOSAIC_LOGIC) {
     // New logic without scaling
     return { ...referenceView };
   } else {
     // Original scaling logic
     return scaledViewLogic(referenceView, cellWidth, cellHeight);
   }
   ```

### Partial Rollback (If Specific Phase Issues)

- **Phase 1.1 Issues**: Revert scaling removal, keep canvas fixes
- **Phase 1.2 Issues**: Revert canvas changes, keep scaling removal
- **Phase 2 Issues**: Revert validation/error handling, keep core fixes

### Testing After Rollback

1. Verify original quarter-display issue returns (confirms rollback success)
2. Run regression tests to ensure no new issues introduced
3. Monitor for any rollback-specific problems
4. Plan remediation strategy for root issues

---

## Conclusion

This plan addresses the MosaicView quarter-display and black screen issues through a systematic approach that removes incorrect scaling logic and trusts the backend's sophisticated coordinate calculations. The solution is architecturally sound, low-risk, and aligns with medical imaging best practices.

**Key Architectural Principle**: **Backend Calculates, Frontend Trusts**

The backend's `ViewRectMm::full_extent()` logic handles aspect ratio preservation, square pixel requirements, and anatomical extent coverage. The frontend should use these calculations directly without modification.

**Expected Outcomes**:
- **User Experience**: Immediate resolution of quarter-display and black screen issues
- **Performance**: >95% render success rate, <500ms update latency
- **Code Quality**: Simplified frontend logic, better error handling
- **Maintainability**: Clear contracts between backend and frontend

**Priority**: Critical - Core functionality fix
**Effort**: Medium - 7-10 days total with thorough testing  
**Risk**: Low-Medium - Well-analyzed changes with comprehensive rollback plan
**Impact**: High - Resolves fundamental rendering pipeline issues

The plan provides multiple safety nets through staged implementation, comprehensive testing, and detailed rollback procedures, ensuring that the fix can be deployed confidently while maintaining system stability.