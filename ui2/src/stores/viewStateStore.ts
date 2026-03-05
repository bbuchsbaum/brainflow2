/**
 * ViewState Store - The single source of truth for the entire application
 * Uses Zustand with coalescing middleware for efficient backend updates
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { immer } from 'zustand/middleware/immer';
import type { ViewState } from '@/types/viewState';
import type { ViewType, ViewPlane, WorldCoordinates } from '@/types/coordinates';
import { coalesceUpdatesMiddleware, coalesceUtils } from './middleware/coalesceUpdatesMiddleware';
import { getApiService } from '@/services/apiService';
import { getViewPlaneService } from '@/services/ViewPlaneService';
import { useViewLayoutStore } from './viewLayoutStore';
import { storeLog, storeWarn, storeError, storeTrace } from '@/utils/debugLog';

// Declare global interface for store
declare global {
  interface Window {
    __viewStateStore?: ReturnType<typeof createViewStateStore>;
  }
}

// Initial view state - placeholder views until a volume is loaded
function getInitialViewState(): ViewState {
  // Create simple placeholder views
  // These will be replaced by backend-calculated views when a volume is loaded
  const defaultViews = {
    axial: {
      origin_mm: [-100, 100, 0],
      u_mm: [0.390625, 0, 0],    // 200mm / 512px
      v_mm: [0, -0.390625, 0],   // -Y for anterior to posterior
      dim_px: [512, 512] as [number, number]
    },
    sagittal: {
      origin_mm: [0, 100, 100],
      u_mm: [0, -0.390625, 0],   // -Y for anterior to posterior
      v_mm: [0, 0, -0.390625],   // -Z for superior to inferior
      dim_px: [512, 512] as [number, number]
    },
    coronal: {
      origin_mm: [-100, 0, 100],
      u_mm: [0.390625, 0, 0],    // +X for left to right
      v_mm: [0, 0, -0.390625],   // -Z for superior to inferior
      dim_px: [512, 512] as [number, number]
    }
  };

  return {
    views: defaultViews,
    crosshair: {
      world_mm: [0, 0, 0],
      visible: true
    },
    layers: []
  };
}

interface ViewStateStore {
  viewState: ViewState;

  // Track pending resize operations to prevent race conditions
  resizeInFlight: Record<ViewType, Promise<void> | null>;

  // Actions
  setViewState: (updater: (state: ViewState) => ViewState | void) => void;
  setCrosshair: (world_mm: WorldCoordinates, updateViews?: boolean, immediate?: boolean) => Promise<void>;
  setCrosshairVisible: (visible: boolean) => void;
  updateView: (viewType: ViewType, plane: ViewPlane) => void;
  updateViewDimensions: (viewType: ViewType, dimensions: [number, number]) => Promise<void>;
  updateDimensionsAndPreserveScale: (viewType: ViewType, dimensions: [number, number]) => Promise<void>;
  // Layer operations removed - use setViewState to update layers

  // Helpers
  getView: (viewType: ViewType) => ViewPlane;
  getViews: () => Record<ViewType, ViewPlane>;

  // For undo/redo (provided by temporal middleware)
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Reset to defaults
  resetToDefaults: () => void;
}

// Create store only once and attach to window for cross-root sharing
const createViewStateStore = () => create<ViewStateStore>()(
  temporal(
    coalesceUpdatesMiddleware<ViewStateStore>({
      // Backend callback will be set by ApiService
      enabled: true,
      useTimeout: false // Use requestAnimationFrame in production
    })(
      immer((set, get) => ({
        viewState: getInitialViewState(),

        // Initialize resize tracking
        resizeInFlight: {
          axial: null,
          sagittal: null,
          coronal: null
        },

        setViewState: (updater) => set((state) => {
          const timestamp = performance.now();
          const oldState = state.viewState;
          storeLog('viewStateStore', `${timestamp.toFixed(0)}ms setViewState called`);
          storeLog('viewStateStore', `  - Current layers: ${oldState.layers.length}`);
          storeLog('viewStateStore', `  - Layer ids:`, oldState.layers.map(l => l.id));

          // Track who's calling setViewState
          const stack = new Error().stack;
          const caller = typeof stack === 'string'
            ? stack.split('\n')[3]?.trim() || 'unknown'
            : 'unknown';
          storeLog('viewStateStore', `  - Called from: ${caller}`);

          // Log the full stack trace if we're updating with 20-80% values
          if (oldState.layers.some(layer =>
            layer.intensity && layer.intensity[0] > 1969 && layer.intensity[0] < 1970)) {
            storeWarn('viewStateStore', 'Stack trace for 20-80% update:');
            storeTrace('viewStateStore', '');
          }

          const updated = updater(state.viewState);
          if (updated) {
            storeLog('viewStateStore', `${(performance.now() - timestamp).toFixed(2)}ms State updated:`);
            storeLog('viewStateStore', `  - New layers: ${updated.layers.length}`);
            storeLog('viewStateStore', `  - Layer ids:`, updated.layers.map(l => l.id));

            // Check for problematic intensity values
            updated.layers.forEach(layer => {
              if (layer.intensity) {
                storeLog('viewStateStore', `  - Layer ${layer.id} intensity: [${layer.intensity[0].toFixed(2)}, ${layer.intensity[1].toFixed(2)}]`);

                // Check for 20-80% values (1969.6 to 7878.4 for data range 0-9848)
                if (layer.intensity[0] > 1969 && layer.intensity[0] < 1970 &&
                    layer.intensity[1] > 7878 && layer.intensity[1] < 7879) {
                  storeError('viewStateStore', `WARNING: 20-80% default intensity detected for layer ${layer.id}!`);
                  storeError('viewStateStore', `This update is resetting user's intensity values!`);
                  storeError('viewStateStore', 'Update details:', {
                    layerId: layer.id,
                    intensity: layer.intensity,
                    caller: caller,
                    timestamp: timestamp
                  });
                  storeTrace('viewStateStore', 'Stack trace for problematic intensity update:');
                }
              }
            });

            state.viewState = updated;
          } else {
            storeLog('viewStateStore', `${(performance.now() - timestamp).toFixed(2)}ms No state update (updater returned void)`);
          }
        }),

        setCrosshairVisible: (visible) => {
          set((state) => {
            state.viewState.crosshair.visible = visible;
          });
        },

        setCrosshair: async (position, updateViews = false, immediate = false) => {
          storeLog('viewStateStore', 'setCrosshair called with:', {
            position,
            updateViews,
            immediate,
            positionType: Array.isArray(position) ? 'array' : typeof position
          });

          // Validate position parameter
          if (!Array.isArray(position) || position.length !== 3) {
            throw new Error(`setCrosshair expects position as [x, y, z] array, got: ${JSON.stringify(position)}`);
          }

          // Wait for any pending resizes to complete before updating crosshair
          const currentState = get();
          const resizePromises = Object.values(currentState.resizeInFlight).filter(p => p !== null);

          if (resizePromises.length > 0) {
            storeLog('viewStateStore', `Waiting for ${resizePromises.length} pending resize(s) before updating crosshair`);
            try {
              await Promise.all(resizePromises);
              storeLog('viewStateStore', 'All resizes complete, proceeding with crosshair update');
            } catch (error) {
              storeWarn('viewStateStore', 'Resize failed, but continuing with crosshair update:', error);
            }
          }

          // Normal update path (with Immer)
          set((state) => {
            try {
              const [x, y, z] = position;
              storeLog('viewStateStore', `Setting crosshair via normal path to: [${x}, ${y}, ${z}]`);

              // With Immer, we can mutate the draft
              state.viewState.crosshair.world_mm = [x, y, z];
              state.viewState.crosshair.visible = true;

              if (updateViews) {
                // Update view plane positions to show the slice containing the crosshair
                // This only updates the out-of-plane coordinate for each view
                const views = state.viewState.views;

                // For each view, we need to find the normal vector to determine
                // which coordinate to update for the slice position

                // Helper to calculate normal vector (cross product of u and v)
                const calculateNormal = (u: [number, number, number], v: [number, number, number]): [number, number, number] => {
                  return [
                    u[1] * v[2] - u[2] * v[1],
                    u[2] * v[0] - u[0] * v[2],
                    u[0] * v[1] - u[1] * v[0]
                  ];
                };

                // Helper to update the origin to show the slice at the crosshair position
                const updateSlicePosition = (view: ViewPlane, crosshair: [number, number, number]): [number, number, number] => {
                  const u = [view.u_mm[0], view.u_mm[1], view.u_mm[2]];
                  const v = [view.v_mm[0], view.v_mm[1], view.v_mm[2]];
                  const normal = calculateNormal(u, v);

                  // Normalize the normal vector
                  const mag = Math.sqrt(normal[0]**2 + normal[1]**2 + normal[2]**2);
                  const n_norm = [normal[0]/mag, normal[1]/mag, normal[2]/mag];

                  // Project crosshair onto the normal to get the distance from origin
                  const distance = crosshair[0] * n_norm[0] + crosshair[1] * n_norm[1] + crosshair[2] * n_norm[2];

                  // Project current origin onto normal
                  const origin_distance = view.origin_mm[0] * n_norm[0] + view.origin_mm[1] * n_norm[1] + view.origin_mm[2] * n_norm[2];

                  // Calculate the offset needed
                  const offset = distance - origin_distance;

                  // Update origin by moving along the normal
                  return [
                    view.origin_mm[0] + offset * n_norm[0],
                    view.origin_mm[1] + offset * n_norm[1],
                    view.origin_mm[2] + offset * n_norm[2]
                  ];
                };

                // Update each view's origin to show the slice at the crosshair
                views.axial.origin_mm = updateSlicePosition(views.axial, [x, y, z]);
                views.sagittal.origin_mm = updateSlicePosition(views.sagittal, [x, y, z]);
                views.coronal.origin_mm = updateSlicePosition(views.coronal, [x, y, z]);

                storeLog('viewStateStore', `Updated slice positions for crosshair at [${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}]`);
              }
            } catch (error) {
              storeError('viewStateStore', 'Error in setCrosshair:', error);
              throw error;
            }
          });

          // If immediate update requested (e.g., for slider drags), force flush
          if (immediate) {
            storeLog('viewStateStore', 'Immediate update requested - forcing flush');
            coalesceUtils.flush(true);
          }
        },

        updateView: (viewType, plane) => set((state) => {
          state.viewState.views[viewType] = plane;
        }),

        updateViewDimensions: async (viewType, dimensions) => {
          // DEPRECATED: This method is kept for backward compatibility
          // Use updateDimensionsAndPreserveScale for resize operations
          storeWarn('viewStateStore', 'updateViewDimensions is deprecated. Use updateDimensionsAndPreserveScale instead.');

          const [newWidth, newHeight] = dimensions;

          // Guard against zero or negative dimensions
          if (newWidth <= 0 || newHeight <= 0) {
            storeWarn('viewStateStore', `Invalid dimensions for ${viewType}: ${newWidth}x${newHeight}, skipping update`);
            return;
          }

          // Simple dimension update without any direct render calls
          // The coalescing middleware will handle the render
          set((state) => {
            state.viewState.views[viewType].dim_px = dimensions;
          });
        },

        updateDimensionsAndPreserveScale: async (viewType, dimensions) => {
          const [newWidth, newHeight] = dimensions;
          storeLog('viewStateStore', `updateDimensionsAndPreserveScale called for ${viewType}:`, {
            requested: { width: newWidth, height: newHeight },
            timestamp: performance.now()
          });

          // Guard against zero or negative dimensions
          if (newWidth <= 0 || newHeight <= 0) {
            storeWarn('viewStateStore', `Invalid dimensions for ${viewType}: ${newWidth}x${newHeight}, skipping update`);
            return;
          }

          // Get current state
          const currentState = get();
          const view = currentState.viewState.views[viewType];
          const [oldWidth, oldHeight] = view.dim_px;

          storeLog('viewStateStore', `Current view state for ${viewType}:`, {
            dimensions: { width: oldWidth, height: oldHeight },
            origin_mm: view.origin_mm,
            u_mm: view.u_mm,
            v_mm: view.v_mm
          });

          // If dimensions haven't changed, skip
          if (oldWidth === newWidth && oldHeight === newHeight) {
            storeLog('viewStateStore', `Dimensions unchanged for ${viewType}, skipping update`);
            return;
          }

          // Check if we have any layers (volumes) loaded
          const layers = currentState.viewState.layers;
          if (layers.length === 0) {
            storeLog('viewStateStore', 'No layers loaded, updating dimensions only');
            // No volumes loaded, just update dimensions
            set((state) => {
              state.viewState.views[viewType].dim_px = dimensions;
            });
            return;
          }

          // Get the first visible layer's volume ID
          const visibleLayer = layers.find(l => l.visible && l.opacity > 0);
          if (!visibleLayer || !visibleLayer.volumeId) {
            storeWarn('viewStateStore', 'No visible layer with volume ID found, layers:', layers);
            // Just update dimensions
            set((state) => {
              state.viewState.views[viewType].dim_px = dimensions;
            });
            return;
          }

          storeLog('viewStateStore', `Using volume ${visibleLayer.volumeId} for recalculation`);

          try {
            const layoutStoreState = useViewLayoutStore.getState();
            const isLockedLayout = layoutStoreState.isLocked();
            const apiService = getApiService();

            if (isLockedLayout) {
              storeLog('viewStateStore', 'Layout locked - recalculating all views atomically');

              const currentViews = currentState.viewState.views;
              const widthScale = oldWidth > 0 ? newWidth / oldWidth : 1;
              const heightScale = oldHeight > 0 ? newHeight / oldHeight : 1;

              const dimsByView: Record<ViewType, [number, number]> = {
                axial: [...currentViews.axial.dim_px],
                sagittal: [...currentViews.sagittal.dim_px],
                coronal: [...currentViews.coronal.dim_px]
              };

              dimsByView[viewType] = [newWidth, newHeight];

              (['axial', 'sagittal', 'coronal'] as ViewType[]).forEach((vt) => {
                if (vt === viewType) {
                  return;
                }
                const currentDims = currentViews[vt].dim_px;
                const scaledDims: [number, number] = [
                  Math.max(1, Math.round(currentDims[0] * widthScale)),
                  Math.max(1, Math.round(currentDims[1] * heightScale))
                ];
                dimsByView[vt] = scaledDims;
              });

              const backendViews = await apiService.recalculateAllViews(
                visibleLayer.volumeId,
                dimsByView,
                currentState.viewState.crosshair.world_mm as [number, number, number]
              );

              storeLog('viewStateStore', 'Backend response for locked layout:', backendViews);

              set((state) => {
                (['axial', 'sagittal', 'coronal'] as ViewType[]).forEach((vt) => {
                  const backendView = backendViews[vt];
                  if (backendView) {
                    state.viewState.views[vt] = backendView;
                  } else {
                    state.viewState.views[vt].dim_px = dimsByView[vt];
                  }
                });
              });

              return;
            }

            // unlocked layout - single view update
            storeLog('viewStateStore', `Attempting backend recalculation for ${viewType}...`);

            const newView = await apiService.recalculateViewForDimensions(
              visibleLayer.volumeId,
              viewType,
              [newWidth, newHeight],
              currentState.viewState.crosshair.world_mm
            );

            storeLog('viewStateStore', `Backend response for ${viewType}:`, {
              requestedDims: [newWidth, newHeight],
              returnedView: newView
            });

            // Update the view with backend-calculated values
            set((state) => {
              storeLog('viewStateStore', `Updating view state for ${viewType} with backend values`);
              state.viewState.views[viewType] = newView;
            });

          } catch (error) {
            storeError('viewStateStore', 'Backend recalculation failed, using frontend fallback:', error);

            // Frontend fallback: Recalculate view to maintain full anatomical extent
            // This mimics what the backend ViewRectMm::full_extent does

            // Get anatomical bounds for this layer
            try {
              const apiService = getApiService();
              const bounds = await apiService.getVolumeBounds(visibleLayer.volumeId);

              storeLog('viewStateStore', 'Got volume bounds:', bounds);

              // Calculate extent based on view type
              let widthMm: number, heightMm: number;
              const crosshair = currentState.viewState.crosshair.world_mm;

              switch (viewType) {
                case 'axial':
                  // XY plane - width is X extent, height is Y extent
                  widthMm = bounds.max[0] - bounds.min[0];
                  heightMm = bounds.max[1] - bounds.min[1];
                  break;
                case 'sagittal':
                  // YZ plane - width is Y extent, height is Z extent
                  widthMm = bounds.max[1] - bounds.min[1];
                  heightMm = bounds.max[2] - bounds.min[2];
                  break;
                case 'coronal':
                  // XZ plane - width is X extent, height is Z extent
                  widthMm = bounds.max[0] - bounds.min[0];
                  heightMm = bounds.max[2] - bounds.min[2];
                  break;
              }

              // Use ViewPlaneService for consistent pixel size calculation
              const viewPlaneService = getViewPlaneService();
              const pixelSize = viewPlaneService.calculatePixelSize(widthMm, heightMm, newWidth, newHeight);

              storeLog('viewStateStore', 'Frontend calculation:', {
                extentMm: { width: widthMm, height: heightMm },
                newDimensions: { width: newWidth, height: newHeight },
                pixelSize
              });

              // Calculate new origin and vectors
              let newOrigin: [number, number, number];
              let newU: [number, number, number];
              let newV: [number, number, number];
              const currentView = currentState.viewState.views[viewType];

              // Preserve current display direction when building fallback views.
              // This avoids flipped-affine regressions (e.g. Schaefer MNI with negative X axis).
              const signed = (value: number, fallbackSign: 1 | -1): 1 | -1 => {
                if (value > 0) return 1;
                if (value < 0) return -1;
                return fallbackSign;
              };

              switch (viewType) {
                case 'axial':
                  // XY plane: preserve existing X/Y direction signs.
                  {
                    const xSign = signed(currentView.u_mm[0], 1);
                    const ySign = signed(currentView.v_mm[1], -1);
                    newOrigin = [
                      xSign > 0 ? bounds.min[0] : bounds.max[0],
                      ySign > 0 ? bounds.min[1] : bounds.max[1],
                      crosshair[2]
                    ];
                    newU = [xSign * pixelSize, 0, 0];
                    newV = [0, ySign * pixelSize, 0];
                  }
                  break;
                case 'sagittal':
                  // YZ plane: preserve existing Y/Z direction signs.
                  {
                    const ySign = signed(currentView.u_mm[1], -1);
                    const zSign = signed(currentView.v_mm[2], -1);
                    newOrigin = [
                      crosshair[0],
                      ySign > 0 ? bounds.min[1] : bounds.max[1],
                      zSign > 0 ? bounds.min[2] : bounds.max[2]
                    ];
                    newU = [0, ySign * pixelSize, 0];
                    newV = [0, 0, zSign * pixelSize];
                  }
                  break;
                case 'coronal':
                  // XZ plane: preserve existing X/Z direction signs.
                  {
                    const xSign = signed(currentView.u_mm[0], 1);
                    const zSign = signed(currentView.v_mm[2], -1);
                    newOrigin = [
                      xSign > 0 ? bounds.min[0] : bounds.max[0],
                      crosshair[1],
                      zSign > 0 ? bounds.min[2] : bounds.max[2]
                    ];
                    newU = [xSign * pixelSize, 0, 0];
                    newV = [0, 0, zSign * pixelSize];
                  }
                  break;
              }

              // Update the view with recalculated values
              set((state) => {
                storeLog('viewStateStore', `Updating view state for ${viewType} with frontend calculation`);
                const updatedView = {
                  origin_mm: newOrigin,
                  u_mm: newU,
                  v_mm: newV,
                  dim_px: dimensions
                };
                storeLog('viewStateStore', 'New view state:', updatedView);
                state.viewState.views[viewType] = updatedView;
              });

            } catch (boundsError) {
              storeError('viewStateStore', 'Failed to get volume bounds:', boundsError);
              // Final fallback: just update dimensions
              set((state) => {
                state.viewState.views[viewType].dim_px = dimensions;
              });
            }
          }
        },


        // Layer operations removed - use setViewState to update layers

        resetToDefaults: () => set((state) => {
          state.viewState = getInitialViewState();
        }),

        // Helper methods
        getView: (viewType) => get().viewState.views[viewType],
        getViews: () => get().viewState.views,

        // Undo/redo (provided by temporal middleware)
        undo: () => {},  // Will be overridden by temporal
        redo: () => {},  // Will be overridden by temporal
        canUndo: () => false, // Will be overridden by temporal
        canRedo: () => false, // Will be overridden by temporal
      }))
    ),
    {
      limit: 50, // Keep 50 states in history
      equality: (a, b) => JSON.stringify(a.viewState) === JSON.stringify(b.viewState)
    }
  )
);

// Export store with global instance sharing
export const useViewStateStore = (() => {
  if (typeof window !== 'undefined' && window.__viewStateStore) {
    return window.__viewStateStore;
  }

  const store = createViewStateStore();

  if (typeof window !== 'undefined') {
    window.__viewStateStore = store;
  }

  return store;
})();
