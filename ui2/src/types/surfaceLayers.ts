/**
 * Surface layer types for neuroimaging visualization
 * These extend the base layer types to support surface meshes
 * 
 * SURF-105: Define surface layer TypeScript interfaces
 * SURF-106: Update ViewLayer discriminated union
 * SURF-107: Create surface-specific property types
 */

import type { Layer, LayerRender } from './layers';

/**
 * Surface-specific rendering properties (SURF-107)
 * These control the appearance of the mesh geometry itself
 */
export interface SurfaceRenderProperties {
  // Mesh display
  wireframe: boolean;
  smoothing: number;  // 0-1, controls normal smoothing
  
  // Lighting model
  lighting: {
    ambient: number;   // 0-1, ambient light contribution
    diffuse: number;   // 0-1, diffuse light contribution
    specular: number;  // 0-1, specular highlight strength
    shininess?: number; // Specular exponent (default: 30)
  };
  
  // Transform
  coordinateTransform?: number[]; // 4x4 matrix as flat array
  
  // Vertex coloring mode
  vertexColoring: 'uniform' | 'mapped' | 'intrinsic';
  baseColor?: string; // Color when vertexColoring is 'uniform'
  
  // Surface-specific opacity (separate from data layer opacity)
  surfaceOpacity: number; // 0-1
}

/**
 * Surface types commonly used in neuroimaging
 */
export type SurfaceType = 'pial' | 'white' | 'inflated' | 'sphere' | 'flat' | 'midthickness';

/**
 * Hemisphere designation
 */
export type Hemisphere = 'left' | 'right' | 'both';

/**
 * Surface metadata specific to neuroimaging surfaces
 */
export interface SurfaceMetadata {
  // Mesh statistics
  vertexCount: number;
  faceCount: number;
  
  // Surface identification
  surfaceType?: SurfaceType;
  hemisphere?: Hemisphere;
  subject?: string;
  
  // Coordinate system
  coordinateSystem?: 'RAS' | 'LAS' | 'LPI' | 'RPI' | 'scanner' | 'tal' | 'mni';
  
  // Memory usage
  memoryBytes?: number;
  
  // File information
  sourceFile?: string;
  fileFormat?: 'gifti' | 'freesurfer' | 'ply' | 'vtk' | 'stl';
}

/**
 * Base properties shared by all layer types
 */
export interface BaseViewLayer {
  id: string;
  name: string;
  resourceId: string;  // Generic resource identifier
  visible: boolean;
  order: number;
  opacity: number;
  colormap: string;
  intensity: [number, number];
  threshold: [number, number];
}

/**
 * Volume layer (existing functionality)
 */
export interface VolumeViewLayer extends BaseViewLayer {
  dataType: 'volume';
  volumeId: string; // For backward compatibility
  interpolation: 'nearest' | 'linear';
}

/**
 * Surface layer with optional volume mapping (SURF-105)
 */
export interface SurfaceViewLayer extends BaseViewLayer {
  dataType: 'surface';
  
  // Surface-specific properties
  surfaceProperties: SurfaceRenderProperties;
  surfaceMetadata?: SurfaceMetadata;
  
  // Surface handle from backend
  surfaceHandle?: string;
  
  // For vol2surf mapping
  sourceVolumeId?: string; // Volume that provides the data
  mappingParameters?: {
    method: 'nearest' | 'trilinear' | 'weighted';
    projectionDepth?: number; // mm from surface
    smoothingKernel?: number; // mm FWHM
  };
}

/**
 * Discriminated union of all layer types
 */
export type ViewLayer = VolumeViewLayer | SurfaceViewLayer;

/**
 * Type guard for volume layers
 */
export function isVolumeLayer(layer: ViewLayer): layer is VolumeViewLayer {
  return layer.dataType === 'volume';
}

/**
 * Type guard for surface layers
 */
export function isSurfaceLayer(layer: ViewLayer): layer is SurfaceViewLayer {
  return layer.dataType === 'surface';
}

/**
 * Type guard for vol2surf layers (surfaces with mapped volume data)
 */
export function isVol2SurfLayer(layer: ViewLayer): layer is SurfaceViewLayer {
  return layer.dataType === 'surface' && !!layer.sourceVolumeId;
}

/**
 * Surface rendering mode (SURF-107)
 */
export type SurfaceRenderMode = 'solid' | 'wireframe' | 'points' | 'solid+wireframe';

/**
 * Surface shader type options
 */
export type SurfaceShaderType = 'phong' | 'lambert' | 'physical' | 'toon' | 'matcap';

/**
 * Surface color mapping source
 */
export interface SurfaceColorMapping {
  source: 'uniform' | 'vertex' | 'texture' | 'volume';
  uniformColor?: string;
  vertexColors?: Float32Array;
  textureId?: string;
  volumeId?: string;
}

/**
 * Complete surface state combining geometry and data
 */
export interface SurfaceState {
  layer: SurfaceViewLayer;
  geometry: {
    vertices: Float32Array;
    faces: Uint32Array;
    normals?: Float32Array;
    uvs?: Float32Array;
  };
  colorMapping: SurfaceColorMapping;
  isLoading: boolean;
  error?: string;
}

/**
 * Surface interaction modes
 */
export type SurfaceInteractionMode = 'rotate' | 'pan' | 'zoom' | 'pick' | 'paint' | 'measure';

/**
 * Surface camera preset positions
 */
export interface SurfaceCameraPreset {
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
}

/**
 * Common camera presets for neuroimaging surfaces
 */
export const SURFACE_CAMERA_PRESETS: Record<string, SurfaceCameraPreset> = {
  lateral_left: {
    name: 'Left Lateral',
    position: [-100, 0, 0],
    target: [0, 0, 0],
    up: [0, 0, 1]
  },
  lateral_right: {
    name: 'Right Lateral',
    position: [100, 0, 0],
    target: [0, 0, 0],
    up: [0, 0, 1]
  },
  medial_left: {
    name: 'Left Medial',
    position: [100, 0, 0],
    target: [0, 0, 0],
    up: [0, 0, 1]
  },
  medial_right: {
    name: 'Right Medial',
    position: [-100, 0, 0],
    target: [0, 0, 0],
    up: [0, 0, 1]
  },
  dorsal: {
    name: 'Dorsal',
    position: [0, 0, 100],
    target: [0, 0, 0],
    up: [0, 1, 0]
  },
  ventral: {
    name: 'Ventral',
    position: [0, 0, -100],
    target: [0, 0, 0],
    up: [0, 1, 0]
  },
  anterior: {
    name: 'Anterior',
    position: [0, 100, 0],
    target: [0, 0, 0],
    up: [0, 0, 1]
  },
  posterior: {
    name: 'Posterior',
    position: [0, -100, 0],
    target: [0, 0, 0],
    up: [0, 0, 1]
  }
};

/**
 * Helper to create default surface render properties
 */
export function createDefaultSurfaceRenderProperties(): SurfaceRenderProperties {
  return {
    wireframe: false,
    smoothing: 0.5,
    lighting: {
      ambient: 0.3,
      diffuse: 0.7,
      specular: 0.2,
      shininess: 30
    },
    vertexColoring: 'uniform',
    baseColor: '#888888',
    surfaceOpacity: 1.0
  };
}

/**
 * Helper to create a surface layer
 */
export function createSurfaceLayer(
  id: string,
  name: string,
  surfaceHandle: string,
  metadata?: Partial<SurfaceMetadata>
): SurfaceViewLayer {
  return {
    id,
    name,
    resourceId: surfaceHandle,
    dataType: 'surface',
    visible: true,
    order: 0,
    opacity: 1,
    colormap: 'viridis',
    intensity: [0, 1],
    threshold: [0, 0],
    surfaceProperties: createDefaultSurfaceRenderProperties(),
    surfaceHandle,
    surfaceMetadata: metadata as SurfaceMetadata
  };
}