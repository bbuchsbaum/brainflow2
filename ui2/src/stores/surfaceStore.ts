/**
 * Surface Store
 * Manages surface geometry and data for visualization
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { DisplayLayer } from '../types/displayLayer';
import type { AtlasConfig } from '@/types/atlas';
import type { AtlasPaletteKind } from '@/types/atlasPalette';

// Surface data types matching backend
export interface SurfaceGeometryData {
  vertices: Float32Array;
  faces: Uint32Array;
  hemisphere?: 'left' | 'right' | 'both';
  surfaceType?: 'pial' | 'white' | 'inflated' | 'sphere';
}

export interface SurfaceDataLayer {
  id: string;
  name: string;
  dataHandle?: string;
  values: Float32Array;
  indices?: Uint32Array; // Optional vertex indices for sparse data
  visible?: boolean;
  colormap: string;
  range: [number, number];      // Current intensity window (display range)
  dataRange: [number, number];  // True data extent (min/max of actual values)
  threshold?: [number, number];
  opacity: number;
  // Categorical/atlas overlays (precolored per-vertex RGBA)
  rgba?: Float32Array;
  labels?: Uint32Array;
  atlasConfig?: AtlasConfig;
  parcellationReferenceId?: string;
  atlasPaletteKind?: AtlasPaletteKind;
  atlasPaletteSeed?: number;
  atlasMaxLabel?: number;
  // Statistical properties
  showOnlyPositive?: boolean;
  showOnlyNegative?: boolean;
  clusterThreshold?: number;
  smoothingKernel?: number;
  mean?: number;
  std?: number;
  // GPU Projection fields (optional - when present, layer can use GPU path)
  // These are set when a volume is projected to a surface for GPU rendering
  volumeData?: ArrayBuffer;               // Raw volume data for GPU texture
  volumeDims?: [number, number, number];  // Volume dimensions [nx, ny, nz]
  affineMatrix?: Float32Array;            // Column-major 4x4 voxel-to-world affine
  volumeId?: string;                      // Reference to source volume
}

export interface LoadedSurface {
  handle: string;
  name: string;
  visible: boolean;
  geometry: SurfaceGeometryData;
  layers: Map<string, SurfaceDataLayer>;
  displayLayers: Map<string, DisplayLayer>;
  metadata: {
    vertexCount: number;
    faceCount: number;
    hemisphere?: string;
    surfaceType?: string;
    path: string;
  };
}

function deriveDisplayLayerFromDataLayer(
  layer: SurfaceDataLayer,
  existing?: DisplayLayer
): DisplayLayer {
  const type: DisplayLayer['type'] =
    layer.labels instanceof Uint32Array
      ? 'label'
      : layer.rgba instanceof Float32Array
        ? 'rgba'
        : 'scalar';

  const next: DisplayLayer = {
    ...existing,
    id: layer.id,
    name: layer.name,
    type,
    visible: layer.visible ?? existing?.visible ?? true,
    opacity: layer.opacity ?? existing?.opacity ?? 1,
    colormap: layer.colormap ?? existing?.colormap,
    intensity: layer.range,
    threshold: layer.threshold,
  };

  if (layer.rgba) {
    next.rgbaData = layer.rgba;
  }
  if (layer.labels) {
    next.labels = layer.labels;
  }

  return next;
}

function applyDisplayLayerToDataLayer(
  dataLayer: SurfaceDataLayer,
  displayLayer: Partial<DisplayLayer>
): SurfaceDataLayer {
  return {
    ...dataLayer,
    ...(displayLayer.name !== undefined ? { name: displayLayer.name } : null),
    ...(displayLayer.visible !== undefined ? { visible: displayLayer.visible } : null),
    ...(displayLayer.opacity !== undefined ? { opacity: displayLayer.opacity } : null),
    ...(displayLayer.colormap !== undefined ? { colormap: displayLayer.colormap } : null),
    ...(displayLayer.intensity !== undefined ? { range: displayLayer.intensity } : null),
    ...(displayLayer.threshold !== undefined ? { threshold: displayLayer.threshold } : null),
  };
}

interface SurfaceRenderSettings {
  wireframe: boolean;
  opacity: number;
  smoothing: number;
  flatShading: boolean;
  // Scene Lighting
  ambientLightIntensity: number;
  directionalLightIntensity: number;
  fillLightIntensity?: number; // Secondary directional light
  lightPosition: [number, number, number];
  // Material Properties
  surfaceColor: string;
  shininess: number;
  specularColor: string;
  emissiveColor: string;
  emissiveIntensity: number;
  // GPU Projection Mode
  // When true, volume-to-surface projection samples volumes in GPU shader
  // When false, uses pre-computed per-vertex values (CPU path)
  useGPUProjection: boolean;
}

interface SurfaceState {
  // Surface storage
  surfaces: Map<string, LoadedSurface>;
  activeSurfaceId: string | null;
  
  // Selection state
  selectedItemType: 'geometry' | 'dataLayer' | null;
  selectedLayerId: string | null;
  
  // Loading state
  isLoading: boolean;
  loadError: string | null;
  
  // View settings
  viewpoint: string;
  showControls: boolean;
  
  // Rendering settings
  renderSettings: SurfaceRenderSettings;
  
  // Actions
  setLoadingState: (isLoading: boolean, loadError?: string | null) => void;
  addSurface: (surface: LoadedSurface, activate?: boolean) => void;
  setSurfaceGeometry: (surfaceId: string, geometry: SurfaceGeometryData) => void;
  addDataLayer: (surfaceId: string, layer: SurfaceDataLayer) => void;
  removeDataLayer: (surfaceId: string, layerId: string) => void;
  updateLayerProperty: (surfaceId: string, layerId: string, property: string, value: unknown) => void;
  upsertDisplayLayer: (surfaceId: string, layer: DisplayLayer) => void;
  updateDisplayLayer: (surfaceId: string, layerId: string, updates: Partial<DisplayLayer>) => void;
  removeDisplayLayer: (surfaceId: string, layerId: string) => void;
  setActiveSurface: (surfaceId: string | null) => void;
  setSurfaceVisibility: (surfaceId: string, visible: boolean) => void;
  removeSurface: (surfaceId: string) => void;
  setViewpoint: (viewpoint: string) => void;
  updateRenderSettings: (settings: Partial<SurfaceRenderSettings>) => void;
  setSelectedItem: (itemType: 'geometry' | 'dataLayer' | null, layerId?: string | null) => void;
  clearError: () => void;
}

export const useSurfaceStore = create<SurfaceState>()(
  devtools(
    (set) => ({
      // Initial state
      surfaces: new Map(),
      activeSurfaceId: null,
      selectedItemType: null,
      selectedLayerId: null,
      isLoading: false,
      loadError: null,
      viewpoint: 'lateral',
      showControls: false,
      
      // Default rendering settings
      renderSettings: {
        wireframe: false,
        opacity: 1.0,
        smoothing: 0.0, // Start with no smoothing
        flatShading: false,
        // Scene Lighting
        ambientLightIntensity: 0.4,
        directionalLightIntensity: 1.0,
        fillLightIntensity: 0.5, // Default fill light
        lightPosition: [100, 100, 100],
        // Material Properties
        surfaceColor: '#CCCCCC', // Light gray default
        shininess: 30,
        specularColor: '#ffffff',
        emissiveColor: '#000000',
        emissiveIntensity: 0.0,
        // GPU Projection - default to CPU path for reliability
        useGPUProjection: false,
      },

      setLoadingState: (isLoading: boolean, loadError: string | null = null) => {
        set((state) => {
          if (state.isLoading === isLoading && state.loadError === loadError) {
            return state;
          }
          return {
            isLoading,
            loadError,
          };
        });
      },

      addSurface: (surface: LoadedSurface, activate = true) => {
        set((state) => {
          const surfaces = new Map(state.surfaces);
          surfaces.set(surface.handle, surface);
          const activeSurfaceId = activate ? surface.handle : state.activeSurfaceId;
          return {
            surfaces,
            activeSurfaceId,
          };
        });
      },

      setSurfaceGeometry: (surfaceId: string, geometry: SurfaceGeometryData) => {
        set((state) => {
          const surface = state.surfaces.get(surfaceId);
          if (!surface) {
            return state;
          }
          const surfaces = new Map(state.surfaces);
          surfaces.set(surfaceId, {
            ...surface,
            geometry,
          });
          return { surfaces };
        });
      },
      
      // Add data layer to surface
      addDataLayer: (surfaceId: string, layer: SurfaceDataLayer) => {
        set((state) => {
          const surface = state.surfaces.get(surfaceId);
          if (!surface) return state;

          const updatedLayer = { visible: true, ...layer };
          const updatedLayers = new Map(surface.layers);
          updatedLayers.set(layer.id, updatedLayer);
          const updatedDisplayLayers = new Map(surface.displayLayers);
          const existingDisplayLayer = updatedDisplayLayers.get(layer.id);
          updatedDisplayLayers.set(
            layer.id,
            deriveDisplayLayerFromDataLayer(updatedLayer, existingDisplayLayer)
          );

          const updatedSurface = {
            ...surface,
            layers: updatedLayers,
            displayLayers: updatedDisplayLayers,
          };
          const updatedSurfaces = new Map(state.surfaces);
          updatedSurfaces.set(surfaceId, updatedSurface);

          return { surfaces: updatedSurfaces };
        });
      },
      
      // Remove data layer
      removeDataLayer: (surfaceId: string, layerId: string) => {
        set((state) => {
          const surface = state.surfaces.get(surfaceId);
          if (!surface) {
            return state;
          }

          if (!surface.layers.has(layerId) && !surface.displayLayers.has(layerId)) {
            return state;
          }

          const layers = new Map(surface.layers);
          layers.delete(layerId);
          const displayLayers = new Map(surface.displayLayers);
          displayLayers.delete(layerId);

          const surfaces = new Map(state.surfaces);
          surfaces.set(surfaceId, { ...surface, layers, displayLayers });

          const nextSelectedItemType =
            state.selectedItemType === 'dataLayer' && state.selectedLayerId === layerId
              ? null
              : state.selectedItemType;
          const nextSelectedLayerId =
            state.selectedItemType === 'dataLayer' && state.selectedLayerId === layerId
              ? null
              : state.selectedLayerId;

          return {
            surfaces,
            selectedItemType: nextSelectedItemType,
            selectedLayerId: nextSelectedLayerId,
          };
        });
      },
      
      // Update layer property
      // IMPORTANT: Create new Map and new layer object to trigger React re-renders
      updateLayerProperty: (surfaceId: string, layerId: string, property: string, value: unknown) => {
        set((state) => {
          const surface = state.surfaces.get(surfaceId);
          if (!surface) return state;

          const layer = surface.layers.get(layerId);
          if (!layer) return state;

          // Create new layer with updated property
          const updatedLayer = { ...layer, [property]: value };

          // Create new layers Map with updated layer
          const newLayers = new Map(surface.layers);
          newLayers.set(layerId, updatedLayer);
          const newDisplayLayers = new Map(surface.displayLayers);
          const existingDisplayLayer = newDisplayLayers.get(layerId);
          newDisplayLayers.set(
            layerId,
            deriveDisplayLayerFromDataLayer(updatedLayer, existingDisplayLayer)
          );

          // Create new surface with synchronized layers and displayLayers maps
          const updatedSurface = {
            ...surface,
            layers: newLayers,
            displayLayers: newDisplayLayers,
          };

          // Create new surfaces Map with updated surface
          const newSurfaces = new Map(state.surfaces);
          newSurfaces.set(surfaceId, updatedSurface);

          return { surfaces: newSurfaces };
        });
      },

      // Upsert a display layer (shared DTO for UI/render)
      upsertDisplayLayer: (surfaceId: string, layer: DisplayLayer) => {
        set((state) => {
          const surface = state.surfaces.get(surfaceId);
          if (!surface) return state;

          const layers = new Map(surface.layers);
          const existingDataLayer = layers.get(layer.id);
          const displayLayers = new Map(surface.displayLayers);

          if (existingDataLayer) {
            const syncedDataLayer = applyDisplayLayerToDataLayer(existingDataLayer, layer);
            layers.set(layer.id, syncedDataLayer);
            displayLayers.set(layer.id, deriveDisplayLayerFromDataLayer(syncedDataLayer, layer));
          } else {
            // Legacy fallback for callers that upsert display-only layers.
            displayLayers.set(layer.id, layer);
          }

          const surfaces = new Map(state.surfaces);
          surfaces.set(surfaceId, { ...surface, layers, displayLayers });
          return { surfaces };
        });
      },

      // Update a display layer by id
      updateDisplayLayer: (surfaceId: string, layerId: string, updates: Partial<DisplayLayer>) => {
        set((state) => {
          const surface = state.surfaces.get(surfaceId);
          if (!surface) return state;

          const displayLayers = new Map(surface.displayLayers);
          const existing = displayLayers.get(layerId);
          if (!existing) return state;

          const nextDisplayLayer = { ...existing, ...updates };
          displayLayers.set(layerId, nextDisplayLayer);

          const layers = new Map(surface.layers);
          const existingDataLayer = layers.get(layerId);
          if (existingDataLayer) {
            const syncedDataLayer = applyDisplayLayerToDataLayer(existingDataLayer, nextDisplayLayer);
            layers.set(layerId, syncedDataLayer);
            displayLayers.set(layerId, deriveDisplayLayerFromDataLayer(syncedDataLayer, nextDisplayLayer));
          }

          const surfaces = new Map(state.surfaces);
          surfaces.set(surfaceId, { ...surface, layers, displayLayers });
          return { surfaces };
        });
      },

      // Remove a display layer
      removeDisplayLayer: (surfaceId: string, layerId: string) => {
        set((state) => {
          const surface = state.surfaces.get(surfaceId);
          if (!surface) return state;

          if (!surface.displayLayers.has(layerId) && !surface.layers.has(layerId)) {
            return state;
          }

          const layers = new Map(surface.layers);
          layers.delete(layerId);
          const displayLayers = new Map(surface.displayLayers);
          displayLayers.delete(layerId);

          const surfaces = new Map(state.surfaces);
          surfaces.set(surfaceId, { ...surface, layers, displayLayers });

          const nextSelectedItemType =
            state.selectedItemType === 'dataLayer' && state.selectedLayerId === layerId
              ? null
              : state.selectedItemType;
          const nextSelectedLayerId =
            state.selectedItemType === 'dataLayer' && state.selectedLayerId === layerId
              ? null
              : state.selectedLayerId;

          return {
            surfaces,
            selectedItemType: nextSelectedItemType,
            selectedLayerId: nextSelectedLayerId,
          };
        });
      },
      
      // Set active surface
      setActiveSurface: (surfaceId: string | null) => {
        set({ activeSurfaceId: surfaceId });
      },

      // Set per-surface geometry visibility
      setSurfaceVisibility: (surfaceId: string, visible: boolean) => {
        set((state) => {
          const current = state.surfaces.get(surfaceId);
          if (!current || current.visible === visible) {
            return state;
          }

          const updatedSurface: LoadedSurface = { ...current, visible };
          const surfaces = new Map(state.surfaces);
          surfaces.set(surfaceId, updatedSurface);

          let nextActiveSurfaceId = state.activeSurfaceId;
          if (!visible && state.activeSurfaceId === surfaceId) {
            const fallbackVisible = Array.from(surfaces.values()).find((s) => s.visible !== false);
            nextActiveSurfaceId = fallbackVisible?.handle ?? state.activeSurfaceId;
          }
          if (visible && !state.activeSurfaceId) {
            nextActiveSurfaceId = surfaceId;
          }

          return {
            surfaces,
            activeSurfaceId: nextActiveSurfaceId,
          };
        });
      },
      
      // Remove surface
      removeSurface: (surfaceId: string) => {
        set((state) => {
          const surfaces = new Map(state.surfaces);
          surfaces.delete(surfaceId);
          const firstVisibleSurfaceId =
            Array.from(surfaces.values()).find((surface) => surface.visible !== false)?.handle ?? null;
          const firstSurfaceId = surfaces.size > 0 ? surfaces.keys().next().value : null;
          const activeSurfaceId = state.activeSurfaceId === surfaceId 
            ? (firstVisibleSurfaceId ?? firstSurfaceId)
            : state.activeSurfaceId;
          return { surfaces, activeSurfaceId };
        });
      },
      
      // Set viewpoint
      setViewpoint: (viewpoint: string) => {
        set({ viewpoint });
      },
      
      // Update render settings
      updateRenderSettings: (settings: Partial<SurfaceRenderSettings>) => {
        set((state) => ({
          renderSettings: {
            ...state.renderSettings,
            ...settings,
          },
        }));
      },
      
      // Set selected item (geometry or data layer)
      setSelectedItem: (itemType, layerId = null) => {
        set({
          selectedItemType: itemType,
          selectedLayerId: itemType === 'dataLayer' ? layerId : null,
        });
      },
      
      // Clear error
      clearError: () => {
        set({ loadError: null });
      },
    }),
    {
      name: 'surface-store',
    }
  )
);
