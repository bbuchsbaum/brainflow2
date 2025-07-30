# MosaicViewPromise vs MosaicViewSimple Investigation Report

**Investigation Date**: 2025-07-29  
**Investigator**: Claude Code Investigator  
**Issue**: MosaicViewPromise lacks UI features and shows only two slices compared to MosaicViewSimple

## Executive Summary

**Root Cause**: MosaicViewPromise was designed as a technical proof-of-concept for promise-based rendering architecture, but lacks the complete UI framework that MosaicViewSimple provides. The "two slices only" issue is caused by a missing CSS class definition that causes container collapse.

**Confidence Level**: Very High (based on analysis of 6 core files with concrete code evidence)

---

## Key Findings

### 1. MISSING UI FRAMEWORK (Primary Issue)

MosaicViewPromise is architecturally incomplete and missing critical UI components:

#### Missing Components in MosaicViewPromise:
- **Grid Size Selector**: No dropdown for 2x2, 3x3, 4x4, 5x5 grid options
- **Axis Selector**: No dropdown for axial/sagittal/coronal view selection
- **Rich Navigation Controls**: Basic text buttons vs styled navigation with icons
- **Responsive Cell Sizing**: No ResizeObserver for dynamic cell sizing
- **Complete Header Framework**: Minimal header vs comprehensive control panel

#### Evidence:
- **MosaicViewSimple**: Lines 228-301 contain comprehensive header with all controls
- **MosaicViewPromise**: Lines 260-283 contain only basic header with navigation buttons
- **MosaicViewSimple**: Lines 255-272 implement grid size dropdown
- **MosaicViewPromise**: Line 151 uses hardcoded `gridSize = { rows: 4, cols: 4 }`

### 2. CSS LAYOUT PROBLEMS (Secondary Issue - Causes "Two Slices" Bug)

#### Critical Missing CSS Class:
- **MosaicViewPromise** uses `className="mosaic-container"` (line 259)
- **MosaicView.css** does NOT define `.mosaic-container` class
- **Result**: Container collapses, hiding most grid cells

#### Container Structure Differences:
- **MosaicViewSimple**: Uses `.mosaic-view` class with proper flex layout and height management
- **MosaicViewPromise**: Uses undefined `.mosaic-container` class with basic div structure

#### Layout Hierarchy:
```
MosaicViewSimple:  Full height container → header → flex-1 grid (takes remaining space)
MosaicViewPromise: Basic container → header → grid (no height management)
```

### 3. HARDCODED CONFIGURATION (Tertiary Issue)

#### External Configuration Dependencies:
- **viewType**: Hardcoded as "axial" in `/ui2/src/components/layout/GoldenLayoutRoot.tsx` (line 52)
- **gridSize**: Hardcoded as `{ rows: 4, cols: 4 }` with no UI controls
- **No Internal State**: MosaicViewPromise has no useState hooks for UI controls

#### State Management Comparison:
- **MosaicViewSimple**: Self-contained with internal state for all UI controls
- **MosaicViewPromise**: Minimal state, relies entirely on external props

### 4. "TWO SLICES ONLY" TECHNICAL BUG

#### Root Cause Analysis:
The combination of missing `mosaic-container` CSS class + complex slice calculations causes display issues:

1. **Container Collapse**: Without CSS height definition, grid container collapses
2. **Slice Calculation**: Complex world position calculations vs simple index mapping
3. **Rendering Sessions**: Individual cell isolation may prevent full grid display

#### Slice Data Generation Differences:
- **MosaicViewSimple** (lines 109-122): Simple iteration over slice indices
- **MosaicViewPromise** (lines 208-235): Complex calculation using `normalizedPosition = i / (sliceMetadata.sliceCount - 1)`

---

## Technical Specifications

### Component Size Comparison:
- **MosaicViewSimple**: 337 lines with complete UI framework
- **MosaicViewPromise**: 305 lines with minimal UI wrapper
- **Missing UI Components**: ~150 lines of header controls and state management

### Architecture Differences:
- **MosaicViewSimple**: Event-driven rendering via MosaicRenderService + RenderCell
- **MosaicViewPromise**: Promise-based rendering via useRenderSession hook

### CSS Class Status:
```css
/* Defined in MosaicView.css */
.mosaic-view ✓     (used by MosaicViewSimple)
.mosaic-grid ✓     (used by both)
.mosaic-cell ✓     (used by both)
.mosaic-container ✗ (used by MosaicViewPromise - MISSING!)
```

---

## Files Examined

1. `/ui2/src/components/views/MosaicViewSimple.tsx` - Complete UI implementation
2. `/ui2/src/components/views/MosaicViewPromise.tsx` - Promise-based implementation
3. `/ui2/src/components/views/MosaicView.css` - Shared styles (missing .mosaic-container)
4. `/ui2/src/components/layout/GoldenLayoutRoot.tsx` - Parent component with hardcoded props
5. `/ui2/src/components/views/RenderCell.tsx` - Event-driven cell component
6. `/ui2/src/hooks/useRenderSession.ts` - Promise-based rendering hook

---

## Evidence of Design Intent

Comments in MosaicViewPromise header (lines 2-13) reveal the technical focus:
- "promise-based rendering instead of event-based rendering"
- "eliminates the brittleness from event filtering"
- "cleaner isolation"

This confirms MosaicViewPromise was designed for **technical architecture improvement**, not **UI feature completeness**.

---

## Expert Analysis Summary

The expert analysis validates our findings and provides additional insights:

1. **CSS Fix is Critical**: Missing `.mosaic-container` class causes grid collapse - this is the immediate cause of "two slices only"
2. **Slice Logic Issue**: When `sliceMetadata.sliceCount < gridSize.rows * gridSize.cols`, cells return null and don't render
3. **Minimal Path Forward**: Add CSS class, extract shared header component, move state up to parent level

---

## Recommended Solutions

### Immediate Fix (5 minutes):
Add to `MosaicView.css`:
```css
.mosaic-container { 
  display: flex; 
  flex-direction: column; 
  height: 100%; 
  overflow: hidden; 
}
```

### Complete Solution (phased approach):
1. **Step 1**: Fix CSS layout (immediate)
2. **Step 2**: Extract shared HeaderControls component
3. **Step 3**: Move state management to parent (GoldenLayoutRoot)
4. **Step 4**: Add responsive sizing logic
5. **Step 5**: Unify rendering architectures

---

## Conclusion

MosaicViewPromise represents a successful technical architecture improvement (promise-based rendering) but was never intended as a complete UI replacement. The "two slices only" issue is primarily a CSS layout problem that can be fixed immediately, while the missing UI features require architectural changes to bring it to feature parity with MosaicViewSimple.

**Next Actions**:
1. Apply CSS fix to restore full grid display
2. Plan phased UI enhancement to match MosaicViewSimple features
3. Consider deprecating MosaicViewSimple once MosaicViewPromise reaches parity

---

**Investigation Status**: ✅ COMPLETE  
**Confidence Level**: 🔴 VERY HIGH  
**Actionable Solutions**: ✅ PROVIDED