# GPU Resource Service Migration Guide

## Overview

The new `GpuResourceService` replaces the old `GpuResourceManager` with a comprehensive service-layer implementation that includes:

- Event-driven architecture
- Memory management and pooling
- Context loss recovery
- Performance monitoring
- Resource lifecycle management

## Key Improvements

### 1. **Event-Driven Updates**

```typescript
// Old: Direct polling
const stats = gpuManager.getStats();

// New: Event-driven
eventBus.on('gpu.memory.pressure', ({ pressure }) => {
	// React to memory pressure
});
```

### 2. **Automatic Memory Management**

```typescript
// Old: Manual cleanup
gpuManager.cleanupUnusedTargets();

// New: Automatic with configurable limits
// Service handles cleanup based on memory pressure
```

### 3. **Context Loss Recovery**

```typescript
// Old: Manual handling
device.lost.then(() => {
	/* custom recovery */
});

// New: Automatic recovery with retry
eventBus.on('gpu.context.restored', () => {
	// Resume rendering
});
```

### 4. **Render Scheduling**

```typescript
// Old: Direct render calls
await coreApi.render_slice(volumeId, sliceIndex);

// New: Scheduled with batching
gpuResourceService.scheduleRender({
	layerId,
	sliceIndex,
	width,
	height,
	timestamp: Date.now()
});
```

## Migration Steps

### Step 1: Update Service Injection

```typescript
// Old
import { getGpuResourceManager } from '$lib/gpu/GpuResourceManager';
const gpuManager = getGpuResourceManager();

// New
import { getService } from '$lib/di/Container';
const gpuResourceService = await getService<GpuResourceService>('gpuResourceService');
```

### Step 2: Update Resource Requests

```typescript
// Old
const target = await gpuManager.acquireRenderTarget(width, height);
try {
	// Use target
} finally {
	gpuManager.releaseRenderTarget(target);
}

// New - Same API but with enhanced features
const target = await gpuResourceService.acquireRenderTarget(width, height, 'rgba8unorm');
try {
	// Use target - automatic memory management
} finally {
	gpuResourceService.releaseRenderTarget(target);
}
```

### Step 3: Update Layer GPU Resources

```typescript
// Old
const gpuInfo = await coreApi.request_layer_gpu_resources(spec);

// New
const gpuInfo = await gpuResourceService.requestLayerGpuResources(layerId, spec);
// Includes caching, memory management, and event notifications
```

### Step 4: Add Event Listeners

```typescript
// Listen for GPU events
onMount(() => {
	const unsubscribes = [
		eventBus.on('gpu.render.complete', ({ layerId, duration }) => {
			console.log(`Render completed in ${duration}ms`);
		}),

		eventBus.on('gpu.memory.pressure', ({ pressure }) => {
			if (pressure === 'high') {
				// Reduce quality or pause non-critical renders
			}
		}),

		eventBus.on('gpu.context.lost', () => {
			// Show loading state
			isRecovering = true;
		}),

		eventBus.on('gpu.context.restored', () => {
			// Resume normal operation
			isRecovering = false;
		})
	];

	return () => {
		unsubscribes.forEach((fn) => fn());
	};
});
```

### Step 5: Use Render Scheduling

```typescript
// Old: Direct rendering
async function renderSlice(slice: number) {
	const target = await gpuManager.acquireRenderTarget(512, 512);
	await coreApi.render_slice(volumeId, { axis: 'axial', index: slice });
	gpuManager.releaseRenderTarget(target);
}

// New: Scheduled rendering
function renderSlice(slice: number) {
	gpuResourceService.scheduleRender({
		layerId: currentLayerId,
		sliceIndex: { axis: 'axial', index: slice },
		width: 512,
		height: 512,
		timestamp: Date.now()
	});
}
```

## Component Example: SliceViewer Migration

### Before

```svelte
<script lang="ts">
	import { getGpuResourceManager } from '$lib/gpu/GpuResourceManager';

	let gpuManager = getGpuResourceManager();
	let renderTarget: RenderTarget | null = null;

	async function initializeGpu() {
		await gpuManager.initialize();
		renderTarget = await gpuManager.acquireRenderTarget(width, height);
	}

	async function render() {
		if (!renderTarget) return;
		await coreApi.render_slice(volumeId, sliceIndex);
	}

	onDestroy(() => {
		if (renderTarget) {
			gpuManager.releaseRenderTarget(renderTarget);
		}
	});
</script>
```

### After

```svelte
<script lang="ts">
	import { getService } from '$lib/di/Container';
	import { getEventBus } from '$lib/events/EventBus';

	let gpuResourceService: GpuResourceService | null = null;
	let eventBus = getEventBus();
	let renderTarget: RenderTarget | null = null;
	let isRecovering = false;

	onMount(async () => {
		gpuResourceService = await getService<GpuResourceService>('gpuResourceService');

		// Initialize GPU
		await gpuResourceService.initialize();

		// Set up event listeners
		const unsubscribes = [
			eventBus.on('gpu.context.lost', () => {
				isRecovering = true;
			}),

			eventBus.on('gpu.context.restored', () => {
				isRecovering = false;
				scheduleRender();
			}),

			eventBus.on('gpu.render.complete', ({ layerId, duration }) => {
				// Update UI with render stats
				lastRenderTime = duration;
			})
		];

		// Initial render
		scheduleRender();

		return () => {
			unsubscribes.forEach((fn) => fn());
			if (renderTarget) {
				gpuResourceService?.releaseRenderTarget(renderTarget);
			}
		};
	});

	function scheduleRender() {
		if (!gpuResourceService || isRecovering) return;

		gpuResourceService.scheduleRender({
			layerId,
			sliceIndex,
			width,
			height,
			timestamp: Date.now()
		});
	}

	// React to changes
	$: if (sliceIndex && gpuResourceService) {
		scheduleRender();
	}
</script>

{#if isRecovering}
	<div class="gpu-recovery">Recovering GPU context...</div>
{/if}
```

## Performance Monitoring

### Access Performance Stats

```typescript
const stats = gpuResourceService.getRenderStats();
console.log({
	fps: stats.fps,
	avgFrameTime: stats.avgFrameTime,
	cacheHitRate: stats.cacheHitRate,
	framesRendered: stats.framesRendered
});
```

### Memory Usage Monitoring

```typescript
const memStats = gpuResourceService.getMemoryStats();
console.log({
	used: `${(memStats.totalAllocated / 1024 / 1024).toFixed(2)} MB`,
	available: `${(memStats.available / 1024 / 1024).toFixed(2)} MB`,
	pressure: memStats.pressure
});
```

## Configuration

Configure GPU settings via ConfigService:

```typescript
// In app initialization
configService.set('gpu.maxTextures', 30);
configService.set('gpu.memoryLimit', 1024); // 1GB
configService.set('gpu.poolSize', 10);
configService.set('gpu.sizeBuckets', [256, 512, 1024, 2048, 4096]);
```

## Best Practices

1. **Always use event listeners** for GPU state changes
2. **Schedule renders** instead of direct rendering for better batching
3. **Handle context loss** gracefully with loading states
4. **Monitor memory usage** and adjust quality based on pressure
5. **Release resources** in component cleanup
6. **Use proper formats** when acquiring render targets
7. **Check initialization** before using GPU resources

## Debugging

Enable GPU debug logging:

```typescript
localStorage.setItem('debug', 'brainflow:gpu:*');
```

Monitor GPU events in console:

```typescript
eventBus.on('gpu.*', (data) => {
	console.log('GPU Event:', data);
});
```

## Common Issues

### 1. Context Loss During Development

- Hot module reload can trigger context loss
- Service automatically recovers

### 2. Memory Pressure

- Monitor with `getMemoryStats()`
- Reduce texture resolution or layer count
- Service automatically evicts LRU resources

### 3. Performance Issues

- Check `getRenderStats()` for bottlenecks
- Ensure proper render scheduling
- Verify GPU power preference is 'high-performance'
