# Facade Pattern Documentation

## Overview

The Brainflow2 surface visualization system uses a **Facade Pattern** to provide a unified interface for managing both volume and surface layers while keeping the underlying stores separate. This architectural decision was made after expert analysis (2025-01-09) to avoid backend incompatibility and maintain clean separation of concerns.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    UI Components                         │
│  (LayerPanel, SurfaceViewPanel, LayerPropertiesManager)  │
└─────────────────────────────────────────────────────────┘
                            │
                    Uses unified interface
                            ↓
┌─────────────────────────────────────────────────────────┐
│              UnifiedLayerService (Facade)                │
│                                                          │
│  - getAllLayers()                                        │
│  - updateLayerProperty()                                 │
│  - createVol2SurfMapping()                               │
│  - Single source of truth for layer operations           │
└─────────────────────────────────────────────────────────┘
                            │
                  Delegates to appropriate store
                    ↙               ↘
┌──────────────────────┐     ┌──────────────────────┐
│    layerStore        │     │   surfaceStore       │
│  (Volume Layers)     │     │  (Surface Layers)    │
│                      │     │                      │
│  - Zustand store     │     │  - Zustand store     │
│  - ViewState sync    │     │  - Three.js data     │
│  - Backend compat    │     │  - Frontend only     │
└──────────────────────┘     └──────────────────────┘
```

## Core Components

### 1. UnifiedLayerService (`/services/UnifiedLayerService.ts`)

The facade service that provides a unified interface for all layer operations.

```typescript
export class UnifiedLayerService {
  // Retrieval methods
  getAllLayers(): ManagedLayer[]
  getVolumeLayers(): ManagedLayer[]
  getSurfaceLayers(): ManagedLayer[]
  getVol2SurfLayers(): ManagedLayer[]
  
  // Operations
  updateLayerProperty(id: string, property: string, value: any): void
  toggleLayerVisibility(id: string): void
  removeLayer(id: string): void
  
  // Vol2Surf mapping
  createVol2SurfMapping(volumeId: string, surfaceId: string): Promise<string>
}
```

### 2. ManagedLayer Type

A discriminated union that represents both volume and surface layers:

```typescript
export type ManagedLayer = 
  | { 
      id: string;
      type: 'volume';
      name: string;
      visible: boolean;
      opacity: number;
      data: LayerInfo;
    }
  | { 
      id: string;
      type: 'surface';
      name: string;
      visible: boolean;
      opacity: number;
      data: LoadedSurface;
      sourceVolumeId?: string; // For vol2surf mapping
    };
```

### 3. useUnifiedLayers Hook (`/hooks/useUnifiedLayers.ts`)

React hook that provides component access to the unified layer system:

```typescript
export function useUnifiedLayers(): UnifiedLayersResult {
  // All layers combined
  allLayers: ManagedLayer[];
  
  // Filtered lists
  volumeLayers: ManagedLayer[];
  surfaceLayers: ManagedLayer[];
  vol2surfLayers: ManagedLayer[];
  
  // Operations
  updateLayer: (id: string, property: string, value: any) => void;
  toggleVisibility: (id: string) => void;
  removeLayer: (id: string) => void;
  
  // Vol2surf
  createVol2Surf: (volumeId: string, surfaceId: string) => Promise<string>;
}
```

## Usage Examples

### Basic Layer Management

```typescript
import { useUnifiedLayers } from '@/hooks/useUnifiedLayers';

function LayerPanel() {
  const { allLayers, toggleVisibility, removeLayer } = useUnifiedLayers();
  
  return (
    <div>
      {allLayers.map(layer => (
        <LayerRow
          key={layer.id}
          layer={layer}
          onToggle={() => toggleVisibility(layer.id)}
          onRemove={() => removeLayer(layer.id)}
        />
      ))}
    </div>
  );
}
```

### Type-Safe Layer Handling

```typescript
import { isVolumeLayer, isSurfaceLayer } from '@/services/UnifiedLayerService';

function LayerIcon({ layer }: { layer: ManagedLayer }) {
  if (isVolumeLayer(layer)) {
    return <VolumeIcon />;
  } else if (isSurfaceLayer(layer)) {
    return layer.sourceVolumeId ? <Vol2SurfIcon /> : <SurfaceIcon />;
  }
}
```

### Vol2Surf Mapping

```typescript
function Vol2SurfDialog() {
  const { 
    availableVolumesForMapping, 
    availableSurfacesForMapping,
    createVol2Surf 
  } = useUnifiedLayers();
  
  const handleCreate = async () => {
    const mappingId = await createVol2Surf(selectedVolume, selectedSurface);
    if (mappingId) {
      console.log('Created vol2surf layer:', mappingId);
    }
  };
}
```

### Specialized Hooks

For components that only need specific layer types:

```typescript
// Only volume layers
import { useVolumeLayers } from '@/hooks/useUnifiedLayers';

function VolumeSettings() {
  const { layers, updateLayer } = useVolumeLayers();
  // Work only with volume layers
}

// Only surface layers
import { useSurfaceLayers } from '@/hooks/useUnifiedLayers';

function SurfaceSettings() {
  const { layers, toggleVisibility } = useSurfaceLayers();
  // Work only with surface layers
}

// Only vol2surf layers
import { useVol2SurfLayers } from '@/hooks/useUnifiedLayers';

function Vol2SurfPanel() {
  const { layers, createMapping } = useVol2SurfLayers();
  // Work only with mapped layers
}
```

## Benefits

### 1. **Clean Separation**
- Volume and surface stores remain independent
- No backend changes required
- Each store optimized for its data type

### 2. **Type Safety**
- Discriminated unions ensure type-safe operations
- Type guards prevent runtime errors
- IntelliSense support throughout

### 3. **Unified UX**
- Single layer list in UI
- Consistent operations across types
- Seamless vol2surf mapping

### 4. **Maintainability**
- Single point of coordination
- Clear delegation pattern
- Easy to extend with new layer types

## Migration Guide

### From Direct Store Access

**Before (Direct Store Access):**
```typescript
import { useLayerStore } from '@/stores/layerStore';
import { useSurfaceStore } from '@/stores/surfaceStore';

function Component() {
  const volumeLayers = useLayerStore(state => state.layers);
  const surfaces = useSurfaceStore(state => state.surfaces);
  
  // Manual combination and type checking
  const allLayers = [...volumeLayers, ...Array.from(surfaces.values())];
}
```

**After (Facade Pattern):**
```typescript
import { useUnifiedLayers } from '@/hooks/useUnifiedLayers';

function Component() {
  const { allLayers } = useUnifiedLayers();
  // Automatically combined and typed
}
```

### Updating Layer Properties

**Before:**
```typescript
// Need to know which store to update
if (isVolume) {
  useLayerStore.getState().updateLayer(id, props);
} else {
  useSurfaceStore.getState().updateSurface(id, props);
}
```

**After:**
```typescript
const { updateLayer } = useUnifiedLayers();
updateLayer(id, 'property', value); // Automatically routes to correct store
```

## Testing

The facade pattern simplifies testing by providing a single interface to mock:

```typescript
// Mock the service
vi.mock('@/services/UnifiedLayerService', () => ({
  unifiedLayerService: {
    getAllLayers: vi.fn(() => mockLayers),
    updateLayerProperty: vi.fn(),
    // ... other methods
  }
}));

// Test components without worrying about store details
describe('LayerPanel', () => {
  it('displays all layers', () => {
    const { result } = renderHook(() => useUnifiedLayers());
    expect(result.current.allLayers).toHaveLength(mockLayers.length);
  });
});
```

## Future Extensions

The facade pattern makes it easy to add new layer types:

1. Add new store for the layer type
2. Extend `ManagedLayer` discriminated union
3. Update `UnifiedLayerService` to include new store
4. Components automatically work with new type

Example for adding annotation layers:
```typescript
type ManagedLayer = 
  | { type: 'volume'; ... }
  | { type: 'surface'; ... }
  | { type: 'annotation'; data: AnnotationLayer; ... }; // New type
```

## Conclusion

The Facade Pattern provides a clean, maintainable solution for unifying volume and surface layers without the complexity of store unification. It respects existing architecture while providing the unified UX users expect.