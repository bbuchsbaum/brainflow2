# CLAUDE.md - UI Directory

This file provides guidance to Claude Code when working with the UI frontend code in this directory.

## UI Architecture Overview

The Brainflow UI is a modern, reactive frontend built with:
- **Framework**: SvelteKit 5 with runes (`$state`, `$derived`, `$effect`)
- **State Management**: Svelte stores ONLY (NOT Zustand) - we are migrating away from Zustand
- **Layout**: Golden Layout for dockable panels
- **Styling**: Tailwind CSS
- **GPU Rendering**: WebGPU for 2D slices, Three.js for 3D surfaces
- **Event System**: Custom EventBus for decoupled communication
- **Services**: Dependency injection pattern for business logic

## CRITICAL: State Management Migration
⚠️ **We are using Svelte stores ONLY** - do NOT use Zustand!
- All stores should use Svelte's `writable()`, `derived()`, `readable()`
- We are actively migrating away from Zustand
- Any new stores must be Svelte stores
- When fixing imports, convert Zustand stores to Svelte stores

## Important SvelteKit File Naming Rules

⚠️ **NEVER create files starting with "+" prefix** (except for SvelteKit's special route files like `+page.svelte`, `+layout.svelte`, etc.)

SvelteKit reserves the "+" prefix for its routing system. Creating custom files with names like `+layout.golden.svelte` or `+mycomponent.svelte` will cause errors:
```
500 Files prefixed with + are reserved (saw src/routes/+layout.golden.svelte)
```

**Correct naming patterns:**
- ✅ `layout.golden.svelte`
- ✅ `MyComponent.svelte` 
- ✅ `mycomponent.backup.svelte`
- ❌ `+layout.golden.svelte`
- ❌ `+MyComponent.svelte`

## Key Architectural Patterns

### 1. Service Layer Pattern
All business logic is extracted into services. Components should be thin UI layers.

```typescript
// ❌ Bad - Business logic in component
const layer = await coreApi.request_layer_gpu_resources(spec);
useLayerStore.getState().addLayer(layer);

// ✅ Good - Use service
const layerService = await getService<LayerService>('layerService');
await layerService.addLayer(spec);
```

### 2. Event-Driven Architecture
Components communicate via EventBus, eliminating circular dependencies.

```typescript
// Emit events
eventBus.emit('layer.opacity.changed', { layerId, opacity });

// Subscribe to events
const unsubscribe = eventBus.on('layer.selected', ({ layerId }) => {
  // Handle selection
});
```

### 3. Clean Stores
Stores contain only state, no business logic. All actions go through services.

```typescript
// Clean store - only pure state management
export const useLayerStore = create<LayerState>()((set) => ({
  layers: new Map(),
  activeLayerId: null,
  setActiveLayer: (id) => set({ activeLayerId: id })
}));
```

### 4. Dependency Injection
Services are registered in a DI container and retrieved by components.

```typescript
// In component
const layerService = await getService<LayerService>('layerService');
const notificationService = await getService<NotificationService>('notificationService');
```

## Directory Structure

```
ui/
├── src/
│   ├── lib/
│   │   ├── api/           # API client and types
│   │   ├── components/    # Svelte components
│   │   │   ├── views/     # Main view components
│   │   │   ├── panels/    # Panel components
│   │   │   └── ui/        # Reusable UI elements
│   │   ├── services/      # Business logic services
│   │   ├── stores/        # Zustand stores
│   │   ├── events/        # Event system
│   │   ├── di/           # Dependency injection
│   │   ├── utils/        # Utility functions
│   │   └── types/        # TypeScript types
│   └── routes/           # SvelteKit routes
└── tests/               # Test files
```

## Component Guidelines

### Creating New Components

1. **Keep components thin** - Only UI logic, no business logic
2. **Use services** - All API calls and data manipulation via services
3. **Use events** - Component communication via EventBus
4. **Clean state** - Local state with `$state`, derived with `$derived`
5. **Proper cleanup** - Always clean up subscriptions in `onDestroy`

### Component Template

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getService } from '$lib/di/Container';
  import { getEventBus } from '$lib/events/EventBus';
  import type { MyService } from '$lib/services/MyService';
  
  // Props
  let { propName }: { propName: string } = $props();
  
  // Services
  let myService: MyService | null = null;
  let eventBus = getEventBus();
  
  // State
  let localState = $state<string>('');
  let derived = $derived(localState.toUpperCase());
  
  // Lifecycle
  onMount(async () => {
    myService = await getService<MyService>('myService');
    
    const unsubscribe = eventBus.on('some.event', (data) => {
      // Handle event
    });
    
    return () => {
      unsubscribe();
    };
  });
</script>
```

## State Management

### Store Patterns

1. **Clean stores** - Only state and pure setters
2. **Service bridges** - Services update stores via events
3. **No circular deps** - Stores don't import other stores
4. **Single source of truth** - One store per domain

### Example Clean Store

```typescript
interface LayerState {
  layers: Map<string, Layer>;
  activeLayerId: string | null;
  setActiveLayer: (id: string | null) => void;
  addLayer: (layer: Layer) => void;
  removeLayer: (id: string) => void;
}

export const useLayerStore = create<LayerState>()((set) => ({
  layers: new Map(),
  activeLayerId: null,
  setActiveLayer: (id) => set({ activeLayerId: id }),
  addLayer: (layer) => set((state) => ({
    layers: new Map(state.layers).set(layer.id, layer)
  })),
  removeLayer: (id) => set((state) => {
    const layers = new Map(state.layers);
    layers.delete(id);
    return { layers };
  })
}));
```

## Testing

### Test Structure

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import MyComponent from './MyComponent.svelte';
import { mockService } from '$lib/test-utils/mockService';

describe('MyComponent', () => {
  it('should handle user interaction', async () => {
    const myService = mockService<MyService>({
      doSomething: vi.fn().mockResolvedValue('result')
    });
    
    const { getByText } = render(MyComponent, {
      props: { propName: 'value' }
    });
    
    fireEvent.click(getByText('Button'));
    
    expect(myService.doSomething).toHaveBeenCalled();
  });
});
```

## Performance Guidelines

1. **Use `$effect` sparingly** - Only for side effects, not computations
2. **Memoize with `$derived`** - For expensive computations
3. **Debounce events** - Use debounce utility for rapid updates
4. **Virtual scrolling** - For long lists
5. **Lazy loading** - Load components on demand

## GPU/WebGPU Guidelines

1. **Resource pooling** - Reuse GPU resources via services
2. **Render scheduling** - Use dirty flag pattern
3. **Error boundaries** - Handle GPU context loss
4. **Canvas sizing** - Handle resize with debouncing
5. **Coordinate systems** - Consistent world/view transforms

## Common Patterns

### Loading States
```svelte
{#if isLoading}
  <LoadingSpinner />
{:else if error}
  <ErrorMessage {error} />
{:else}
  <Content {data} />
{/if}
```

### Event Handling
```typescript
// Debounced handler
const handleChange = debounce((value: string) => {
  myService?.updateValue(value);
}, 300);

// Error handling
try {
  await myService?.riskyOperation();
} catch (error) {
  notificationService?.error('Operation failed', { error });
}
```

### Reactive Patterns
```typescript
// React to prop changes
$effect(() => {
  if (propName) {
    // Do something when prop changes
  }
});

// Computed values
let fullName = $derived(`${firstName} ${lastName}`);
```

## Do's and Don'ts

### Do's
- ✅ Use services for all business logic
- ✅ Use EventBus for component communication
- ✅ Clean up subscriptions and resources
- ✅ Handle errors with NotificationService
- ✅ Use TypeScript strictly
- ✅ Test components in isolation
- ✅ Use semantic HTML and ARIA labels
- ✅ Follow existing patterns in codebase

### Don'ts
- ❌ Put business logic in components
- ❌ Import stores into other stores
- ❌ Use `.subscribe()` without cleanup
- ❌ Manipulate DOM directly
- ❌ Use `any` type without good reason
- ❌ Create duplicate component files
- ❌ Mix concerns in a single service
- ❌ Ignore error handling

## Migration Guidelines

When migrating existing components:

1. **Extract business logic** → Move to services
2. **Replace store manipulation** → Use events
3. **Remove circular deps** → Use EventBus
4. **Add error handling** → NotificationService
5. **Update imports** → Use clean stores
6. **Add tests** → At least basic coverage
7. **Update types** → Full TypeScript coverage
8. **Document changes** → Update migration summary

## Debugging Tips

1. **Enable debug mode**: `localStorage.setItem('debug', 'brainflow:*')`
2. **Event monitoring**: `eventBus.on('*', console.log)`
3. **Store inspection**: `useLayerStore.getState()` in console
4. **GPU debugging**: Check `chrome://gpu` for WebGPU status
5. **Performance**: Use Chrome DevTools Performance tab

## Resources

- [Svelte 5 Docs](https://svelte.dev/docs)
- [SvelteKit Docs](https://kit.svelte.dev/docs)
- [Zustand Docs](https://github.com/pmndrs/zustand)
- [WebGPU Spec](https://gpuweb.github.io/gpuweb/)
- [Three.js Docs](https://threejs.org/docs/)