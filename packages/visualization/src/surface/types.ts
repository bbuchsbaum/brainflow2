import type React from 'react';

export type SurfaceLayerKind = 'data' | 'rgba' | 'volume';

export interface SurfaceRenderableGeometry {
  vertices: Float32Array;
  faces: Uint32Array;
  hemisphere?: 'left' | 'right' | 'both' | string;
  surfaceType?: string;
}

export interface SurfaceRenderableLayer {
  id: string;
  visible?: boolean;
  colormap?: string;
  range?: [number, number];
  threshold?: [number, number];
  opacity?: number;
  values?: Float32Array;
  indices?: Uint32Array | null;
  rgba?: Float32Array;
  volumeData?: ArrayBuffer;
  volumeDims?: [number, number, number];
  affineMatrix?: Float32Array;
}

export interface SurfaceRenderable {
  handle: string;
  name?: string;
  visible?: boolean;
  geometry: SurfaceRenderableGeometry;
  layers: ReadonlyMap<string, SurfaceRenderableLayer> | readonly SurfaceRenderableLayer[];
  metadata?: unknown;
}

export interface SurfaceLightingSettings {
  ambientLightIntensity: number;
  directionalLightIntensity: number;
  fillLightIntensity?: number;
  lightPosition: [number, number, number];
}

export interface SurfaceMaterialSettings {
  surfaceColor: string;
  shininess: number;
  specularColor: string;
  emissiveColor: string;
  emissiveIntensity: number;
}

export interface SurfaceProjectionSettings {
  useGPUProjection: boolean;
}

export interface SurfaceDisplaySettings {
  wireframe: boolean;
  opacity: number;
  smoothing: number;
  flatShading: boolean;
}

export interface SurfaceViewSettings {
  lightingSettings: SurfaceLightingSettings;
  displaySettings: SurfaceDisplaySettings;
  materialSettings: SurfaceMaterialSettings;
  projectionSettings: SurfaceProjectionSettings;
}

export const DEFAULT_NEURO_SURFACE_LIGHTING_SETTINGS: SurfaceLightingSettings = {
  ambientLightIntensity: 0.4,
  directionalLightIntensity: 1.0,
  fillLightIntensity: 0.5,
  lightPosition: [100, 100, 100],
};

export const DEFAULT_NEURO_SURFACE_DISPLAY_SETTINGS: SurfaceDisplaySettings = {
  wireframe: false,
  opacity: 1,
  smoothing: 0,
  flatShading: false,
};

export const DEFAULT_NEURO_SURFACE_MATERIAL_SETTINGS: SurfaceMaterialSettings = {
  surfaceColor: '#CCCCCC',
  shininess: 30,
  specularColor: '#ffffff',
  emissiveColor: '#000000',
  emissiveIntensity: 0,
};

export const DEFAULT_NEURO_SURFACE_PROJECTION_SETTINGS: SurfaceProjectionSettings = {
  useGPUProjection: false,
};

export const DEFAULT_NEURO_SURFACE_VIEW_SETTINGS: SurfaceViewSettings = {
  lightingSettings: DEFAULT_NEURO_SURFACE_LIGHTING_SETTINGS,
  displaySettings: DEFAULT_NEURO_SURFACE_DISPLAY_SETTINGS,
  materialSettings: DEFAULT_NEURO_SURFACE_MATERIAL_SETTINGS,
  projectionSettings: DEFAULT_NEURO_SURFACE_PROJECTION_SETTINGS,
};

export interface RenderableLayerSpec {
  id: string;
  kind: SurfaceLayerKind;
  colormap?: string;
  range?: [number, number];
  threshold?: [number, number];
  opacity: number;
  values?: Float32Array;
  indices?: Uint32Array | null;
  rgba?: Float32Array;
  volumeData?: ArrayBuffer;
  volumeDims?: [number, number, number];
  affineMatrix?: Float32Array;
}

export interface SurfaceReconciliationPlan {
  requiresRebuild: boolean;
  compositingModeChanged: boolean;
  removeLayerIds: string[];
  addLayers: RenderableLayerSpec[];
  updateLayers: RenderableLayerSpec[];
  orderedLayerIds: string[];
  orderChanged: boolean;
}

export type SurfaceCanvasExporter = (options: {
  format: 'png' | 'jpg';
  transparentBackground: boolean;
}) => Promise<Uint8Array>;

export interface NeuroSurfaceCanvasProps {
  surfaces: readonly SurfaceRenderable[];
  width: number;
  height: number;
  viewpoint?: string;
  showControls?: boolean;
  lightingSettings?: SurfaceLightingSettings;
  displaySettings?: SurfaceDisplaySettings;
  materialSettings?: SurfaceMaterialSettings;
  projectionSettings?: SurfaceProjectionSettings;
  renderSignal?: unknown;
  /**
   * World-space [x, y, z] in mm (same coordinate frame as the surface vertices)
   * to mark with a cursor sphere — e.g. the linked volume crosshair. Pass
   * `null`/`undefined` to hide the marker.
   */
  /** Optional anatomical world vertices indexed exactly like each display mesh.
   * When supplied, meshes absent from this map cannot drive a linked cursor.
   * Inflated displays use these for picking/snapping and retain their own
   * vertex positions for drawing the marker.
   */
  cursorAnatomy?: ReadonlyMap<string, Float32Array>;
  markerWorldPosition?: [number, number, number] | null;
  /**
   * When true (default), the marker snaps to the nearest surface vertex so it
   * sits on the cortex rather than floating at the raw world point.
   */
  markerSnapToSurface?: boolean;
  /**
   * Hide the marker when the nearest surface vertex is farther than this many
   * mm from the world point (so a crosshair deep in the brain / off the loaded
   * hemisphere doesn't snap to a misleading spot). No limit when undefined.
   */
  markerMaxSnapDistanceMm?: number;
  /** Marker sphere color (hex). Defaults to a bright green. */
  markerColor?: string;
  /** Marker sphere radius in world mm. Defaults to 2.5. */
  markerRadiusMm?: number;
  className?: string;
  style?: React.CSSProperties;
  onActivate?: () => void;
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>;
  onExporterChange?: (exporter: SurfaceCanvasExporter | null) => void;
  onError?: (error: unknown) => void;
  /**
   * Fired when the user clicks (not drags) a point on a rendered surface, with
   * the picked location in the surface's own vertex frame (world [x, y, z]).
   * Used to drive a reverse linked cursor (surface click → volume crosshair).
   */
  onSurfacePick?: (world: [number, number, number]) => void;
}

export type NeurosurfaceLayerConfig =
  | {
      type: 'base';
      id: string;
      color?: number;
      opacity?: number;
      visible?: boolean;
      order?: number;
    }
  | {
      type: 'data';
      id: string;
      data: Float32Array | number[];
      indices?: Uint32Array | number[];
      colorMap?: unknown;
      range?: [number, number];
      threshold?: [number, number];
      opacity?: number;
      blendMode?: string;
      visible?: boolean;
      order?: number;
    }
  | {
      type: 'rgba';
      id: string;
      data: Float32Array | number[];
      opacity?: number;
      blendMode?: string;
      visible?: boolean;
      order?: number;
    }
  | {
      type: 'label';
      id: string;
      labels: Uint32Array | Int32Array | number[];
      labelDefs: Array<{ id: number; color: number; name?: string }>;
      defaultColor?: number;
      opacity?: number;
      visible?: boolean;
      order?: number;
    }
  | {
      type: 'outline';
      id: string;
      roiLabels: Uint32Array | Int32Array | number[];
      color?: number;
      opacity?: number;
      width?: number;
      halo?: boolean;
      haloColor?: number;
      haloWidth?: number;
      offset?: number;
      roiSubset?: number[] | null;
      visible?: boolean;
      blendMode?: string;
      order?: number;
    };
