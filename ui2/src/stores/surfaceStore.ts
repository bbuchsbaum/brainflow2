/**
 * Surface Store
 * Manages surface geometry and data for visualization
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import { DisplayLayer, BlendMode } from '../types/displayLayer';

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
  colormap: string;
  range: [number, number];
  threshold?: [number, number];
  opacity: number;
  // Statistical properties
  showOnlyPositive?: boolean;
  showOnlyNegative?: boolean;
  clusterThreshold?: number;
  smoothingKernel?: number;
  mean?: number;
  std?: number;
}

export interface LoadedSurface {
  handle: string;
  name: string;
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
  showNormals: boolean;
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
  updateLayerProperty: (surfaceId: string, layerId: string, property: string, value: any) => void;
  upsertDisplayLayer: (surfaceId: string, layer: DisplayLayer) => void;
  updateDisplayLayer: (surfaceId: string, layerId: string, updates: Partial<DisplayLayer>) => void;
  removeDisplayLayer: (surfaceId: string, layerId: string) => void;
  setActiveSurface: (surfaceId: string | null) => void;
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
        showNormals: false,
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
          const hemisphere = result.hemisphere;
          const surfaceType = result.surface_type;
          
          // Create new surface entry
          const surface: LoadedSurface = {
            handle: handle,
            name: path.split('/').pop() || 'Unknown',
            geometry: {
              vertices: new Float32Array(0),
              faces: new Uint32Array(0),
              hemisphere: hemisphere as any,
              surfaceType: surfaceType as any,
            },
            layers: new Map(),
            displayLayers: new Map(),
            metadata: {
              vertexCount: vertexCount,
              faceCount: faceCount,
              hemisphere: hemisphere,
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
          const surfaces = new Map(state.surfaces);
          const surface = surfaces.get(surfaceId);
          if (surface) {
            surface.layers.set(layer.id, layer);
          }
          return { surfaces };
        });
      },
      
      // Remove data layer
      removeDataLayer: (surfaceId: string, layerId: string) => {
        set((state) => {
          const surfaces = new Map(state.surfaces);
          const surface = surfaces.get(surfaceId);
          if (surface) {
            surface.layers.delete(layerId);
          }
          return { surfaces };
        });
      },
      
      // Update layer property
      updateLayerProperty: (surfaceId: string, layerId: string, property: string, value: any) => {
        set((state) => {
          const surfaces = new Map(state.surfaces);
          const surface = surfaces.get(surfaceId);
          if (surface) {
            const layer = surface.layers.get(layerId);
            if (layer) {
              (layer as any)[property] = value;
            }
          }
          return { surfaces };
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
      
      // Remove surface
      removeSurface: (surfaceId: string) => {
        set((state) => {
          const surfaces = new Map(state.surfaces);
          surfaces.delete(surfaceId);
          const activeSurfaceId = state.activeSurfaceId === surfaceId 
            ? (surfaces.size > 0 ? surfaces.keys().next().value : null)
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
