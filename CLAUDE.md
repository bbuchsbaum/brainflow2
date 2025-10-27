# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Brainflow is a high-performance, cross-platform desktop neuroimaging application built with:
- **Backend**: Rust with Tauri, wgpu for WebGPU rendering
- **Frontend**: React, TypeScript, Three.js (3D), WebGPU (2D slices)
- **State Management**: Zustand
- **UI**: Tailwind CSS, Golden Layout for docking

## Essential Commands

### Development
```bash
# Run development server (hot-reloading)
# IMPORTANT: Always use this command to run the app, NOT "npm run dev"
cargo tauri dev

# Run Rust tests
cargo test --workspace

# Run UI unit tests
pnpm --filter ui2 test

# Run UI tests with UI
pnpm --filter ui2 test:ui

# Build application
cargo tauri build

# UI-only development (only for testing UI components, not full app)
# Note: Many features won't work without Tauri backend
cd ui2 && npm run dev

# Generate TypeScript bindings from Rust types
cargo xtask ts-bindings
```

### Code Quality
```bash
# Rust formatting and linting
cargo fmt --all
cargo clippy --workspace --all-targets

# TypeScript formatting and linting
pnpm format
pnpm lint

# Run full test suite
pnpm test  # runs UI tests + cargo test
```

### Benchmarking
```bash
# Run texture upload benchmark
cargo bench -p render_loop --bench upload
```

### Setup
```bash
# Initial setup after cloning
cargo fetch
pnpm install
cd packages/api && pnpm run build && cd ../..
```

## Architecture

The project uses a dual-workspace architecture:
- **Rust workspace** (`Cargo.toml`) - Backend services
- **pnpm workspace** (`pnpm-workspace.yaml`) - Frontend and TypeScript packages

### Core Principles
1. **Heavy computation in Rust** - All volumetric math, rendering, file I/O handled by Rust backend
2. **TypeScript uses handles** - Frontend references data via handles, no duplication
3. **Zero-copy transfers** - SharedArrayBuffers for large data transfers
4. **Plugin architecture** - TypeScript plugins extend functionality
5. **GPU acceleration** - WebGPU for 2D orthogonal slices, WebGL/Three.js for 3D surfaces

### Key Components

**Rust Core (`/core/`)**:
- `api_bridge/` - Tauri command implementations and permission system
- `bridge_types/` - Shared types between Rust components
- `filesystem/` - File operations, BIDS scanning
- `loaders/` - File format loaders (NIfTI, GIfTI)
  - `nifti/` - NIfTI volume loading
  - `gifti/` - GIfTI surface mesh loading
- `render_loop/` - WebGPU rendering service with runtime WGSL shaders
- `neuro-types/` - Core types for neuroimaging (slice specs, view rects, coordinate systems)
- `neuro-core/` - Core neuroimaging utilities and shared logic
- `neuro-cpu/` - CPU-based volume rendering fallback
- `volmath/` - Core math, volume operations, spatial utilities
- `colormap/` - Color mapping functionality
- `atlases/` - Brain atlas support

**Frontend (`/ui2/`)**:
- React application with:
  - WebGPU for 2D orthogonal slices
  - Three.js/WebGL for 3D surface rendering
  - Zustand stores for state management (cross-panel state)
  - Golden Layout v2 for dockable panels (isolated React roots per panel)
  - Vitest for unit testing

**Key Frontend Services (`/ui2/src/services/`)**:
- `FileLoadingService.ts` - Orchestrates file loading operations
- `SurfaceLoadingService.ts` - Surface geometry loading
- `SurfaceOverlayService.ts` - Surface data overlay management
- `VolumeLoadingService.ts` - Volume data loading
- `UnifiedLayerService.ts` - Unified layer management for volumes and surfaces
- `ViewRegistry.ts` - View component registration and management
- `RenderCoordinator.ts` - Coordinates rendering across multiple views
- `OptimizedRenderService.ts` - Optimized rendering with batching
- `MosaicRenderService.ts` - Multi-slice mosaic view rendering
- `CrosshairService.ts` - Crosshair synchronization across views
- `LayerApiImpl.ts` - Layer API implementation
- `apiService.ts` - Main API service (49KB - extensive command implementations)
- `transport.ts` - Tauri command transport layer

**Shared (`/packages/`)**:
- `api/` - Core TypeScript interfaces (@brainflow/api)
- `legacy-ts/` - Code being migrated from legacy system

### Data Flow
1. User requests file load via UI
2. Tauri command loads file in Rust, creates handle
3. Handle returned to TypeScript frontend
4. UI requests rendering via handle reference
5. Rust prepares GPU resources, renders via WebGPU/WebGL
6. Zero-copy transfer of results to frontend

## Tauri Command Bridge

When working with Tauri commands between JavaScript and Rust:

### 1. Parameter Naming Convention
Tauri automatically converts between naming conventions:
- **JavaScript**: Use camelCase (`originMm`, `layerId`)
- **Rust**: Use snake_case (`origin_mm`, `layer_id`)

### 2. Adding New Commands
**IMPORTANT**: Adding a new Tauri command requires updates in FOUR places:
1. Define the command function in `lib.rs` with `#[command]` attribute
2. Add to `COMMANDS` array in `/core/api_bridge/build.rs`
3. Add to `generate_handler!` macro in `lib.rs` (commonly missed!)
4. Add to `apiBridgeCommands` array in `/ui2/src/services/transport.ts`

See `/core/api_bridge/ADDING_COMMANDS.md` for detailed steps.

### 3. Permissions
Commands need permissions in `/core/api_bridge/permissions/default.toml`:
```toml
permissions = ["allow-update-frame-ubo", "allow-patch-layer", ...]
```

### 4. Invocation
From JavaScript, use the plugin namespace:
```typescript
await invoke('plugin:api-bridge|update_frame_ubo', {
  originMm: [0, 0, 0, 1],  // camelCase in JS
  uMm: [1, 0, 0, 0],
  vMm: [0, 1, 0, 0]
});
```

## Key Documentation

Essential architectural docs in `/memory-bank/`:
- `ADR-001-architecture.md` - Core architecture decisions
- `projectbrief.md` - Project goals and vision
- `PLAN-phase1-milestones.md` - Current development phase
- `DEV-bootstrap-guide.md` - Detailed setup instructions
- `repository_structure.md` - Complete directory layout

## Coordinate Systems & Rendering

**Key Insight**: CPU and GPU use different Y-axis conventions that must be handled at the correct boundary.

### Coordinate Conventions
- **World Space**: LPI (Left-Posterior-Inferior) - standard neuroimaging coordinates
- **GPU/WebGPU**: Y=0 at bottom, Y increases upward (OpenGL convention)
- **CPU/Images**: Y=0 at top, Y increases downward (image convention)

### Critical Implementation Details
1. **CPU Renderer** (`neuro-cpu/src/volume_renderer.rs`):
   - Uses image convention internally (Y=0 at top)
   - NO Y-flip in the renderer itself
   - Directly writes pixels in row order

2. **GPU Renderer** (`render_loop/`):
   - Uses OpenGL convention internally (Y=0 at bottom)
   - Y-flip happens during buffer readback in `render_to_buffer()`
   - This is the ONLY place where Y-flip should occur

3. **Coordinate Transforms** (`neuro-types/src/slice_spec.rs`, `view_rect.rs`):
   - Define viewing planes with consistent orientation vectors
   - Axial: down = -Y (anterior→posterior)
   - Sagittal: right = -Y (anterior→posterior), down = -Z
   - Coronal: down = -Z (superior→inferior)

### Why This Matters
Placing the Y-flip at the GPU buffer readback boundary ensures:
- Both renderers use consistent world-to-pixel transforms
- Coordinate calculations remain identical between CPU/GPU
- The Y-flip is isolated to format conversion, not geometric calculations

## Aspect Ratio Preservation

**Critical**: Medical imaging requires square pixels to preserve anatomical proportions.

### The Problem
The frontend's `createOrthogonalViews` in `ui2/src/utils/coordinates.ts` was using non-uniform pixel sizes:
```typescript
// ❌ WRONG - Creates different pixel sizes for X and Y
const pixelSizeX = extentX / dimX;
const pixelSizeY = extentY / dimY;
```

This caused the axial view to appear horizontally compressed when the view dimensions weren't square.

### The Solution
Use uniform pixel size (matching the backend's implementation):
```typescript
// ✅ CORRECT - Uses same pixel size for both axes
const pixelSize = Math.max(extentX / dimX, extentY / dimY);
```

### Backend Reference
The backend correctly implements this in `core/neuro-types/src/view_rect.rs`:
```rust
// SliceGeometry::full_extent
let pixel_size = (width_mm / screen_px_max[0] as f32)
    .max(height_mm / screen_px_max[1] as f32);
```

### Key Principle
Always use the larger of the two pixel sizes to ensure the entire extent fits within the view while maintaining square pixels. This is standard practice in medical imaging to avoid distorting anatomical structures.

## Current Status

Phase 1 (WebGPU v2) - Sprint 1 Complete / Starting Sprint 2 (M4 Kickoff):

**Implemented Features:**
- ✅ NIfTI volume loading and caching
- ✅ GIfTI surface geometry loading
- ✅ Orthogonal slice viewing (WebGPU)
- ✅ 3D surface rendering (Three.js)
- ✅ Surface data overlay visualization
- ✅ Unified layer management (volumes + surfaces)
- ✅ Mosaic view for multi-slice visualization
- ✅ Flexible slice panel with navigation
- ✅ Crosshair synchronization across views
- ✅ Interpolation mode toggle (nearest/linear)
- ✅ File browser with directory navigation
- ✅ Layer properties panel with controls
- ✅ Atlas support and overlays
- ✅ Progress tracking and loading queue
- ✅ Template service for standard brain spaces

**Current Focus:**
- Surface visualization enhancements
- Unified layer system refinements
- Performance optimization
- Testing and stability improvements

## State Management Architecture

### Zustand Stores (`/ui2/src/stores/`)
The application uses Zustand for all cross-component state management:

**Core Stores:**
- `layerStore.ts` - Layer management (volumes, surfaces, overlays)
- `surfaceStore.ts` - Surface geometry and data visualization
- `viewStateStore.ts` - View state (slice positions, orientations, zoom)
- `renderStateStore.ts` - Render state and frame tracking
- `crosshairSettingsStore.ts` - Crosshair configuration and visibility
- `mouseCoordinateStore.ts` - Mouse position tracking across views
- `loadingQueueStore.ts` - File loading queue and progress
- `progressStore.ts` - Progress tracking for async operations
- `fileBrowserStore.ts` - File browser state and navigation
- `workspaceStore.ts` - Workspace and session management
- `annotationStore.ts` - Annotation data and tools
- `statusBarStore.ts` - Status bar content and updates

**Store Patterns:**
- Stores use middleware for batching and performance optimization
- Selectors are used to prevent unnecessary re-renders (see `SELECTORS_GUIDE.md`)
- Stores are documented in `MIGRATION_NOTES.md`

### React Root Isolation Issue (GoldenLayout)
GoldenLayout creates **isolated React roots** for each docked panel. This means:
- React Context providers in one panel don't affect other panels
- Components in different panels can't share React Context state
- Updates in one root (e.g., settings dialog) won't propagate to other roots (e.g., view panels)

### Solution: Use Zustand for Cross-Root State
For any state that needs to be shared across panels:
- ❌ **Don't use React Context** - It only works within a single React tree
- ✅ **Use Zustand stores** - They're global singletons that work across all React roots

Example: Crosshair settings must update immediately in all views when changed in the settings dialog. Using React Context failed because each panel has its own root. Switching to Zustand fixed this instantly.

### Key Principle
If state needs to be visible across multiple GoldenLayout panels, it MUST use Zustand, not React Context.

## Lessons Learned: Allotment Split Pane Compatibility

### Issue: Flexbox Layouts Don't Work Within Allotment Panes
When using the Allotment library for resizable split panes, **flexbox layouts don't work correctly** within the panes. This caused the slice slider to be completely invisible in SliceViewCanvas.

### Problem Details
- **What failed**: Using `flex`, `flex-col`, and `flex-1` classes within Allotment.Pane components
- **Symptom**: Child components (especially those at bottom of flex containers) become invisible
- **Root cause**: Allotment manages its own layout system that conflicts with flexbox

### Solution: Use Absolute Positioning
Instead of flexbox, use absolute positioning for layout within Allotment panes:

```typescript
// ❌ WRONG - Flexbox doesn't work in Allotment
<div className="flex flex-col h-full">
  <div className="flex-1"><SliceRenderer /></div>
  <div className="h-8"><SliceSlider /></div>
</div>

// ✅ CORRECT - Use absolute positioning
<div className="relative h-full">
  <div className="absolute inset-0" style={{ bottom: '32px' }}>
    <SliceRenderer />
  </div>
  <div className="absolute bottom-0 left-0 right-0" style={{ height: '32px' }}>
    <SliceSlider />
  </div>
</div>
```

### Key Principle
When components are inside Allotment panes (like FlexibleSlicePanel), avoid flexbox for internal layout. Use absolute positioning or other CSS techniques instead.

## Rendering Architecture

### Dual Rendering Path
The application supports both GPU and CPU rendering:

**GPU Rendering (Primary):**
- WebGPU via `render_loop` crate
- Runtime-loaded WGSL shaders (not build-time compiled)
- Shader sources in [core/render_loop/src/shaders/](core/render_loop/src/shaders/)
- Y-flip happens at buffer readback boundary only
- Consistent world-to-pixel transforms

**CPU Rendering (Fallback):**
- `neuro-cpu` crate provides software rendering
- Used when WebGPU is unavailable
- Matches GPU output exactly (no Y-flip in renderer itself)
- Image convention internally (Y=0 at top)

### Future: Typed Shader Bindings
A plan exists to trial `wgsl_to_wgpu` for build-time typed shader bindings:
- Feature-gated: `typed-shaders` feature flag
- No change to default build until proven stable
- See [memory-bank/SHADER_BINDINGS_PLAN.md](memory-bank/SHADER_BINDINGS_PLAN.md)

### Render Coordination
- `RenderCoordinator` manages multiple views
- `OptimizedRenderService` batches render calls
- Frame-based rendering with render state tracking
- Crosshair synchronization across all views

## Testing Strategy

### Unit Tests
- Rust: `cargo test --workspace`
- UI: `pnpm --filter ui2 test` (Vitest)
- UI with UI: `pnpm --filter ui2 test:ui`

### Integration Tests
- `neuro-integration-tests` crate for cross-component testing
- Tests rendering consistency between CPU and GPU paths
- Tests coordinate system transformations

### Test Data
- Test data in [test-data/](test-data/) directory
- Includes sample NIfTI volumes and GIfTI surfaces
- Example: `bilateral_frontal_roi.func.gii`

## Documentation Structure

### Memory Bank (`/memory-bank/`)
Key architectural documentation:
- `ADR-001-architecture.md` - Core architecture decisions
- `projectbrief.md` - Project goals and vision
- `PLAN-phase1-milestones.md` - Current development phase
- `DEV-bootstrap-guide.md` - Detailed setup instructions
- `repository_structure.md` - Complete directory layout
- `ARCHITECTURE.md` - Overall system architecture
- `Implementation_Roadmap.md` - Implementation plan and roadmap
- `SHADER_BINDINGS_PLAN.md` - Future shader compilation strategy

### UI Documentation (`/ui2/docs/`)
- Component documentation
- Service layer documentation
- Store usage patterns

### Sprint Documentation (`/ui2/` and `/memory-bank/sprints/`)
- `SURFACE_SPRINTS.md` - Surface visualization sprint plans
- `SURFACE_VISUALIZATION_ARCHITECTURE.md` - Surface rendering architecture
- Sprint-specific plans in `memory-bank/sprints/`

## Project Vision

**Goal**: Build the greatest fMRI UI program in the history of the world.

This means:
- **Performance**: Sub-frame rendering times, smooth 60fps interaction
- **Correctness**: Pixel-perfect medical imaging with preserved aspect ratios
- **Usability**: Intuitive, researcher-friendly interface
- **Extensibility**: Plugin system for custom analysis pipelines
- **Reliability**: Stable, tested, production-ready code
- **Cross-platform**: Native performance on macOS, Windows, Linux

Claude Code is fully on board with this vision and committed to achieving it.