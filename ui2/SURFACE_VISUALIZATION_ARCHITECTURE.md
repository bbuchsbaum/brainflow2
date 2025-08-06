# Surface Visualization Architecture Plan

**Status**: Planning Phase  
**Date**: 2025-08-05  
**Reviewed by**: O3 (OpenAI) and Gemini-2.5-Pro expert analysis  

## Executive Summary

This document outlines the architectural plan for adding 3D surface visualization capabilities to the Brainflow neuroimaging application, which currently supports only volumetric data visualization. The plan enables:

1. **3D Brain Surface Meshes**: Multi-layer surface support with shared controls
2. **Volume-to-Surface Mapping (vol2surf)**: Dynamic projection of volume data onto surface vertices
3. **Hybrid Visualization**: Surface backgrounds with volume data mapped dynamically
4. **Unified Layer Management**: Single LayerPanel handling both volumes and surfaces
5. **Performance-Optimized**: GPU-accelerated vol2surf mapping for real-time updates

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
// Decouple control components to prevent conditional explosion
const CONTROLS_MAP = {
  volume: VolumeControls,
  surface: SurfaceControls,
} as const;

export const LayerControlsPanel: React.FC<LayerControlsPanelProps> = ({ 
  selectedLayer 
}) => {
  if (!selectedLayer) return <NoLayerSelected />;
  
  const ControlsComponent = CONTROLS_MAP[selectedLayer.dataType];
  
  return (
    <div className="space-y-4">
      {/* Shared controls rendered for ALL layer types */}
      <SharedControls 
        layer={selectedLayer}
        onOpacityChange={handleOpacityChange}
        onColormapChange={handleColormapChange}
        onIntensityChange={handleIntensityChange}
        onThresholdChange={handleThresholdChange}
      />
      
      {/* Type-specific controls */}
      {ControlsComponent && (
        <ControlsComponent 
          layer={selectedLayer} 
          onPropertiesChange={handlePropertiesChange}
        />
      )}
      
      {/* Vol2Surf mapping controls (if applicable) */}
      {selectedLayer.dataType === 'surface' && selectedLayer.sourceVolumeId && (
        <Vol2SurfControls
          surfaceLayer={selectedLayer}
          sourceVolumeId={selectedLayer.sourceVolumeId}
          onMappingChange={handleMappingChange}
        />
      )}
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

### Phase 1: Foundation (2-3 weeks)
- Extend type system with `SurfaceViewLayer` interface
- Update `ViewState` to handle discriminated union
- Add surface-specific state selectors
- **Deliverable**: Type-safe foundation with no UI changes

### Phase 2: Basic Surface Loading (2-3 weeks)  
- Implement `SurfaceHandle` and basic surface loading
- Extend `LayerService` with `addSurfaceLayer()`
- Create basic `SurfaceView` component with uniform coloring
- **Deliverable**: Can load and display static surface meshes

### Phase 3: Surface Controls (1-2 weeks)
- Implement component composition pattern for `LayerControlsPanel`
- Create `SurfaceControls` component
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

---

**Document Status**: Architecture planning complete, ready for implementation  
**Next Steps**: Begin Phase 1 implementation with type system extensions