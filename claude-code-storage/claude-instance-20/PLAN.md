# MosaicView JSON Parsing Error - Comprehensive Fix Plan

## 1. Problem Summary

The MosaicView component is failing with a JSON deserialization error when attempting batch rendering. The root cause is a type mismatch in the `threshold` field:

- **Frontend sends**: `threshold: [0, 0]` (array format)
- **Backend expects**: `threshold: null` or `threshold: { mode: ThresholdMode, range: [f32, f32] }`

The error occurs at JSON column 403 during deserialization in the Rust backend, specifically when parsing the first layer's threshold field.

## 2. Solution Options

### Option A: Fix in MosaicView Component (Recommended)
**Description**: Update MosaicView.tsx to create layers with the correct threshold format.

**Pros**:
- Simple, targeted fix
- Addresses the issue at its source
- Minimal code changes required
- Maintains consistency with other view components

**Cons**:
- Only fixes this specific component
- Doesn't prevent similar issues in other components

### Option B: Fix in API Service Transformation
**Description**: Ensure the apiService transformation properly handles all threshold formats.

**Pros**:
- Centralizes the fix in one location
- Could handle multiple incorrect formats

**Cons**:
- The transformation already sets `threshold: null` correctly
- The issue is that MosaicView's format bypasses or overrides the transformation
- More complex to ensure all edge cases are handled

### Option C: Make Backend Accept Array Format
**Description**: Update Rust deserialization to accept `[f32, f32]` arrays and convert them.

**Pros**:
- Most flexible solution
- Maintains backward compatibility

**Cons**:
- Adds complexity to the backend
- Violates the principle of having a single correct format
- Could mask other data format issues

### Option D: Comprehensive Type Safety (Long-term)
**Description**: Create shared TypeScript types that exactly match Rust structures.

**Pros**:
- Prevents future type mismatches
- Compile-time safety
- Self-documenting code

**Cons**:
- Requires significant refactoring
- Not an immediate fix

## 3. Recommended Solution

**Primary Fix**: Option A - Fix in MosaicView Component
**Long-term Enhancement**: Option D - Implement comprehensive type safety

The recommended approach is to fix the immediate issue in MosaicView while planning for better type safety to prevent similar issues in the future.

## 4. Implementation Plan

### Phase 1: Immediate Fix (Option A)

#### Step 1: Update MosaicView Layer Creation
**File**: `/ui2/src/components/views/MosaicView.tsx`
**Line**: 299
**Change**:
```typescript
// FROM:
threshold: [0, 0],  // default threshold

// TO:
threshold: null,  // No thresholding
```

#### Step 2: Verify API Service Transformation
**File**: `/ui2/src/services/apiService.ts`
**Action**: Confirm that the transformation at line 847 is being applied correctly
**Verification**: Add temporary logging to ensure transformed layers have `threshold: null`

#### Step 3: Update Any Related Layer Creation Code
**Files to check**:
- Search for other instances of `threshold:` array assignments in the codebase
- Ensure all layer creation follows the same pattern

### Phase 2: Type Safety Implementation (Option D)

#### Step 1: Create Shared Type Definitions
**New File**: `/packages/api/src/types/ViewState.ts`
```typescript
export interface ThresholdConfig {
  mode: 'Range' | 'Percentile';
  range: [number, number];
}

export interface LayerConfig {
  volume_id: string;
  opacity: number;
  colormap_id: number;
  blend_mode: 'Normal' | 'Additive';
  intensity_window: [number, number];
  threshold: ThresholdConfig | null;
  visible: boolean;
}

export interface ViewState {
  views: ViewDict;
  crosshair: CrosshairState;
  layers: LayerConfig[];
}
```

#### Step 2: Generate TypeScript Types from Rust
**Action**: Use existing `cargo xtask ts-bindings` infrastructure to generate types
**Files to update**:
- `/core/bridge_types/src/lib.rs` - Ensure types are properly exported
- `/packages/api/src/generated/` - Verify generated types match Rust exactly

#### Step 3: Create Layer Factory Function
**New File**: `/ui2/src/utils/layerFactory.ts`
```typescript
import { LayerConfig } from '@brainflow/api';

export function createLayerConfig(params: {
  id: string;
  volumeId: string;
  opacity?: number;
  colormap?: string;
  intensity?: [number, number];
  threshold?: ThresholdConfig | null;
  visible?: boolean;
}): LayerConfig {
  return {
    volume_id: params.volumeId,
    opacity: params.opacity ?? 1.0,
    colormap_id: colormapNameToId(params.colormap || 'gray'),
    blend_mode: 'Normal',
    intensity_window: params.intensity || [0, 100],
    threshold: params.threshold ?? null,
    visible: params.visible ?? true
  };
}
```

#### Step 4: Update All Components to Use Factory
**Files to update**:
- `/ui2/src/components/views/MosaicView.tsx`
- `/ui2/src/components/views/OrthogonalViewContainer.tsx`
- Any other components creating layer configurations

## 5. Testing Strategy

### Unit Tests

#### Test 1: MosaicView Layer Creation
**File**: `/ui2/src/components/views/__tests__/MosaicView.test.tsx`
```typescript
describe('MosaicView layer creation', () => {
  it('should create layers with null threshold', () => {
    const viewStates = buildViewStates(mockLayers, mockRequests);
    viewStates.forEach(state => {
      state.layers.forEach(layer => {
        expect(layer.threshold).toBeNull();
      });
    });
  });
});
```

#### Test 2: API Service Transformation
**File**: `/ui2/src/services/__tests__/apiService.test.ts`
```typescript
describe('batchRenderSlices transformation', () => {
  it('should transform frontend threshold format to backend format', () => {
    const frontendState = {
      layers: [{ threshold: [0, 0], ...otherProps }]
    };
    const result = apiService.batchRenderSlices([frontendState], 256, 256);
    // Verify the JSON contains threshold: null
  });
});
```

### Integration Tests

#### Test 1: E2E Mosaic Rendering
**File**: `/e2e/tests/mosaic-view.spec.ts`
```typescript
test('mosaic view renders without JSON errors', async ({ page }) => {
  // Load a volume
  await loadTestVolume(page);
  
  // Open mosaic view
  await page.click('[data-testid="mosaic-view-button"]');
  
  // Verify no console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  
  // Wait for rendering
  await page.waitForTimeout(1000);
  
  // Assert no JSON parsing errors
  expect(consoleErrors).not.toContain(expect.stringMatching(/Failed to parse view states JSON/));
});
```

#### Test 2: Manual Testing Checklist
1. Launch application with `cargo tauri dev`
2. Load a test volume
3. Open MosaicView
4. Verify slices render correctly
5. Check console for any JSON parsing errors
6. Test with different layer configurations (opacity, colormap changes)
7. Verify threshold controls work if implemented

### Regression Testing
1. Ensure other view types still work (OrthogonalView, LightboxView)
2. Verify layer visibility toggles work
3. Test colormap and intensity adjustments
4. Confirm no performance degradation

## 6. Implementation Timeline

1. **Immediate Fix (1-2 hours)**
   - Update MosaicView.tsx
   - Test the fix
   - Verify no regressions

2. **Type Safety Implementation (4-6 hours)**
   - Create type definitions
   - Implement layer factory
   - Update all components
   - Write comprehensive tests

3. **Testing & Validation (2-3 hours)**
   - Run all unit tests
   - Perform manual testing
   - Update E2E tests
   - Document changes

## 7. Risk Mitigation

1. **Backup Current State**: Create a git branch before making changes
2. **Incremental Changes**: Apply the immediate fix first, test thoroughly before proceeding
3. **Monitor for Side Effects**: Watch for any changes in other view components
4. **Rollback Plan**: Keep the fix minimal to allow easy reversion if needed

## 8. Success Criteria

1. MosaicView renders without JSON parsing errors
2. All existing functionality remains intact
3. Unit tests pass for layer creation
4. E2E tests pass for mosaic rendering
5. No performance degradation observed
6. Code follows established patterns and conventions

## 9. Future Improvements

1. **Automated Type Generation**: Enhance `cargo xtask ts-bindings` to generate more comprehensive types
2. **Runtime Validation**: Add validation layer before JSON serialization
3. **Better Error Messages**: Provide more context when type mismatches occur
4. **Type Guards**: Implement TypeScript type guards for runtime type checking
5. **Documentation**: Update developer documentation with correct layer creation patterns