# UI2 Architecture Flow Analysis Report

## Executive Summary

This report traces the execution paths and dependencies for the four critical architectural flows identified in the investigation report. The analysis reveals complex interconnected systems with multiple dual sources of truth, creating significant risk for race conditions, data corruption, and UI inconsistencies.

**Key Finding**: The architecture exhibits a **spider web of interdependencies** where single user actions trigger cascading updates across multiple stores, services, and components, with numerous potential failure points and synchronization issues.

---

## Flow 1: Layer Visibility State Management

### Complete Flow Path

```
USER INTERACTION (Checkbox Click)
    ↓
LayerPanel.tsx:toggleVisibility() [Lines 68-81]
    ↓
LayerService.toggleVisibility() [LayerService.ts:109-115]
    ↓
BRANCHES INTO TWO PARALLEL PATHS:

PATH A (Immediate UI Update):
LayerService.patchLayer() [LayerService.ts:94-104]
    ↓ (requestAnimationFrame batching)
LayerService.flushPatches() [LayerService.ts:152-173]
    ↓
Backend API call (api.patchLayerRender)
    ↓
EventBus.emit('layer.patched') [LayerService.ts:164]

PATH B (Event-based Update):
EventBus.emit('layer.visibility') [LayerService.ts:114]
    ↓
StoreSyncService listener [StoreSyncService.ts:81-94]
    ↓
ViewStateStore.setViewState() [StoreSyncService.ts:82-93]
    ↓
Coalescing Middleware triggered
    ↓
Backend render update
```

### Files Involved
- `/ui2/src/components/panels/LayerPanel.tsx` (Lines 68-81)
- `/ui2/src/services/LayerService.ts` (Lines 109-115, 94-104, 152-173)
- `/ui2/src/services/StoreSyncService.ts` (Lines 81-94)
- `/ui2/src/stores/viewStateStore.ts` (Lines 99-118, setViewState)
- `/ui2/src/stores/layerStore.ts` (Lines 267-283, updateLayerRender)

### Potential Race Conditions
1. **Double Update Race**: LayerService.patchLayer() and StoreSyncService both update different stores simultaneously
2. **Backend Sync Race**: Backend render update may complete before layer.patched event is processed
3. **Visibility Derivation Conflict**: `layer.visible` boolean vs `opacity > 0` derivation can get out of sync

### Problematic Edge Cases
- User rapidly clicks visibility checkbox → Multiple overlapping async operations
- Backend update fails → ViewState and LayerStore become inconsistent
- Component unmounts during async operation → Event handlers called on disposed components

---

## Flow 2: Crosshair Position Updates

### Complete Flow Path

```
USER INTERACTION (Mouse Click on Canvas)
    ↓
SliceView.handleMouseClick() [SliceView.tsx:238-289]
    ↓
CoordinateTransform.screenToWorld() [SliceView.tsx:278]
    ↓
ViewStateStore.setCrosshair() [SliceView.tsx:284]
    ↓
BRANCHES INTO MULTIPLE PARALLEL PATHS:

PATH A (ViewState Update):
ViewStateStore.setCrosshair() [viewStateStore.ts:163-262]
    ↓
Waits for pending resizes [viewStateStore.ts:177-188]
    ↓
Updates crosshair.world_mm [viewStateStore.ts:192-198]
    ↓
Optional: Updates view origins [viewStateStore.ts:200-250]
    ↓
Coalescing Middleware → Backend

PATH B (Event Emission):
EventBus.emit('mouse.worldCoordinate') [SliceView.tsx:313]
    ↓
StatusBar components update hover display

PATH C (Crosshair Redraw):
useEffect trigger on crosshair change [SliceView.tsx:428-437]
    ↓
requestAnimationFrame(redrawCanvas) [SliceView.tsx:431-435]
    ↓
renderCrosshairRef.current() [SliceView.tsx:109-157]
```

### Files Involved
- `/ui2/src/components/views/SliceView.tsx` (Lines 238-289, 313, 428-437)
- `/ui2/src/stores/viewStateStore.ts` (Lines 163-262)
- `/ui2/src/utils/coordinates.ts` (CoordinateTransform.screenToWorld)
- `/ui2/src/utils/crosshairUtils.ts` (drawCrosshair, transformCrosshairCoordinates)
- `/ui2/src/stores/middleware/coalesceUpdatesMiddleware.ts` (Backend sync)

### Synchronization Points with Conflicts
1. **Resize vs Crosshair Race**: setCrosshair waits for resizes, but multiple views may resize simultaneously
2. **Canvas Redraw Conflicts**: Multiple requestAnimationFrame calls can queue conflicting redraws
3. **Coordinate Transform Precision**: Float precision errors accumulate across multiple transforms

### Race Condition Scenarios
- User clicks rapidly → Multiple setCrosshair calls queued behind resize operations
- View dimensions change during crosshair update → Coordinate transforms use stale view geometry
- Backend crosshair update returns before frontend redraw → Visual lag creates user confusion

---

## Flow 3: Time Navigation Flow

### Complete Flow Path

```
USER INTERACTION (Time Slider Drag)
    ↓
TimeSlider.handleScrub() [TimeSlider.tsx:62-75]
    ↓
SPLITS INTO IMMEDIATE + THROTTLED PATHS:

PATH A (Immediate UI Feedback):
setLocalTimepoint(value) [TimeSlider.tsx:71]
    ↓
Component re-renders with local override [TimeSlider.tsx:108]

PATH B (Throttled Backend Update):
throttledSetTimepoint() [TimeSlider.tsx:37-43]
    ↓
TimeNavigationService.setTimepoint() [TimeNavigationService.ts:77-96]
    ↓
ViewStateStore.setViewState() [TimeNavigationService.ts:87-89]
    ↓
BRANCHES INTO MULTIPLE PATHS:

PATH B1 (Store Updates):
ViewState.timepoint updated [TimeNavigationService.ts:88]
    ↓
Coalescing Middleware → Backend render update

PATH B2 (Event Emission):
EventBus.emit('time.changed') [TimeNavigationService.ts:92-95]
    ↓
Components listening for time changes update

PATH B3 (Local State Cleanup):
setLocalTimepoint(null) [TimeSlider.tsx:40]
    ↓
Component re-renders without override
```

### Files Involved
- `/ui2/src/components/ui/TimeSlider.tsx` (Lines 62-75, 37-43, 27-29)
- `/ui2/src/services/TimeNavigationService.ts` (Lines 77-96)
- `/ui2/src/stores/viewStateStore.ts` (setViewState implementation)
- `/ui2/src/hooks/useTimeNavigation.ts` (wrapper around service)
- `/ui2/src/stores/layerStore.ts` (timeSeriesInfo, currentTimepoint fields)

### State Synchronization Issues
1. **Triple Time State**:
   - `ViewStateStore.viewState.timepoint` (global)
   - `LayerStore.layers[].currentTimepoint` (per-layer)  
   - `TimeSlider.localTimepoint` (UI override)

2. **Throttling Conflicts**: 16ms throttle can cause UI lag vs backend updates
3. **Layer-Specific vs Global**: Unclear which takes precedence when layers have different timepoints

### Race Condition Scenarios
- User drags slider rapidly → localTimepoint and backend timepoint get out of sync
- Multiple 4D volumes loaded → Conflicting timepoint states per layer
- Component unmounts during throttled update → setState called on unmounted component

---

## Flow 4: File Loading State Management

### Complete Flow Path

```
USER INTERACTION (File Drop on SliceView)
    ↓
SliceView.handleDrop() [SliceView.tsx:559-581]
    ↓
FileLoadingService.loadDroppedFile() [Import at SliceView.tsx:568-569]
    ↓
COMPLEX MULTI-STEP LOADING FLOW:

STEP 1 (File Processing):
FileLoadingService processes file
    ↓
Backend file loading API calls
    ↓
Volume handle creation

STEP 2 (Layer Creation):
LayerService.addLayer() [LayerService.ts:36-51]
    ↓
Backend API call
    ↓
EventBus.emit('layer.added') [LayerService.ts:41]

STEP 3 (Store Synchronization):
StoreSyncService.layer.added listener [StoreSyncService.ts:45-68]
    ↓
BRANCHES INTO MULTIPLE PARALLEL UPDATES:

PATH A (LayerStore Update):
LayerStore.addLayer() [layerStore.ts:149-185]
    ↓
Creates default render properties [layerStore.ts:161-169]
    ↓
Auto-selects layer if first [layerStore.ts:172-175]

PATH B (ViewState Update):
StoreSyncService.convertToViewLayer() [StoreSyncService.ts:21-41]
    ↓
ViewStateStore.setViewState() [StoreSyncService.ts:56-59]
    ↓
Adds layer to viewState.layers

PATH C (Metadata Processing):
LayerStore.setLayerMetadata() [layerStore.ts:337-344]
    ↓
EventBus.emit('layer.metadata.updated') [layerStore.ts:343]

PATH D (Crosshair Centering):
StoreSyncService checks for first layer [StoreSyncService.ts:62-67]
    ↓
ViewStateStore.setCrosshair() [StoreSyncService.ts:65]
    ↓
Triggers Flow 2 (Crosshair Updates)
```

### Files Involved
- `/ui2/src/components/views/SliceView.tsx` (Lines 559-581)
- `/ui2/src/services/FileLoadingService.ts` (loadDroppedFile method)
- `/ui2/src/services/LayerService.ts` (Lines 36-51)
- `/ui2/src/services/StoreSyncService.ts` (Lines 21-68)
- `/ui2/src/stores/layerStore.ts` (Lines 149-185, 337-344)
- `/ui2/src/stores/viewStateStore.ts` (setViewState, setCrosshair)

### Critical Race Conditions
1. **Metadata vs Render Race**: Default render properties created before metadata available
2. **Multi-Store Update Race**: LayerStore and ViewStateStore updated in parallel
3. **Crosshair Centering Race**: setCrosshair may fire before view dimensions are established

### Failure Points
- File loading fails → Inconsistent loading states across components
- Backend layer creation succeeds but frontend add fails → Orphaned backend resources
- Multiple files dropped simultaneously → Overlapping async operations

---

## Cross-Flow Interaction Analysis

### Flow Interaction Matrix

| Flow 1 (Visibility) | Flow 2 (Crosshair) | Flow 3 (Time) | Flow 4 (Loading) |
|---------------------|---------------------|---------------|------------------|
| **Visibility ↔ Crosshair**: Crosshair rendering depends on layer visibility | **Crosshair ↔ Time**: Time changes trigger crosshair-linked renders | **Time ↔ Loading**: New 4D volumes affect time navigation | **Loading ↔ Visibility**: New layers default to visible |
| **Visibility ↔ Time**: 4D layers need visibility for time nav | **Crosshair ↔ Loading**: Loading centers crosshair on first layer | **Time ↔ Visibility**: Time changes only affect visible layers | **Loading ↔ Crosshair**: First layer centers crosshair |

### Cascade Failure Scenarios

1. **The "Loading Storm"**: User drops multiple files → Flow 4 triggers multiple instances → Each triggers Flow 2 (crosshair centering) → Crosshair position oscillates → Flow 1 (visibility) races with loading states

2. **The "Time-Visibility Deadlock"**: User changes timepoint while toggling layer visibility → Time update waits for coalescing → Visibility update waits for backend → Backend queues conflict with each other

3. **The "Crosshair Precision Drift"**: Rapid mouse clicks trigger Flow 2 → Coordinate transforms accumulate errors → Meanwhile Flow 3 time changes → View geometry recalculates → Crosshair position becomes inconsistent

---

## Root Cause Analysis

### Architectural Anti-Patterns Identified

1. **Multiple Sources of Truth**:
   - Layer render properties: `layerStore.layerRender` + `viewStateStore.layers[]`
   - Time state: `viewState.timepoint` + `layer.currentTimepoint` + `TimeSlider.localTimepoint`
   - Crosshair state: `viewState.crosshair` + `StatusBar` display + canvas render state

2. **Event-Driven Chaos**:
   - 15+ different event types flowing through EventBus
   - Circular event dependencies (A emits → B listens → B emits → A listens)
   - No event ordering guarantees

3. **Async Operation Races**:
   - Backend API calls with no coordination
   - requestAnimationFrame batching conflicts
   - Throttled vs immediate update races

4. **State Synchronization Complexity**:
   - StoreSyncService attempts to keep 2+ stores in sync
   - Coalescing middleware adds another async layer
   - No atomic transaction support

### Performance Impact

1. **Unnecessary Re-renders**: Single user action triggers 5-10 component re-renders
2. **Backend Request Flooding**: Rapid interactions create dozens of queued API calls
3. **Memory Leaks**: Event listeners not properly cleaned up during component unmount
4. **CPU Waste**: Redundant coordinate transformations and canvas redraws

---

## Sequence Diagrams

### Flow 1 Sequence: Layer Visibility Toggle
```
User        LayerPanel    LayerService    StoreSyncService    LayerStore    ViewStateStore    Backend
|              |              |               |                 |             |               |
|─click────────>|              |               |                 |             |               |
|              |─toggle──────>|               |                 |             |               |
|              |              |─patchLayer────>|                 |             |               |
|              |              |─emit('vis')───>|─────listen─────>|             |               |
|              |              |               |                 |             |─setViewState─>|
|              |              |─flushPatches──>|                 |             |               |─render─>|
|              |              |               |                 |─updateRender>|               |
|              |<─────────────|<──────────────|<────────────────|             |               |<───────|
|<─────────────|              |               |                 |             |               |
```

### Flow 2 Sequence: Crosshair Position Update
```
User        SliceView    CoordTransform    ViewStateStore    Coalescing    Backend    Canvas
|              |              |               |                 |           |          |
|─click────────>|              |               |                 |           |          |
|              |─screenToWorld>|               |                 |           |          |
|              |<─────────────|               |                 |           |          |
|              |─setCrosshair─>|               |                 |           |          |
|              |              |─setViewState─>|                 |           |          |
|              |              |               |─────queue──────>|           |          |
|              |              |               |                 |─batch────>|          |
|              |─redrawCanvas─>|               |                 |           |          |─draw─>|
|<─────────────|              |               |                 |           |          |
```

---

## Risk Assessment

### Critical Risk Areas (Immediate Action Required)

1. **Layer Visibility State** - **CRITICAL**
   - **Impact**: Data corruption, user confusion
   - **Likelihood**: High (user frequently toggles visibility)
   - **Files**: LayerPanel.tsx, LayerService.ts, StoreSyncService.ts

2. **File Loading Race Conditions** - **HIGH**
   - **Impact**: Failed loads, inconsistent state
   - **Likelihood**: Medium (users drop multiple files)
   - **Files**: SliceView.tsx, FileLoadingService.ts, StoreSyncService.ts

### Moderate Risk Areas

3. **Crosshair Synchronization** - **MODERATE**
   - **Impact**: Visual inconsistency, precision loss
   - **Likelihood**: Medium (coordinate precision errors accumulate)
   - **Files**: SliceView.tsx, viewStateStore.ts

4. **Time Navigation Conflicts** - **MODERATE**
   - **Impact**: UI lag, incorrect timepoint display
   - **Likelihood**: Low (fewer users have 4D data)
   - **Files**: TimeSlider.tsx, TimeNavigationService.ts

---

## Recommendations

### Phase 1: Critical Fixes (Weeks 1-2)

1. **Eliminate Dual Sources of Truth**:
   - **Action**: Choose ViewStateStore as single source for layer render properties
   - **Remove**: `layerStore.layerRender` Map entirely
   - **Update**: All components to read from `viewStateStore.viewState.layers`

2. **Consolidate Event Handling**:
   - **Action**: Replace EventBus with direct store subscriptions where possible
   - **Remove**: StoreSyncService event listeners
   - **Add**: Zustand subscriptions for cross-store sync

3. **Fix File Loading Race Conditions**:
   - **Action**: Add mutex/semaphore for file loading operations
   - **Queue**: Sequential file processing instead of parallel
   - **Validate**: State consistency after each load operation

### Phase 2: Architectural Improvements (Weeks 3-4)

4. **Implement State Transactions**:
   - **Add**: Atomic update mechanism for multi-store operations
   - **Ensure**: All-or-nothing state updates
   - **Rollback**: Failed operations restore previous state

5. **Optimize Async Operations**:
   - **Debounce**: Rapid user interactions (crosshair, sliders)
   - **Cancel**: In-flight operations when new ones start
   - **Coordinate**: Backend API calls to prevent conflicts

6. **Add State Validation**:
   - **Runtime**: Consistency checks between stores
   - **Logging**: State transition audit trail
   - **Recovery**: Automatic repair of inconsistent state

### Phase 3: Long-term Architecture (Weeks 5-8)

7. **Redesign Store Architecture**:
   - **Single**: Central state store with domain slices
   - **Immutable**: State updates via reducers only
   - **Predictable**: Unidirectional data flow

8. **Implement Proper Error Boundaries**:
   - **Isolate**: Store update failures
   - **Graceful**: Degradation of functionality
   - **Recovery**: User-initiated state reset

---

## Prevention Strategies

### Code Review Guidelines
1. **Check**: Any PR adding new state must justify why existing stores can't be used
2. **Verify**: Event emissions have corresponding listeners and cleanup
3. **Ensure**: Async operations have timeout and error handling
4. **Validate**: State updates are atomic and consistent

### Development Tools
1. **ESLint Rules**: Detect dual state patterns
2. **Testing**: Integration tests for cross-flow interactions
3. **Monitoring**: Runtime state consistency validation
4. **Documentation**: State ownership responsibility matrix

### Architecture Enforcement
1. **ADR**: Architectural Decision Records for all state decisions
2. **Refactoring**: Regular debt payment cycles
3. **Metrics**: Track state complexity and update frequency
4. **Training**: Team education on state management patterns

---

## Conclusion

The UI2 architecture exhibits a **highly complex web of interdependencies** that creates significant risk for user-facing bugs and data corruption. The four analyzed flows demonstrate how single user actions cascade through multiple systems, with numerous failure points and race conditions.

**The most critical issue is the dual source of truth for layer rendering properties**, which directly parallels the histogram bug pattern and should be addressed immediately. The other flows, while individually manageable, interact in ways that compound the complexity and create unexpected failure modes.

**Immediate action is required** to prevent user data loss and maintain application stability. The recommended three-phase approach balances critical fixes with long-term architectural improvements to create a more maintainable and reliable system.

**Success metrics** for these improvements should include:
- Elimination of all dual state patterns
- Reduction in cross-component re-renders by >50%
- Zero race condition reports in user testing
- Sub-100ms response time for all UI interactions

The current architecture represents a **technical debt crisis** that will only worsen without systematic intervention. However, with focused effort on the identified flows and recommended architectural changes, the system can be restored to a maintainable and reliable state.