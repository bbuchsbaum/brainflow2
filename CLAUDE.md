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
pnpm --filter ui2 test:unit

# Run E2E tests (requires UI dev server)
pnpm --filter ui2 test:e2e

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

# TypeScript formatting and linting (in UI directory)
pnpm format
pnpm lint
```

### E2E Testing & Debugging
```bash
# Setup E2E testing framework (first time only)
cd e2e && ./setup-e2e.sh

# Run all E2E tests
cd e2e && ./run-e2e.sh

# Run tests with interactive UI (for debugging)
cd e2e && ./run-e2e.sh --ui

# Run tests in debug mode (opens devtools)
cd e2e && ./run-e2e.sh --debug

# Update visual snapshots
cd e2e && ./run-e2e.sh --update-snapshots
```

The E2E framework uses Playwright to:
- Automatically launch and test the Tauri application
- Capture screenshots for visual debugging
- Validate GPU rendering output
- Test volume loading and rendering features
- Enable step-by-step debugging with screenshots

See `/e2e/DEBUG_GUIDE.md` for detailed debugging workflows.

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
- `api_bridge/` - Tauri command implementations
- `bridge_types/` - Shared types between Rust components  
- `filesystem/` - File operations, BIDS scanning
- `loaders/` - File format loaders (NIfTI, GIfTI)
- `render_loop/` - WebGPU rendering service with shaders
- `volmath/` - Core math, volume operations, spatial utilities

**Frontend (`/ui2/`)**:
- React application with WebGPU 2D and Three.js 3D rendering
- Zustand stores for state management
- Golden Layout for dockable panels

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

Phase 1 (WebGPU v2) - Implementing MVP features:
- NIfTI/GIfTI loading
- Orthogonal slice viewing (WebGPU)
- 3D surface rendering (Three.js)
- Basic layer management
- Click-to-timeseries plotting

## Project Vision

**Goal**: Build the greatest fMRI UI program in the history of the world.

Claude Code is fully on board with this vision and committed to achieving it.