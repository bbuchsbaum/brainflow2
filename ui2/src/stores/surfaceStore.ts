/**
 * Surface Store
 * Manages surface geometry and data for visualization
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';

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
}

export interface LoadedSurface {
  handle: string;
  name: string;
  geometry: SurfaceGeometryData;
  layers: Map<string, SurfaceDataLayer>;
  metadata: {
    vertexCount: number;
    faceCount: number;
    hemisphere?: string;
    surfaceType?: string;
    path: string;
  };
}

interface SurfaceState {
  // Surface storage
  surfaces: Map<string, LoadedSurface>;
  activeSurfaceId: string | null;
  
  // Loading state
  isLoading: boolean;
  loadError: string | null;
  
  // View settings
  viewpoint: string;
  showControls: boolean;
  ambientLight: number;
  
  // Actions
  loadSurface: (path: string) => Promise<string>;
  loadSurfaceGeometry: (handle: string) => Promise<void>;
  addDataLayer: (surfaceId: string, layer: SurfaceDataLayer) => void;
  removeDataLayer: (surfaceId: string, layerId: string) => void;
  updateLayerProperty: (surfaceId: string, layerId: string, property: string, value: any) => void;
  setActiveSurface: (surfaceId: string | null) => void;
  removeSurface: (surfaceId: string) => void;
  setViewpoint: (viewpoint: string) => void;
  clearError: () => void;
}

export const useSurfaceStore = create<SurfaceState>()(
  devtools(
    (set, get) => ({
      // Initial state
      surfaces: new Map(),
      activeSurfaceId: null,
      isLoading: false,
      loadError: null,
      viewpoint: 'lateral',
      showControls: false,
      ambientLight: 0x404040,
      
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