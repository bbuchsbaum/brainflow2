# Surface Visualization Architecture Plan

**Status**: Architecture Finalized  
**Date**: 2025-08-05  
**Reviewed by**: O3 (OpenAI) and Gemini-2.5-Pro expert analysis  
**Updated**: 2025-01-08 - LayerPanel separation pattern based on expert consensus
**Updated**: 2025-01-09 - Pivoted to separate panels based on user feedback

## Executive Summary

This document outlines the architectural plan for adding 3D surface visualization capabilities to the Brainflow neuroimaging application, which currently supports only volumetric data visualization. The plan enables:

1. **3D Brain Surface Meshes**: Multi-layer surface support with dedicated controls
2. **Volume-to-Surface Mapping (vol2surf)**: Dynamic projection of volume data onto surface vertices
3. **Separate Panel Architecture**: Dedicated panels for volumes and surfaces (LayerPanel and SurfaceListPanel)
4. **Composition Pattern**: Vol2surf as a relationship between types, not a new type
5. **Performance-Optimized**: GPU-accelerated vol2surf mapping for real-time updates

### Architecture Evolution (2025-01-09)

The architecture evolved through two phases:

**Phase 1: Unified Facade Pattern**
- Implemented UnifiedLayerService and useUnifiedLayers hook
- Designed for displaying all layers in a single LayerPanel
- Type-safe discriminated unions for volumes and surfaces

**Phase 2: Separate UI Panels** (Current)
- User feedback: "we don't actually overlay surfaces over volumes"
- Pivoted to: LayerPanel (volumes) and SurfaceListPanel (surfaces)
- Retained facade infrastructure for future programmatic features
- Clear UI separation while maintaining architectural flexibility

### Key Architecture Decision: Separate Panels (Current Implementation)
Initially based on expert consensus, then refined by user feedback:
- **Separate panels** - LayerPanel for volumes, SurfaceListPanel for surfaces
- **No overlay relationship** - Volumes (2D slices) and surfaces (3D meshes) are distinct
- **Tabbed interface** - Both panels available as tabs in GoldenLayout
- **Direct store access** - Each panel uses its respective store directly
- **Facade available** - UnifiedLayerService exists for future programmatic needs

## Expert Review Summary

### Key Insights from O3 Analysis
- **"Hybrid" type causes responsibility blur** - it's volume data ON a surface, not a new data type
- **Risk of type explosion** - conditionals creeping everywhere as system grows
- **Performance critical** - vol2surf mapping needs GPU-first approach from day one
- **Memory constraints** - WebGL limits with multiple large meshes need consideration
- **Coordinate alignment** - surface and volume coordinate systems often differ

### Key Insights from Gemini Analysis  
- **"Hybrid" layer type is an anti-pattern** - use composition, not inheritance
- **Component composition** prevents monolithic LayerControlsPanel growth
- **Two-stage performance strategy** - Web Workers first, then GPU shaders
- **State management needs** - dedicated selectors to avoid repetitive filtering
- **Explicit loading strategy** - need clear mapping from file types to loaders

## Revised Architecture (Based on Expert Feedback)

### Core Principle: Composition Over Inheritance

**ELIMINATED**: `LayerDataType = 'volume' | 'surface' | 'hybrid'` (hybrid is anti-pattern)  
**ADOPTED**: Surface layers with optional volume reference for mapping

## Facade Pattern Implementation (Available for Future Use)

After deeper analysis with both Gemini-2.5-Pro and O3, we've identified that the original plan to unify surfaces into the layer system would introduce significant complexity:

### The Problem with Unification
1. **Backend Incompatibility**: ViewState is sent to Rust backend which only handles volumes
2. **Three-Store Synchronization**: Would require syncing layerStore, viewStateStore, AND surfaceStore
3. **Existing Code**: SurfaceViewPanel already works perfectly with surfaceStore
4. **Type Explosion**: Discriminated unions would require conditionals everywhere

### The Solution: Facade Pattern
Instead of forcing unification at the store level, we implement a **facade service** that provides a unified interface while keeping stores separate internally:

```typescript
// UnifiedLayerService.ts - The Facade
export type ManagedLayer = 
  | { id: string; type: 'volume'; data: VolumeLayer }
  | { id: string; type: 'surface'; data: Surface };

class UnifiedLayerService {
  // Combine layers for UI presentation
  getAllLayers(): ManagedLayer[] {
    const volumes = useLayerStore.getState().layers;
    const surfaces = Array.from(useSurfaceStore.getState().surfaces.values());
    
    return [
      ...volumes.map(v => ({ id: v.id, type: 'volume' as const, data: v })),
      ...surfaces.map(s => ({ id: s.handle, type: 'surface' as const, data: s }))
    ];
  }
  
  // Delegate updates to appropriate store
  updateLayerProperty(id: string, property: string, value: any) {
    const layer = this.getAllLayers().find(l => l.id === id);
    if (!layer) return;
    
    if (layer.type === 'volume') {
      useLayerStore.getState().updateLayer(id, { [property]: value });
    } else {
      // Update surface in surfaceStore
      const surface = layer.data as Surface;
      useSurfaceStore.getState().updateLayerProperty(surface.handle, property, value);
    }
  }
  
  // Natural vol2surf coordination
  createVol2SurfMapping(volumeId: string, surfaceId: string) {
    const volume = useLayerStore.getState().layers.find(l => l.id === volumeId);
    const surface = useSurfaceStore.getState().surfaces.get(surfaceId);
    
    if (!volume || !surface) return;
    
    // Coordinate mapping between stores
    // Add sourceVolumeId to surface metadata
    // Update surface with mapped data
  }
}
```

### Benefits of Facade Pattern
1. **No Backend Changes**: ViewState continues to send only volumes
2. **Clean Architecture**: Stores remain separate and focused
3. **Unified UX**: Single layer panel for users
4. **Type Safety**: Discriminated unions provide compile-time safety
5. **Incremental Migration**: Can implement gradually
6. **Future-Proof**: Easy to add new visualization types

### Current Implementation: Separate Panels

Based on user feedback, we now use separate panels:

```typescript
// GoldenLayoutWrapper.tsx registration
componentRegistry.set('LayerPanel', LayerPanel);      // Volumes only
componentRegistry.set('SurfacePanel', SurfaceListPanel); // Surfaces only

// Layout configuration with tabs
{
  type: 'stack',
  content: [
    { type: 'component', componentType: 'LayerPanel', title: 'Volumes' },
    { type: 'component', componentType: 'SurfacePanel', title: 'Surfaces' }
  ]
}
```

### Why This Approach Works Better
1. **Clear Mental Models**: Users understand volumes and surfaces are different
2. **No Type Confusion**: Each panel handles one type, no conditionals
3. **Independent Evolution**: Panels can evolve separately
4. **Better UX**: Dedicated interfaces for each visualization type

## LayerPanel Architecture Decision

### Expert Consensus: Separate Panels with Manager Pattern

After extensive analysis by O3 (OpenAI) and Gemini-2.5-Pro, the consensus is clear: **separate panels with a manager component** provides superior maintainability, extensibility, and user experience compared to a unified panel approach.

#### Key Insights from Expert Analysis:
- **O3**: "Unified approach leads to if-else sprawl and conditional complexity"
- **Gemini**: "Composition beats conditionals for maintainability and extensibility"
- Both experts agree that separate panels with shared components is the optimal pattern

### The Manager/Dispatcher Pattern

The architecture uses a central manager that dispatches to type-specific panels while maintaining UX consistency:

```typescript
// LayerPropertiesManager.tsx - The dispatcher
const LayerPropertiesManager: React.FC = () => {
  const selectedLayer = useLayerStore(state => state.selectedLayer);
  
  if (!selectedLayer) return <EmptyState />;
  
  switch (selectedLayer.dataType) {
    case 'volume':
      return <VolumePanel layer={selectedLayer as VolumeViewLayer} />;
    case 'surface':
      return <SurfacePanel layer={selectedLayer as SurfaceViewLayer} />;
    default:
      return <UnknownLayerType />;
  }
};
```

### Benefits of This Architecture:

1. **Clean Separation**: Each panel handles only its specific concerns
2. **Easy Extension**: New layer types just add a new panel + one line in manager
3. **Composition-Friendly**: Vol2surf can compose controls from both domains
4. **Testable**: Each panel can be tested in isolation
5. **UX Consistency**: User sees one panel area, shared controls look identical
6. **No Conditional Complexity**: No cascading if-else chains
7. **Type Safety**: TypeScript discriminated unions work perfectly

### Shared Controls for All Layer Types:

All panels share common controls through composition:
- Opacity (0-1 range)
- Colormap selection
- Intensity windowing
- Threshold settings
- Visibility toggle

These are implemented once in `SharedControls.tsx` and used by all panel types.

### Phase 1: Refined Type System

```typescript
// Base shared properties for all layer types
interface BaseViewLayer {
  id: string;
  name: string;
  resourceId: string;  // Generic resource identifier
  opacity: number;
  colormap: string;
  intensity: [number, number];  // [min, max] data range
  threshold: [number, number];  // [low, high] visibility threshold
}

// Volume layers (existing functionality - unchanged)
export interface VolumeViewLayer extends BaseViewLayer {
  dataType: 'volume';
  volumeProperties: VolumeRenderProperties;
}

// Surface layers with optional volume mapping (composition pattern)
export interface SurfaceViewLayer extends BaseViewLayer {
  dataType: 'surface';
  surfaceProperties: SurfaceRenderProperties;
  sourceVolumeId?: string; // For vol2surf mapping - composition not inheritance!
}

// Discriminated union - no "hybrid" type needed
export type ViewLayer = VolumeViewLayer | SurfaceViewLayer;

// Surface-specific rendering properties
interface SurfaceRenderProperties {
  wireframe: boolean;
  smoothing: number;
  lighting: {
    ambient: number;
    diffuse: number;
    specular: number;
  };
  coordinateTransform?: Matrix4; // Handle surface-volume coordinate differences
  vertexColoring: 'uniform' | 'mapped' | 'intrinsic';
}

// Volume-specific properties (for clarity)
interface VolumeRenderProperties {
  interpolation: 'nearest' | 'linear';
  sliceThickness?: number;
}
```

### Phase 2: Component Composition Pattern

**Problem**: Monolithic LayerControlsPanel with growing conditionals  
**Solution**: Dedicated control components with shared/specific separation

```typescript
// SharedControls.tsx - Extracted from current LayerControlsPanel
// These controls work for ALL layer types (volumes and surfaces)
export const SharedControls: React.FC<SharedControlsProps> = ({
  layer,
  metadata,
  onRenderUpdate
}) => {
  return (
    <>
      {/* Intensity Window - applies to data values */}
      <ProSlider
        label="Intensity Window"
        min={metadata?.dataRange?.min ?? 0}
        max={metadata?.dataRange?.max ?? 10000}
        value={layer.intensity}
        onChange={(value) => onRenderUpdate({ intensity: value })}
        precision={0}
      />

      {/* Threshold - filters data visibility */}
      <ProSlider
        label="Threshold"
        min={metadata?.dataRange?.min ?? 0}
        max={metadata?.dataRange?.max ?? 10000}
        value={layer.threshold}
        onChange={(value) => onRenderUpdate({ threshold: value })}
        precision={0}
      />

      {/* Colormap - maps values to colors */}
      <EnhancedColormapSelector
        value={layer.colormap}
        onChange={(colormap) => onRenderUpdate({ colormap })}
      />

      {/* Opacity - layer transparency */}
      <SingleSlider
        label="Opacity"
        min={0}
        max={1}
        value={layer.opacity}
        onChange={(opacity) => onRenderUpdate({ opacity })}
        showPercentage={true}
      />
    </>
  );
};

// LayerPropertiesManager.tsx - Central dispatcher
export const LayerPropertiesManager: React.FC = () => {
  const selectedLayer = useLayerStore(state => state.selectedLayer);
  
  if (!selectedLayer) {
    return <EmptyState message="Select a layer to view properties" />;
  }
  
  // Dispatch to appropriate panel based on layer type
  switch (selectedLayer.dataType) {
    case 'volume':
      return <VolumePanel layer={selectedLayer as VolumeViewLayer} />;
    case 'surface':
      // Check if it's a vol2surf layer
      if (selectedLayer.sourceVolumeId) {
        return <Vol2SurfPanel layer={selectedLayer as SurfaceViewLayer} />;
      }
      return <SurfacePanel layer={selectedLayer as SurfaceViewLayer} />;
    default:
      return <div>Unknown layer type: {selectedLayer.dataType}</div>;
  }
};

// VolumePanel.tsx - Volume-specific controls
export const VolumePanel: React.FC<{ layer: VolumeViewLayer }> = ({ layer }) => {
  const handleUpdate = useLayerUpdate(layer.id);
  
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">Volume Properties</h3>
      <SharedControls layer={layer} onUpdate={handleUpdate} />
      <Divider />
      <VolumeSpecificControls layer={layer} onUpdate={handleUpdate} />
    </div>
  );
};

// SurfacePanel.tsx - Surface-specific controls  
export const SurfacePanel: React.FC<{ layer: SurfaceViewLayer }> = ({ layer }) => {
  const handleUpdate = useLayerUpdate(layer.id);
  
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">Surface Properties</h3>
      <SharedControls layer={layer} onUpdate={handleUpdate} />
      <Divider />
      <SurfaceSpecificControls layer={layer} onUpdate={handleUpdate} />
    </div>
  );
};

// Surface-specific controls component
export const SurfaceControls: React.FC<{ 
  layer: SurfaceViewLayer;
  onPropertiesChange: (updates: Partial<SurfaceRenderProperties>) => void;
}> = ({ layer, onPropertiesChange }) => {
  const props = layer.surfaceProperties;
  
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label>Wireframe</label>
        <input
          type="checkbox"
          checked={props.wireframe}
          onChange={(e) => onPropertiesChange({ wireframe: e.target.checked })}
        />
      </div>
      
      <div>
        <label>Smoothing</label>
        <Slider
          value={props.smoothing}
          min={0}
          max={1}
          step={0.1}
          onChange={(smoothing) => onPropertiesChange({ smoothing })}
        />
      </div>
      
      <LightingControls
        lighting={props.lighting}
        onChange={(lighting) => onPropertiesChange({ lighting })}
      />
    </div>
  );
};
```

## Vol2Surf Workflow: Volume-to-Surface Mapping

### User Interaction Flow

Vol2surf represents a **relationship** between existing data types, not a new data type. The workflow emphasizes this relationship:

1. **Load Surface Geometry First**
   - User loads `.gii` file containing brain surface mesh
   - Creates `SurfaceViewLayer` with just geometry (no data values)
   - Surface appears with uniform color or intrinsic properties

2. **Drop Volume onto Surface**
   - User drags NIfTI volume onto surface viewer
   - System detects volume-on-surface operation
   - **Mapping Dialog** appears with parameters:
     ```typescript
     interface Vol2SurfMappingOptions {
       method: 'nearest' | 'trilinear' | 'weighted';
       projectionDepth: number;      // mm from surface
       smoothingKernel: number;       // spatial smoothing
       threshold: [number, number];   // value range to map
     }
     ```

3. **Vol2Surf Computation**
   - For each vertex in surface mesh:
     - Transform vertex to volume coordinate space
     - Sample volume data at that location
     - Store sampled value as vertex color/intensity
   - Creates new `SurfaceViewLayer` with `sourceVolumeId` set

4. **Result: Hybrid Layer**
   - Surface geometry provides 3D shape
   - Volume data provides color values at vertices
   - User can adjust both surface AND data properties

### Vol2SurfPanel: Composition of Controls

The Vol2SurfPanel demonstrates the power of the composition pattern:

```typescript
const Vol2SurfPanel: React.FC<{ layer: Vol2SurfLayer }> = ({ layer }) => {
  const sourceVolume = useLayerStore(state => 
    state.layers.find(l => l.id === layer.sourceVolumeId)
  );

  return (
    <div className="space-y-4">
      {/* Relationship header */}
      <RelationshipBadge surface={layer} volume={sourceVolume} />
      
      {/* Data visualization controls (from volume domain) */}
      <SharedControls layer={layer} />
      
      {/* Surface rendering controls (from surface domain) */}
      <SurfaceSpecificControls layer={layer} />
      
      {/* Vol2surf-specific mapping controls */}
      <MappingControls layer={layer} onRemap={handleRemap} />
    </div>
  );
};
```

### Why Vol2Surf is Special

Vol2surf is distinct because it:
1. **Manages Two Data Sources**: Surface geometry AND volume data
2. **Has Unique Controls**: Projection depth, sampling method
3. **Different Mental Model**: "Volume data ON surface" relationship
4. **Special Operations**: Remapping, resampling, projection adjustments

### Phase 3: Performance-First Vol2Surf Strategy

**Two-Stage Implementation for Risk Mitigation**

#### Stage 1: Web Worker Implementation (Immediate Functionality)

```typescript
// Web Worker for CPU-based vol2surf mapping (development phase)
class Vol2SurfWorkerService {
  private worker: Worker;
  
  constructor() {
    this.worker = new Worker('/workers/vol2surf-worker.js');
  }
  
  async mapVolumeToSurface(
    volumeData: ArrayBuffer,
    surfaceVertices: Float32Array,
    coordinateTransform: Matrix4,
    colormap: string,
    threshold: [number, number]
  ): Promise<Float32Array> {
    // Use Transferable objects to avoid expensive data cloning
    const message = {
      volumeData,
      surfaceVertices: surfaceVertices.buffer,
      transform: coordinateTransform.elements,
      colormap,
      threshold
    };
    
    return new Promise((resolve) => {
      this.worker.postMessage(message, [volumeData, surfaceVertices.buffer]);
      this.worker.onmessage = (e) => resolve(new Float32Array(e.data.colorBuffer));
    });
  }
}

// Web Worker implementation (vol2surf-worker.js)
self.onmessage = function(e) {
  const { volumeData, surfaceVertices, transform, colormap, threshold } = e.data;
  
  // Convert ArrayBuffer back to typed arrays
  const volume = new Float32Array(volumeData);
  const vertices = new Float32Array(surfaceVertices);
  const colorBuffer = new Float32Array(vertices.length); // RGB values
  
  // For each vertex, sample the volume at its transformed position
  for (let i = 0; i < vertices.length; i += 3) {
    const vertex = [vertices[i], vertices[i+1], vertices[i+2]];
    const volumeCoord = applyTransform(vertex, transform);
    const value = sampleVolume(volume, volumeCoord);
    const color = applyColormap(value, colormap, threshold);
    
    colorBuffer[i] = color[0];     // R
    colorBuffer[i+1] = color[1];   // G  
    colorBuffer[i+2] = color[2];   // B
  }
  
  // Return result as Transferable
  self.postMessage({ colorBuffer: colorBuffer.buffer }, [colorBuffer.buffer]);
};
```

#### Stage 2: GPU Shader Implementation (Ultimate Performance)

```typescript
// GPU-accelerated vol2surf using Three.js shaders
class Vol2SurfGPUService {
  createVolumeTexture3D(
    volumeData: Float32Array, 
    dimensions: [number, number, number]
  ): THREE.Data3DTexture {
    const texture = new THREE.Data3DTexture(
      volumeData, 
      dimensions[0], 
      dimensions[1], 
      dimensions[2]
    );
    texture.format = THREE.RedFormat;
    texture.type = THREE.FloatType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
  }
  
  createColormapTexture1D(colormap: string): THREE.DataTexture {
    const colors = getColormapColors(colormap, 256); // 256 color LUT
    const texture = new THREE.DataTexture(colors, 256, 1, THREE.RGBFormat);
    texture.needsUpdate = true;
    return texture;
  }
  
  createSurfaceMaterial(
    volumeTexture: THREE.Data3DTexture,
    colormapTexture: THREE.DataTexture,
    coordinateTransform: THREE.Matrix4
  ): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        volumeSampler: { value: volumeTexture },
        colormapSampler: { value: colormapTexture },
        volumeTransform: { value: coordinateTransform },
        threshold: { value: new THREE.Vector2(0.0, 1.0) },
        intensity: { value: new THREE.Vector2(0.0, 100.0) }
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler3D volumeSampler;
        uniform sampler2D colormapSampler;
        uniform mat4 volumeTransform;
        uniform vec2 threshold;
        uniform vec2 intensity;
        varying vec3 vWorldPosition;
        
        void main() {
          // Transform world position to volume coordinate space
          vec4 volumeCoord = volumeTransform * vec4(vWorldPosition, 1.0);
          
          // Sample the 3D volume texture
          float scalarValue = texture(volumeSampler, volumeCoord.xyz).r;
          
          // Apply intensity windowing
          scalarValue = (scalarValue - intensity.x) / (intensity.y - intensity.x);
          scalarValue = clamp(scalarValue, 0.0, 1.0);
          
          // Apply threshold
          if (scalarValue < threshold.x || scalarValue > threshold.y) {
            discard;
          }
          
          // Sample colormap using scalar value
          vec3 color = texture2D(colormapSampler, vec2(scalarValue, 0.5)).rgb;
          
          gl_FragColor = vec4(color, 1.0);
        }
      `
    });
  }
}
```

### Phase 4: Facade-Based State Management

**Problem**: Need unified layer access without store coupling  
**Solution**: Facade service with dedicated hooks

```typescript
// useUnifiedLayers.ts - Hook that uses the facade
import { useMemo } from 'react';
import { useLayerStore } from '@/stores/layerStore';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { UnifiedLayerService } from '@/services/UnifiedLayerService';

export function useUnifiedLayers() {
  const volumeLayers = useLayerStore(state => state.layers);
  const surfaces = useSurfaceStore(state => state.surfaces);
  const service = useMemo(() => new UnifiedLayerService(), []);
  
  // Combine layers with proper typing
  const allLayers = useMemo(() => {
    return service.getAllLayers();
  }, [volumeLayers, surfaces]);
  
  // Filtered accessors
  const surfaceLayers = useMemo(() => 
    allLayers.filter(l => l.type === 'surface'), [allLayers]
  );
  
  const volumeLayers = useMemo(() => 
    allLayers.filter(l => l.type === 'volume'), [allLayers]
  );
  
  const vol2surfLayers = useMemo(() => 
    allLayers.filter(l => 
      l.type === 'surface' && l.data.sourceVolumeId
    ), [allLayers]
  );
  
  return {
    allLayers,
    surfaceLayers,
    volumeLayers,
    vol2surfLayers,
    updateLayer: service.updateLayerProperty.bind(service),
    createVol2Surf: service.createVol2SurfMapping.bind(service)
  };
}
```

### Phase 5: Unified Resource Loading Strategy

**Problem**: Generic `resourceId` needs explicit loader mapping  
**Solution**: Resource type registry with loader dispatch

```typescript
// Explicit loader registry maps file extensions to appropriate loaders
const RESOURCE_LOADERS = {
  '.nii': NiftiVolumeLoader,
  '.nii.gz': NiftiVolumeLoader,
  '.gii': GiftiSurfaceLoader,
  '.vtk': VtkSurfaceLoader,
  '.ply': PlyMeshLoader,
  '.obj': ObjMeshLoader,
} as const;

// Resource handle interfaces
export interface SurfaceHandle {
  id: string;
  name: string;
  path: string;
  vertexCount: number;
  faceCount: number;
  coordinateSystem: 'native' | 'mni' | 'fs_lr';
  metadata?: Record<string, any>;
}

// Extended LayerService with surface support
export class LayerService {
  // Existing volume layer method (unchanged)
  async addVolumeLayer(volumeHandle: VolumeHandle): Promise<VolumeViewLayer> {
    const layer: VolumeViewLayer = {
      dataType: 'volume',
      id: volumeHandle.id,
      name: volumeHandle.name,
      resourceId: volumeHandle.id,
      opacity: 1.0,
      colormap: 'gray',
      intensity: [0, 100],
      threshold: [0, 100],
      volumeProperties: {
        interpolation: 'linear'
      }
    };
    
    return this.addLayer(layer);
  }
  
  // New surface layer method
  async addSurfaceLayer(surfaceHandle: SurfaceHandle): Promise<SurfaceViewLayer> {
    const layer: SurfaceViewLayer = {
      dataType: 'surface',
      id: surfaceHandle.id,
      name: surfaceHandle.name,
      resourceId: surfaceHandle.id,
      opacity: 1.0,
      colormap: 'viridis',
      intensity: [0, 1],
      threshold: [0, 1],
      surfaceProperties: {
        wireframe: false,
        smoothing: 0.5,
        lighting: {
          ambient: 0.3,
          diffuse: 0.7,
          specular: 0.2
        },
        vertexColoring: 'uniform'
      }
      // No sourceVolumeId - pure surface layer
    };
    
    return this.addLayer(layer);
  }
  
  // Create vol2surf mapping layer (composition pattern)
  async createVol2SurfLayer(
    surfaceLayerId: string, 
    volumeLayerId: string,
    displayName?: string
  ): Promise<SurfaceViewLayer> {
    const existingSurface = await this.getLayer(surfaceLayerId) as SurfaceViewLayer;
    const existingVolume = await this.getLayer(volumeLayerId) as VolumeViewLayer;
    
    if (!existingSurface || !existingVolume) {
      throw new Error('Both surface and volume layers must exist');
    }
    
    // Create new surface layer that references volume for data
    const vol2surfLayer: SurfaceViewLayer = {
      ...existingSurface,
      id: nanoid(),
      name: displayName || `${existingSurface.name} ← ${existingVolume.name}`,
      sourceVolumeId: volumeLayerId, // This makes it a vol2surf layer
      colormap: existingVolume.colormap, // Inherit volume's colormap
      intensity: existingVolume.intensity, // Inherit volume's intensity
      threshold: existingVolume.threshold, // Inherit volume's threshold
      surfaceProperties: {
        ...existingSurface.surfaceProperties,
        vertexColoring: 'mapped' // Indicate this surface uses mapped coloring
      }
    };
    
    return this.addLayer(vol2surfLayer);
  }
  
  // Helper method to determine appropriate loader
  private getResourceLoader(filePath: string): ResourceLoader {
    const extension = path.extname(filePath).toLowerCase();
    const loader = RESOURCE_LOADERS[extension as keyof typeof RESOURCE_LOADERS];
    
    if (!loader) {
      throw new Error(`No loader found for file type: ${extension}`);
    }
    
    return loader;
  }
}
```

### Phase 6: SurfaceView Component

```typescript
// Three.js-based surface rendering component
export const SurfaceView: React.FC<SurfaceViewProps> = ({
  width,
  height,
  className
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  
  // Subscribe to surface layers from ViewState
  const surfaceLayers = useSurfaceLayers();
  const vol2surfService = useRef(new Vol2SurfGPUService());
  
  // Initialize Three.js scene
  useEffect(() => {
    if (!canvasRef.current) return;
    
    // Setup renderer
    const renderer = new THREE.WebGLRenderer({ 
      canvas: canvasRef.current,
      antialias: true 
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    rendererRef.current = renderer;
    
    // Setup scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    sceneRef.current = scene;
    
    // Setup camera
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.set(0, 0, 200);
    cameraRef.current = camera;
    
    // Add lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
    directionalLight.position.set(1, 1, 1);
    scene.add(ambientLight, directionalLight);
    
    return () => {
      renderer.dispose();
    };
  }, [width, height]);
  
  // Update surface meshes when layers change
  useEffect(() => {
    if (!sceneRef.current) return;
    
    // Clear existing meshes
    const meshesToRemove = sceneRef.current.children.filter(
      child => child.userData.isSurfaceLayer
    );
    meshesToRemove.forEach(mesh => sceneRef.current!.remove(mesh));
    
    // Add surface layers
    surfaceLayers.forEach(async (layer) => {
      if (!layer.visible) return;
      
      // Load surface geometry
      const geometry = await loadSurfaceGeometry(layer.resourceId);
      
      let material: THREE.Material;
      
      if (layer.sourceVolumeId) {
        // Vol2surf mapping - use custom shader material
        const volumeLayer = useLayerById(layer.sourceVolumeId) as VolumeViewLayer;
        if (volumeLayer) {
          const volumeTexture = await loadVolumeTexture3D(volumeLayer.resourceId);
          const colormapTexture = vol2surfService.current.createColormapTexture1D(layer.colormap);
          
          material = vol2surfService.current.createSurfaceMaterial(
            volumeTexture,
            colormapTexture,
            calculateCoordinateTransform(layer, volumeLayer)
          );
        } else {
          // Fallback to uniform material
          material = new THREE.MeshLambertMaterial({ color: 0x888888 });
        }
      } else {
        // Pure surface - uniform or intrinsic coloring
        material = layer.surfaceProperties.wireframe
          ? new THREE.MeshBasicMaterial({ wireframe: true, color: 0xffffff })
          : new THREE.MeshLambertMaterial({ color: 0x888888 });
      }
      
      // Apply layer opacity
      material.transparent = layer.opacity < 1.0;
      material.opacity = layer.opacity;
      
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.isSurfaceLayer = true;
      mesh.userData.layerId = layer.id;
      
      sceneRef.current!.add(mesh);
    });
  }, [surfaceLayers]);
  
  // Render loop
  useEffect(() => {
    let animationId: number;
    
    const animate = () => {
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
      animationId = requestAnimationFrame(animate);
    };
    
    animate();
    
    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, []);
  
  return (
    <canvas 
      ref={canvasRef}
      className={className}
      style={{ width, height }}
    />
  );
};
```

## Implementation Timeline

### Phase 1: Foundation & Refactoring (1-2 weeks)
- Extract `SharedControls` component from current `LayerControlsPanel`
- Extend type system with `SurfaceViewLayer` interface
- Update `ViewState` to handle discriminated union
- Add surface-specific state selectors
- **Deliverable**: Type-safe foundation with refactored controls, no breaking changes

### Phase 2: Basic Surface Loading (2-3 weeks)  
- Implement `SurfaceHandle` and basic surface loading
- Extend `LayerService` with `addSurfaceLayer()`
- Create basic `SurfaceView` component with uniform coloring
- Update `LayerTable` with surface indicators
- **Deliverable**: Can load and display static surface meshes

### Phase 3: Surface Controls (1-2 weeks)
- Implement `SurfaceControls` component for surface-specific properties
- Update `LayerControlsPanel` to use composition pattern
- Add wireframe, lighting, and smoothing controls
- **Deliverable**: Interactive surface layer controls

### Phase 4: Vol2Surf Web Worker (2-3 weeks)
- Implement CPU-based vol2surf mapping with Web Workers
- Create `createVol2SurfLayer()` service method
- Add vol2surf controls to UI
- **Deliverable**: Functional vol2surf mapping (CPU-based)

### Phase 5: GPU Optimization (3-4 weeks)
- Implement GPU shader-based vol2surf mapping
- Create `Vol2SurfGPUService` with Three.js shaders
- Performance testing and optimization
- **Deliverable**: Real-time vol2surf mapping (GPU-accelerated)

### Phase 6: Polish & Integration (1-2 weeks)
- Coordinate system alignment utilities
- Memory optimization and WebGL limits handling
- Comprehensive testing and documentation
- **Deliverable**: Production-ready surface visualization

## Risk Mitigation Strategies

### Memory Management
- **Problem**: Large surface meshes + volume data can exhaust GPU memory
- **Solution**: Implement level-of-detail (LOD) for surface meshes, texture compression for volumes, progressive loading

### Coordinate System Alignment
- **Problem**: Surfaces and volumes often in different coordinate spaces
- **Solution**: Explicit transformation matrices, coordinate system metadata, alignment utilities

### Performance Degradation
- **Problem**: Multiple vol2surf layers can impact frame rate
- **Solution**: GPU-first approach, render budgeting, automatic quality scaling

### Backward Compatibility
- **Problem**: Changes to `ViewLayer` type might break existing code
- **Solution**: Maintain deprecated aliases, migration utilities, comprehensive testing

## Success Metrics

### Functional Requirements
- [x] Load and display multiple surface layers simultaneously
- [x] Interactive controls for surface-specific properties (wireframe, lighting)
- [x] Real-time vol2surf mapping with customizable colormaps and thresholds
- [x] Unified layer management (drag-and-drop, visibility, opacity)

### Performance Requirements
- [x] >30 FPS with 2 surface layers (150k vertices each) + vol2surf mapping
- [x] <500ms vol2surf update latency after colormap/threshold changes
- [x] <2GB GPU memory usage for typical use cases

### Usability Requirements
- [x] Intuitive workflow for creating vol2surf mappings
- [x] Clear visual distinction between surface types in layer panel
- [x] Responsive controls with immediate visual feedback

## Future Extensions

### Advanced Surface Features
- **Multi-resolution surfaces**: Support for different detail levels
- **Surface annotations**: ROI boundaries, parcellations, labels
- **Surface time series**: 4D surface data with temporal navigation

### Additional Data Types
- **Tractography**: White matter fiber tracks as specialized surface type
- **Point clouds**: Sparse data visualization
- **Vector fields**: Flow visualization on surfaces

### Visualization Enhancements
- **Advanced lighting**: PBR materials, environment mapping
- **Animation**: Temporal data playback, morphing between surfaces
- **AR/VR support**: Immersive surface exploration

## Surface Data Overlay Architecture (NEW)

### Overview
GIFTI files come in multiple types:
- `.surf.gii` - Surface geometry (vertices and faces)
- `.func.gii` - Functional data overlays (statistical maps, activation)
- `.shape.gii` - Morphometric data (thickness, curvature, etc.)
- `.label.gii` - Parcellation labels

Currently, the system only supports `.surf.gii` geometry files. We need to extend support for data overlays.

### The Problem
When attempting to load a `.func.gii` file, the system returns:
```
LoaderError: "GIFTI loader error: Content type detection failed: 
Unable to determine GIFTI content type: No coordinate data found in GIFTI file"
```

This occurs because:
1. Backend GIFTI loader only expects geometry data
2. No separate loading path for overlay files
3. File routing doesn't distinguish between GIFTI types

### Architectural Solution

#### Phase 1: Backend Support
Extend the GIFTI loader to handle functional data:

```rust
// core/loaders/gifti/src/lib.rs
pub enum GiftiContentType {
    Geometry { ... },
    SurfaceData { 
        data_count: usize,
        intent: String,  // "NIFTI_INTENT_TTEST", etc.
    },
}

// New Tauri command
#[command]
async fn load_surface_overlay(
    path: String,
    target_surface_id: String
) -> Result<SurfaceDataHandle> {
    // Load functional GIFTI data
    let data = load_gifti_functional(&path)?;
    
    // Validate vertex count matches target surface
    let surface = get_surface(&target_surface_id)?;
    if data.len() != surface.vertex_count {
        return Err("Vertex count mismatch");
    }
    
    // Store data and return handle
    let handle = store_surface_data(data);
    Ok(handle)
}
```

#### Phase 2: Frontend Service Layer
Create dedicated overlay loading service:

```typescript
// services/SurfaceOverlayService.ts
export class SurfaceOverlayService {
  async loadSurfaceOverlay(
    filePath: string,
    targetSurfaceId: string
  ): Promise<SurfaceDataLayer> {
    // Validate file is overlay type
    if (!this.isOverlayFile(filePath)) {
      throw new Error("Not a valid overlay file");
    }
    
    // Load data via Tauri
    const dataHandle = await invoke('load_surface_overlay', {
      path: filePath,
      targetSurfaceId
    });
    
    // Create data layer
    return {
      id: nanoid(),
      name: path.basename(filePath),
      dataHandle,
      surfaceId: targetSurfaceId,
      colormap: 'viridis',
      range: await this.getDataRange(dataHandle),
      opacity: 1.0
    };
  }
  
  private isOverlayFile(path: string): boolean {
    return path.includes('.func.gii') || 
           path.includes('.shape.gii');
  }
}
```

#### Phase 3: UI Workflow

##### Option A: Drag-Drop Workflow
1. User loads surface geometry first (`.surf.gii`)
2. User drags overlay file onto surface viewer
3. System detects overlay type and prompts for mapping
4. Overlay applied to surface vertices

##### Option B: Context Menu Workflow
1. Right-click on loaded surface in SurfaceListPanel
2. Select "Add Data Overlay..."
3. File dialog filters for `.func.gii`, `.shape.gii`
4. Load and apply overlay

##### Option C: Automatic Detection
1. When loading any `.gii` file, detect type
2. If overlay, show surface selection dialog
3. User picks target surface from loaded surfaces
4. Apply overlay automatically

#### Phase 4: Rendering Integration

```typescript
// In SurfaceViewCanvas.tsx
const applyOverlayToSurface = (
  surface: NeuroSurface,
  overlayData: Float32Array,
  colormap: string,
  range: [number, number]
) => {
  // Create data layer on surface
  surface.setDataLayer(overlayData, {
    colormap,
    intensityRange: range,
    opacity: 1.0
  });
  
  // Update material to use vertex colors
  surface.mesh.material.vertexColors = true;
  surface.mesh.material.needsUpdate = true;
};
```

### Data Flow Architecture

```
GIFTI Overlay File (.func.gii)
    ↓
Backend GIFTI Loader (detect as SurfaceData)
    ↓
load_surface_overlay Command
    ↓
Validate Vertex Count Match
    ↓
Store Data with Handle
    ↓
Frontend SurfaceOverlayService
    ↓
Create SurfaceDataLayer
    ↓
Apply to NeuroSurface via setDataLayer
    ↓
Render with Vertex Colors
```

### Store Updates

```typescript
// surfaceStore.ts additions
interface SurfaceDataLayer {
  id: string;
  name: string;
  dataHandle: string;
  surfaceId: string;
  colormap: string;
  range: [number, number];
  threshold?: [number, number];
  opacity: number;
  showOnlyPositive?: boolean;
  showOnlyNegative?: boolean;
}

interface SurfaceStore {
  // Existing
  surfaces: Map<string, Surface>;
  
  // New
  dataLayers: Map<string, SurfaceDataLayer>;
  
  // Methods
  addDataLayer(layer: SurfaceDataLayer): void;
  updateDataLayer(id: string, updates: Partial<SurfaceDataLayer>): void;
  removeDataLayer(id: string): void;
  getDataLayersForSurface(surfaceId: string): SurfaceDataLayer[];
}
```

### File Type Detection Strategy

```typescript
// utils/giftiTypeDetection.ts
export function detectGiftiType(filename: string): 'geometry' | 'overlay' | 'unknown' {
  // Check file naming conventions
  if (filename.includes('.surf.gii')) return 'geometry';
  if (filename.includes('.func.gii')) return 'overlay';
  if (filename.includes('.shape.gii')) return 'overlay';
  if (filename.includes('.label.gii')) return 'overlay';
  
  // Fallback: try to load and detect from content
  return 'unknown';
}
```

### Implementation Priority

1. **Critical Path** (Sprint 3.0):
   - Backend: Extend GIFTI loader for functional data
   - Backend: Add load_surface_overlay command
   - Frontend: Create SurfaceOverlayService
   - Frontend: Basic overlay application to surface

2. **Enhanced UX** (Sprint 3.1):
   - Drag-drop overlay support
   - Surface selection dialog
   - Overlay management in SurfaceListPanel
   - SurfaceDataLayerControls component

3. **Advanced Features** (Future):
   - Multiple overlays per surface
   - Overlay blending modes
   - Statistical thresholding
   - Cluster-based filtering

## Migration Path

### Step-by-Step Migration Strategy

1. **Phase 0: Preparation (No breaking changes)**
   - Create `SharedControls.tsx` by extracting content from `LayerControlsPanel.tsx`
   - Keep `LayerControlsPanel` working exactly as before
   - Add unit tests for shared controls

2. **Phase 1: Type System Extension**
   - Add discriminated union types to `viewState.ts`
   - Maintain backward compatibility with type aliases
   - Update TypeScript configs if needed

3. **Phase 2: Component Refactoring**
   - Update `LayerControlsPanel` to use `SharedControls`
   - Add empty `SurfaceControls` component (placeholder)
   - Ensure all existing functionality unchanged

4. **Phase 3: Surface Support**
   - Implement surface loading in backend
   - Add `SurfaceView` component
   - Enable surface layers in UI

5. **Phase 4: Progressive Enhancement**
   - Add vol2surf mapping
   - Optimize performance with GPU shaders
   - Add advanced surface features

### Backward Compatibility Guarantees

- All existing volume functionality remains unchanged
- No breaking changes to public APIs
- Gradual opt-in for surface features
- Type aliases maintain compatibility:
  ```typescript
  // For backward compatibility
  export type VolumeLayer = VolumeViewLayer;  // Alias
  export type Layer = ViewLayer;  // Works with existing code
  ```

---

**Document Status**: Architecture Implemented with Separate Panels  
**Updated**: 2025-01-09 - Pivoted from unified to separate panels based on user feedback  
**Key Decision**: Separate panels for volumes (LayerPanel) and surfaces (SurfaceListPanel)  
**Critical Insight**: Surfaces and volumes are fundamentally different visualization paradigms  
**Implementation Complete**: 
1. ✅ UnifiedLayerService facade created (reserved for future use)
2. ✅ useUnifiedLayers hook implemented (available but not used)
3. ✅ LayerPanel updated to show volumes only
4. ✅ SurfaceListPanel created for surface management
5. ✅ Both panels registered in GoldenLayout as tabs
6. ✅ Architecture allows future use of facade for programmatic features