# Brainflow Project Blueprint

**Version:** 2.0 (Consolidated)  
**Date:** 2025-01-21  
**Architecture:** WebGPU v2 with Tauri

## Executive Summary

Brainflow is a high-performance, cross-platform desktop application for neuroimaging visualization and analysis. Built on a Rust core with TypeScript/Svelte UI, it leverages WebGPU for 2D slice rendering and WebGL (Three.js) for 3D surface visualization.

### Core Objectives
- **Fast Loading & Interaction**: Sub-second file loads, 60+ FPS rendering
- **Advanced GPU Layering**: Multi-volume compositing with real-time controls
- **Integrated Analysis**: Linked views (slice/surface/plot) with synchronized interactions
- **Extensibility**: Plugin architecture for custom loaders and visualizations
- **Cross-Platform**: Native performance on macOS, Windows, Linux

## Architecture Overview

### Technology Stack

#### Backend (Rust)
- **Framework**: Tauri ~2.0
- **GPU**: wgpu ~0.20 (WebGPU implementation)
- **Core Libraries**: 
  - nalgebra (linear algebra)
  - nifti/gifti (file formats)
  - rayon (parallelization)
  - tokio (async runtime)
  - serde/ts-rs (serialization & TS type generation)

#### Frontend (TypeScript/JavaScript)
- **Framework**: SvelteKit ~2.x
- **State Management**: Zustand ~4.x
- **Layout**: GoldenLayout ~2.x
- **3D Graphics**: Three.js ~0.16x
- **Plotting**: Plotly.js (Web Worker)
- **UI Components**: shadcn-svelte

### Architectural Patterns

#### 1. Rust Core / TypeScript UI Separation
```
┌─────────────────────────────────────────────────────┐
│                    TypeScript UI                     │
│  (Orchestration, State Management, User Interaction) │
└─────────────────────┬───────────────────────────────┘
                      │ Tauri IPC Bridge
                      │ (async commands)
┌─────────────────────▼───────────────────────────────┐
│                     Rust Core                        │
│  (Heavy Computation, GPU Management, File I/O)       │
└─────────────────────────────────────────────────────┘
```

**Key Principle**: "Port what hurts; keep what flows"
- Hot-loop math (>10⁷ ops/frame) → Rust
- Large buffers (>32MB) → Rust with SharedArrayBuffer
- UI components & state → TypeScript/Svelte
- Domain orchestration → TypeScript

#### 2. Zero-Copy Data Transfer
- Large volumetric data allocated in Rust
- Transferred via SharedArrayBuffers (SAB) or ArrayBuffers
- TypeScript receives handles, not copies
- GPU textures uploaded directly from Rust buffers

#### 3. GPU-Centric Rendering Pipeline
```
World Space (LPI mm) → Shader (world_to_voxel matrix) → Voxel Space → Texture Sampling
```
- All volumes normalized to canonical LPI (Left-Posterior-Inferior) world space
- Per-layer `world_to_voxel` matrices handle orientation differences
- No CPU-side resampling; all transformation in shaders

#### 4. Plugin Architecture
- TypeScript plugins implement standardized interfaces
- Core API (`@brainflow/api`) defines contracts
- Plugins can be loaders, plotters, or analysis tools
- First-party plugins in monorepo, third-party via npm

## Repository Structure

```
brainflow/
├── core/                        # Rust workspace
│   ├── api_bridge/             # Tauri command implementations
│   ├── render_loop/            # WebGPU rendering service
│   ├── volmath/               # Geometry & spatial math
│   ├── filesystem/            # File operations, BIDS scanning
│   └── loaders/               # File format loaders
│       ├── nifti/
│       └── gifti/
├── ui/                         # SvelteKit application
│   └── src/
│       ├── routes/            # Pages
│       └── lib/
│           ├── components/    # UI components
│           ├── stores/        # Zustand state
│           └── api.ts         # CoreApi wrapper
├── plugins/                    # First-party plugins
│   ├── atlas-loader/
│   └── plot-voxel-histogram/
├── packages/                   # Shared libraries
│   ├── api/                   # @brainflow/api types
│   └── legacy-ts/             # Migrated legacy code
├── src-tauri/                 # Tauri app configuration
├── docs/                      # Documentation
├── schemas/                   # JSON schemas
└── tools/                     # Development utilities
```

## Core Components

### 1. Tauri Bridge & Commands
- **Pattern**: Async commands with snake_case naming
- **Error Handling**: Rust `Result<T, E>` → TypeScript `Promise<T>` rejection
- **Key Commands**:
  - `load_file(path)` → Returns volume/surface handle
  - `request_layer_gpu_resources(spec)` → GPU texture upload
  - `world_to_voxel(volumeId, worldCoord)` → Coordinate transform
  - `get_timeseries_matrix(volumeId, voxelIndices)` → Extract data

### 2. RenderLoopService (Rust/wgpu)
- Manages WebGPU device, queue, and swapchain
- Implements texture atlas for efficient slice storage
- Handles multi-layer compositing via uniform buffer objects (UBOs)
- Key resources:
  - **Volume Texture Atlas**: 2D array or 3D texture
  - **Layer UBOs**: Per-layer display properties
  - **Colormap LUT**: 2D texture array for color mapping

### 3. Volume & Surface Data Model
```rust
// Simplified view of core traits
trait Volume<D> {
    fn space(&self) -> &NeuroSpace;  // Affine transform
    fn as_bytes(&self) -> Option<&[u8]>;  // For GPU upload
}

struct DenseVolume3<T> {
    data: Vec<T>,
    space: NeuroSpace,
    // ...
}
```

### 4. UI Component Architecture
- **VolumeView**: Triple orthogonal slice viewer (WebGPU)
- **SurfaceView**: 3D mesh viewer (Three.js/WebGL)
- **TreeBrowser**: File system navigator
- **LayerPanel**: Layer controls (opacity, colormap, etc.)
- **PlotPanel**: Plotly visualization (Web Worker)

### 5. State Management (Zustand)
```typescript
// Example layer store structure
interface LayerStore {
  layers: Layer[]
  selectedId: string | null
  addLayer: (spec: LayerSpec) => void
  updateDisplay: (id: string, props: Partial<DisplayProps>) => void
  requestGpuResources: (id: string) => Promise<void>
}
```

## Development Guidelines

### Build & Test Pipeline

1. **Static Analysis**
   ```bash
   cargo fmt --all --check
   cargo clippy --workspace
   pnpm lint
   ```

2. **Unit Tests**
   ```bash
   cargo test --workspace
   pnpm test:unit
   ```

3. **Adapter Tests** (Rust-WASM vs Legacy TS)
   ```bash
   wasm-pack test --node -- --package brainflow-volmath
   pnpm test:adapter
   ```

4. **E2E Tests**
   ```bash
   pnpm test:e2e
   ```

### Performance Requirements
- **Texture Upload**: >2 GB/s (discrete GPU), >1 GB/s (integrated)
- **Slice Scrolling**: ≥60 FPS for 256-slice volume
- **Surface Rotation**: ≥90 FPS (M1/M2), ≥60 FPS (Win/RTX2060)
- **Click-to-Plot**: <50ms latency
- **Matrix Extraction**: <120ms for 10k voxel ROI

### Coding Standards
- **Rust**: Follow clippy recommendations, use `Result` for errors
- **TypeScript**: Strict mode, explicit types, immutable patterns
- **Naming**: snake_case for Rust/IPC, camelCase for TS
- **Comments**: Explain "why" not "what", document complex algorithms

## Security & Permissions

### Tauri Capabilities
- File system access scoped to user-selected directories
- No arbitrary command execution
- IPC commands require explicit registration
- Content Security Policy enforced

### Data Handling
- No network requests in Phase 1 (except plugin registry)
- User data never leaves local machine
- Temporary files cleaned on exit

## Plugin Development

### Plugin Manifest (brainflow-plugin.json)
```json
{
  "name": "example-loader",
  "version": "0.1.0",
  "type": "LoaderPlugin",
  "supportedExtensions": [".custom"],
  "entryPoint": "dist/index.js"
}
```

### Plugin Interfaces
```typescript
interface LoaderPlugin {
  name: string
  canLoad(path: string): boolean
  load(path: string): Promise<LoadResult>
}

interface PlotPlugin {
  name: string
  supportedTypes: DataType[]
  plot(data: PlotData, container: HTMLElement): Promise<void>
}
```

## Migration Strategy (Legacy Code)

### Phase 1 Scope
- **Port to Rust**: Core `NeuroSpace`, basic volume accessors, file loaders
- **Keep in TypeScript**: Atlas logic, colormap generation, UI utilities
- **Adapter Testing**: Ensure numerical equivalence during migration

### Future Phases
- Complete volume manipulation APIs
- Advanced resampling algorithms
- Statistical analysis modules

## References

For detailed specifications, see:
- Architecture diagrams and decisions
- Rendering pipeline details  
- UI layout and interaction patterns
- Migration planning documents
- Testing procedures

*This blueprint consolidates the core technical design from the Phase 1 planning documents.*