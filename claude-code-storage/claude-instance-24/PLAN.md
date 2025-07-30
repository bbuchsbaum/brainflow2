# MosaicViewPromise UI Parity Implementation Plan

**Plan Date**: 2025-07-29  
**Objective**: Fix MosaicViewPromise "two slices only" bug and achieve complete UI parity with MosaicViewSimple while maintaining promise-based rendering architecture benefits  
**Total Estimated Effort**: 10.5-15.5 hours over 1-2 days  

---

## Executive Summary

### Problem Statement
MosaicViewPromise was designed as a technical proof-of-concept for promise-based rendering but lacks the complete UI framework that MosaicViewSimple provides. The primary issue is a missing CSS class causing grid collapse and a "two slices only" display bug, combined with missing UI controls for axis selection, grid sizing, and navigation.

### Solution Overview
This plan implements a 5-phase approach to transform MosaicViewPromise into a complete UI component while preserving its promise-based rendering architecture benefits:

```
Phase 1: CSS Fix (5 min)          --> Immediate grid display fix
    |                                     
    v                                     
Phase 2: State Management (2-3h)  --> Internal state foundation
    |                                     
    v                                     
Phase 3: UI Controls (3-4h)       --> Complete feature parity
    |                                     
    v                                     
Phase 4: Responsive Sizing (1-2h) --> Dynamic layout support
    |                                     
    v                                     
Phase 5: Shared Components (4-6h) --> Code quality improvement
```

### Key Constraints
- **PRESERVE**: Promise-based rendering architecture (don't regress to event-based)
- **ACHIEVE**: Full UI parity with MosaicViewSimple
- **MINIMIZE**: Code duplication through shared components
- **MAINTAIN**: Principle of least surprise for users switching between implementations

---

## Root Cause Analysis

### Primary Issues Identified

1. **CRITICAL CSS BUG**: Missing `.mosaic-container` class definition in `MosaicView.css`
   - **Impact**: Grid container collapses, showing only 2 slices instead of 16
   - **Root Cause**: MosaicViewPromise uses undefined CSS class
   - **Fix Complexity**: 5 minutes (add CSS definition)

2. **MISSING UI FRAMEWORK**: Incomplete component architecture
   - **Missing**: Axis selector dropdown, grid size selector, rich navigation
   - **Impact**: Users cannot control view configuration
   - **Fix Complexity**: 3-4 hours (port UI controls)

3. **HARDCODED CONFIGURATION**: External dependency on parent component
   - **Issue**: `viewType` and `gridSize` hardcoded in `GoldenLayoutRoot.tsx`
   - **Impact**: No user control, component not self-contained
   - **Fix Complexity**: 2-3 hours (internal state management)

4. **NO RESPONSIVE SIZING**: Missing dynamic layout adaptation
   - **Issue**: No ResizeObserver integration
   - **Impact**: Grid doesn't adapt to container changes
   - **Fix Complexity**: 1-2 hours (port ResizeObserver logic)

---

## Implementation Phases

### Phase 1: CRITICAL CSS Fix
**Duration**: 5 minutes  
**Risk Level**: LOW  
**Dependencies**: None  

#### Objective
Fix the immediate "two slices only" display bug by adding the missing CSS class definition.

#### Files Modified
- `/ui2/src/components/views/MosaicView.css`

#### Technical Implementation
Add the following CSS class definition:

```css
.mosaic-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.mosaic-container .mosaic-grid {
  flex: 1;
  min-height: 0;
}
```

#### Success Criteria
- [ ] 4x4 grid displays all 16 cells instead of 2
- [ ] Container maintains proper height allocation
- [ ] No regression in existing functionality

#### Testing
1. Load mosaic workspace
2. Verify 16 cells visible in 4x4 grid
3. Confirm proper grid layout and spacing

#### Commit Message
```
fix(mosaic): Add missing .mosaic-container CSS class

- Fixes "two slices only" display bug in MosaicViewPromise
- Adds proper flex layout for grid container height management
- Ensures all 16 cells display correctly in 4x4 grid
```

---

### Phase 2: STATE MANAGEMENT Foundation
**Duration**: 2-3 hours  
**Risk Level**: MEDIUM  
**Dependencies**: Phase 1 complete (working grid display)  

#### Objective
Transform MosaicViewPromise from hardcoded external props to internal state management, matching MosaicViewSimple's architecture.

#### Files Modified
- `/ui2/src/components/views/MosaicViewPromise.tsx` (add useState hooks)
- `/ui2/src/components/layout/GoldenLayoutRoot.tsx` (remove hardcoded props)

#### Technical Implementation

**1. Add State Variables to MosaicViewPromise.tsx** (30 min)
```typescript
// Add after existing useState hooks (around line 152)
const [sliceAxis, setSliceAxis] = useState<'axial' | 'sagittal' | 'coronal'>('axial');
const [gridSize, setGridSize] = useState({ rows: 4, cols: 4 });
const [totalSlices, setTotalSlices] = useState(100);
const [cellSize, setCellSize] = useState({ width: 256, height: 256 });
```

**2. Update Component Interface** (15 min)
```typescript
// Remove props from interface
interface MosaicViewPromiseProps {
  // Remove: viewType: 'axial' | 'sagittal' | 'coronal';
  // Remove: gridSize: { rows: number; cols: number };
  // Keep workspaceId if needed for consistency
}

// Update component declaration
export function MosaicViewPromise(/* remove props */) {
```

**3. Update GoldenLayoutRoot.tsx** (15 min)
```typescript
// Change line 52 from:
// return <MosaicViewPromise viewType="axial" gridSize={{ rows: 4, cols: 4 }} />;
// to:
return <MosaicViewPromise />;
```

**4. Update Slice Calculation Logic** (60 min)
- Replace hardcoded `viewType` with `sliceAxis` state
- Replace hardcoded `gridSize` with internal state
- Update slice data generation to use state values
- Ensure promise rendering updates when state changes

**5. Integration Testing** (30 min)
- Verify state changes trigger re-renders
- Test default values work correctly
- Confirm no regressions in rendering

#### Success Criteria
- [ ] Component uses internal state instead of props
- [ ] State changes trigger proper re-renders
- [ ] Default behavior matches previous hardcoded behavior
- [ ] No external dependencies on parent component

#### Risk Mitigation
- Keep old props as optional fallback values during transition
- Test each state variable addition individually
- Maintain backward compatibility during development

#### Commit Message
```
feat(mosaic): Add internal state management to MosaicViewPromise

- Adds 4 new useState hooks for complete self-contained state
- Removes dependency on hardcoded props from GoldenLayoutRoot
- Converts viewType prop to sliceAxis internal state
- Converts gridSize prop to internal state management
- Updates slice calculation logic to use internal state values
```

---

### Phase 3: UI CONTROLS Implementation
**Duration**: 3-4 hours  
**Risk Level**: HIGH  
**Dependencies**: Phase 2 complete (internal state available)  

#### Objective
Add complete UI controls to match MosaicViewSimple functionality: axis selector, grid size selector, and rich navigation.

#### Files Modified
- `/ui2/src/components/views/MosaicViewPromise.tsx` (major header expansion)

#### Technical Implementation

**1. Add Axis Selector Dropdown** (90 min)
Port from MosaicViewSimple lines 238-253:
```typescript
// Add to header section (around line 270)
<div className="flex items-center gap-2">
  <label className="text-sm font-medium">Axis:</label>
  <select 
    value={sliceAxis} 
    onChange={(e) => setSliceAxis(e.target.value as 'axial' | 'sagittal' | 'coronal')}
    className="bg-gray-800 border border-gray-600 text-white px-2 py-1 rounded text-sm"
  >
    <option value="axial">Axial</option>
    <option value="sagittal">Sagittal</option>
    <option value="coronal">Coronal</option>
  </select>
</div>
```

**2. Add Grid Size Selector Dropdown** (90 min)
Port from MosaicViewSimple lines 255-272:
```typescript
<div className="flex items-center gap-2">
  <label className="text-sm font-medium">Grid:</label>
  <select 
    value={`${gridSize.rows}x${gridSize.cols}`}
    onChange={(e) => {
      const [rows, cols] = e.target.value.split('x').map(Number);
      setGridSize({ rows, cols });
    }}
    className="bg-gray-800 border border-gray-600 text-white px-2 py-1 rounded text-sm"
  >
    <option value="2x2">2×2</option>
    <option value="3x3">3×3</option>
    <option value="4x4">4×4</option>
    <option value="5x5">5×5</option>
  </select>
</div>
```

**3. Add Rich Navigation Controls** (60 min)
Port from MosaicViewSimple lines 275-300:
```typescript
// Replace basic text buttons with rich navigation
<div className="flex items-center gap-1">
  <Button
    variant="outline"
    size="sm"
    onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
    disabled={currentPage === 0}
  >
    <ChevronLeft className="h-4 w-4" />
    Previous
  </Button>
  <span className="text-sm px-2">
    Page {currentPage + 1} of {totalPages}
  </span>
  <Button
    variant="outline"
    size="sm"
    onClick={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
    disabled={currentPage >= totalPages - 1}
  >
    Next
    <ChevronRight className="h-4 w-4" />
  </Button>
</div>
```

**4. Integration Testing** (30 min)
- Test each control changes rendering appropriately
- Verify axis changes update slice data
- Confirm grid size changes update layout
- Test navigation buttons work correctly

#### Integration Challenge
**Critical**: Ensure UI state changes trigger promise-based re-renders correctly.

**Solution Strategy**:
- Add useEffect hooks to watch for state changes
- Update slice data generation when axis or grid size changes
- Ensure MosaicCellPromise components re-render with new data
- Maintain promise isolation per cell

#### Success Criteria
- [ ] Axis selector changes slice rendering orientation
- [ ] Grid size selector changes grid layout (2x2, 3x3, 4x4, 5x5)
- [ ] Navigation buttons work with proper disabled states
- [ ] All UI controls match MosaicViewSimple appearance and behavior
- [ ] Promise-based rendering continues to work correctly

#### Commit Message
```
feat(mosaic): Add complete UI controls to MosaicViewPromise

- Adds axis selector dropdown for axial/sagittal/coronal switching
- Adds grid size selector dropdown for 2x2, 3x3, 4x4, 5x5 options
- Adds rich navigation controls with icons and disabled states
- Integrates UI controls with promise-based rendering pipeline
- Achieves UI parity with MosaicViewSimple while maintaining promise architecture
```

---

### Phase 4: RESPONSIVE SIZING
**Duration**: 1-2 hours  
**Risk Level**: LOW  
**Dependencies**: Phase 3 complete (UI controls working)  

#### Objective
Add ResizeObserver integration for dynamic cell sizing and responsive grid layout.

#### Files Modified
- `/ui2/src/components/views/MosaicViewPromise.tsx` (add ResizeObserver logic)

#### Technical Implementation

**1. Port ResizeObserver Logic** (45 min)
Port from MosaicViewSimple lines 130-170:
```typescript
// Add after existing useEffect hooks
const gridRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  if (!gridRef.current) return;

  const updateCellSize = () => {
    if (!gridRef.current) return;
    
    const rect = gridRef.current.getBoundingClientRect();
    const cellWidth = (rect.width - (gridSize.cols - 1) * 4) / gridSize.cols; // 4px gap
    const cellHeight = (rect.height - (gridSize.rows - 1) * 4) / gridSize.rows;
    
    setCellSize({
      width: Math.max(100, Math.floor(cellWidth)),
      height: Math.max(100, Math.floor(cellHeight))
    });
  };

  updateCellSize();

  const observer = new ResizeObserver(updateCellSize);
  observer.observe(gridRef.current);

  return () => observer.disconnect();
}, [gridSize.rows, gridSize.cols]);
```

**2. Integrate with MosaicCellPromise Sizing** (30 min)
- Update grid container to use `gridRef`
- Ensure cell dimensions passed to MosaicCellPromise components
- Test cell sizing updates correctly

**3. Test Responsive Behavior** (15 min)
- Resize browser window and verify grid adapts
- Change grid size and confirm proper recalculation
- Test different aspect ratios

#### Success Criteria
- [ ] Grid adapts to container size changes
- [ ] Cell dimensions calculated correctly for all grid sizes
- [ ] No layout jumping or flashing during resize
- [ ] Performance remains smooth during resize operations

#### Performance Considerations
- Ensure ResizeObserver doesn't interfere with promise rendering
- Debounce resize calculations if needed
- Maintain cell aspect ratios appropriately

#### Commit Message
```
feat(mosaic): Add responsive sizing to MosaicViewPromise

- Adds ResizeObserver integration for dynamic cell sizing
- Implements proper grid dimension calculations for all sizes
- Ensures smooth responsive behavior on container changes
- Maintains cell aspect ratios and minimum sizes
- Integrates seamlessly with existing promise-based rendering
```

---

### Phase 5: SHARED COMPONENTS Extraction
**Duration**: 4-6 hours  
**Risk Level**: HIGH  
**Dependencies**: Phase 4 complete (full UI parity achieved)  

#### Objective
Extract common UI components to eliminate code duplication between MosaicViewSimple and MosaicViewPromise implementations.

#### Files Created
- `/ui2/src/components/mosaic/shared/MosaicHeader.tsx`
- `/ui2/src/components/mosaic/shared/AxisSelector.tsx`
- `/ui2/src/components/mosaic/shared/GridSizeSelector.tsx`
- `/ui2/src/components/mosaic/shared/MosaicNavigation.tsx`

#### Files Modified
- `/ui2/src/components/views/MosaicViewSimple.tsx` (use shared components)
- `/ui2/src/components/views/MosaicViewPromise.tsx` (use shared components)

#### Technical Implementation

**1. Extract MosaicHeader Component** (2 hours)
```typescript
// /ui2/src/components/mosaic/shared/MosaicHeader.tsx
interface MosaicHeaderProps {
  title: string;
  sliceAxis: 'axial' | 'sagittal' | 'coronal';
  onAxisChange: (axis: 'axial' | 'sagittal' | 'coronal') => void;
  gridSize: { rows: number; cols: number };
  onGridSizeChange: (size: { rows: number; cols: number }) => void;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function MosaicHeader({ ... }: MosaicHeaderProps) {
  // Consolidated header implementation
}
```

**2. Extract AxisSelector Component** (1 hour)
```typescript
// /ui2/src/components/mosaic/shared/AxisSelector.tsx
interface AxisSelectorProps {
  value: 'axial' | 'sagittal' | 'coronal';
  onChange: (axis: 'axial' | 'sagittal' | 'coronal') => void;
}

export function AxisSelector({ value, onChange }: AxisSelectorProps) {
  // Axis selection dropdown implementation
}
```

**3. Extract GridSizeSelector Component** (1 hour)
```typescript
// /ui2/src/components/mosaic/shared/GridSizeSelector.tsx
interface GridSizeSelectorProps {
  value: { rows: number; cols: number };
  onChange: (size: { rows: number; cols: number }) => void;
}

export function GridSizeSelector({ value, onChange }: GridSizeSelectorProps) {
  // Grid size selection dropdown implementation
}
```

**4. Extract MosaicNavigation Component** (1 hour)
```typescript
// /ui2/src/components/mosaic/shared/MosaicNavigation.tsx
interface MosaicNavigationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function MosaicNavigation({ ... }: MosaicNavigationProps) {
  // Navigation buttons implementation
}
```

#### Implementation Strategy
- **Extract one component at a time**
- **Test after each extraction**
- **Maintain backwards compatibility**
- **Make components configurable via props**
- **Update both implementations to use shared components**

#### Risk Mitigation
- **Phase-by-phase extraction**: Don't extract all components at once
- **Maintain API compatibility**: Ensure shared components work with both architectures
- **Comprehensive testing**: Test both MosaicViewSimple and MosaicViewPromise after each extraction
- **Rollback capability**: Each component extraction should be a separate commit

#### Success Criteria
- [ ] No code duplication between MosaicViewSimple and MosaicViewPromise
- [ ] Both implementations use identical UI components
- [ ] Shared components are reusable and well-documented
- [ ] No regression in functionality for either implementation
- [ ] Code maintenance overhead significantly reduced

#### Commit Message
```
refactor(mosaic): Extract shared components to eliminate duplication

- Extracts MosaicHeader, AxisSelector, GridSizeSelector, MosaicNavigation
- Creates /ui2/src/components/mosaic/shared/ directory structure
- Updates both MosaicViewSimple and MosaicViewPromise to use shared components
- Eliminates ~150 lines of duplicated UI code
- Improves maintainability and consistency between implementations
```

---

## Technical Architecture Strategy

### Promise-Based Rendering Preservation

**Core Principle**: Maintain the promise-based rendering architecture throughout all phases.

```
Current Architecture (Preserve):
Component State Change
    ↓
Individual cell re-renders
    ↓
useRenderSession per cell
    ↓
Direct promise-based rendering
    ↓
Independent canvas updates
```

**Benefits to Maintain**:
- Clean isolation between cells
- Direct promise returns without event filtering
- Individual error handling per cell
- Built-in performance tracking per session

### State Management Architecture

**Phase 2 Target State**:
```typescript
// Internal state management (matching MosaicViewSimple pattern)
const [sliceAxis, setSliceAxis] = useState<'axial' | 'sagittal' | 'coronal'>('axial');
const [currentPage, setCurrentPage] = useState(0);
const [gridSize, setGridSize] = useState({ rows: 4, cols: 4 });
const [totalSlices, setTotalSlices] = useState(100);
const [cellSize, setCellSize] = useState({ width: 256, height: 256 });
```

**State Flow Pattern**:
```
User Interaction → State Update → Slice Data Recalculation → Promise Re-renders
```

### Component Integration Strategy

**UI Controls → Promise Rendering Integration**:
1. **State Changes**: UI controls update component state
2. **Effect Triggers**: useEffect hooks watch for state changes
3. **Data Recalculation**: Slice positions and indices recalculated
4. **Promise Updates**: MosaicCellPromise components receive new props
5. **Individual Renders**: Each cell renders independently via promise

**Critical Integration Points**:
- Axis changes must update slice calculation axis
- Grid size changes must recalculate cell layout
- Navigation changes must update visible slice range
- All changes must preserve promise isolation

---

## CSS and Layout Strategy

### Immediate CSS Fix (Phase 1)

**Problem**: Missing `.mosaic-container` class causing grid collapse

**Solution**: Add proper flex layout definition
```css
.mosaic-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.mosaic-container .mosaic-grid {
  flex: 1;
  min-height: 0;
}
```

### Layout Hierarchy Target
```
.mosaic-container (height: 100%, flex column)
    ↓
Header (flex-shrink: 0)
    ↓
Grid Container (flex: 1, overflow: auto)
    ↓
CSS Grid with dynamic template
    ↓
Individual cells with calculated dimensions
```

### Responsive Layout Strategy

**Grid Calculation Algorithm**:
```typescript
const cellWidth = (containerWidth - (gridSize.cols - 1) * gap) / gridSize.cols;
const cellHeight = (containerHeight - (gridSize.rows - 1) * gap) / gridSize.rows;
```

**ResizeObserver Integration**:
- Monitor container size changes
- Recalculate cell dimensions
- Update cellSize state
- Trigger cell re-renders with new dimensions

---

## Testing and Validation Strategy

### Phase-by-Phase Testing

**Phase 1: CSS Fix Validation**
- [ ] Load mosaic workspace
- [ ] Verify 16 cells visible in 4x4 grid layout
- [ ] Confirm proper container height allocation
- [ ] Test grid spacing and alignment

**Phase 2: State Management Validation**
- [ ] Verify internal state initialization
- [ ] Test state changes trigger re-renders
- [ ] Confirm default behavior matches previous version
- [ ] Test component works without external props

**Phase 3: UI Controls Validation**
- [ ] Test axis selector changes rendering orientation
- [ ] Verify grid size selector updates layout correctly
- [ ] Test navigation buttons with proper disabled states
- [ ] Confirm UI matches MosaicViewSimple appearance

**Phase 4: Responsive Sizing Validation**
- [ ] Resize browser window, verify grid adapts
- [ ] Change grid sizes, confirm proper recalculation
- [ ] Test performance during resize operations
- [ ] Verify no layout jumping or flashing

**Phase 5: Shared Components Validation**
- [ ] Test both implementations use shared components
- [ ] Verify no regression in either implementation
- [ ] Confirm code duplication eliminated
- [ ] Test component reusability and documentation

### Regression Testing Checklist

**Core Functionality**:
- [ ] Promise-based rendering continues to work
- [ ] Individual cell isolation maintained
- [ ] Error handling per cell preserved
- [ ] Performance tracking functionality intact

**User Experience**:
- [ ] All UI controls respond immediately
- [ ] Grid displays correct number of cells
- [ ] Navigation works across all grid sizes
- [ ] Responsive behavior smooth and predictable

**Performance**:
- [ ] No performance degradation from UI additions
- [ ] ResizeObserver doesn't impact rendering
- [ ] Promise rendering remains efficient
- [ ] Memory usage stable during interactions

---

## Risk Mitigation Matrix

### HIGH RISK: Phase 3 - UI Controls Integration

**Risk**: UI controls may not integrate properly with promise-based rendering
**Impact**: Broken functionality, user experience degradation
**Mitigation Strategy**:
- Build incrementally, test each control separately
- Use existing MosaicViewSimple code as reference
- Test promise rendering updates after each UI addition
- Maintain separate branches for rollback capability

**Warning Signs**:
- UI controls don't trigger re-renders
- Promise rendering breaks or becomes inconsistent
- Performance degradation during UI interactions

**Contingency Plan**:
- Roll back to Phase 2 if integration fails
- Consider alternative state update patterns
- Implement temporary UI/rendering bridge if needed

### MEDIUM RISK: Phase 5 - Shared Component Extraction

**Risk**: Extracting shared components may break both implementations
**Impact**: Both MosaicView implementations could be affected
**Mitigation Strategy**:
- Extract one component at a time
- Test both implementations after each extraction
- Maintain backward compatibility during transition
- Use feature flags if needed

**Warning Signs**:
- Regressions in either implementation
- Components don't work with both architectures
- Increased coupling between implementations

**Contingency Plan**:
- Complete one implementation at a time
- Keep original code as backup until extraction complete
- Consider partial extraction if full extraction problematic

### LOW RISK: Phases 1, 2, 4

**Risk Level**: Minimal - well-defined changes with clear success criteria
**Mitigation**: Follow exact procedures, test immediately after changes

---

## Timeline and Execution Strategy

### Development Schedule

```
Day 1:
├── Phase 1: CSS Fix (5 min)
├── Phase 2: State Management (2-3 hours)
└── Phase 3 Start: Axis Selector (1.5 hours)

Day 2:
├── Phase 3 Complete: Grid + Navigation (1.5-2.5 hours)
├── Phase 4: Responsive Sizing (1-2 hours)
└── Phase 5 Start: Component Extraction (2-3 hours)

Optional Day 3:
└── Phase 5 Complete: Shared Components (remaining time)
```

### Execution Priorities

**IMMEDIATE (Phase 1)**:
- Fix "two slices only" bug with CSS addition
- Validate grid displays all cells correctly

**HIGH PRIORITY (Phases 2-3)**:
- Establish internal state management foundation
- Add UI controls for user configuration

**MEDIUM PRIORITY (Phase 4)**:
- Implement responsive sizing for better UX

**LOW PRIORITY (Phase 5)**:
- Extract shared components for code quality
- Can be deferred if time constraints exist

### Commit Strategy

**Commit After Each Phase**:
```bash
# Phase 1
git add ui2/src/components/views/MosaicView.css
git commit -m "fix(mosaic): Add missing .mosaic-container CSS class"

# Phase 2  
git add ui2/src/components/views/MosaicViewPromise.tsx ui2/src/components/layout/GoldenLayoutRoot.tsx
git commit -m "feat(mosaic): Add internal state management to MosaicViewPromise"

# Phase 3
git add ui2/src/components/views/MosaicViewPromise.tsx
git commit -m "feat(mosaic): Add complete UI controls to MosaicViewPromise"

# Phase 4
git add ui2/src/components/views/MosaicViewPromise.tsx  
git commit -m "feat(mosaic): Add responsive sizing to MosaicViewPromise"

# Phase 5
git add ui2/src/components/mosaic/shared/ ui2/src/components/views/
git commit -m "refactor(mosaic): Extract shared components to eliminate duplication"
```

---

## Success Metrics

### Functional Parity Checklist

**UI Controls**:
- [ ] Axis selector dropdown with 3 options (axial, sagittal, coronal)
- [ ] Grid size selector dropdown with 4 options (2x2, 3x3, 4x4, 5x5)
- [ ] Rich navigation with icons and proper disabled states
- [ ] All controls respond immediately to user interaction

**Grid Display**:
- [ ] Displays correct number of cells for selected grid size
- [ ] Grid adapts properly to container size changes
- [ ] Cell spacing and alignment matches MosaicViewSimple
- [ ] No visual glitches or layout jumping

**User Experience**:
- [ ] No distinguishable difference from MosaicViewSimple for end users
- [ ] All interactions work identically to MosaicViewSimple
- [ ] Performance remains smooth during all operations
- [ ] Error handling maintains per-cell isolation

**Technical Architecture**:
- [ ] Promise-based rendering architecture preserved
- [ ] Component is self-contained with internal state
- [ ] No code duplication between implementations (Phase 5)
- [ ] Shared components are reusable and well-documented (Phase 5)

### Performance Validation

**Rendering Performance**:
- No degradation in promise-based rendering speed
- ResizeObserver doesn't impact rendering performance
- UI interactions remain responsive under load

**Memory Usage**:
- Stable memory usage during extended operation
- No memory leaks from new UI components
- Promise session cleanup continues to work correctly

---

## Long-term Architecture Considerations

### Future Enhancement Opportunities

**Post-Implementation Optimizations**:
1. **Batch Rendering Coordination**: Consider hybrid approach combining promise benefits with batch rendering efficiency
2. **Shared Rendering Sessions**: Explore sharing sessions between related cells
3. **Performance Monitoring**: Add metrics collection for promise rendering performance
4. **Error Recovery**: Implement graceful degradation when promise rendering fails

### Deprecation Strategy

**MosaicViewSimple Lifecycle**:
- After Phase 4 completion, MosaicViewPromise achieves full parity
- Phase 5 creates shared components benefiting both implementations  
- Future consideration: Deprecate MosaicViewSimple once MosaicViewPromise proven stable
- Migration path: Update GoldenLayoutRoot to use MosaicViewPromise by default

### Maintenance Strategy

**Code Organization**:
- Shared components in `/ui2/src/components/mosaic/shared/`
- Clear documentation for architectural differences
- Comprehensive test coverage for both implementations
- Regular performance monitoring and optimization

---

## Implementation Readiness

### Prerequisites Met
- [ ] Investigation reports completed and analyzed
- [ ] Technical requirements clearly defined
- [ ] Risk mitigation strategies established
- [ ] Timeline and resource allocation planned

### Next Actions
1. **Begin Phase 1**: Add missing CSS class to fix immediate bug
2. **Validate Fix**: Confirm grid displays all cells correctly
3. **Proceed with Phase 2**: Begin state management foundation
4. **Follow systematic approach**: Complete each phase before proceeding to next

### Development Environment Requirements
- **Tauri Development Server**: `cargo tauri dev`
- **File Access**: Write permissions to `/ui2/src/components/views/` directory
- **Testing Capability**: Ability to load mosaic workspace for validation
- **Version Control**: Git access for phase-by-phase commits

---

**Plan Status**: ✅ COMPLETE  
**Ready for Implementation**: ✅ YES  
**Risk Assessment**: ✅ ACCEPTABLE with mitigation strategies  
**Expected Outcome**: MosaicViewPromise with complete UI parity while maintaining promise-based architecture benefits