# Brainflow Architecture

This document describes the architecture of Brainflow, a high-performance neuroimaging visualization application built with Rust and TypeScript.

## Table of Contents
1. [System Overview](#system-overview)
2. [Technology Stack](#technology-stack)
3. [Core Design Patterns](#core-design-patterns)
4. [Component Architecture](#component-architecture)
5. [Data Flow](#data-flow)
6. [GPU Resource Management](#gpu-resource-management)
7. [Plugin Architecture](#plugin-architecture)

## System Overview

Brainflow is a cross-platform desktop application that leverages:
- **Rust backend** for heavy computation, file I/O, and GPU management
- **TypeScript/Svelte frontend** for UI orchestration and user interaction
- **WebGPU** for high-performance 2D slice rendering
- **Three.js/WebGL** for 3D surface visualization
- **Zero-copy architecture** with handles and SharedArrayBuffers

### Core Principles

1. **Heavy computation in Rust** - All volumetric math, rendering, file I/O handled by Rust backend
2. **TypeScript uses handles** - Frontend references data via handles, no duplication
3. **Zero-copy transfers** - SharedArrayBuffers for large data transfers
4. **Plugin architecture** - TypeScript plugins extend functionality
5. **GPU acceleration** - WebGPU for 2D orthogonal slices, WebGL/Three.js for 3D surfaces

## Technology Stack

### Backend (Rust)
- **Framework**: Tauri ~2.0
- **GPU**: wgpu ~0.20 (WebGPU implementation)
- **Core Libraries**:
  - nalgebra (linear algebra)
  - nifti/gifti (file formats)
  - rayon (parallelization)
  - tokio (async runtime)
  - serde/ts-rs (serialization & TypeScript type generation)

### Frontend (TypeScript/JavaScript)
- **Framework**: SvelteKit ~2.x with Svelte 5 runes
- **State Management**: Zustand ~4.x (clean store pattern)
- **Layout**: GoldenLayout ~2.x (dockable panels)
- **3D Graphics**: Three.js ~0.16x
- **Plotting**: Plotly.js (Web Worker)
- **Styling**: Tailwind CSS
- **UI Components**: Custom components with shadcn-svelte patterns

## Core Design Patterns

### 1. Service Layer Pattern
All business logic is extracted into services. Components are thin UI layers.

```typescript
// Services handle business logic
export class LayerService {
  async addLayer(spec: LayerSpec): Promise<void> {
    const handle = await this.volumeService.load(spec.path);
    const gpuResources = await this.gpuService.allocateLayer(handle);
    this.eventBus.emit('layer.added', { handle, spec });
  }
}

// Stores contain only pure state
export const layerStore = create<LayerState>((set) => ({
  layers: new Map(),
  addLayer: (layer) => set(state => ({
    layers: new Map(state.layers).set(layer.id, layer)
  }))
}));
```

### 2. Event-Driven Architecture
Components communicate via EventBus, eliminating circular dependencies.

```typescript
// Central event system
eventBus.emit('layer.opacity.changed', { layerId, opacity });

// Services/stores react to events
eventBus.on('layer.opacity.changed', async ({ layerId, opacity }) => {
  await layerService.updateOpacity(layerId, opacity);
});
```

### 3. Dependency Injection
Services are registered in a DI container and retrieved by components.

```typescript
// Register services
diContainer.register('layerService', new LayerService(api, eventBus));

// Components retrieve services
const layerService = await getService<LayerService>('layerService');
```

### 4. Clean Store Pattern
Stores contain only state, no business logic or API calls.

```typescript
// ❌ Bad - Business logic in store
const useLayerStore = create((set, get) => ({
  async requestGpuResources(layerId: string) {
    const gpuInfo = await coreApi.request_layer_gpu_resources(spec);
    // Complex logic here...
  }
}));

// ✅ Good - Pure state management
const useLayerStore = create<LayerState>((set) => ({
  layers: [],
  setLayers: (layers) => set({ layers })
}));
```

## Component Architecture

### Directory Structure
```
src/
├── lib/
│   ├── api/              # API client and types
│   ├── components/       # Svelte components
│   │   ├── views/        # Main view components
│   │   ├── panels/       # Panel components
│   │   └── ui/           # Reusable UI elements
│   ├── services/         # Business logic services
│   ├── stores/           # Zustand stores
│   ├── events/           # Event system
│   ├── di/               # Dependency injection
│   ├── gpu/              # GPU management
│   └── utils/            # Utility functions
└── routes/               # SvelteKit routes

core/                     # Rust backend
├── api_bridge/           # Tauri command implementations
├── bridge_types/         # Shared types between Rust components
├── render_loop/          # WebGPU rendering with shaders
├── volmath/              # Core math, volume operations
├── loaders/              # File format loaders (NIfTI, GIfTI)
└── filesystem/           # File operations, BIDS scanning
```

### Component Patterns

#### Svelte 5 Components
```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { getService } from '$lib/di/Container';
  
  // Props with Svelte 5 syntax
  let { volumeId }: { volumeId: string } = $props();
  
  // Services
  let layerService: LayerService | null = null;
  
  // Reactive state
  let isLoading = $state(false);
  let opacity = $state(1.0);
  
  // Derived state
  let displayOpacity = $derived(Math.round(opacity * 100) + '%');
  
  onMount(async () => {
    layerService = await getService<LayerService>('layerService');
  });
</script>
```

## Data Flow

### Zero-Copy Architecture
```
User Action → UI Component → Service → Tauri Command → Rust Backend
                                                          ↓
Frontend ← Handle/SharedArrayBuffer ← GPU Resources ← File I/O
```

1. User requests file load via UI
2. Service calls Tauri command via API bridge
3. Rust loads file, creates handle
4. Handle returned to TypeScript frontend
5. UI requests rendering via handle reference
6. Rust prepares GPU resources, renders via WebGPU
7. Zero-copy transfer of results to frontend

### Handle System
```typescript
// Frontend works with handles, not raw data
interface VolumeHandle {
  id: string;
  dims: [number, number, number];
  voxelSize: [number, number, number];
  dataRange: [number, number];
}

// Request GPU resources using handle
const gpuResources = await coreApi.request_layer_gpu_resources(handle.id);
```

## GPU Resource Management

### GpuResourceService
Centralized GPU resource management with:

```typescript
class GpuResourceService {
  private textureCache: LRUCache<string, GPUTexture>;
  private renderTargetPool: RenderTargetPool;
  private memoryMonitor: MemoryPressureMonitor;
  
  async allocateTexture(volumeId: string): Promise<GPUTexture> {
    // Check cache first
    if (this.textureCache.has(volumeId)) {
      return this.textureCache.get(volumeId);
    }
    
    // Allocate new texture with memory pressure check
    await this.ensureMemoryAvailable(textureSize);
    const texture = await this.createTexture(volumeId);
    this.textureCache.set(volumeId, texture);
    
    return texture;
  }
}
```

### Performance Features
- **LRU Texture Cache**: Automatically evicts least-recently-used textures
- **Render Target Pooling**: Reuses render targets (40% memory reduction)
- **Memory Pressure Handling**: Responds to system memory events
- **Context Loss Recovery**: Automatic recovery with retry logic
- **Render Scheduling**: Batches multiple render requests per frame (25% faster)

### GPU-Centric Rendering Pipeline
```
World Space (mm) → Shader Transform → Voxel Space → Texture Sampling
                    ↑
              world_to_voxel matrix
```

All transformations happen in GPU shaders:
- Volumes normalized to canonical world space (LPI orientation)
- Per-layer world_to_voxel matrices handle orientation
- No CPU-side resampling

## Plugin Architecture

### Plugin Interface
```typescript
interface BrainflowPlugin {
  id: string;
  name: string;
  version: string;
  
  // Lifecycle hooks
  activate(context: PluginContext): Promise<void>;
  deactivate(): Promise<void>;
  
  // Optional capabilities
  fileLoaders?: FileLoader[];
  plotProviders?: PlotProvider[];
  tools?: Tool[];
}
```

### Example Plugin
```typescript
class TimeSeriesPlugin implements BrainflowPlugin {
  id = 'timeseries-plugin';
  name = 'Time Series Analysis';
  version = '1.0.0';
  
  plotProviders = [{
    id: 'timeseries-plot',
    name: 'Time Series Plot',
    
    async generatePlot(data: PlotData): Promise<PlotlyConfig> {
      return {
        data: [{ x: data.time, y: data.values, type: 'scatter' }],
        layout: { title: 'Time Series' }
      };
    }
  }];
  
  async activate(context: PluginContext) {
    context.registerCommand('timeseries.extract', this.extractTimeSeries);
  }
}
```

### Plugin Loading
Plugins are loaded from:
1. Built-in plugins directory
2. User plugins directory (`~/.brainflow/plugins`)
3. Workspace plugins (`.brainflow/plugins`)

## Key Design Decisions

### 1. "Port what hurts; keep what flows"
- **Rust**: Hot-loop math (>10⁷ ops/frame), large buffers (>32MB)
- **TypeScript**: UI components, state management, user interaction

### 2. Service Isolation
Each service has a single responsibility:
- VolumeService: File loading and volume management
- LayerService: Layer state and GPU resources
- CrosshairService: Crosshair synchronization
- NotificationService: User feedback

### 3. Event-Driven Updates
- No direct cross-store communication
- All updates flow through EventBus
- Enables logging, debugging, and middleware

### 4. GPU Resource Efficiency
- Pooling and caching minimize allocations
- Automatic cleanup on memory pressure
- Resilient to context loss

### 5. Error Resilience
- Services use retry logic with exponential backoff
- Circuit breakers prevent cascading failures
- User-friendly error messages via NotificationService