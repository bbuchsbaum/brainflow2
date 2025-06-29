# Code Context for Svelte UI Review

## Critical Code Paths

### 1. GPU Rendering Pipeline

#### SliceViewerGPU Component Flow:
```typescript
// Component receives props
volumeMeta -> ViewFrame calculation -> GPU render request -> Canvas display

// Key integration points:
1. Frame calculation (geometry/viewFrameExplicit.ts)
2. GPU render manager (gpu/renderManager.ts)
3. Annotation overlay (canvas-based)
4. Mouse interaction handling
```

#### Performance-Critical Loop:
```typescript
// In SliceViewerGPU.svelte
async function updateGpuFrame() {
  if (!renderManager || !canvasElement) return;
  
  const frame = calculateViewFrame(/* ... */);
  const result = await renderManager.render({
    frame,
    layers: gpuLayers,
    showCrosshair,
    crosshairWorld: [crosshairWorld.x, crosshairWorld.y, crosshairWorld.z]
  });
  
  // PNG to canvas - potential bottleneck
  displayPngOnCanvas(result.imageData);
}
```

### 2. State Management Pattern

#### Layer Store Architecture:
```typescript
interface LayerEntry {
  spec: LayerSpec;           // Layer configuration
  gpu?: VolumeLayerGpuInfo;  // GPU resources (if allocated)
  isLoadingGpu: boolean;     // Loading state
  error?: string;            // Error state
}

// Async GPU resource management
async requestGpuResources(layerId: string) {
  // 1. Find layer
  // 2. Call Tauri API
  // 3. Update store with GPU info
  // 4. Handle errors
}
```

### 3. Tauri API Integration

#### Current Pattern:
```typescript
// api.ts wraps all Tauri commands
async function load_file(path: string): Promise<VolumeHandleInfo> {
  return invokeWithReady<VolumeHandleInfo>('plugin:api-bridge|load_file', { path });
}

// Components use via:
const handleInfo = await coreApi.load_file(path);
```

### 4. Reactive Patterns

#### Svelte 5 Runes Usage:
```typescript
// State
let crosshairWorld = $state({ x: 0, y: 0, z: 0 });

// Computed
let gpuLayers = $derived(/* compute from state */);

// Effects
$effect(() => {
  // Subscribe to stores
  return unsubscribe;
});
```

## Known Issues and Concerns

### 1. PNG Transfer Overhead
Currently, GPU renders to PNG, transfers as binary, then draws to canvas. This involves:
- GPU render to texture
- Encode to PNG (Rust side)
- Transfer via IPC
- Decode PNG (JS side)
- Draw to canvas

**Question**: Should we use SharedArrayBuffer or OffscreenCanvas?

### 2. Store Subscription Pattern
Mixing Zustand with Svelte reactivity:
```typescript
$effect(() => {
  const unsubscribe = useLayerStore.subscribe((state) => {
    // Update local state from store
  });
  return unsubscribe;
});
```

**Question**: Is this the optimal pattern or should we use a Svelte-native store?

### 3. Component Prop Drilling
VolumeView -> OrthogonalViewGPU -> SliceViewerGPU

Each level passes through:
- volumeMeta
- layers
- crosshairWorld
- event handlers

**Question**: Should we use context or a different pattern?

### 4. GPU Resource Lifecycle
Resources are allocated on demand but cleanup is unclear:
```typescript
// Allocation is explicit
await useLayerStore.getState().requestGpuResources(layerId);

// But when/how are they released?
// Only on component unmount? Layer removal?
```

### 5. Type Generation Pipeline
```bash
cargo xtask ts-bindings
```
Generates types in `/packages/api/src/generated/`

**Concern**: Manual process, could get out of sync

## Performance Hotspots

### 1. TreeBrowser Virtual Scrolling
```typescript
// Current implementation uses reactive blocks
$: startIdx = Math.floor(scrollTop / itemHeight);
$: endIdx = Math.min(startIdx + visibleCount + overscan, flatNodes.length);
$: visibleNodes = flatNodes.slice(startIdx, endIdx);
```

**Load test**: 10,000+ files in directory

### 2. Annotation Rendering
```typescript
// Renders on every frame
function renderAnnotations() {
  ctx.clearRect(0, 0, width, height);
  for (const annotation of annotations) {
    drawAnnotation(ctx, annotation, worldToScreen);
  }
}
```

**Concern**: No dirty checking or render optimization

### 3. Window/Level Updates
Frequent slider updates trigger:
1. Store update
2. Derived state recalculation  
3. GPU uniform buffer update
4. Full re-render

**Question**: Should we debounce more aggressively?

## Integration Test Scenarios

### 1. Large Volume Loading
- Load 512x512x512 volume
- Measure time to first render
- Monitor memory usage
- Test navigation responsiveness

### 2. Multi-Layer Rendering
- Load 3-4 volumes
- Adjust opacity on each
- Measure frame rate during interaction
- Check GPU memory usage

### 3. Rapid State Changes
- Quickly switch between colormaps
- Rapidly adjust window/level
- Fast crosshair movement
- Monitor for dropped frames or lag

### 4. Component Mount/Unmount
- Rapidly create/destroy VolumeView components
- Check for memory leaks
- Verify GPU resources are released
- Monitor handle cleanup

## Questions for Reviewers

### Architecture
1. Is the component hierarchy optimal for performance?
2. Should we use Svelte context for cross-component state?
3. Is the GPU rendering abstraction at the right level?
4. How can we better handle async operations in components?

### Performance  
1. What's the best way to transfer pixel data from GPU to canvas?
2. Should we implement a dirty-checking system for renders?
3. How can we optimize the virtual scrolling further?
4. Is the current debouncing strategy sufficient?

### Patterns
1. Is mixing Zustand with Svelte 5 runes problematic?
2. Should GPU resources be managed differently?
3. How can we improve the type generation workflow?
4. What's the best error boundary strategy for Svelte?

### Technical Debt
1. What should be the priority order for addressing issues?
2. Which patterns need immediate refactoring?
3. What testing strategies should we implement?
4. How can we improve the developer experience?