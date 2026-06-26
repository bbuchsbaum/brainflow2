/**
 * Surface Store
 * Manages surface geometry and data for visualization
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useActivePanelStore } from '@/stores/activePanelStore';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import type { AtlasConfig } from '@/types/atlas';
import type { AtlasPaletteKind } from '@/types/atlasPalette';
import { resolveExplicitSurfaceViewId } from '@/utils/surfaceViewContext';

/**
 * Fallback surface-view id used by panes that render a surface without an
 * explicit per-tab id (notably the Integrated workspace's inline surface pane).
 * Shared so settings writers and the canvas read/write the same key.
 */
export const DEFAULT_SURFACE_VIEW_ID = 'surface-view';

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
  range: [number, number]; // Current intensity window (display range)
  dataRange: [number, number]; // True data extent (min/max of actual values)
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
  volumeData?: ArrayBuffer; // Raw volume data for GPU texture
  volumeDims?: [number, number, number]; // Volume dimensions [nx, ny, nz]
  affineMatrix?: Float32Array; // Column-major 4x4 voxel-to-world affine
  volumeId?: string; // Reference to source volume
}

export interface LoadedSurface {
  handle: string;
  name: string;
  visible: boolean;
  geometry: SurfaceGeometryData;
  layers: Map<string, SurfaceDataLayer>;
  metadata: {
    vertexCount: number;
    faceCount: number;
    hemisphere?: string;
    surfaceType?: string;
    path: string;
    sourceVolumeId?: string;
    mappingOptions?: {
      method?: 'nearest' | 'trilinear' | 'weighted';
      projectionDepth?: number;
      smoothingKernel?: number;
    };
  };
}

export interface SurfaceLightingSettings {
  ambientLightIntensity: number;
  directionalLightIntensity: number;
  fillLightIntensity?: number; // Secondary directional light
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

export type SurfaceSelectionItemType = 'geometry' | 'dataLayer' | null;

export interface SurfaceViewSelection {
  activeSurfaceId: string | null;
  selectedItemType: SurfaceSelectionItemType;
  selectedLayerId: string | null;
}

export interface SurfaceViewSettings {
  lightingSettings: SurfaceLightingSettings;
  displaySettings: SurfaceDisplaySettings;
  materialSettings: SurfaceMaterialSettings;
  projectionSettings: SurfaceProjectionSettings;
}

export const DEFAULT_SURFACE_LIGHTING_SETTINGS: SurfaceLightingSettings = {
  ambientLightIntensity: 0.4,
  directionalLightIntensity: 1.0,
  fillLightIntensity: 0.5,
  lightPosition: [100, 100, 100],
};

export const DEFAULT_SURFACE_MATERIAL_SETTINGS: SurfaceMaterialSettings = {
  surfaceColor: '#CCCCCC',
  shininess: 30,
  specularColor: '#ffffff',
  emissiveColor: '#000000',
  emissiveIntensity: 0.0,
};

export const DEFAULT_SURFACE_PROJECTION_SETTINGS: SurfaceProjectionSettings = {
  useGPUProjection: false,
};

export const DEFAULT_SURFACE_DISPLAY_SETTINGS: SurfaceDisplaySettings = {
  wireframe: false,
  opacity: 1.0,
  smoothing: 0.0,
  flatShading: false,
};

export const DEFAULT_SURFACE_VIEW_SETTINGS: SurfaceViewSettings = {
  lightingSettings: DEFAULT_SURFACE_LIGHTING_SETTINGS,
  displaySettings: DEFAULT_SURFACE_DISPLAY_SETTINGS,
  materialSettings: DEFAULT_SURFACE_MATERIAL_SETTINGS,
  projectionSettings: DEFAULT_SURFACE_PROJECTION_SETTINGS,
};

export function createDefaultSurfaceViewSettings(): SurfaceViewSettings {
  return {
    lightingSettings: {
      ...DEFAULT_SURFACE_LIGHTING_SETTINGS,
      lightPosition: [...DEFAULT_SURFACE_LIGHTING_SETTINGS.lightPosition] as [
        number,
        number,
        number,
      ],
    },
    displaySettings: { ...DEFAULT_SURFACE_DISPLAY_SETTINGS },
    materialSettings: { ...DEFAULT_SURFACE_MATERIAL_SETTINGS },
    projectionSettings: { ...DEFAULT_SURFACE_PROJECTION_SETTINGS },
  };
}

export function getSurfaceViewSettingsForId(
  surfaceViewSettings: Map<string, SurfaceViewSettings>,
  surfaceViewId: string,
): SurfaceViewSettings {
  return surfaceViewSettings.get(surfaceViewId) ?? DEFAULT_SURFACE_VIEW_SETTINGS;
}

export function createDefaultSurfaceViewSelection(
  surfaceHandle: string | null | undefined,
): SurfaceViewSelection {
  if (!surfaceHandle) {
    return {
      activeSurfaceId: null,
      selectedItemType: null,
      selectedLayerId: null,
    };
  }

  return {
    activeSurfaceId: surfaceHandle,
    selectedItemType: 'geometry',
    selectedLayerId: null,
  };
}

export function getSurfaceViewSelectionForId(
  surfaceViewSelections: Map<string, SurfaceViewSelection>,
  surfaceViewHandles: Map<string, string>,
  surfaceViewId: string,
): SurfaceViewSelection {
  return (
    surfaceViewSelections.get(surfaceViewId) ??
    createDefaultSurfaceViewSelection(surfaceViewHandles.get(surfaceViewId))
  );
}

function selectionsEqual(a: SurfaceViewSelection, b: SurfaceViewSelection): boolean {
  return (
    a.activeSurfaceId === b.activeSurfaceId &&
    a.selectedItemType === b.selectedItemType &&
    a.selectedLayerId === b.selectedLayerId
  );
}

function normalizeSurfaceSelection(
  surfaceId: string | null | undefined,
  itemType: SurfaceSelectionItemType,
  layerId: string | null | undefined,
): SurfaceViewSelection {
  if (!surfaceId) {
    return createDefaultSurfaceViewSelection(null);
  }

  if (itemType === 'dataLayer' && layerId) {
    return {
      activeSurfaceId: surfaceId,
      selectedItemType: 'dataLayer',
      selectedLayerId: layerId,
    };
  }

  return {
    activeSurfaceId: surfaceId,
    selectedItemType: 'geometry',
    selectedLayerId: null,
  };
}

function resolveExplicitSurfaceViewSelectionTarget(
  surfaceViewHandles: Map<string, string>,
): string | null {
  return resolveExplicitSurfaceViewId({
    surfaceViewHandles,
    activeRenderableId: useActiveRenderContextStore.getState().activeId,
    activePanelType: useActivePanelStore.getState().componentType,
    activePanelState: useActivePanelStore.getState().componentState,
  });
}

interface SurfaceState {
  // Surface storage
  surfaces: Map<string, LoadedSurface>;
  activeSurfaceId: string | null;

  // Compatibility selection state mirrored from the explicit active surface view
  // when one exists, otherwise used as a legacy fallback.
  selectedItemType: SurfaceSelectionItemType;
  selectedLayerId: string | null;

  // Loading state
  isLoading: boolean;
  loadError: string | null;

  // View settings
  viewpoint: string;
  showControls: boolean;

  // Per-view rendering settings
  surfaceViewSettings: Map<string, SurfaceViewSettings>;
  surfaceViewHandles: Map<string, string>;
  surfaceViewSelections: Map<string, SurfaceViewSelection>;

  // Actions
  setLoadingState: (isLoading: boolean, loadError?: string | null) => void;
  addSurface: (surface: LoadedSurface, activate?: boolean) => void;
  setSurfaceGeometry: (surfaceId: string, geometry: SurfaceGeometryData) => void;
  addDataLayer: (surfaceId: string, layer: SurfaceDataLayer) => void;
  removeDataLayer: (surfaceId: string, layerId: string) => void;
  updateLayerProperty: (
    surfaceId: string,
    layerId: string,
    property: string,
    value: unknown,
  ) => void;
  setActiveSurface: (surfaceId: string | null) => void;
  setSurfaceVisibility: (surfaceId: string, visible: boolean) => void;
  removeSurface: (surfaceId: string) => void;
  setViewpoint: (viewpoint: string) => void;
  registerSurfaceView: (surfaceViewId: string, surfaceHandle: string) => void;
  unregisterSurfaceView: (surfaceViewId: string) => void;
  activateSurfaceView: (surfaceViewId: string) => void;
  setSurfaceSelectionForView: (
    surfaceViewId: string,
    surfaceId: string | null,
    itemType: SurfaceSelectionItemType,
    layerId?: string | null,
  ) => void;
  setCompatibilitySelection: (
    surfaceId: string | null,
    itemType: SurfaceSelectionItemType,
    layerId?: string | null,
  ) => void;
  updateSurfaceViewLightingSettings: (
    surfaceViewId: string,
    settings: Partial<SurfaceLightingSettings>,
  ) => void;
  updateSurfaceViewDisplaySettings: (
    surfaceViewId: string,
    settings: Partial<SurfaceDisplaySettings>,
  ) => void;
  updateSurfaceViewMaterialSettings: (
    surfaceViewId: string,
    settings: Partial<SurfaceMaterialSettings>,
  ) => void;
  updateSurfaceViewProjectionSettings: (
    surfaceViewId: string,
    settings: Partial<SurfaceProjectionSettings>,
  ) => void;
  updateSurfaceProjectionSettingsForSurface: (
    surfaceHandle: string,
    settings: Partial<SurfaceProjectionSettings>,
  ) => void;
  setSelectedItem: (itemType: SurfaceSelectionItemType, layerId?: string | null) => void;
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
      surfaceViewSettings: new Map(),
      surfaceViewHandles: new Map(),
      surfaceViewSelections: new Map(),

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

          const updatedSurface = {
            ...surface,
            layers: updatedLayers,
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

          if (!surface.layers.has(layerId)) {
            return state;
          }

          const layers = new Map(surface.layers);
          layers.delete(layerId);

          const surfaces = new Map(state.surfaces);
          surfaces.set(surfaceId, { ...surface, layers });

          let surfaceViewSelections = state.surfaceViewSelections;
          for (const [surfaceViewId, selection] of state.surfaceViewSelections.entries()) {
            if (
              selection.activeSurfaceId === surfaceId &&
              selection.selectedItemType === 'dataLayer' &&
              selection.selectedLayerId === layerId
            ) {
              if (surfaceViewSelections === state.surfaceViewSelections) {
                surfaceViewSelections = new Map(state.surfaceViewSelections);
              }
              surfaceViewSelections.set(
                surfaceViewId,
                normalizeSurfaceSelection(surfaceId, 'geometry', null),
              );
            }
          }

          const nextSelectedItemType =
            state.activeSurfaceId === surfaceId &&
            state.selectedItemType === 'dataLayer' &&
            state.selectedLayerId === layerId
              ? 'geometry'
              : state.selectedItemType;
          const nextSelectedLayerId =
            state.activeSurfaceId === surfaceId &&
            state.selectedItemType === 'dataLayer' &&
            state.selectedLayerId === layerId
              ? null
              : state.selectedLayerId;

          return {
            surfaces,
            surfaceViewSelections,
            selectedItemType: nextSelectedItemType,
            selectedLayerId: nextSelectedLayerId,
          };
        });
      },

      // Update layer property
      // IMPORTANT: Create new Map and new layer object to trigger React re-renders
      updateLayerProperty: (
        surfaceId: string,
        layerId: string,
        property: string,
        value: unknown,
      ) => {
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

          // Create new surface with updated layer map
          const updatedSurface = {
            ...surface,
            layers: newLayers,
          };

          // Create new surfaces Map with updated surface
          const newSurfaces = new Map(state.surfaces);
          newSurfaces.set(surfaceId, updatedSurface);

          return { surfaces: newSurfaces };
        });
      },

      // Set active surface
      setActiveSurface: (surfaceId: string | null) => {
        set((state) => {
          const nextSelection = normalizeSurfaceSelection(
            surfaceId,
            surfaceId ? 'geometry' : null,
            null,
          );
          const activeViewId = resolveExplicitSurfaceViewSelectionTarget(state.surfaceViewHandles);
          let surfaceViewSelections = state.surfaceViewSelections;

          if (activeViewId) {
            const currentSelection = getSurfaceViewSelectionForId(
              state.surfaceViewSelections,
              state.surfaceViewHandles,
              activeViewId,
            );
            if (!selectionsEqual(currentSelection, nextSelection)) {
              surfaceViewSelections = new Map(state.surfaceViewSelections);
              surfaceViewSelections.set(activeViewId, nextSelection);
            }
          }

          if (
            state.activeSurfaceId === nextSelection.activeSurfaceId &&
            state.selectedItemType === nextSelection.selectedItemType &&
            state.selectedLayerId === nextSelection.selectedLayerId &&
            surfaceViewSelections === state.surfaceViewSelections
          ) {
            return state;
          }

          return {
            activeSurfaceId: nextSelection.activeSurfaceId,
            selectedItemType: nextSelection.selectedItemType,
            selectedLayerId: nextSelection.selectedLayerId,
            surfaceViewSelections,
          };
        });
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

          let surfaceViewSelections = state.surfaceViewSelections;
          if (!visible) {
            const fallbackVisible =
              Array.from(surfaces.values()).find((s) => s.visible !== false)?.handle ?? null;
            for (const [surfaceViewId, selection] of state.surfaceViewSelections.entries()) {
              if (selection.activeSurfaceId !== surfaceId) {
                continue;
              }
              if (surfaceViewSelections === state.surfaceViewSelections) {
                surfaceViewSelections = new Map(state.surfaceViewSelections);
              }
              surfaceViewSelections.set(
                surfaceViewId,
                normalizeSurfaceSelection(
                  fallbackVisible,
                  fallbackVisible ? 'geometry' : null,
                  null,
                ),
              );
            }
          }

          const nextSelectedItemType =
            !visible && state.activeSurfaceId === surfaceId
              ? nextActiveSurfaceId
                ? 'geometry'
                : null
              : state.selectedItemType;
          const nextSelectedLayerId =
            !visible && state.activeSurfaceId === surfaceId ? null : state.selectedLayerId;

          return {
            surfaces,
            activeSurfaceId: nextActiveSurfaceId,
            selectedItemType: nextSelectedItemType,
            selectedLayerId: nextSelectedLayerId,
            surfaceViewSelections,
          };
        });
      },

      // Remove surface
      removeSurface: (surfaceId: string) => {
        set((state) => {
          const surfaces = new Map(state.surfaces);
          surfaces.delete(surfaceId);
          const firstVisibleSurfaceId =
            Array.from(surfaces.values()).find((surface) => surface.visible !== false)?.handle ??
            null;
          const firstSurfaceId = surfaces.size > 0 ? surfaces.keys().next().value : null;
          const activeSurfaceId =
            state.activeSurfaceId === surfaceId
              ? (firstVisibleSurfaceId ?? firstSurfaceId)
              : state.activeSurfaceId;
          let surfaceViewSelections = state.surfaceViewSelections;
          for (const [surfaceViewId, selection] of state.surfaceViewSelections.entries()) {
            if (selection.activeSurfaceId !== surfaceId) {
              continue;
            }
            if (surfaceViewSelections === state.surfaceViewSelections) {
              surfaceViewSelections = new Map(state.surfaceViewSelections);
            }
            surfaceViewSelections.set(
              surfaceViewId,
              normalizeSurfaceSelection(activeSurfaceId, activeSurfaceId ? 'geometry' : null, null),
            );
          }
          return {
            surfaces,
            activeSurfaceId,
            selectedItemType:
              state.activeSurfaceId === surfaceId
                ? activeSurfaceId
                  ? 'geometry'
                  : null
                : state.selectedItemType,
            selectedLayerId: state.activeSurfaceId === surfaceId ? null : state.selectedLayerId,
            surfaceViewSelections,
          };
        });
      },

      // Set viewpoint
      setViewpoint: (viewpoint: string) => {
        set({ viewpoint });
      },

      registerSurfaceView: (surfaceViewId: string, surfaceHandle: string) => {
        set((state) => {
          const surfaceViewSettings = state.surfaceViewSettings.has(surfaceViewId)
            ? state.surfaceViewSettings
            : new Map(state.surfaceViewSettings).set(
                surfaceViewId,
                createDefaultSurfaceViewSettings(),
              );
          const surfaceViewHandles =
            state.surfaceViewHandles.get(surfaceViewId) === surfaceHandle
              ? state.surfaceViewHandles
              : new Map(state.surfaceViewHandles).set(surfaceViewId, surfaceHandle);
          const surfaceViewSelections = state.surfaceViewSelections.has(surfaceViewId)
            ? state.surfaceViewSelections
            : new Map(state.surfaceViewSelections).set(
                surfaceViewId,
                createDefaultSurfaceViewSelection(surfaceHandle),
              );
          return {
            surfaceViewSettings,
            surfaceViewHandles,
            surfaceViewSelections,
          };
        });
      },

      unregisterSurfaceView: (surfaceViewId: string) => {
        set((state) => {
          if (
            !state.surfaceViewSettings.has(surfaceViewId) &&
            !state.surfaceViewHandles.has(surfaceViewId) &&
            !state.surfaceViewSelections.has(surfaceViewId)
          ) {
            return state;
          }

          const surfaceViewSettings = new Map(state.surfaceViewSettings);
          surfaceViewSettings.delete(surfaceViewId);

          const surfaceViewHandles = new Map(state.surfaceViewHandles);
          surfaceViewHandles.delete(surfaceViewId);

          const surfaceViewSelections = new Map(state.surfaceViewSelections);
          surfaceViewSelections.delete(surfaceViewId);

          return {
            surfaceViewSettings,
            surfaceViewHandles,
            surfaceViewSelections,
          };
        });
      },

      activateSurfaceView: (surfaceViewId) => {
        set((state) => {
          const nextSelection = getSurfaceViewSelectionForId(
            state.surfaceViewSelections,
            state.surfaceViewHandles,
            surfaceViewId,
          );
          if (
            state.activeSurfaceId === nextSelection.activeSurfaceId &&
            state.selectedItemType === nextSelection.selectedItemType &&
            state.selectedLayerId === nextSelection.selectedLayerId
          ) {
            return state;
          }
          return {
            activeSurfaceId: nextSelection.activeSurfaceId,
            selectedItemType: nextSelection.selectedItemType,
            selectedLayerId: nextSelection.selectedLayerId,
          };
        });
      },

      setSurfaceSelectionForView: (surfaceViewId, surfaceId, itemType, layerId = null) => {
        set((state) => {
          const nextSelection = normalizeSurfaceSelection(surfaceId, itemType, layerId);
          const currentSelection = getSurfaceViewSelectionForId(
            state.surfaceViewSelections,
            state.surfaceViewHandles,
            surfaceViewId,
          );
          const surfaceViewSelections = selectionsEqual(currentSelection, nextSelection)
            ? state.surfaceViewSelections
            : new Map(state.surfaceViewSelections).set(surfaceViewId, nextSelection);

          if (
            surfaceViewSelections === state.surfaceViewSelections &&
            state.activeSurfaceId === nextSelection.activeSurfaceId &&
            state.selectedItemType === nextSelection.selectedItemType &&
            state.selectedLayerId === nextSelection.selectedLayerId
          ) {
            return state;
          }

          return {
            surfaceViewSelections,
            activeSurfaceId: nextSelection.activeSurfaceId,
            selectedItemType: nextSelection.selectedItemType,
            selectedLayerId: nextSelection.selectedLayerId,
          };
        });
      },

      setCompatibilitySelection: (surfaceId, itemType, layerId = null) => {
        set((state) => {
          const nextSelection = normalizeSurfaceSelection(surfaceId, itemType, layerId);
          if (
            state.activeSurfaceId === nextSelection.activeSurfaceId &&
            state.selectedItemType === nextSelection.selectedItemType &&
            state.selectedLayerId === nextSelection.selectedLayerId
          ) {
            return state;
          }

          return {
            activeSurfaceId: nextSelection.activeSurfaceId,
            selectedItemType: nextSelection.selectedItemType,
            selectedLayerId: nextSelection.selectedLayerId,
          };
        });
      },

      updateSurfaceViewLightingSettings: (surfaceViewId, settings) => {
        set((state) => {
          const current =
            state.surfaceViewSettings.get(surfaceViewId) ?? createDefaultSurfaceViewSettings();
          const surfaceViewSettings = new Map(state.surfaceViewSettings);
          surfaceViewSettings.set(surfaceViewId, {
            ...current,
            lightingSettings: {
              ...current.lightingSettings,
              ...settings,
              lightPosition: settings.lightPosition
                ? ([...settings.lightPosition] as [number, number, number])
                : current.lightingSettings.lightPosition,
            },
          });
          return { surfaceViewSettings };
        });
      },

      updateSurfaceViewDisplaySettings: (surfaceViewId, settings) => {
        set((state) => {
          const current =
            state.surfaceViewSettings.get(surfaceViewId) ?? createDefaultSurfaceViewSettings();
          const surfaceViewSettings = new Map(state.surfaceViewSettings);
          surfaceViewSettings.set(surfaceViewId, {
            ...current,
            displaySettings: {
              ...current.displaySettings,
              ...settings,
            },
          });
          return { surfaceViewSettings };
        });
      },

      updateSurfaceViewMaterialSettings: (surfaceViewId, settings) => {
        set((state) => {
          const current =
            state.surfaceViewSettings.get(surfaceViewId) ?? createDefaultSurfaceViewSettings();
          const surfaceViewSettings = new Map(state.surfaceViewSettings);
          surfaceViewSettings.set(surfaceViewId, {
            ...current,
            materialSettings: {
              ...current.materialSettings,
              ...settings,
            },
          });
          return { surfaceViewSettings };
        });
      },

      updateSurfaceViewProjectionSettings: (surfaceViewId, settings) => {
        set((state) => {
          const current =
            state.surfaceViewSettings.get(surfaceViewId) ?? createDefaultSurfaceViewSettings();
          const surfaceViewSettings = new Map(state.surfaceViewSettings);
          surfaceViewSettings.set(surfaceViewId, {
            ...current,
            projectionSettings: {
              ...current.projectionSettings,
              ...settings,
            },
          });
          return { surfaceViewSettings };
        });
      },

      updateSurfaceProjectionSettingsForSurface: (surfaceHandle, settings) => {
        set((state) => {
          let changed = false;
          const surfaceViewSettings = new Map(state.surfaceViewSettings);

          for (const [surfaceViewId, handle] of state.surfaceViewHandles.entries()) {
            if (handle !== surfaceHandle) {
              continue;
            }
            const current =
              surfaceViewSettings.get(surfaceViewId) ?? createDefaultSurfaceViewSettings();
            surfaceViewSettings.set(surfaceViewId, {
              ...current,
              projectionSettings: {
                ...current.projectionSettings,
                ...settings,
              },
            });
            changed = true;
          }

          if (!changed) {
            return state;
          }

          return { surfaceViewSettings };
        });
      },

      // Set selected item (geometry or data layer)
      setSelectedItem: (itemType, layerId = null) => {
        set((state) => {
          const nextSelection = normalizeSurfaceSelection(state.activeSurfaceId, itemType, layerId);
          const activeViewId = resolveExplicitSurfaceViewSelectionTarget(state.surfaceViewHandles);
          let surfaceViewSelections = state.surfaceViewSelections;

          if (activeViewId) {
            const currentSelection = getSurfaceViewSelectionForId(
              state.surfaceViewSelections,
              state.surfaceViewHandles,
              activeViewId,
            );
            if (!selectionsEqual(currentSelection, nextSelection)) {
              surfaceViewSelections = new Map(state.surfaceViewSelections);
              surfaceViewSelections.set(activeViewId, nextSelection);
            }
          }

          if (
            state.selectedItemType === nextSelection.selectedItemType &&
            state.selectedLayerId === nextSelection.selectedLayerId &&
            surfaceViewSelections === state.surfaceViewSelections
          ) {
            return state;
          }

          return {
            selectedItemType: nextSelection.selectedItemType,
            selectedLayerId: nextSelection.selectedLayerId,
            surfaceViewSelections,
          };
        });
      },

      // Clear error
      clearError: () => {
        set({ loadError: null });
      },
    }),
    {
      name: 'surface-store',
    },
  ),
);
