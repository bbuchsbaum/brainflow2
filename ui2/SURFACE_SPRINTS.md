# Surface Visualization Sprint Plan

**Project**: Brainflow2 Surface Visualization  
**Duration**: 6 weeks (3 sprints × 2 weeks)  
**Start Date**: 2025-01-08  
**Architecture**: Separate UI panels with independent stores (revised 2025-01-09)

## Architecture Update (2025-01-09)
Based on expert analysis and user feedback, we've evolved the architecture:
1. **Initial**: Facade Pattern with UnifiedLayerService for unified display
2. **Final**: Separate panels (LayerPanel for volumes, SurfaceListPanel for surfaces)
3. **Rationale**: "We don't actually overlay surfaces over volumes" - they need distinct UIs
4. **Result**: Clear separation with tabbed interface in GoldenLayout

The facade infrastructure remains available for future programmatic features.

---

## Sprint 1: Foundation & Architecture
**Duration**: 2 weeks  
**Goal**: Refactor existing code for surface support without breaking changes

### Epic 1.1: Control Panel Refactoring
- [x] **SURF-101**: Extract SharedControls component from LayerControlsPanel
  - Extract opacity, colormap, intensity, threshold controls
  - Create `SharedControls.tsx` with TypeScript interfaces
  - Add proper prop types for layer and metadata
  - Write unit tests for SharedControls
  - **Acceptance**: SharedControls renders independently with all props typed

- [x] **SURF-102**: Create LayerPropertiesManager dispatcher component
  - Implement `LayerPropertiesManager.tsx` 
  - Add discriminated union dispatch logic
  - Create placeholder VolumePanel component
  - Create placeholder SurfacePanel component
  - **Acceptance**: Manager correctly routes to appropriate panel based on dataType

- [x] **SURF-103**: Implement VolumePanel with existing functionality
  - Move volume-specific controls from LayerControlsPanel
  - Integrate SharedControls component
  - Add interpolation mode selector
  - Add slice thickness control (if applicable)
  - **Acceptance**: VolumePanel fully replaces LayerControlsPanel for volumes

- [x] **SURF-104**: Create SurfacePanel placeholder
  - Basic component structure
  - Integrate SharedControls
  - Add "Coming Soon" message for surface-specific controls
  - **Acceptance**: SurfacePanel renders without errors

### Epic 1.2: Type System Extension
- [x] **SURF-105**: Define surface layer TypeScript interfaces
  - Create `SurfaceViewLayer` interface extending `BaseViewLayer`
  - Define `SurfaceRenderProperties` interface
  - Add `dataType: 'surface'` discriminator
  - Add optional `sourceVolumeId` for vol2surf
  - **Acceptance**: Types compile without errors

- [x] **SURF-106**: Update ViewLayer discriminated union
  - Modify `ViewLayer` type to include `SurfaceViewLayer`
  - Add backward compatibility type aliases
  - Update type guards for surface detection
  - **Acceptance**: Existing code continues to compile

- [x] **SURF-107**: Create surface-specific property types
  - Define wireframe, smoothing, lighting property types
  - Add vertex coloring modes enum
  - Create coordinate transform matrix type
  - **Acceptance**: All surface properties strongly typed

### Epic 1.3: Facade Pattern Implementation (REVISED 2025-01-09)
- [x] **SURF-108**: Create UnifiedLayerService facade
  - Implement service class in `/services/UnifiedLayerService.ts`
  - Define `ManagedLayer` discriminated union type
  - Implement `getAllLayers()` to combine volume and surface stores
  - Add `updateLayerProperty()` with delegation logic
  - Create `createVol2SurfMapping()` for cross-store coordination
  - **Acceptance**: Service provides unified interface to both stores

- [x] **SURF-109**: Create useUnifiedLayers hook
  - Implement hook in `/hooks/useUnifiedLayers.ts`
  - Subscribe to both layerStore and surfaceStore
  - Provide filtered accessors (surfaceLayers, volumeLayers, vol2surfLayers)
  - Maintain type safety with discriminated unions
  - Include update methods bound to service
  - **Acceptance**: Hook provides typed access to all layers

- [x] **SURF-110**: Create separate UI panels for volumes and surfaces
  - Created SurfaceListPanel component for surface management
  - Reverted LayerPanel to show volumes only (removed useUnifiedLayers)
  - Registered both panels in GoldenLayoutWrapper
  - Configured panels as tabs in the same dock
  - **Acceptance**: Separate panels provide clear UI distinction

### Epic 1.4: Testing & Documentation
- [x] **SURF-111**: Write unit tests for refactored components
  - Test UnifiedLayerService with 26 test cases
  - Test useUnifiedLayers hook with 9 test cases
  - All tests passing (35 total)
  - **Acceptance**: All tests pass, coverage > 80%

- [x] **SURF-112**: Update component documentation
  - Created comprehensive FACADE_PATTERN.md documentation
  - Added JSDoc comments to UnifiedLayerService
  - Added JSDoc comments to useUnifiedLayers hook
  - **Acceptance**: All new components documented

### Sprint 1 Success Criteria
- [x] ✅ Existing volume functionality unchanged (volumes still use layerStore)
- [x] ✅ No regressions in current features (backward compatible facade)
- [x] ✅ SharedControls extracted and reusable (completed in earlier tasks)
- [x] ✅ LayerPropertiesManager dispatches correctly (completed)
- [x] ✅ Type system supports surfaces (ManagedLayer discriminated union)
- [x] ✅ All existing tests pass (35 tests passing)
- [x] ✅ Facade Pattern implemented (UnifiedLayerService - available for future use)
- [x] ✅ Separate panels created (LayerPanel for volumes, SurfaceListPanel for surfaces)

---

## Sprint 2: Surface Loading & Display
**Duration**: 2 weeks  
**Goal**: Load and display basic surface meshes with controls

### Epic 2.1: Backend Surface Support
- [x] **SURF-201**: Verify load_surface Tauri command
  - Created comprehensive tests in SurfaceLoading.test.ts
  - Verified proper snake_case field handling
  - Validated surface handle returns
  - **Acceptance**: ✅ Can load .gii files without errors

- [x] **SURF-202**: Implement get_surface_geometry command
  - Verified vertices are returned as Float32Array compatible
  - Verified faces are returned as Uint32Array compatible
  - Tested large mesh support (>100k vertices)
  - **Acceptance**: ✅ Geometry data correctly transferred to frontend

- [x] **SURF-203**: Add surface metadata support
  - Returns vertex count, face count
  - Includes hemisphere information
  - Includes surface type (pial, white, inflated)
  - **Acceptance**: ✅ Metadata available in frontend

### Epic 2.2: Surface Rendering
- [x] **SURF-204**: Fix ColorMappedNeuroSurface rendering
  - Fixed black screen issue by creating explicit identity mapping indices
  - Changed from passing null to proper Uint32Array
  - Switched to smooth shading (flatShading: false)
  - **Acceptance**: ✅ Surface renders with correct colors

- [x] **SURF-205**: Fix camera management
  - Implemented camera state preservation during resize
  - Added controls state preservation
  - Improved centerCamera with requestAnimationFrame
  - **Acceptance**: ✅ Camera doesn't reset on resize

- [x] **SURF-206**: Optimize initial render
  - Added dimension waiting loop in initialization
  - Improved container dimension detection
  - Fixed timing with requestAnimationFrame
  - **Acceptance**: ✅ Surface visible immediately on load

### Epic 2.3: Surface Controls Implementation
- [x] **SURF-207**: Implement wireframe toggle & surface controls
  - Created SurfaceControlPanel component
  - Added renderSettings to surfaceStore
  - Implemented wireframe, opacity, smoothing controls
  - Added viewpoint selection buttons
  - **Acceptance**: ✅ Can toggle wireframe and adjust surface properties

- [x] **SURF-208**: Add lighting controls
  - Implemented ambient light slider (already existed)
  - Implemented diffuse light slider
  - Implemented specular light slider
  - **Acceptance**: ✅ Lighting adjustable in real-time

- [x] **SURF-209**: Add smoothing control
  - Smoothing slider already implemented (0-1)
  - Connected to renderSettings in surfaceStore
  - Updates material properties via store
  - **Acceptance**: ✅ Surface smoothness adjustable

### Epic 2.4: File Loading Integration
- [x] **SURF-210**: Create SurfaceLoadingService
  - Implemented loadSurfaceFile method with options
  - Handles .gii file format validation
  - Integrates with loading queue
  - **Acceptance**: ✅ Service loads surface files

- [x] **SURF-211**: Update FileLoadingService router
  - Detects surface file extensions via isSupportedSurfaceFile
  - Routes to SurfaceLoadingService
  - Progress indicators integrated with loading queue
  - **Acceptance**: ✅ Double-click .gii loads surface

- [x] **SURF-212**: Add surface file validation
  - Checks file format validity in validateSurfaceFile
  - Basic validation implemented (extension check)
  - Error messages via event bus notifications
  - **Acceptance**: ✅ Invalid files handled gracefully

### Epic 2.5: Layer Management UI
- [x] **SURF-213**: Create SurfaceListPanel for surfaces
  - Created dedicated panel component
  - Shows surface list with metadata
  - Displays vertex/face count
  - **Acceptance**: Surfaces have dedicated management panel

- [x] **SURF-214**: Enable surface layer operations
  - Visibility toggle implemented
  - Remove surface functionality added
  - Selection/activation working
  - **Acceptance**: Can manage surface layers

- [x] **SURF-215**: Add surface metadata drawer
  - Created SurfaceMetadataDrawer component
  - Shows mesh statistics, coordinate system, memory usage
  - Integrated with SurfaceListPanel via Info button
  - **Acceptance**: ✅ Can inspect surface details

### Sprint 2 Success Criteria
- [x] ✅ Can load .gii surface files (via SurfaceLoadingService)
- [x] ✅ Surface renders immediately (fixed in earlier tasks)
- [x] ✅ Camera orientation preserved (fixed in SURF-205)
- [x] ✅ Wireframe and lighting controls work (SURF-207, SURF-208)
- [x] ✅ SurfaceListPanel shows surface layers
- [x] ✅ Can add/remove surface layers (via SurfaceListPanel)

---

## Sprint 3: Surface Data Overlays & Vol2Surf Mapping
**Duration**: 2 weeks  
**Goal**: Implement surface data overlay support and volume-to-surface mapping

### Epic 3.0: Surface Overlay Support (NEW - Priority)
- [ ] **SURF-300A**: Extend GIFTI loader for functional data
  - Detect `.func.gii` and `.shape.gii` file types
  - Parse scalar data arrays from GIFTI XML
  - Return SurfaceDataHandle with metadata
  - **Acceptance**: Can load functional GIFTI files without errors

- [ ] **SURF-300B**: Add load_surface_overlay Tauri command
  - Create new command in api_bridge
  - Validate vertex count matches target surface
  - Store overlay data in memory with handle
  - **Acceptance**: Backend can load and store overlay data

- [ ] **SURF-300C**: Create SurfaceOverlayService
  - Implement loadSurfaceOverlay method
  - Handle drag-drop overlay onto surface
  - Validate compatibility (vertex count match)
  - **Acceptance**: Frontend can load overlay files

- [ ] **SURF-300D**: Implement overlay application to surface
  - Add setDataLayer method to NeuroSurface
  - Map scalar values to vertex colors
  - Apply colormap and thresholding
  - **Acceptance**: Surface displays overlay colors

- [ ] **SURF-300E**: Create SurfaceDataLayerControls
  - Colormap selection
  - Intensity range controls
  - Threshold controls
  - Statistical display options
  - **Acceptance**: Can adjust overlay visualization

- [ ] **SURF-300F**: Update FileLoadingService router
  - Detect overlay files by name pattern
  - Route to SurfaceOverlayService
  - Show overlay load dialog for surface selection
  - **Acceptance**: Double-click .func.gii loads as overlay

### Epic 3.1: Vol2Surf UI Components
- [ ] **SURF-301**: Create Vol2SurfMappingDialog
  - Design parameter input form
  - Add method selector (nearest/trilinear/weighted)
  - Add projection depth slider (-5 to 5mm)
  - Add smoothing kernel size input
  - **Acceptance**: Dialog captures all parameters

- [ ] **SURF-302**: Create Vol2SurfPanel component
  - Combine SharedControls for data
  - Include SurfaceSpecificControls
  - Add MappingControls section
  - Show relationship badge
  - **Acceptance**: Panel shows all relevant controls

- [ ] **SURF-303**: Add relationship visualization
  - Create RelationshipBadge component
  - Show surface → volume connection
  - Display mapping method
  - **Acceptance**: Clear visual of data relationship

### Epic 3.2: Mapping Implementation
- [ ] **SURF-304**: Create vol2surf Web Worker
  - Implement vol2surf-worker.js
  - Add nearest neighbor sampling
  - Add trilinear interpolation
  - Handle coordinate transforms
  - **Acceptance**: Worker performs mapping

- [ ] **SURF-305**: Implement Vol2SurfWorkerService
  - Create service class
  - Handle worker communication
  - Use transferable objects
  - Add progress callbacks
  - **Acceptance**: Service manages worker lifecycle

- [ ] **SURF-306**: Add coordinate transformation
  - Transform surface vertices to volume space
  - Handle different coordinate systems
  - Apply transformation matrices
  - **Acceptance**: Correct spatial alignment

### Epic 3.3: Data Flow Integration
- [ ] **SURF-307**: Implement drag-drop detection
  - Detect volume dropped on surface viewer
  - Validate volume compatibility
  - Show mapping dialog
  - **Acceptance**: Drag-drop triggers dialog

- [ ] **SURF-308**: Create vol2surf layer
  - Call createVol2SurfLayer service method
  - Set sourceVolumeId reference
  - Copy initial colormap from volume
  - **Acceptance**: New layer created with mapping

- [ ] **SURF-309**: Update surface vertex colors
  - Apply mapped data to vertices
  - Update material vertex colors
  - Trigger re-render
  - **Acceptance**: Surface shows volume data

### Epic 3.4: Mapping Controls
- [ ] **SURF-310**: Wire up colormap changes
  - Apply colormap to mapped data
  - Update surface material
  - Real-time preview
  - **Acceptance**: Colormap changes apply immediately

- [ ] **SURF-311**: Implement threshold controls
  - Apply threshold to vertex visibility
  - Update material uniforms
  - Hide vertices outside range
  - **Acceptance**: Threshold filters mapped data

- [ ] **SURF-312**: Add remapping capability
  - "Remap" button in Vol2SurfPanel
  - Reopen mapping dialog
  - Apply new parameters
  - **Acceptance**: Can change mapping parameters

### Epic 3.5: Performance & UX
- [ ] **SURF-313**: Add progress indicator
  - Show mapping progress bar
  - Display vertices processed
  - Estimate time remaining
  - **Acceptance**: User sees progress

- [ ] **SURF-314**: Implement cancellation
  - Cancel button during mapping
  - Properly terminate worker
  - Clean up partial results
  - **Acceptance**: Can cancel long operations

- [ ] **SURF-315**: Cache mapping results
  - Store computed mappings
  - Invalidate on parameter change
  - Reuse for colormap updates
  - **Acceptance**: Faster subsequent updates

### Epic 3.6: Layer Management
- [ ] **SURF-316**: Update LayerTable for vol2surf
  - Show vol2surf icon (🔗)
  - Display source volume name
  - Show mapping indicator
  - **Acceptance**: Vol2surf layers clearly marked

- [ ] **SURF-317**: Add vol2surf to LayerService
  - Implement createVol2SurfLayer
  - Track layer relationships
  - Handle layer deletion cascades
  - **Acceptance**: Service manages vol2surf layers

- [ ] **SURF-318**: Enable vol2surf operations
  - Duplicate vol2surf layer
  - Change source volume
  - Export mapped data
  - **Acceptance**: Full layer operations

### Sprint 3 Success Criteria
- [ ] ✅ Can map volume to surface via drag-drop
- [ ] ✅ Mapping dialog captures parameters
- [ ] ✅ Surface displays volume data colors
- [ ] ✅ Vol2SurfPanel shows hybrid controls
- [ ] ✅ Performance < 2s for 150k vertices
- [ ] ✅ Can remap with different parameters

---

## Post-MVP Sprints

### Sprint 4: GPU Optimization (2 weeks)
- [ ] Implement GPU-based vol2surf with Three.js shaders
- [ ] Add 3D texture support for volumes
- [ ] Create custom shader materials
- [ ] Optimize for real-time updates
- [ ] Add LOD support for large meshes

### Sprint 5: Advanced Features (2 weeks)
- [ ] Multi-resolution surface support
- [ ] Surface annotations and parcellations
- [ ] 4D surface time series
- [ ] Surface morphing animations
- [ ] ROI drawing on surfaces

### Sprint 6: Polish & Integration (1 week)
- [ ] Coordinate system alignment tools
- [ ] Memory optimization
- [ ] Performance profiling
- [ ] Comprehensive error handling
- [ ] User documentation

---

## Definition of Done

### For each ticket:
- [ ] Code implemented and working
- [ ] Unit tests written and passing
- [ ] Integration tested with existing features
- [ ] Code reviewed (if team > 1)
- [ ] Documentation updated
- [ ] No console errors or warnings

### For each sprint:
- [ ] All tickets completed
- [ ] Success criteria met
- [ ] Demo prepared
- [ ] Retrospective conducted
- [ ] Next sprint planned

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| WebGL memory limits | High | Implement LOD, texture compression |
| Coordinate misalignment | Medium | Add transformation matrices, validation |
| Performance with large meshes | High | GPU acceleration, progressive loading |
| GoldenLayout remounting | Medium | Separate viewer lifecycle management |
| Browser compatibility | Low | Test on Chrome, Firefox, Safari |

---

## Technical Debt to Address

1. **Immediate**
   - Remove debug console.log statements
   - Fix TypeScript any types
   - Add error boundaries

2. **Short-term**
   - Refactor surface store for consistency
   - Improve error messages
   - Add loading states

3. **Long-term**
   - Migrate to WebGPU when stable
   - Implement service workers
   - Add offline support

---

**Document Status**: Ready for implementation  
**Last Updated**: 2025-01-09  
**Next Review**: End of Sprint 1