# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Brainflow is a high-performance, cross-platform desktop neuroimaging application built with:
- **Backend**: Rust with Tauri, wgpu for WebGPU rendering
- **Frontend**: SvelteKit, TypeScript, Three.js (3D), WebGPU (2D slices)
- **State Management**: Zustand
- **UI**: Tailwind CSS, Golden Layout for docking

## Essential Commands

### Development
```bash
# Run development server (hot-reloading)
cargo tauri dev

# Run Rust tests
cargo test --workspace

# Run UI unit tests
pnpm --filter ui test:unit

# Run E2E tests (requires UI dev server)
pnpm --filter ui test:e2e

# Build application
cargo tauri build

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

**Frontend (`/ui/`)**:
- SvelteKit application with WebGPU 2D and Three.js 3D rendering
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

## Key Documentation

Essential architectural docs in `/memory-bank/`:
- `ADR-001-architecture.md` - Core architecture decisions
- `projectbrief.md` - Project goals and vision
- `PLAN-phase1-milestones.md` - Current development phase
- `DEV-bootstrap-guide.md` - Detailed setup instructions
- `repository_structure.md` - Complete directory layout

## Current Status

Phase 1 (WebGPU v2) - Implementing MVP features:
- NIfTI/GIfTI loading
- Orthogonal slice viewing (WebGPU)
- 3D surface rendering (Three.js)
- Basic layer management
- Click-to-timeseries plotting