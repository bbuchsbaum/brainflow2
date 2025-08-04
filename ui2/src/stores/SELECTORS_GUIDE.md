# Typed Selectors Guide

## Why Typed Selectors?

The bug that took 3 hours to debug was caused by accessing `state.metadata` instead of `state.layerMetadata`. TypeScript couldn't catch this because Zustand's selector pattern allows arbitrary property access.

Typed selectors solve this by:
1. Providing a single source of truth for property names
2. Enabling TypeScript to catch typos at compile time
3. Making refactoring safer

## Usage

### Basic Usage

```typescript
// ❌ BAD - Direct state access (can cause runtime errors)
const metadata = useLayerStore(state => state.metadata); // undefined!

// ✅ GOOD - Typed selector
const metadata = useLayer(state => layerSelectors.layerMetadata);
```

### Common Patterns

```typescript
// Get all layers
const layers = useLayers();

// Get selected layer ID
const selectedLayerId = useSelectedLayerId();

// Get selected layer object
const selectedLayer = useSelectedLayer();

// Get metadata for a specific layer
const metadata = useLayerMetadata(layerId);

// Get render properties for a specific layer
const renderProps = useLayerRender(layerId);
```

### Custom Selectors

```typescript
// Use the generic useLayer hook with any selector
const visibleLayers = useLayer(layerSelectors.getVisibleLayers);

// Combine selectors
const layerWithMetadata = useLayer(state => {
  const layer = layerSelectors.getLayerById(state, id);
  const metadata = layerSelectors.getLayerMetadata(state, id);
  return { layer, metadata };
});
```

## Available Selectors

### Basic Selectors
- `layers` - All layers array
- `selectedLayerId` - Currently selected layer ID
- `layerMetadata` - Map of layer metadata
- `layerRender` - Map of render properties
- `loadingLayers` - Set of loading layer IDs
- `errorLayers` - Map of layer errors

### Computed Selectors
- `getLayerById(state, id)` - Get specific layer
- `getLayerMetadata(state, id)` - Get metadata for layer
- `getLayerRender(state, id)` - Get render props for layer
- `getSelectedLayer(state)` - Get selected layer object
- `getSelectedLayerMetadata(state)` - Get selected layer metadata
- `getSelectedLayerRender(state)` - Get selected layer render props
- `isLayerLoading(state, id)` - Check if layer is loading
- `getLayerError(state, id)` - Get error for layer
- `getVisibleLayers(state)` - Get layers with opacity > 0
- `getLayersByType(state, type)` - Filter layers by type
- `hasLayers(state)` - Check if any layers exist

## Enforcement

To enforce typed selector usage:

1. Import only the selectors and hooks, not the raw store:
   ```typescript
   // Import this:
   import { useLayer, layerSelectors, useLayers } from '@/stores/layerStore';
   
   // Not this:
   import { useLayerStore } from '@/stores/layerStore';
   ```

2. The raw `useLayerStore` is still exported for backward compatibility, but new code should use typed selectors.

3. During code review, look for direct state property access and suggest using selectors instead.

## Other Stores

Similar typed selectors should be created for:
- `viewStateStore`
- `fileBrowserStore`
- Other stores as needed

This pattern prevents the silent failures that made our debugging session so painful.