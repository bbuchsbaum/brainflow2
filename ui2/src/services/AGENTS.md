<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# ui2/src/services

## Purpose
Business logic and API integration layer for the Brainflow frontend. Contains 42 service files implementing the service-driven architecture, handling file loading, rendering coordination, layer management, view synchronization, and backend communication. Services are the ONLY layer that updates stores and calls Tauri commands.

## Key Files
| File | Description |
|------|-------------|
| apiService.ts | Main API service with extensive command implementations - 58KB, THE central API hub |
| transport.ts | Tauri command transport layer with permission management - 9KB |
| FileLoadingService.ts | Orchestrates file loading operations - 10KB |
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
| StoreSyncService.ts | Cross-store synchronization - 7KB |
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
