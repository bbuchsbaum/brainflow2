import type { SurfaceCameraState } from './cameraState.js';
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
  /**
   * Per-vertex folding values for the grey underlay (FreeSurfer convention:
   * positive in sulci): a `.sulc`/`.curv`/`.shape.gii` file, or sulcal depth
   * computed from the matching folded mesh. Null/absent: plain base colour.
   */
  curvature?: Float32Array | null;
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
  /** Draw the folding (curvature / sulcal depth) underlay when a surface has one. */
  showCurvature?: boolean;
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
  showCurvature: true,
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

/** A camera pose for a figure capture (D3). */
/** An anatomical figure view, or 'current': the camera as the user left it. */
export type SurfaceExportView = 'current' | 'lateral' | 'medial' | 'dorsal' | 'ventral' | 'anterior' | 'posterior';

export interface SurfaceExportPose {
  view: SurfaceExportView;
  /**
   * Which hemisphere to show: 'left' / 'right' hide the other one; 'both'
   * shows every visible surface (a paired view when a left and a right
   * surface are loaded). Default: every visible surface, single view of the
   * first.
   */
  hemisphere?: 'left' | 'right' | 'both';
}

/** The camera's screen basis in world (RAS) coordinates. */
export interface SurfaceCameraBasis {
  /** World direction pointing to screen right. */
  right: [number, number, number];
  /** World direction pointing to screen up. */
  up: [number, number, number];
  /** World direction from the camera into the scene. */
  forward: [number, number, number];
}

export interface SurfaceCaptureResult {
  bytes: Uint8Array;
  /** The pose's camera basis (for an orientation glyph in the figure). */
  basis: SurfaceCameraBasis | null;
  /** Hemispheres drawn. */
  hemispheres: Array<'left' | 'right'>;
}

export type SurfaceCanvasExporter = ((options: {
  format: 'png' | 'jpg';
  transparentBackground: boolean;
}) => Promise<Uint8Array>) & {
  /**
   * Render one pose at width x height device pixels on the live viewer
   * (controls paused, other hemisphere hidden, anatomical view, then the
   * camera, visibility and marker restored). Present on viewers that support
   * figure capture.
   */
  captureCamera?: () => SurfaceCameraState | null;
  capturePose?: (options: {
    pose: SurfaceExportPose;
    width: number;
    height: number;
    transparentBackground: boolean;
    background?: string;
    showMarker?: boolean;
  }) => Promise<SurfaceCaptureResult>;
  /** What a figure can show: hemispheres on screen, the viewport's aspect, the largest renderable side. */
  figureInfo?: () => SurfaceFigureInfo;
};

export interface SurfaceFigureInfo {
  /** Hemispheres of the visible surfaces (left first). */
  hemispheres: Array<'left' | 'right'>;
  /** The on-screen viewport, CSS px. */
  viewport: { width: number; height: number };
  /** Largest pane side the WebGL context can render (drawing buffer limit). */
  maxSide: number;
}

export interface NeuroSurfaceCanvasProps {
  surfaces: readonly SurfaceRenderable[];
  width: number;
  height: number;
  viewpoint?: string;
  /** Applied once after the initial mesh fit; subsequent preset controls remain active. */
  initialCameraState?: SurfaceCameraState | null;
  onCameraStateChange?: (state: SurfaceCameraState) => void;
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
  /** Optional subset eligible for cursor snapping; picking remains available on every mesh. */
  markerSurfaceHandles?: readonly string[];
  /** Marker sphere color (hex). Defaults to a bright green. */
  markerColor?: string;
  /** Marker sphere radius in world mm. Defaults to 2.5. */
  markerRadiusMm?: number;
  className?: string;
  style?: React.CSSProperties;
  onActivate?: () => void;
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>;
  onExporterChange?: (exporter: SurfaceCanvasExporter | null) => void;
  /** The camera's screen basis whenever it changes (orientation glyph, D5). */
  onCameraChange?: (basis: SurfaceCameraBasis) => void;
  /**
   * Bump to re-apply `viewpoint` even when its value is unchanged (the preset
   * pressed again after an orbit). The viewpoint is also re-applied after the
   * first fit of a new mesh.
   */
  viewpointNonce?: number;
  onError?: (error: unknown) => void;
  /**
   * Fired when the user clicks (not drags) a point on a rendered surface, with
   * the picked location in the surface's own vertex frame (world [x, y, z]).
   * Used to drive a reverse linked cursor (surface click → volume crosshair).
   */
  onSurfacePick?: (world: [number, number, number], picked?: { handle: string; vertex: number }) => void;
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
