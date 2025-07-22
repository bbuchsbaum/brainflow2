# Brainflow Development Guide

This guide provides practical information for developers working with the Brainflow codebase.

## Table of Contents
1. [Development Setup](#development-setup)
2. [Architecture Patterns](#architecture-patterns)
3. [Component Development](#component-development)
4. [State Management](#state-management)
5. [Testing Strategy](#testing-strategy)
6. [Common Tasks](#common-tasks)
7. [Performance Guidelines](#performance-guidelines)
8. [Debugging](#debugging)

## Development Setup

### Prerequisites
- Rust (latest stable)
- Node.js 18+ and pnpm
- Platform-specific dependencies:
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `webkit2gtk-4.1`, `libgtk-3-dev`
  - **Windows**: Visual Studio Build Tools

### Initial Setup
```bash
# Clone the repository
git clone https://github.com/your-org/brainflow2.git
cd brainflow2

# Install dependencies
cargo fetch
pnpm install

# Build TypeScript types
cd packages/api && pnpm run build && cd ../..

# Run development server
cargo tauri dev
```

### Essential Commands
```bash
# Development
cargo tauri dev              # Run with hot-reloading
cargo test --workspace       # Run Rust tests
pnpm --filter ui test:unit   # Run UI unit tests
pnpm --filter ui test:e2e    # Run E2E tests

# Code quality
cargo fmt --all              # Format Rust code
cargo clippy --workspace     # Lint Rust code
pnpm --filter ui format      # Format TypeScript
pnpm --filter ui lint        # Lint TypeScript

# Build
cargo tauri build            # Build for production
cargo xtask ts-bindings      # Generate TypeScript types from Rust
```

## Architecture Patterns

### Service Layer Pattern
All business logic must be extracted into services. Components should only handle UI concerns.

```typescript
// ✅ Good - Service handles business logic
export class VolumeService {
  constructor(
    private api: CoreApi,
    private eventBus: EventBus,
    private notificationService: NotificationService
  ) {}

  async loadVolume(path: string): Promise<string> {
    try {
      const volumeInfo = await this.api.load_file(path);
      const handle = volumeInfo.handle;
      
      // Request GPU resources
      await this.api.request_layer_gpu_resources(handle);
      
      // Emit success event
      this.eventBus.emit('volume.loaded', { handle, volumeInfo });
      
      return handle;
    } catch (error) {
      this.notificationService.error('Failed to load volume', { error });
      throw error;
    }
  }
}

// ❌ Bad - Business logic in component
async function handleLoad(path: string) {
  const volumeInfo = await coreApi.load_file(path);
  await coreApi.request_layer_gpu_resources(volumeInfo.handle);
  volumeStore.setVolume(volumeInfo.handle, volumeInfo);
}
```

### Event-Driven Communication
Use EventBus for all cross-component communication.

```typescript
// Emit events from services
this.eventBus.emit('crosshair.changed', { position: [x, y, z] });

// Subscribe in components/services
const unsubscribe = eventBus.on('crosshair.changed', ({ position }) => {
  updateCrosshairDisplay(position);
});

// Always clean up subscriptions
onDestroy(() => {
  unsubscribe();
});
```

### Dependency Injection
Register and retrieve services using the DI container.

```typescript
// Register services (in app initialization)
diContainer.register('volumeService', new VolumeService(api, eventBus));
diContainer.register('layerService', new LayerService(api, eventBus));

// Retrieve in components
onMount(async () => {
  volumeService = await getService<VolumeService>('volumeService');
});
```

## Component Development

### Svelte 5 Component Template
```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getService } from '$lib/di/Container';
  import { getEventBus } from '$lib/events/EventBus';
  import type { MyService } from '$lib/services/MyService';
  
  // Props (Svelte 5 syntax)
  let { 
    volumeId,
    initialOpacity = 1.0 
  }: { 
    volumeId: string;
    initialOpacity?: number;
  } = $props();
  
  // Services
  let myService: MyService | null = null;
  let eventBus = getEventBus();
  
  // State (Svelte 5 runes)
  let isLoading = $state(false);
  let opacity = $state(initialOpacity);
  let error = $state<string | null>(null);
  
  // Derived state
  let displayOpacity = $derived(`${Math.round(opacity * 100)}%`);
  let canUpdate = $derived(!isLoading && !error);
  
  // Event subscriptions
  let unsubscribes: Array<() => void> = [];
  
  async function updateOpacity(newOpacity: number) {
    if (!myService || !canUpdate) return;
    
    isLoading = true;
    error = null;
    
    try {
      await myService.updateOpacity(volumeId, newOpacity);
      opacity = newOpacity;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      isLoading = false;
    }
  }
  
  onMount(async () => {
    // Get services
    myService = await getService<MyService>('myService');
    
    // Subscribe to events
    unsubscribes.push(
      eventBus.on('opacity.external.changed', ({ id, opacity: newOpacity }) => {
        if (id === volumeId) {
          opacity = newOpacity;
        }
      })
    );
  });
  
  onDestroy(() => {
    // Clean up all subscriptions
    unsubscribes.forEach(fn => fn());
  });
</script>

<div class="component">
  {#if error}
    <div class="error">{error}</div>
  {/if}
  
  <label>
    Opacity: {displayOpacity}
    <input 
      type="range" 
      min="0" 
      max="1" 
      step="0.01"
      value={opacity}
      disabled={!canUpdate}
      oninput={(e) => updateOpacity(parseFloat(e.currentTarget.value))}
    />
  </label>
</div>
```

### Component Guidelines
1. **Keep components thin** - Only UI logic, no business logic
2. **Use services** - All API calls and data manipulation via services
3. **Use events** - Component communication via EventBus
4. **Clean state** - Local state with `$state`, derived with `$derived`
5. **Proper cleanup** - Always clean up subscriptions in `onDestroy`
6. **Error handling** - Show user-friendly errors via NotificationService

## State Management

### Clean Store Pattern
Stores should contain only state and pure mutations. No async operations or business logic.

```typescript
// stores/layerStore.ts
import { create } from 'zustand';

interface LayerState {
  layers: Map<string, Layer>;
  activeLayerId: string | null;
  
  // Pure state mutations only
  setLayers: (layers: Layer[]) => void;
  addLayer: (layer: Layer) => void;
  removeLayer: (id: string) => void;
  setActiveLayer: (id: string | null) => void;
}

export const useLayerStore = create<LayerState>((set) => ({
  layers: new Map(),
  activeLayerId: null,
  
  setLayers: (layers) => set({
    layers: new Map(layers.map(l => [l.id, l]))
  }),
  
  addLayer: (layer) => set((state) => ({
    layers: new Map(state.layers).set(layer.id, layer)
  })),
  
  removeLayer: (id) => set((state) => {
    const layers = new Map(state.layers);
    layers.delete(id);
    return { layers };
  }),
  
  setActiveLayer: (id) => set({ activeLayerId: id })
}));
```

### Store Usage in Services
```typescript
export class LayerService {
  async addLayer(spec: LayerSpec): Promise<void> {
    // Business logic in service
    const volumeInfo = await this.api.load_file(spec.path);
    const gpuResources = await this.api.request_layer_gpu_resources(volumeInfo.handle);
    
    // Update store with pure data
    useLayerStore.getState().addLayer({
      id: volumeInfo.handle,
      spec,
      volumeInfo,
      gpuResources
    });
    
    // Emit event for other systems
    this.eventBus.emit('layer.added', { id: volumeInfo.handle });
  }
}
```

## Testing Strategy

### Test Structure
```
tests/
├── unit/           # Unit tests for individual functions/classes
├── integration/    # Integration tests for service interactions
├── component/      # Component tests with mocked services
└── e2e/            # End-to-end tests with real backend
```

### Unit Testing Services
```typescript
import { describe, it, expect, vi } from 'vitest';
import { VolumeService } from './VolumeService';
import { createMockApi, createMockEventBus } from '$lib/test-utils';

describe('VolumeService', () => {
  it('should load volume and emit event', async () => {
    const mockApi = createMockApi({
      load_file: vi.fn().mockResolvedValue({ 
        handle: 'test-handle',
        dims: [256, 256, 128]
      })
    });
    
    const mockEventBus = createMockEventBus();
    const service = new VolumeService(mockApi, mockEventBus);
    
    const handle = await service.loadVolume('/test/path.nii');
    
    expect(handle).toBe('test-handle');
    expect(mockApi.load_file).toHaveBeenCalledWith('/test/path.nii');
    expect(mockEventBus.emit).toHaveBeenCalledWith('volume.loaded', {
      handle: 'test-handle',
      volumeInfo: expect.any(Object)
    });
  });
});
```

### Component Testing
```typescript
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import VolumeLoader from './VolumeLoader.svelte';
import { mockService } from '$lib/test-utils';

describe('VolumeLoader', () => {
  it('should load volume on button click', async () => {
    const volumeService = mockService<VolumeService>({
      loadVolume: vi.fn().mockResolvedValue('test-handle')
    });
    
    const { getByText, getByRole } = render(VolumeLoader, {
      props: { path: '/test/volume.nii' }
    });
    
    const button = getByRole('button', { name: 'Load Volume' });
    await fireEvent.click(button);
    
    await waitFor(() => {
      expect(volumeService.loadVolume).toHaveBeenCalledWith('/test/volume.nii');
      expect(getByText('Volume loaded')).toBeInTheDocument();
    });
  });
});
```

### E2E Testing
```typescript
import { test, expect } from '@playwright/test';
import { launchApp, loadTestVolume } from './e2e-utils';

test('load and display NIfTI volume', async () => {
  const app = await launchApp();
  const page = await app.firstWindow();
  
  // Load test volume
  await page.click('button:has-text("Load Volume")');
  await page.selectFile('input[type="file"]', './test-data/brain.nii.gz');
  
  // Verify volume loaded
  await expect(page.locator('.volume-info')).toContainText('256 × 256 × 128');
  
  // Verify GPU rendering
  const canvas = page.locator('canvas.slice-viewer');
  await expect(canvas).toBeVisible();
  
  // Take screenshot for visual regression
  await expect(canvas).toHaveScreenshot('volume-loaded.png');
});
```

## Common Tasks

### Adding a New Service
1. Create service class in `src/lib/services/`
2. Register in DI container initialization
3. Create interface for type safety
4. Add tests

```typescript
// src/lib/services/AnnotationService.ts
export interface AnnotationService {
  addAnnotation(annotation: Annotation): Promise<void>;
  removeAnnotation(id: string): Promise<void>;
  getAnnotations(volumeId: string): Promise<Annotation[]>;
}

export class AnnotationServiceImpl implements AnnotationService {
  constructor(
    private api: CoreApi,
    private eventBus: EventBus
  ) {}
  
  async addAnnotation(annotation: Annotation): Promise<void> {
    await this.api.save_annotation(annotation);
    this.eventBus.emit('annotation.added', annotation);
  }
}

// Register in app initialization
diContainer.register('annotationService', new AnnotationServiceImpl(api, eventBus));
```

### Adding a New Store
1. Create store with clean pattern
2. No business logic, only state
3. Export typed hooks

```typescript
// src/lib/stores/annotationStore.ts
interface AnnotationState {
  annotations: Map<string, Annotation>;
  selectedId: string | null;
  
  // Pure mutations
  setAnnotations: (annotations: Annotation[]) => void;
  selectAnnotation: (id: string | null) => void;
}

export const useAnnotationStore = create<AnnotationState>((set) => ({
  annotations: new Map(),
  selectedId: null,
  
  setAnnotations: (annotations) => set({
    annotations: new Map(annotations.map(a => [a.id, a]))
  }),
  
  selectAnnotation: (id) => set({ selectedId: id })
}));
```

### Adding a New Component
1. Use the component template
2. Retrieve services via DI
3. Subscribe to relevant events
4. Clean up properly

### Handling Errors
```typescript
// In services
try {
  const result = await riskyOperation();
  return result;
} catch (error) {
  // Log for debugging
  console.error('[ServiceName] Operation failed:', error);
  
  // Notify user
  this.notificationService.error('Operation failed', { 
    error,
    context: { operation: 'riskyOperation' }
  });
  
  // Re-throw for caller to handle
  throw error;
}

// In components
try {
  await service.doSomething();
} catch (error) {
  // Error already logged/notified by service
  // Just update local state
  errorState = 'Failed to complete operation';
}
```

## Performance Guidelines

### GPU Resource Management
1. **Request resources lazily** - Only when needed for rendering
2. **Release promptly** - When layer removed or hidden
3. **Use pooling** - RenderTargetPool for temporary buffers
4. **Monitor memory** - React to pressure events

```typescript
// Good pattern for GPU resources
class LayerRenderer {
  private resourceHandle: string | null = null;
  
  async ensureResources(): Promise<void> {
    if (!this.resourceHandle) {
      this.resourceHandle = await gpuService.allocateLayer(this.layerId);
    }
  }
  
  async render(): Promise<void> {
    await this.ensureResources();
    // Render using resourceHandle
  }
  
  async cleanup(): Promise<void> {
    if (this.resourceHandle) {
      await gpuService.releaseLayer(this.resourceHandle);
      this.resourceHandle = null;
    }
  }
}
```

### State Updates
1. **Batch updates** - Use transactions for multiple changes
2. **Debounce inputs** - For sliders and continuous updates
3. **Use derived state** - Instead of recalculating in render

```typescript
// Debounced updates
const debouncedUpdate = debounce((value: number) => {
  service.updateValue(value);
}, 300);

// Batch store updates
useLayerStore.setState((state) => ({
  layers: new Map(state.layers),
  activeLayerId: newId,
  // Multiple updates in one transaction
}));
```

### Rendering Optimization
1. **Use dirty flags** - Only re-render when needed
2. **Implement view frustum culling** - Don't render invisible layers
3. **LOD (Level of Detail)** - Lower quality for thumbnails/previews

## Debugging

### Debug Mode
Enable debug logging:
```javascript
localStorage.setItem('debug', 'brainflow:*');
```

### Event Monitoring
```typescript
// Log all events
eventBus.on('*', (eventName, data) => {
  console.log(`[Event] ${eventName}:`, data);
});
```

### GPU Debugging
1. Check WebGPU status: `chrome://gpu`
2. Enable GPU validation: `localStorage.setItem('gpu-validation', 'true')`
3. Use diagnostic page: Navigate to `/diagnostic`

### Performance Profiling
```typescript
// Use diagnostic logger
import { diagnosticLogger } from '$lib/utils/diagnosticLogger';

diagnosticLogger.checkpoint('Load Volume', async () => {
  return await volumeService.loadVolume(path);
});

// Get report
diagnosticLogger.getDiagnosticReport();
```

### Common Issues

#### GPU Context Lost
```typescript
// Services should handle context loss
class GpuService {
  private async withContextRecovery<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error.message.includes('context lost')) {
        await this.reinitialize();
        return await operation(); // Retry once
      }
      throw error;
    }
  }
}
```

#### Memory Leaks
- Always unsubscribe from events
- Release GPU resources
- Clear large arrays/buffers
- Use WeakMap for object associations

#### Circular Dependencies
- Use EventBus instead of direct imports
- Services should not import stores
- Stores should not import other stores