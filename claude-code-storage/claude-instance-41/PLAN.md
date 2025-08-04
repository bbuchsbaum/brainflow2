# UI2 Architecture Simplification Plan

## Executive Summary

This plan addresses the **critical architectural debt** identified in the investigation and flow reports. The primary focus is **eliminating dual sources of truth** that caused the histogram bug and create ongoing risk of data corruption and UI inconsistencies.

The plan prioritizes **surgical fixes over architectural rewrites**, focusing on the highest-impact, lowest-complexity changes first. All changes aim to **simplify rather than add complexity**.

---

## Risk-Based Priority Matrix

| Issue | Risk Level | User Impact | Fix Complexity | Priority |
|--------|------------|-------------|----------------|----------|
| Layer Render Properties Dual State | **CRITICAL** | Data Loss | High | **P0** |
| File Loading Race Conditions | **HIGH** | App Crashes | Medium | **P1** |
| Crosshair State Fragmentation | **MODERATE** | Visual Bugs | Low | **P2** |
| Time Navigation State Split | **MODERATE** | UI Lag | Medium | **P3** |
| Event Bus Circular Dependencies | **LOW** | Performance | Low | **P4** |

---

## Phase 1: Critical Fixes (Week 1-2)

### P0: Eliminate Layer Render Properties Dual State

**Problem**: Layer rendering properties exist in both `layerStore.layerRender` and `viewStateStore.viewState.layers`, creating the exact pattern that caused the histogram bug.

**Solution**: Make `viewStateStore` the single source of truth for ALL layer render properties.

#### Files to Change:
1. **Remove from LayerStore** - `/ui2/src/stores/layerStore.ts`
   - Delete `layerRender: Map<string, LayerRender>` (Line ~35)
   - Delete `updateLayerRender()` method (Lines 267-283)
   - Delete `getLayerRender()` method (Lines ~290)
   - Keep only `layers: LayerInfo[]` for metadata

2. **Update LayerPanel** - `/ui2/src/components/panels/LayerPanel.tsx`
   - **BEFORE**: Complex dual-store merge logic (Lines 45-66)
   - **AFTER**: Single read from `viewStateStore.viewState.layers`
   ```typescript
   // Delete lines 45-66 (complex merge logic)
   // Replace with:
   const viewStateLayers = useViewStateStore(state => state.viewState.layers);
   const selectedRender = viewStateLayers.find(l => l.id === selectedLayerId);
   ```

3. **Update LayerService** - `/ui2/src/services/LayerService.ts`
   - Remove `patchLayer()` method that updates layerStore (Lines 94-104)
   - Direct all updates to `viewStateStore.setViewState()`
   - Remove dual-path updates in `toggleVisibility()` (Lines 109-115)

4. **Delete StoreSyncService** - `/ui2/src/services/StoreSyncService.ts`
   - **ENTIRE FILE DELETION** (259 lines)
   - Remove all imports of StoreSyncService from other files
   - Remove StoreSyncService initialization from `/ui2/src/hooks/useServicesInit.ts`

#### Migration Strategy:
1. **Data Migration**: Copy existing `layerRender` data to `viewState.layers` on app startup
2. **Gradual Migration**: Update components one by one to read from viewStateStore
3. **Testing**: After each component update, verify layer properties work correctly
4. **Cleanup**: Remove layerStore render properties only after all components migrated

#### Risk Mitigation:
- **Backup**: Export current layer state before migration
- **Rollback**: Keep old code in git branch for quick revert if needed
- **Testing**: Test every layer operation (visibility, opacity, intensity) after changes

### P1: Fix File Loading Race Conditions

**Problem**: Multiple files dropped simultaneously trigger overlapping async operations that create inconsistent state.

**Solution**: Add file loading queue with sequential processing.

#### Files to Change:
1. **Update SliceView** - `/ui2/src/components/views/SliceView.tsx`
   - **BEFORE**: Direct call to `FileLoadingService.loadDroppedFile()` (Lines 568-569)
   - **AFTER**: Queue file for sequential processing
   ```typescript
   // Replace handleDrop logic:
   const handleDrop = async (event: DragEvent) => {
     event.preventDefault();
     const files = Array.from(event.dataTransfer?.files || []);
     await FileLoadingService.queueFiles(files); // Sequential processing
   };
   ```

2. **Update FileLoadingService** - `/ui2/src/services/FileLoadingService.ts`
   - Add file loading queue
   - Add mutex to prevent concurrent loads
   - Add loading state tracking
   ```typescript
   private loadingQueue: File[] = [];
   private isLoading = false;
   
   async queueFiles(files: File[]) {
     this.loadingQueue.push(...files);
     if (!this.isLoading) {
       await this.processQueue();
     }
   }
   
   private async processQueue() {
     this.isLoading = true;
     while (this.loadingQueue.length > 0) {
       const file = this.loadingQueue.shift()!;
       await this.loadDroppedFile(file);
     }
     this.isLoading = false;
   }
   ```

3. **Add Loading State** - `/ui2/src/stores/layerStore.ts`
   - Add `loadingFiles: string[]` to track files being loaded
   - Add loading state methods
   ```typescript
   loadingFiles: [] as string[],
   
   setFileLoading: (filename: string) => set(state => ({
     loadingFiles: [...state.loadingFiles, filename]
   })),
   
   setFileLoaded: (filename: string) => set(state => ({
     loadingFiles: state.loadingFiles.filter(f => f !== filename)
   }))
   ```

#### Risk Mitigation:
- **Error Handling**: Failed file loads don't block queue processing
- **User Feedback**: Show loading spinner for queued files
- **Timeout**: Add 30-second timeout per file to prevent infinite hangs

---

## Phase 2: Moderate Fixes (Week 3)

### P2: Consolidate Crosshair State

**Problem**: Crosshair state exists in `viewStateStore`, `CrosshairService`, and `statusBarStore`.

**Solution**: Make `viewStateStore` the single source, remove other copies.

#### Files to Change:
1. **Remove CrosshairService State** - `/ui2/src/services/CrosshairService.ts` (if exists)
   - Remove internal `crosshairState` property
   - Make service stateless, only coordinate between stores
   - All operations read/write directly to viewStateStore

2. **Update StatusBar** - `/ui2/src/components/ui/StatusBar.tsx`
   - **BEFORE**: Reading from `statusBarStore.values.crosshair`
   - **AFTER**: Subscribe directly to `viewStateStore.crosshair`
   ```typescript
   const crosshair = useViewStateStore(state => state.viewState.crosshair);
   const crosshairDisplay = `(${crosshair.world_mm.map(v => v.toFixed(1)).join(', ')})`;
   ```

3. **Simplify statusBarStore** - `/ui2/src/stores/statusBarStore.ts` (if exists)
   - Remove `crosshair` from values object
   - Remove crosshair update logic
   - Keep only truly status-bar-specific data

#### Migration Strategy:
- **Single Commit**: This change is simple enough to do atomically
- **Testing**: Verify crosshair position updates in status bar after clicks

### P3: Clarify Time Navigation Ownership

**Problem**: Time state exists in three places: `viewState.timepoint`, `layer.currentTimepoint`, and `TimeSlider.localTimepoint`.

**Solution**: Define clear ownership hierarchy.

#### Ownership Rules:
1. **Global Timepoint**: `viewStateStore.viewState.timepoint` - applies to ALL layers
2. **Layer Metadata**: `layerStore.layers[].timeSeriesInfo` - READ-ONLY metadata only
3. **UI Performance**: `TimeSlider.localTimepoint` - temporary override during dragging only

#### Files to Change:
1. **Update TimeNavigationService** - `/ui2/src/services/TimeNavigationService.ts`
   - Remove complex fallback logic (Lines ~135-139)
   - Always read from `viewStateStore.viewState.timepoint`
   - Remove per-layer timepoint logic
   ```typescript
   // BEFORE: Complex fallback
   const currentTimepoint = viewState.timepoint || layers[0]?.currentTimepoint || 0;
   
   // AFTER: Simple single source
   const currentTimepoint = viewState.timepoint || 0;
   ```

2. **Update LayerStore** - `/ui2/src/stores/layerStore.ts`
   - Remove `currentTimepoint` from layer objects
   - Keep only `timeSeriesInfo` metadata
   - Document that this is READ-ONLY metadata

3. **Document TimeSlider Logic** - `/ui2/src/components/ui/TimeSlider.tsx`
   - Add clear comments explaining local override pattern
   - Add timeout to clear local state if backend update fails
   ```typescript
   // Local override for smooth UI during dragging
   // Falls back to viewState.timepoint after throttled update
   const [localTimepoint, setLocalTimepoint] = useState<number | null>(null);
   
   // Clear local override after 1 second if backend update doesn't come back
   useEffect(() => {
     if (localTimepoint !== null) {
       const timeout = setTimeout(() => setLocalTimepoint(null), 1000);
       return () => clearTimeout(timeout);
     }
   }, [localTimepoint]);
   ```

---

## Phase 3: Cleanup (Week 4)

### P4: Reduce Event Bus Complexity

**Problem**: 15+ event types with circular dependencies and unclear lifecycle.

**Solution**: Replace event patterns with direct store subscriptions where possible.

#### Files to Change:
1. **Replace Event Listeners** - Various components
   - **BEFORE**: `EventBus.on('layer.added', callback)`
   - **AFTER**: `useLayerStore.subscribe(state => state.layers, callback)`

2. **Remove Event Emissions** - Service files
   - Remove `EventBus.emit()` calls where Zustand subscriptions can replace them
   - Keep events only for truly cross-domain communication

3. **Document Remaining Events** - Create `/ui2/src/services/EventBus.md`
   - List all remaining event types
   - Document why each event is necessary vs store subscription
   - Add lifecycle management rules

---

## Prevention Strategies

### Code Review Checklist
- [ ] Does this PR add new state? If yes, justify why existing stores can't be used
- [ ] Does this PR read the same data from multiple places? Flag for dual source of truth
- [ ] Does this PR add new async operations without error handling/timeout?
- [ ] Does this PR emit events that could create circular dependencies?

### ESLint Rules to Add
1. **no-dual-state**: Detect when same property accessed from multiple stores
2. **no-event-cycles**: Detect potential circular event dependencies
3. **async-error-handling**: Require try/catch for all async operations

### Testing Strategy
1. **Integration Tests**: Test the 4 flows identified in the reports
2. **Race Condition Tests**: Simulate rapid user interactions
3. **Error Recovery Tests**: Verify app doesn't break when operations fail

### Documentation Requirements
1. **Store Ownership Matrix**: Document which store owns which data
2. **Data Flow Diagrams**: Replace current complex flows with simple unidirectional flows
3. **Migration Guide**: For developers working on legacy code

---

## Success Metrics

### Technical Metrics
- **State Duplication**: Zero properties stored in multiple places
- **Event Complexity**: <5 event types remaining
- **Race Conditions**: Zero race condition bugs in user testing
- **Component Re-renders**: <3 re-renders per user interaction

### User Experience Metrics
- **Response Time**: <100ms for all UI interactions
- **Error Rate**: Zero data corruption incidents
- **Load Performance**: Files load successfully 99.9% of time
- **Visual Consistency**: Crosshair always shows correct position

---

## Implementation Timeline

### Week 1: P0 Critical
- **Days 1-2**: Remove layerStore render properties
- **Days 3-4**: Update all components to use viewStateStore
- **Day 5**: Delete StoreSyncService, test everything

### Week 2: P1 High Priority
- **Days 1-2**: Implement file loading queue
- **Days 3-4**: Add loading state management
- **Day 5**: Test concurrent file drops

### Week 3: P2-P3 Moderate
- **Days 1-2**: Consolidate crosshair state
- **Days 3-4**: Clarify time navigation ownership
- **Day 5**: Test all affected flows

### Week 4: P4 Cleanup & Prevention
- **Days 1-2**: Reduce event bus complexity
- **Days 3-4**: Add ESLint rules and documentation
- **Day 5**: Final testing and performance validation

---

## Risk Mitigation

### Rollback Strategy
- **Git Branches**: Keep working branch for each phase
- **Feature Flags**: Ability to switch back to old behavior
- **Data Export**: Backup user state before each major change

### Testing Requirements
- **Manual Testing**: Every layer operation after each change
- **Automated Testing**: Integration tests for the 4 critical flows
- **Performance Testing**: Measure before/after re-render counts

### Monitoring
- **Error Tracking**: Monitor for state consistency errors
- **Performance Tracking**: Watch for regression in response times
- **User Feedback**: Monitor for reports of UI bugs or data loss

---

## Conclusion

This plan transforms the current **spider web of interdependencies** into a clean, unidirectional data flow architecture. By eliminating dual sources of truth and simplifying state management, we remove the root cause of bugs like the histogram issue while making the codebase more maintainable.

The **surgical approach** focuses on deletion over addition, ensuring we don't introduce new complexity while solving existing problems. Each change is designed to be **independently testable** and **incrementally deployable**, minimizing risk while maximizing impact.

**Success depends on discipline**: following the single source of truth principle and preventing the reintroduction of dual state patterns through code review and automated tooling.