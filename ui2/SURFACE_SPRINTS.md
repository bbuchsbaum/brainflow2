# Surface Visualization Sprint Plan

**Project**: Brainflow2 Surface Visualization  
**Duration**: 6 weeks (3 sprints × 2 weeks)  
**Start Date**: 2025-01-08  
**Architecture**: Separate panels with manager pattern (based on expert consensus)

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

### Epic 1.3: State Management
- [ ] **SURF-108**: Implement surface layer selectors
  - Create `useSurfaceLayers()` hook
  - Create `useVolumeLayers()` hook  
  - Create `useVol2SurfLayers()` hook
  - Add `useLayerById()` selector
  - **Acceptance**: Selectors correctly filter layers by type

- [ ] **SURF-109**: Extend LayerStore for surfaces
  - Add surface layer storage capability
  - Implement `addSurfaceLayer` action
  - Implement `updateSurfaceProperties` action
  - Maintain backward compatibility
  - **Acceptance**: Store handles both volume and surface layers

- [ ] **SURF-110**: Add surface-specific store actions
  - Create `setSurfaceWireframe` action
  - Create `setSurfaceSmoothing` action
  - Create `setSurfaceLighting` action
  - **Acceptance**: Can update surface properties via store

### Epic 1.4: Testing & Documentation
- [ ] **SURF-111**: Write unit tests for refactored components
  - Test SharedControls with mock data
  - Test LayerPropertiesManager routing
  - Test VolumePanel functionality
  - **Acceptance**: All tests pass, coverage > 80%

- [ ] **SURF-112**: Update component documentation
  - Document SharedControls props
  - Document panel architecture
  - Add JSDoc comments
  - **Acceptance**: All new components documented

### Sprint 1 Success Criteria
- [ ] ✅ Existing volume functionality unchanged
- [ ] ✅ No regressions in current features  
- [ ] ✅ SharedControls extracted and reusable
- [ ] ✅ LayerPropertiesManager dispatches correctly
- [ ] ✅ Type system supports surfaces
- [ ] ✅ All existing tests pass

---

## Sprint 2: Surface Loading & Display
**Duration**: 2 weeks  
**Goal**: Load and display basic surface meshes with controls

### Epic 2.1: Backend Surface Support
- [ ] **SURF-201**: Verify load_surface Tauri command
  - Test with sample .gii files
  - Ensure proper error handling
  - Validate returned surface handle
  - **Acceptance**: Can load .gii files without errors

- [ ] **SURF-202**: Implement get_surface_geometry command
  - Ensure vertices are returned as Float32Array
  - Ensure faces are returned as Uint32Array
  - Handle large meshes (>100k vertices)
  - **Acceptance**: Geometry data correctly transferred to frontend

- [ ] **SURF-203**: Add surface metadata support
  - Return vertex count, face count
  - Include hemisphere information
  - Include surface type (pial, white, inflated)
  - **Acceptance**: Metadata available in frontend

### Epic 2.2: Surface Rendering
- [ ] **SURF-204**: Fix ColorMappedNeuroSurface rendering
  - Fix black screen issue (indices array)
  - Ensure proper material creation
  - Handle empty/null indices correctly
  - **Acceptance**: Surface renders with correct colors

- [ ] **SURF-205**: Fix camera management
  - Preserve camera orientation during resize
  - Implement proper centerCamera usage
  - Add hasCenteredCamera tracking
  - **Acceptance**: Camera doesn't reset on resize

- [ ] **SURF-206**: Optimize initial render
  - Surface appears without manual resize
  - Proper container dimension handling
  - Fix timing issues with GoldenLayout
  - **Acceptance**: Surface visible immediately on load

### Epic 2.3: Surface Controls Implementation
- [ ] **SURF-207**: Implement wireframe toggle
  - Add checkbox to SurfacePanel
  - Wire up to surface material
  - Live update without reload
  - **Acceptance**: Can toggle wireframe on/off

- [ ] **SURF-208**: Add lighting controls
  - Implement ambient light slider
  - Implement diffuse light slider
  - Implement specular light slider
  - **Acceptance**: Lighting adjustable in real-time

- [ ] **SURF-209**: Add smoothing control
  - Implement smoothing slider (0-1)
  - Apply to surface normals
  - Update material properties
  - **Acceptance**: Surface smoothness adjustable

### Epic 2.4: File Loading Integration
- [ ] **SURF-210**: Create SurfaceLoadingService
  - Implement loadSurfaceFile method
  - Handle .gii file format
  - Support drag-and-drop
  - **Acceptance**: Service loads surface files

- [ ] **SURF-211**: Update FileLoadingService router
  - Detect surface file extensions
  - Route to SurfaceLoadingService
  - Update progress indicators
  - **Acceptance**: Double-click .gii loads surface

- [ ] **SURF-212**: Add surface file validation
  - Check file format validity
  - Validate mesh integrity
  - Provide meaningful error messages
  - **Acceptance**: Invalid files handled gracefully

### Epic 2.5: Layer Management UI
- [ ] **SURF-213**: Update LayerTable for surfaces
  - Add surface layer rows
  - Show appropriate icon (🔺)
  - Display vertex/face count
  - **Acceptance**: LayerTable shows surface layers

- [ ] **SURF-214**: Enable surface layer operations
  - Visibility toggle for surfaces
  - Remove surface functionality
  - Reorder surface layers
  - **Acceptance**: Can manage surface layers

- [ ] **SURF-215**: Add surface metadata drawer
  - Show detailed surface properties
  - Display coordinate system
  - Show memory usage
  - **Acceptance**: Can inspect surface details

### Sprint 2 Success Criteria
- [ ] ✅ Can load .gii surface files
- [ ] ✅ Surface renders immediately (no resize needed)
- [ ] ✅ Camera orientation preserved
- [ ] ✅ Wireframe and lighting controls work
- [ ] ✅ LayerTable shows surface layers
- [ ] ✅ Can add/remove surface layers

---

## Sprint 3: Vol2Surf Mapping
**Duration**: 2 weeks  
**Goal**: Implement volume-to-surface data mapping

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
**Last Updated**: 2025-01-08  
**Next Review**: End of Sprint 1