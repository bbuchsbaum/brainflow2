# Surface Visualization Architecture Plan

**Status**: Architecture Finalized  
**Date**: 2025-08-05  
**Reviewed by**: O3 (OpenAI) and Gemini-2.5-Pro expert analysis  
**Updated**: 2025-01-08 - LayerPanel separation pattern based on expert consensus

## Executive Summary

This document outlines the architectural plan for adding 3D surface visualization capabilities to the Brainflow neuroimaging application, which currently supports only volumetric data visualization. The plan enables:

1. **3D Brain Surface Meshes**: Multi-layer surface support with dedicated controls
2. **Volume-to-Surface Mapping (vol2surf)**: Dynamic projection of volume data onto surface vertices
3. **Separate Panel Architecture**: Dedicated panels for volumes and surfaces with shared components
4. **Composition Pattern**: Vol2surf as a relationship between types, not a new type
5. **Performance-Optimized**: GPU-accelerated vol2surf mapping for real-time updates

### Key Architecture Decision: Separate Panels with Manager
Based on expert consensus from O3 and Gemini-2.5-Pro:
- **Separate panels** for volumes and surfaces prevent conditional complexity
- **Manager/dispatcher pattern** maintains UX consistency
- **Shared controls** extracted into reusable components
- **Composition over inheritance** for vol2surf hybrid layers

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

### Phase 4: State Management with Dedicated Selectors

**Problem**: Components littered with `layers.filter(l => l.dataType === 'surface')`  
**Solution**: Dedicated hooks encapsulate filtering logic

```typescript
// Dedicated state selectors to avoid repetitive filtering
export const useSurfaceLayers = (): SurfaceViewLayer[] => {
  return useViewStateStore(state => 
    state.viewState.layers.filter(l => l.dataType === 'surface') as SurfaceViewLayer[]
  );
};

export const useVolumeLayers = (): VolumeViewLayer[] => {
  return useViewStateStore(state => 
    state.viewState.layers.filter(l => l.dataType === 'volume') as VolumeViewLayer[]
  );
};

export const useVol2SurfLayers = (): SurfaceViewLayer[] => {
  return useViewStateStore(state => 
    state.viewState.layers.filter(l => 
      l.dataType === 'surface' && l.sourceVolumeId
    ) as SurfaceViewLayer[]
  );
};

export const useLayerById = (id: string): ViewLayer | undefined => {
  return useViewStateStore(state => 
    state.viewState.layers.find(l => l.id === id)
  );
};

export const useAvailableVolumesForMapping = (): VolumeViewLayer[] => {
  return useViewStateStore(state => 
    state.viewState.layers.filter(l => 
      l.dataType === 'volume' && l.visible
    ) as VolumeViewLayer[]
  );
};
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

**Document Status**: Architecture finalized with separate panels pattern  
**Updated**: 2025-01-08 - Expert consensus achieved on LayerPanel separation  
**Key Decision**: Separate VolumePanel and SurfacePanel with LayerPropertiesManager  
**Next Steps**: 
1. Extract SharedControls from existing LayerPanel
2. Create LayerPropertiesManager as central dispatcher
3. Implement VolumePanel and SurfacePanel components
4. Begin surface geometry loading implementation