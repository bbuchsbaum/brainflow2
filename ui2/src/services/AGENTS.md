<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# ui2/src/services

## Purpose
Business logic and API integration layer for the Brainflow frontend. Contains 41 service files implementing the service-driven architecture, handling file loading, rendering coordination, layer management, view synchronization, and backend communication. Services are the ONLY layer that updates stores and calls Tauri commands.

## Key Files
| File | Description |
|------|-------------|
| apiService.ts | Main API service with extensive command implementations - 58KB, THE central API hub |
| DisplayLifecycleOrchestrator.ts | Canonical ingress owner for file-driven display lifecycle flows |
| transport.ts | Tauri command transport layer with permission management - 9KB |
| FileLoadingService.ts | Compatibility facade delegating file loads to DisplayLifecycleOrchestrator |
| SurfaceLoadingService.ts | Surface geometry loading - 10KB |
| SurfaceOverlayService.ts | Surface data overlay management - 12KB |
| VolumeLoadingService.ts | Volume data loading - 20KB |
| VolumeSurfaceProjectionService.ts | Volume-to-surface projection - 29KB |
| UnifiedLayerService.ts | Unified layer management for volumes and surfaces - 8KB |
| LayerService.ts | Layer operations and management - 8KB |
| LayerApiImpl.ts | Layer API implementation - 11KB |
| RenderCoordinator.ts | Coordinates rendering across multiple views - 16KB |
| OptimizedRenderService.ts | Optimized rendering with batching - 11KB |
| MosaicRenderService.ts | Multi-slice mosaic view rendering - 21KB |
| ViewRegistry.ts | View component registration and management - 10KB |
| ViewExportService.ts | Export views as images - 12KB |
| ViewPlaneService.ts | View plane calculations - 9KB |
| CrosshairService.ts | Crosshair synchronization across views - 9KB |
| CrosshairMenuService.ts | Crosshair context menu - 2KB |
| AtlasService.ts | Brain atlas support and loading - 14KB |
| AtlasPaletteService.ts | Atlas color palette management - 3KB |
| AtlasPressureMonitor.ts | Atlas memory pressure monitoring - 10KB |
| TemplateService.ts | Standard brain space templates - 8KB |
| ProgressService.ts | Progress tracking and reporting - 8KB |
| StatusBarService.ts | Status bar updates - 7KB |
| MetadataStatusService.ts | Layer metadata status updates - 2KB |
| LayerMetadataService.ts | Layer metadata operations - 2KB |
| HistogramService.ts | Histogram data computation - 7KB |
| SliceNavigationService.ts | Slice navigation logic - 4KB |
| TimeNavigationService.ts | 4D time navigation - 8KB |
| ClusterService.ts | Cluster analysis - 1KB |
| SamplingService.ts | Data sampling operations - 1KB |
| `StoreSyncService.ts` | Removed. Cross-store synchronization is now explicit in `LayerApiImpl`/`LayerService`. |
| SurfaceLayerAdapter.ts | Surface layer adapter - 4KB |
| HoverInfoService.ts | Hover tooltip information - 3KB |
| PerformanceMonitoringService.ts | Performance monitoring - 7KB |
| RenderSession.ts | Render session management - 6KB |
| VolumeHandleStore.ts | Volume handle storage - 1KB |
| layoutService.ts | Layout management - 3KB |
| PHASE2_COMPLETE.md | Phase 2 completion notes |
| README_CROSSHAIR_MENU.md | Crosshair menu documentation |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| hoverProviders/ | Hover tooltip data providers (atlas, coords, intensity) |
| __tests__/ | Service unit tests |

## For AI Agents

### Working In This Directory
- Services are singleton instances - import and use directly
- Services are the ONLY layer that updates Zustand stores
- Services are the ONLY layer that calls Tauri commands
- Keep services focused on a single responsibility
- Services can depend on other services
- Services can access multiple stores
- Use async/await for backend operations
- Handle errors and provide user feedback
- Use ProgressService for long operations
- Document public methods and their contracts
- Keep apiService.ts as the central API hub

### Testing Requirements
- Mock Tauri commands with vi.mock
- Mock store methods
- Test service methods in isolation
- Test error handling paths
- Test async operation completion
- Test progress reporting
- Verify store updates occur correctly
- Test service dependencies

### Common Patterns
- Service singleton: Export const instance, not class
- Store access: Import store, use getState() for non-reactive access
- Store updates: `useStore.getState().method()`
- Backend calls: Go through apiService or transport
- Error handling: Try/catch, formatTauriError, user feedback
- Progress tracking: ProgressService.start/update/complete
- Async operations: async/await with proper error handling
- Service coordination: Services call other services as needed

## Dependencies

### Internal
- ../stores/ - All Zustand stores
- ../types/ - Type definitions
- ../utils/ - Utility functions
- @brainflow/api - API types and bindings

### External
- @tauri-apps/api - Tauri backend communication
- zustand - Store access (not creation)

<!-- MANUAL: Services implement all business logic. Components should never directly update stores or call Tauri. -->

## Population probe lifecycle

- `studio/PopulationProbeController.ts` is owned per mounted population panel. It retains one sampled frame and admits one active sampling call plus the latest pending query. Stop/replacement invalidates publication, discards pending work and aborts issued sampling through SampleProvider. Native cooperative cancellation retains worker ownership until the operation reaches a cancellation boundary. Do not make this lifecycle a process-global singleton.
- Query identity includes workspace/import/set/feature, context sources and the spatial probe. Focus, working selection and presentation changes reuse the frame. Keep large frames and image arrays out of Zustand.
- `studio/PopulationProbeActions.ts` owns population panel store mutations and the disposable hover subscription; pure query/summary calculations remain in the controller module.
- Immutable saved-query source freezing, dataset-scoped cache teardown, saved participant metadata/provenance, temporal semantics and native hover provenance remain explicit follow-up work in `docs/plans/neurotabs-implementation-status.md`.

## Live population fields

- `studio/PopulationSliceService.ts` is owned by a mounted Population lens, not a global singleton. It owns latest-query coalescing, native cancellation/release, sampled arrays and bitmap leases. React view leases keep old bitmaps alive until committed views release them. Do not put the arrays or images in Zustand.
- `buildPopulationSource` is shared by probe and field requests; unresolved/ambiguous bindings fail consistently. Query operands distinguish focus from working membership. Preview-without alters only the field request; it can omit one observation or every selected row of a declared participant.
- The Studio coordinator must bypass file/GPU member loading and compare-file materialization while the Population lens owns display. Navigation and hover stay in the service layer; pinned probes remain fixed during slice navigation.

- Optional population cutouts share the slice query and source guard. `packPopulationCutouts` assembles one sprite with the focused-map scale; the same `PopulationImages` lease owns all three bitmaps. Reject missing/reordered gallery results and close all completed bitmaps on conversion failure, stale publication or final lease release.

- `PopulationProbeController` also owns an explicit response arrangement fitted from the sampled frame. `populationWitnesses.ts` ranks finite responses, breaks ties by declared source order, keeps unavailable IDs last, and selects distinct actual empirical-rank witnesses. Ordering/expansion does not resample or alter membership. Retain the fit probe/source provenance while a probe changes; clear the fit across source-binding or dataset changes.

- `describePopulationProbe` summarizes already reduced observation responses, with inclusive near-zero endpoints and finite selected denominators. Mean absolute magnitude and cancellation are descriptive companions to sign counts. Changing the sign interval must not trigger spatial resampling or change selection/order.

- `populationParticipants.ts` validates explicit complete keyed participant identity and builds selected groups. `single` refuses repeated selected rows; `mean` averages finite rows within each person before equal participant weighting. Native fields reduce voxelwise; probe summaries reduce the already spatially sampled responses. Preserve this order, local missingness and original observation identity. Configuration changes must not resample a fixed probe. Invalid participant summaries must not silently fall back to row weighting.

- `studioMetadata` is the shared keyed observation-metadata reader. Full `memberSummaries[].designValues` records override compact previews; never repair an incomplete authoritative record from a preview. Participant identity and filters require coverage of all requested observations. `attachObservationMetadata` joins plot metadata without changing row grain and aliases reserved/colliding names; never overwrite `member`, `value`, `count` or band columns. Metadata strings do not establish typed physical axes.
