# COMPREHENSIVE PLAN TO FIX IMAGE DISPLAY ISSUE IN FLEXIBLEORTHOGONALVIEW

## EXECUTIVE SUMMARY

The investigation has identified a critical runtime error in FlexibleOrthogonalView.tsx where `useViewStateStore` is used without being imported. This causes component mounting failure, preventing the slice views from registering event listeners and displaying images. Additionally, the ViewToolbar introduction may have created layout issues affecting canvas dimensions.

## ROOT CAUSE ANALYSIS

### Primary Issue
- **Missing Import**: `useViewStateStore` is called at line 90 in FlexibleOrthogonalView.tsx without being imported
- **Impact**: JavaScript runtime error prevents entire component tree from mounting
- **Result**: No SliceView components mount → No event listeners registered → No images displayed

### Secondary Issues
- **Layout Changes**: ViewToolbar addition changed flex structure
- **Symptom**: Only coronal view (bottom-right) sometimes renders, suggesting axial and sagittal have 0 dimensions
- **CSS Flex**: Missing `min-h-0` on flex containers can cause overflow issues

## IMPLEMENTATION PLAN

### PHASE 1 - CRITICAL FIX (IMMEDIATE PRIORITY)

**Objective**: Fix the runtime error blocking all functionality

**File**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/FlexibleOrthogonalView.tsx`

**Changes**:
1. Add missing import at line 5 (with other imports):
```typescript
import { useViewStateStore } from '@/stores/viewStateStore';
```

**Impact**: This single change will:
- Eliminate the runtime error
- Allow component tree to mount properly
- Enable SliceView components to register event listeners
- Restore basic image display functionality

**Verification**:
- No console errors on load
- At least one view displays an image

---

### PHASE 2 - LAYOUT STABILITY IMPROVEMENTS

**Objective**: Ensure all three views have proper dimensions

**File 1**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/FlexibleOrthogonalView.tsx`

**Changes** (lines 103-108):
1. Line 104 - Add flex-shrink-0 to ViewToolbar:
```tsx
<ViewToolbar className="flex-shrink-0" />
```

2. Line 105 - Update flex container with min-h-0 and overflow-hidden:
```tsx
<div className="flex-1 min-h-0 overflow-hidden">
```

**File 2**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/FlexibleOrthogonalView.css`

**Add CSS safeguards**:
```css
.split-view-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  overflow: hidden;
}

.split-view-container > div:last-child {
  min-height: 0; /* Critical for proper flex sizing */
}
```

**Rationale**: 
- `flex-shrink-0` prevents toolbar from being compressed
- `min-h-0` allows flex children to shrink below their content size
- `overflow-hidden` prevents content from breaking layout

---

### PHASE 3 - DEFENSIVE PROGRAMMING & ERROR HANDLING

**Objective**: Add resilience to prevent future issues

**File 1**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/SliceView.tsx`

**Add dimension validation** (after line 300 in redrawCanvasImpl):
```typescript
// Validate canvas dimensions before drawing
if (!canvas.width || !canvas.height) {
  console.warn(`SliceView ${viewId}: Canvas has zero dimensions, skipping draw`);
  return;
}
```

**File 2**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/FlexibleSlicePanel.tsx`

**Add minimum dimension check** (after line 100):
```typescript
// Check for minimum viable dimensions
if (dimensions.width < 10 || dimensions.height < 10) {
  console.warn(`FlexibleSlicePanel: Dimensions too small (${dimensions.width}x${dimensions.height})`);
  return (
    <div className="flex items-center justify-center h-full text-gray-500">
      View too small
    </div>
  );
}
```

**File 3**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/ErrorBoundary.tsx` (NEW FILE)

```typescript
import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-4 text-red-500">
          <h2>Something went wrong</h2>
          <pre className="text-xs">{this.state.error?.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
```

**File 4**: Update App.tsx to wrap FlexibleOrthogonalView with ErrorBoundary

---

### PHASE 4 - VERIFICATION & TESTING PROCEDURES

**Objective**: Comprehensive validation of all fixes

#### 1. Console Error Check
- Open browser DevTools before loading app
- Check for errors on initial load
- Load a .nii file and check for errors
- **Expected**: No errors, especially no "useViewStateStore is not defined"

#### 2. DOM Inspection
- In DevTools Elements tab, locate canvas elements
- Check computed styles for width/height
- **Expected**: All three canvases have non-zero dimensions
- **Path**: `.split-view-container > div > .allotment-module canvas`

#### 3. Event Flow Validation
- Enable debug logging: `localStorage.debug = 'brainflow:*'`
- Reload app and load a file
- **Expected logs**:
  - "render.complete" events for axial, sagittal, coronal
  - "SliceView redrawing canvas" for each view
  - No "Canvas has zero dimensions" warnings

#### 4. Visual Validation
- ✓ All three orthogonal views display brain images
- ✓ Images are centered and scaled appropriately
- ✓ Crosshair appears at expected position
- ✓ Resizing window maintains proper layout

#### 5. Regression Testing
- Test toolbar functionality (zoom, contrast controls)
- Test mouse interactions (click to move crosshair)
- Test window resizing at various sizes
- Test loading multiple files sequentially

---

### PHASE 5 - PREVENTION & LONG-TERM QUALITY

**Objective**: Prevent similar issues in the future

**File 1**: `/Users/bbuchsbaum/code/brainflow2/.eslintrc.json`

Add rules to catch missing imports:
```json
{
  "rules": {
    "no-undef": "error",
    "react-hooks/exhaustive-deps": "error"
  }
}
```

**File 2**: `/Users/bbuchsbaum/code/brainflow2/tsconfig.json`

Enable stricter TypeScript checking:
```json
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitAny": true
  }
}
```

**Additional Measures**:
- Add pre-commit hooks for linting
- Create unit tests for view components
- Document critical dependencies

---

## IMPLEMENTATION SEQUENCE

```
┌─────────────────┐
│   PHASE 1       │
│ Critical Import │ ← START HERE (Blocks everything else)
│     Fix         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Verify Fix    │ ← Check if this alone resolves issue
│  (Quick Test)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   PHASE 2       │
│ Layout Fixes    │ ← Only if views still don't render
│  (If needed)    │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│        PHASE 3 & 5              │
│ Defensive Code & Prevention     │ ← Can be done in parallel
│    (Quality improvements)       │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────┐
│   PHASE 4       │
│ Full Testing    │ ← Final validation
│  & Validation   │
└─────────────────┘
```

## RISK MITIGATION

### Potential Issues & Solutions

1. **Import fix doesn't resolve display issue**
   - Solution: Proceed immediately to Phase 2 layout fixes
   - Debug: Check canvas dimensions in DOM

2. **Layout changes break existing functionality**
   - Solution: Test incrementally, one CSS change at a time
   - Rollback: Remove min-h-0 if it causes issues

3. **Error boundary interferes with hot reloading**
   - Solution: Disable ErrorBoundary in development mode
   - Alternative: Use React DevTools to debug

## SUCCESS CRITERIA

The fix is considered successful when:
1. No JavaScript errors in console
2. All three views (axial, sagittal, coronal) display images
3. Images maintain proper aspect ratio and centering
4. Toolbar functions work correctly
5. Window resizing maintains layout integrity
6. No regression in existing functionality

## QUICK START

For immediate fix, just add this one line to FlexibleOrthogonalView.tsx:

```typescript
import { useViewStateStore } from '@/stores/viewStateStore';
```

This should resolve the primary issue. If problems persist, continue with Phase 2.