/**
 * Surface Store
 * Manages surface geometry and data for visualization
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import type { DisplayLayer } from '../types/displayLayer';
import type { AtlasConfig } from '@/types/atlas';
import type { AtlasPaletteKind } from '@/types/atlasPalette';
import { normalizeSurfaceHemisphere } from '@/utils/surfaceIdentity';

// Surface data types matching backend
export interface SurfaceGeometryData {
  vertices: Float32Array;
  faces: Uint32Array;
  hemisphere?: 'left' | 'right' | 'both';
  surfaceType?: 'pial' | 'white' | 'inflated';
}

export interface SurfaceDataLayer {
  id: string;
  name: string;
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
  loadSurface: (path: string) => Promise<string>;
  loadSurfaceGeometry: (handle: string) => Promise<void>;
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
    (set, get) => ({
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
      
      // Load surface from file
      loadSurface: async (path: string) => {
        set({ isLoading: true, loadError: null });
        
        try {
          // Call Tauri command to load surface
          const result = await invoke<{
            type: 'Surface';
            handle: string;
            vertex_count: number;
            face_count: number;
            hemisphere?: string;
            surface_type?: string;
          }>('plugin:api-bridge|load_surface', { path });
          
          
          // Verify we got a Surface type
          if (result.type !== 'Surface') {
            throw new Error(`Expected Surface type, got ${result.type}`);
          }
          
          // Extract the fields (using snake_case as per Rust serialization)
          const handle = result.handle;
          const vertexCount = result.vertex_count || 0;
          const faceCount = result.face_count || 0;
          const hemisphere = normalizeSurfaceHemisphere(result.hemisphere) ?? undefined;
          const surfaceType = result.surface_type;
          
          // Create new surface entry
              const surface: LoadedSurface = {
            handle: handle,
            name: path.split('/').pop() || 'Unknown',
            visible: true,
                geometry: {
                  vertices: new Float32Array(0),
                  faces: new Uint32Array(0),
                  hemisphere,
                  surfaceType: surfaceType as SurfaceGeometryData['surfaceType'],
                },
            layers: new Map(),
            displayLayers: new Map(),
              metadata: {
                vertexCount: vertexCount,
                faceCount: faceCount,
                hemisphere: hemisphere ?? result.hemisphere,
                surfaceType: surfaceType,
                path,
              },
          };
          
          // Store surface
          set((state) => ({
            surfaces: new Map(state.surfaces).set(handle, surface),
            activeSurfaceId: handle,
            isLoading: false,
          }));
          
          // Load geometry data
          await get().loadSurfaceGeometry(handle);
          
          return handle;
        } catch (error) {
          console.error('Failed to load surface:', error);
          set({
            isLoading: false,
            loadError: error instanceof Error ? error.message : 'Failed to load surface'
          });
          throw error;
        }
      },

      // Register a surface from a template (already loaded by backend)
      registerSurfaceFromTemplate: async (
        handle: string,
        metadata: {
          space: string;
          geometryType: string;
          hemisphere: string;
          vertexCount: number;
          faceCount: number;
        }
      ): Promise<string> => {
        set({ isLoading: true, loadError: null });

        try {
          // Generate display name from template metadata
          const normalizedHemisphere =
            normalizeSurfaceHemisphere(metadata.hemisphere) ?? metadata.hemisphere;
          const displayName = `${metadata.space} ${metadata.geometryType} (${normalizedHemisphere})`;

          // Create new surface entry
          const surface: LoadedSurface = {
            handle: handle,
            name: displayName,
            visible: true,
            geometry: {
              vertices: new Float32Array(0),
              faces: new Uint32Array(0),
              hemisphere: normalizeSurfaceHemisphere(metadata.hemisphere) ?? undefined,
              surfaceType: metadata.geometryType as 'pial' | 'white' | 'inflated' | 'sphere',
            },
            layers: new Map(),
            displayLayers: new Map(),
            metadata: {
              vertexCount: metadata.vertexCount,
              faceCount: metadata.faceCount,
              hemisphere: normalizedHemisphere,
              surfaceType: metadata.geometryType,
              path: `templateflow://${metadata.space}_${metadata.geometryType}_${normalizedHemisphere}`,
            },
          };

          // Store surface
          set((state) => ({
            surfaces: new Map(state.surfaces).set(handle, surface),
            activeSurfaceId: handle,
            isLoading: false,
          }));

          // Load geometry data from backend
          await get().loadSurfaceGeometry(handle);

          console.log('[surfaceStore] Registered surface from template:', displayName, handle);
          return handle;
        } catch (error) {
          console.error('Failed to register surface from template:', error);
          set({
            isLoading: false,
            loadError: error instanceof Error ? error.message : 'Failed to register surface from template'
          });
          throw error;
        }
      },

      // Load surface geometry data
      loadSurfaceGeometry: async (handle: string) => {
        try {
          // Get vertices and faces from backend
          const geometryData = await invoke<{
            vertices: number[];
            faces: number[];
          }>('plugin:api-bridge|get_surface_geometry', { handle });
          
          // Convert to typed arrays
          const vertices = new Float32Array(geometryData.vertices);
          const faces = new Uint32Array(geometryData.faces);
          
          // Update surface geometry
          set((state) => {
            const surfaces = new Map(state.surfaces);
            const surface = surfaces.get(handle);
            if (surface) {
              surface.geometry.vertices = vertices;
              surface.geometry.faces = faces;
            }
            return { surfaces };
          });
        } catch (error) {
          console.error('Failed to load surface geometry:', error);
          set({ 
            loadError: error instanceof Error ? error.message : 'Failed to load geometry' 
          });
        }
      },
      
      // Add data layer to surface
      addDataLayer: (surfaceId: string, layer: SurfaceDataLayer) => {
        set((state) => {
          const surface = state.surfaces.get(surfaceId);
          if (!surface) return state;

          const updatedLayer = { visible: true, ...layer };
          const updatedLayers = new Map(surface.layers);
          updatedLayers.set(layer.id, updatedLayer);

          const updatedSurface = { ...surface, layers: updatedLayers };
          const updatedSurfaces = new Map(state.surfaces);
          updatedSurfaces.set(surfaceId, updatedSurface);

          return { surfaces: updatedSurfaces };
        });
      },
      
      // Remove data layer
      removeDataLayer: (surfaceId: string, layerId: string) => {
        set((state) => {
          const surfaces = new Map(state.surfaces);
          const surface = surfaces.get(surfaceId);
          if (surface) {
            surface.layers.delete(layerId);
            // Also drop any display layer entry with the same id
            if (surface.displayLayers.has(layerId)) {
              surface.displayLayers.delete(layerId);
            }
            // Clear selection if it pointed to this layer
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
          }
          return { surfaces };
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

          // Create new surface with new layers Map
          const updatedSurface = { ...surface, layers: newLayers };

          // Create new surfaces Map with updated surface
          const newSurfaces = new Map(state.surfaces);
          newSurfaces.set(surfaceId, updatedSurface);

          return { surfaces: newSurfaces };
        });
      },

      // Upsert a display layer (shared DTO for UI/render)
      upsertDisplayLayer: (surfaceId: string, layer: DisplayLayer) => {
        set((state) => {
          const surfaces = new Map(state.surfaces);
          const surface = surfaces.get(surfaceId);
          if (!surface) return state;
          const displayLayers = new Map(surface.displayLayers);
          displayLayers.set(layer.id, layer);
          surface.displayLayers = displayLayers;
          surfaces.set(surfaceId, surface);
          return { surfaces };
        });
      },

      // Update a display layer by id
      updateDisplayLayer: (surfaceId: string, layerId: string, updates: Partial<DisplayLayer>) => {
        set((state) => {
          const surfaces = new Map(state.surfaces);
          const surface = surfaces.get(surfaceId);
          if (!surface) return state;
          const displayLayers = new Map(surface.displayLayers);
          const existing = displayLayers.get(layerId);
          if (!existing) return state;
          displayLayers.set(layerId, { ...existing, ...updates });
          surface.displayLayers = displayLayers;
          surfaces.set(surfaceId, surface);
          return { surfaces };
        });
      },

      // Remove a display layer
      removeDisplayLayer: (surfaceId: string, layerId: string) => {
        set((state) => {
          const surfaces = new Map(state.surfaces);
          const surface = surfaces.get(surfaceId);
          if (!surface) return state;
          const displayLayers = new Map(surface.displayLayers);
          displayLayers.delete(layerId);
          surface.displayLayers = displayLayers;
          surfaces.set(surfaceId, surface);
          return { surfaces };
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
