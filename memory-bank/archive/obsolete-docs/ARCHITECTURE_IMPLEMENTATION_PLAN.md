# Architecture Implementation Plan - Comprehensive

## Overview
This document provides a comprehensive architectural blueprint for the Brainflow2 codebase transformation, focusing on code quality, maintainability, performance, and scalability. This is a non-medical desktop application prioritizing architectural excellence.

## Table of Contents
1. [Core Architectural Issues](#core-architectural-issues)
2. [Architectural Patterns](#architectural-patterns)
3. [Component Architecture](#component-architecture)
4. [Performance Optimization](#performance-optimization)
5. [Security & Validation](#security--validation)
6. [Testing Infrastructure](#testing-infrastructure)
7. [Implementation Status](#implementation-status)
8. [Implementation Timeline](#implementation-timeline)

## Core Architectural Issues

### 1. Store Architecture Anti-Patterns (CRITICAL)

**Problem**: Direct circular dependencies and business logic in stores
```typescript
// BAD: Current implementation
import { crosshairSlice } from '$lib/stores/crosshairSlice';
requestGpuResources: async (layerId: string) => {
  const gpuInfo = await coreApi.request_layer_gpu_resources(layerEntry.spec);
  // 70+ lines of logic inside store action
}
```

**Solution**: Event-driven architecture with service layer
```typescript
// GOOD: Service layer pattern
export class LayerService {
  async requestGpuResources(spec: LayerSpec): Promise<VolumeLayerGpuInfo> {
    return await this.api.request_layer_gpu_resources(spec);
  }
}

// GOOD: Pure state management
export const useLayerStore = createStore<LayerState>((set) => ({
  layers: [],
  addLayer: (layer) => set(state => ({ layers: [...state.layers, layer] })),
  updateLayer: (id, updates) => set(state => ({
    layers: state.layers.map(l => l.id === id ? {...l, ...updates} : l)
  }))
}));
```

### 2. GPU Resource Management Inefficiency (HIGH)

**Problem**: No pooling, fixed sizes, recreating resources
```typescript
// BAD: Creates new render target when size changes
async ensureOffscreenTarget(width: number, height: number) {
  if (this.offscreenSize?.[0] !== width || this.offscreenSize?.[1] !== height) {
    await coreApi.create_offscreen_render_target(width, height);
  }
}
```

**Solution**: Resource pooling with LRU cache
```typescript
class GpuResourceManager {
  private texturePool = new LRUCache<string, GPUTexture>(10);
  private renderTargetPool = new Map<string, RenderTarget>();

  acquireRenderTarget(width: number, height: number): RenderTarget {
    // Round to nearest power of 2 for better reuse
    const w = Math.pow(2, Math.ceil(Math.log2(width)));
    const h = Math.pow(2, Math.ceil(Math.log2(height)));
    const key = `${w}x${h}`;

    return this.renderTargetPool.get(key) || this.createRenderTarget(w, h);
  }
}
```

### 3. Component Organization Chaos (HIGH)

**Problem**: Mixed responsibilities, inconsistent patterns
- OrthogonalViewGPU.svelte has 1168 lines mixing multiple concerns

**Solution**: Separate concerns with composition
```typescript
// OrthogonalView.svelte - UI only
<script>
  import { useViewportManager } from './viewport';
  import { useRenderManager } from './rendering';
  import SliceCanvas from './SliceCanvas.svelte';
</script>

// viewport.ts - Viewport logic
export function useViewportManager() {
  const scale = $state(1);
  const offset = $state([0, 0]);
  return { scale, offset, pan, zoom };
}

// rendering.ts - GPU logic
export function useRenderManager(viewport) {
  const gpu = getGpuRenderManager();
  return { render: () => gpu.render(viewport) };
}
```

## Architectural Patterns

### 4. Service Layer Pattern
- **Purpose**: Separate business logic from state management
- **Implementation**: Services handle all business logic, stores handle pure state
- **Benefits**: Testability, reusability, clear separation of concerns

### 5. Event-Driven Architecture
- **Purpose**: Eliminate circular dependencies between stores
- **Implementation**: EventBus for decoupled communication
- **Benefits**: Modular architecture, easier testing, better scalability

### 6. Dependency Injection
- **Purpose**: Manage service instances and dependencies
- **Implementation**: DIContainer with lifecycle management
- **Benefits**: Testability, flexibility, clear dependency graph

### 7. Command Query Responsibility Segregation (CQRS)
```typescript
// Commands - Write operations
export class LayerCommands {
  async addLayer(spec: LayerSpec): Promise<void> {
    const errors = this.validator.validate(spec);
    if (errors.length > 0) throw new ValidationError(errors);
    
    await this.repository.add(spec);
    this.eventBus.emit('layer.added', { layerId: spec.id });
  }
}

// Queries - Read operations
export class LayerQueries {
  async getLayerById(id: string): Promise<LayerView> {
    return this.cache.get(`layer:${id}`, async () => {
      const layer = await this.repository.findById(id);
      return this.mapToView(layer);
    });
  }
}
```

### 8. Event Sourcing for State Management
```typescript
interface StateEvent {
  id: string;
  type: string;
  payload: unknown;
  timestamp: number;
}

export class StateEventStore {
  private events: StateEvent[] = [];
  
  append(event: StateEvent): void {
    this.events.push(event);
    this.eventBus.emit(event.type, event);
  }
  
  replay(until?: number): State {
    return this.events.reduce((state, event) => {
      if (until && event.timestamp > until) return state;
      return this.reducer(state, event);
    }, initialState);
  }
}
```

### 9. Repository Pattern
- **Purpose**: Abstract data access layer
- **Implementation**: Interfaces for data operations
- **Benefits**: Swappable data sources, testability

### 10. Facade Pattern
- **Purpose**: Simplified API for complex subsystems
- **Implementation**: High-level API hiding GPU complexity
- **Benefits**: Easier usage, encapsulation

### 11. Strategy Pattern
- **Purpose**: Interchangeable algorithms
- **Implementation**: Rendering strategies, compression algorithms
- **Benefits**: Runtime algorithm selection, extensibility

### 12. Observer Pattern
- **Purpose**: Reactive updates
- **Implementation**: Store subscriptions, event handling
- **Benefits**: Loose coupling, reactive UI

### 13. Factory Pattern
- **Purpose**: Object creation abstraction
- **Implementation**: Service factories, component factories
- **Benefits**: Centralized creation logic, configuration

## Component Architecture

### 14. Bundle Size & Dependencies (MEDIUM)

**Problem**: Full lodash for one function
```typescript
import { debounce } from 'lodash-es'; // Imports 70KB for 1 function
```

**Solution**: Native alternatives
```typescript
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: number;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}
```

### 15. Memory Leaks from Subscriptions (MEDIUM)

**Problem**: Store subscriptions without cleanup

**Solution**: Proper lifecycle management
```typescript
onMount(() => {
  const unsubscribe = useLayerStore.subscribe(handleStoreChange);
  return unsubscribe; // Cleanup on unmount
});
```

### 16. Feature-Based Module Structure

**Current Structure** (Technical grouping):
```
lib/
├── components/     # All components mixed
├── stores/        # All stores mixed
└── gpu/          # All GPU code
```

**New Structure** (Feature grouping):
```
lib/
├── features/
│   ├── volume-viewer/
│   │   ├── components/
│   │   ├── services/
│   │   ├── stores/
│   │   └── index.ts
│   ├── file-browser/
│   └── layer-management/
├── shared/
│   ├── gpu/
│   ├── utils/
│   └── types/
```

### 17. Consistent Component Patterns

```typescript
interface ComponentContract<TProps, TState> {
  // Required lifecycle hooks
  onMount?(): void | (() => void);
  onError?(error: Error): void;

  // Required states
  loading: boolean;
  error: Error | null;

  // Required methods
  reset(): void;
}
```

### 18. Micro-Frontend Architecture

```typescript
export const federationConfig = {
  name: 'brainflow-shell',
  remotes: {
    volumeViewer: 'volumeViewer@http://localhost:3001/remoteEntry.js',
    fileBrowser: 'fileBrowser@http://localhost:3002/remoteEntry.js',
    layerPanel: 'layerPanel@http://localhost:3003/remoteEntry.js'
  }
};
```

## Performance Optimization

### 19. Render Pipeline Optimization (HIGH)

**Problem**: Every state change triggers full re-render

**Solution**: Dirty-flag pattern with render scheduling
```typescript
class RenderScheduler {
  private dirty = new Set<string>();
  private rafId: number | null = null;

  markDirty(layerId: string) {
    this.dirty.add(layerId);
    this.scheduleRender();
  }

  private scheduleRender() {
    if (this.rafId) return;
    
    this.rafId = requestAnimationFrame(() => {
      this.renderDirtyLayers();
      this.dirty.clear();
      this.rafId = null;
    });
  }
}
```

### 20. WebWorker for Heavy Computation

**Problem**: Heavy computations block UI thread

**Solution**: Offload to WebWorker
```typescript
export class StatsWorker {
  calculateHistogram(data: Float32Array): number[] {
    const histogram = new Array(256).fill(0);
    for (let i = 0; i < data.length; i++) {
      histogram[Math.floor(data[i] * 255)]++;
    }
    return histogram;
  }
}

// Usage
const worker = await getStatsWorker();
const histogram = await worker.calculateHistogram(volumeData);
```

### 21. Virtual Scrolling for Large Lists

```typescript
const virtualizer = createVirtualizer({
  count: files.length,
  getScrollElement: () => scrollElement,
  estimateSize: () => 35,
  overscan: 5
});
```

### 22. Progressive Resource Loading

```typescript
export class ResourceLoader {
  private queue = new PriorityQueue<LoadTask>();
  
  async load<T>(
    key: string,
    loader: () => Promise<T>,
    priority: Priority = Priority.Normal
  ): Promise<T> {
    // Priority-based loading
  }
}
```

### 23. GPU Resource Lifecycle Management

```typescript
class ResourceLifecycleManager {
  private resources = new Map<string, GPUResource>();
  private refCounts = new Map<string, number>();

  acquire(id: string): GPUResource {
    this.refCounts.set(id, (this.refCounts.get(id) || 0) + 1);
    return this.resources.get(id) || this.create(id);
  }

  release(id: string) {
    const count = (this.refCounts.get(id) || 0) - 1;
    if (count <= 0) {
      this.resources.get(id)?.destroy();
      this.resources.delete(id);
      this.refCounts.delete(id);
    }
  }
}
```

## Security & Validation

### 24. Input Validation Framework

```typescript
export const FilePathSchema = z.string()
  .min(1, 'Path cannot be empty')
  .refine(path => !path.includes('..'), 'Path traversal detected')
  .refine(path => path.startsWith('/'), 'Must be absolute path');

export const VolumeSpecSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  path: FilePathSchema,
  dimensions: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
  voxelSize: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
  dataType: z.enum(['uint8', 'int16', 'float32', 'float64'])
});
```

### 25. Content Security Policy

```typescript
export class ContentSecurityManager {
  generateCSPHeader(): string {
    return [
      `default-src 'self'`,
      `script-src 'self' 'nonce-${this.nonce}'`,
      `style-src 'self' 'unsafe-inline'`,
      `img-src 'self' data: blob:`,
      `connect-src 'self' ${[...this.trustedOrigins].join(' ')}`,
      `worker-src 'self' blob:`,
      `object-src 'none'`
    ].join('; ');
  }
}
```

### 26. Rate Limiting
- API endpoint protection
- Resource allocation limits
- User action throttling

### 27. Audit Logging
- User actions tracking
- Security event logging
- Performance metrics logging

## Testing Infrastructure

### 28. Visual Regression Testing

```typescript
test('renders axial slice correctly', async ({ page }) => {
  await page.click('[data-testid="axial-view"]');
  await page.waitForTimeout(100);
  
  // Take Percy snapshot
  await percySnapshot(page, 'Volume - Axial View');
  
  // Check pixel values
  const pixels = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, 10, 10);
    return Array.from(imageData.data);
  });
  
  expect(pixels).toMatchSnapshot('axial-pixels.json');
});
```

### 29. Performance Testing Suite

```typescript
describe('Rendering Performance', () => {
  bench('render single slice', async () => {
    await renderVolume({
      volumeId: 'test-volume',
      slice: 100,
      viewport: { width: 512, height: 512 }
    });
  });
});
```

### 30. Test Infrastructure Components
- Mock services for unit testing
- WebGPU mocking for CI/CD
- Visual regression with Percy
- Performance benchmarking with Vitest
- E2E testing with Playwright

## Monitoring & Production

### 31. Runtime Performance Monitoring

```typescript
export class PerformanceMonitor {
  private observers: PerformanceObserver[] = [];
  
  startMonitoring() {
    this.observeLongTasks();
    this.observeLayoutShifts();
    this.observeInteractions();
  }
  
  private observeLongTasks() {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 50) {
          this.recordMetric('long-task', {
            duration: entry.duration,
            startTime: entry.startTime
          });
        }
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  }
}
```

### 32. Shader Hot Module Replacement

```typescript
export class ShaderManager {
  async loadShader(name: string, path: string): Promise<GPUShaderModule> {
    const source = await this.loadShaderSource(path);
    const module = this.device.createShaderModule({ code: source });
    
    if (import.meta.env.DEV) {
      this.watchShader(name, path);
    }
    
    return module;
  }
}
```

### 33. Build Optimization
- Tree shaking
- Code splitting
- Asset compression
- Bundle analysis

## Implementation Status

### ✅ Completed

#### Services & Infrastructure
- [x] Event Bus implementation with full event system
- [x] Dependency Injection Container
- [x] Layer Service with complete CRUD operations
- [x] Volume Service with repository pattern
- [x] Crosshair Service for coordinate management  
- [x] Mount Service for file system operations
- [x] Config Service for preferences
- [x] Notification Service with toast UI
- [x] Annotation Service for annotations
- [x] Stream Manager for data streaming
- [x] GPU Resource Service (partial)
- [x] Validation Service and Zod schemas
- [x] Store Service Bridge for event integration

#### Stores & State Management
- [x] Clean layer store (Map-based)
- [x] Clean crosshair store
- [x] Clean volume store  
- [x] Mount store
- [x] Removed circular dependencies
- [x] Event-driven store updates

#### Component Migrations (9/15 completed)
- [x] TreeBrowser - Full service integration
- [x] OrthogonalViewGPU - GPU service pattern
- [x] VolumeView - Clean architecture
- [x] StatusBar - Event-driven updates
- [x] OrthogonalViewContainer - Layout management
- [x] SliceViewerGPU - Single slice rendering
- [x] FileBrowserPanel - Mount service integration
- [x] LayerControls - Full service pattern
- [x] LayerPanel - Compact vertical design

#### Testing Infrastructure
- [x] Mock service factory
- [x] Mock EventBus with inspection
- [x] Mock stores utilities
- [x] Mock DI container
- [x] Browser API mocks (WebGPU, etc.)
- [x] Test setup with Vitest
- [x] Component test examples (4 components)
- [x] Accessibility test patterns

#### Documentation
- [x] Architecture Implementation Plan (31 points)
- [x] UI CLAUDE.md with patterns & guidelines
- [x] Component Migration Summary
- [x] Testing Progress Summary

#### Utilities & Helpers
- [x] LRU Cache implementation
- [x] Debounce utility (enhanced)
- [x] Sanitization utilities
- [x] Error boundaries
- [x] Render scheduler
- [x] Validated API wrapper

### 🚧 In Progress
- [ ] PlotPanel component (doesn't exist yet - M5/M6)
- [ ] GPU Resource Service (complete implementation)
- [ ] Remaining component tests (VolumeView, FileBrowserPanel, etc.)

### 📋 TODO

#### Remaining Components (6/15)
- [ ] PlotPanel (needs creation)
- [ ] LayerList
- [ ] ViewControls  
- [ ] AnnotationPanel
- [ ] TimeSeriesViewer
- [ ] SurfaceRenderer

#### Advanced Patterns
- [ ] CQRS command/query handlers
- [ ] State machines with XState
- [ ] Event sourcing store
- [ ] Plugin Manager
- [ ] WebWorker compute pools

#### Testing & Quality
- [ ] Visual regression with Playwright
- [ ] E2E test suite
- [ ] Performance benchmarks
- [ ] Bundle size monitoring
- [ ] Memory leak detection

#### Production Features
- [ ] Runtime monitoring dashboard
- [ ] Error tracking integration
- [ ] Performance metrics collection
- [ ] User analytics (privacy-respecting)
- [ ] Crash reporting

## Implementation Timeline

### Month 1: Foundation (Weeks 1-4)
**Week 1-2**: Service Layer & DI
- Extract services from stores
- Set up dependency injection
- Implement event bus

**Week 3-4**: Validation & Security
- Implement validation framework
- Add security hardening
- Remove console.logs

### Month 2: Performance (Weeks 5-8)
**Week 5-6**: GPU Optimization
- Implement GPU resource pooling
- Add render scheduler
- Resource lifecycle management

**Week 7-8**: Bundle & Loading
- Optimize bundle size
- Add performance monitoring
- Implement lazy loading

### Month 3: Architecture (Weeks 9-12)
**Week 9-10**: Advanced Patterns
- Implement CQRS
- Add event sourcing
- Repository pattern

**Week 11-12**: State Management
- Implement state machines
- Micro-frontend preparation
- Feature-based reorganization

### Month 4: Quality (Weeks 13-16)
**Week 13-14**: Testing Infrastructure
- Set up visual regression
- Add performance tests
- Unit test coverage

**Week 15-16**: Monitoring
- Implement monitoring service
- Add performance tracking
- Set up alerting

### Month 5: Production (Weeks 17-20)
**Week 17-18**: Build Pipeline
- Optimize build process
- Set up deployment
- Add quality gates

**Week 19-20**: Documentation
- Create developer docs
- API documentation
- Training materials

### Month 6: Polish (Weeks 21-24)
**Week 21-22**: Performance Tuning
- Analyze metrics
- Optimize bottlenecks
- Load testing

**Week 23-24**: Launch Preparation
- Security audit
- Final testing
- Release preparation

## Success Metrics

### Code Quality
- Cyclomatic complexity: <5 per function
- File size: <300 lines per file
- Test coverage: >80%
- Type coverage: 100%
- No circular dependencies

### Performance
- Bundle size: <1.5MB
- First paint: <200ms
- 60 FPS during interaction
- Memory usage: <500MB for 10 volumes
- GPU memory: <80% utilization

### Developer Experience
- Build time: <10s
- Test run time: <30s
- New feature time: -40% reduction
- Onboarding time: <1 day
- Hot reload: <500ms

### Architecture
- Service isolation: 100%
- Store purity: 100%
- Component size: <300 lines
- Dependency depth: <5 levels

## UI Layout

The UI maintains the GoldenLayout structure with improvements:

```
┌─────────────────────────────────────────────────────┐
│                    Header                           │
├────────────────┬────────────────────────────────────┤
│                │                                    │
│ TreeBrowser    │        OrthogonalView            │
│   (25%)        │           (75%)                   │
├────────────────┤                                    │
│                │                                    │
│ PlotPanel      ├────────────────────────────────────┤
│   (25%)        │        LayerPanel                 │
│                │   (Unified selection + controls)  │
└────────────────┴────────────────────────────────────┘
                 Status Bar (GPU | FPS | Status)
```

### Key UI Improvements
- Single LayerPanel combining selection and controls
- Compact, vertical control layout with collapsible sections
- Space-efficient design with progressive disclosure
- Modern slider components with inline values
- Status bar with real-time metrics

## Component Specifications

### Core Services

#### LayerService
- Manages layer lifecycle
- GPU resource allocation
- State synchronization
- Event emission

#### VolumeService
- Volume loading/unloading
- Metadata management
- Coordinate transformations
- Data access patterns

#### RenderService
- GPU pipeline management
- Shader compilation
- Resource binding
- Frame scheduling

#### ConfigService
- Application settings
- User preferences
- Plugin configuration
- Persistence layer

### Utility Services

#### NotificationService
- User notifications
- Error reporting
- Progress tracking
- Toast messages

#### ValidationService
- Input validation
- Schema enforcement
- Error formatting
- Type safety

#### MonitoringService
- Performance metrics
- Error tracking
- Usage analytics
- Resource monitoring

### Infrastructure

#### EventBus
- Decoupled communication
- Type-safe events
- Event replay
- Debugging support

#### DIContainer
- Service registration
- Lifecycle management
- Dependency resolution
- Scope handling

#### ResourceManager
- GPU resource pooling
- Memory management
- Reference counting
- Garbage collection

## Development Guidelines

### Code Style
- TypeScript strict mode
- ESLint + Prettier
- Conventional commits
- JSDoc for public APIs

### Git Workflow
- Feature branches
- PR reviews required
- CI must pass
- Squash merging

### Testing Requirements
- Unit tests for services
- Integration tests for features
- Visual regression for UI
- Performance benchmarks

### Documentation
- Architecture decisions (ADRs)
- API documentation
- Component storybook
- Video tutorials

This comprehensive plan transforms the codebase from a monolithic, tightly-coupled system into a modular, testable, and maintainable architecture that scales with team and feature requirements.