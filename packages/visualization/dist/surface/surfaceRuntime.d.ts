import { DataLayer, RGBALayer, VolumeProjectionLayer, type MultiLayerNeuroSurface, type NeuroSurfaceViewer } from 'neurosurface';
import type { RenderableLayerSpec, SurfaceDisplaySettings, SurfaceLightingSettings, SurfaceMaterialSettings } from './types.js';
export type SurfaceLightingTarget = Pick<NeuroSurfaceViewer, 'setHeadlight' | 'updateConfig' | 'ambientLight' | 'directionalLight' | 'fillLight'>;
export declare function buildLayerInstance(spec: RenderableLayerSpec): DataLayer | RGBALayer | VolumeProjectionLayer;
export declare function applyLayerUpdate(renderedSurface: MultiLayerNeuroSurface, spec: RenderableLayerSpec): void;
export declare function applySurfaceRenderSettings(surface: MultiLayerNeuroSurface, display: SurfaceDisplaySettings, material: SurfaceMaterialSettings): void;
export declare function applySceneRenderSettings(viewer: SurfaceLightingTarget, settings: SurfaceLightingSettings): void;
//# sourceMappingURL=surfaceRuntime.d.ts.map