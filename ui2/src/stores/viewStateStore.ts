/**
 * ViewState Store - The single source of truth for the entire application
 * Uses Zustand with coalescing middleware for efficient backend updates
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { immer } from 'zustand/middleware/immer';
import type { ViewState } from '@/types/viewState';
import type { ViewType, ViewPlane, WorldCoordinates } from '@/types/coordinates';
import { coalesceUpdatesMiddleware } from './middleware/coalesceUpdatesMiddleware';
import { getApiService } from '@/services/apiService';

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
  updateView: (viewType: ViewType, plane: ViewPlane) => void;
  updateViewDimensions: (viewType: ViewType, dimensions: [number, number]) => Promise<void>;
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
          console.log(`[viewStateStore ${timestamp.toFixed(0)}ms] setViewState called`);
          console.log(`  - Current layers: ${oldState.layers.length}`);
          console.log(`  - Layer ids:`, oldState.layers.map(l => l.id));
          
          // Track who's calling setViewState
          const stack = new Error().stack;
          const caller = typeof stack === 'string' 
            ? stack.split('\n')[3]?.trim() || 'unknown'
            : 'unknown';
          console.log(`  - Called from: ${caller}`);
          
          // Log the full stack trace if we're updating with 20-80% values
          if (oldState.layers.some(layer => 
            layer.intensity && layer.intensity[0] > 1969 && layer.intensity[0] < 1970)) {
            console.warn('[viewStateStore] Stack trace for 20-80% update:');
            console.trace();
          }
          
          const updated = updater(state.viewState);
          if (updated) {
            console.log(`[viewStateStore ${performance.now() - timestamp}ms] State updated:`);
            console.log(`  - New layers: ${updated.layers.length}`);
            console.log(`  - Layer ids:`, updated.layers.map(l => l.id));
            
            // Check for problematic intensity values
            updated.layers.forEach(layer => {
              if (layer.intensity) {
                console.log(`  - Layer ${layer.id} intensity: [${layer.intensity[0].toFixed(2)}, ${layer.intensity[1].toFixed(2)}]`);
                
                // Check for 20-80% values (1969.6 to 7878.4 for data range 0-9848)
                if (layer.intensity[0] > 1969 && layer.intensity[0] < 1970 &&
                    layer.intensity[1] > 7878 && layer.intensity[1] < 7879) {
                  console.error(`[viewStateStore] ❌ WARNING: 20-80% default intensity detected for layer ${layer.id}!`);
                  console.error(`[viewStateStore] This update is resetting user's intensity values!`);
                  console.trace('Stack trace for problematic intensity update:');
                }
              }
            });
            
            state.viewState = updated;
          } else {
            console.log(`[viewStateStore ${performance.now() - timestamp}ms] No state update (updater returned void)`);
          }
        }),
        
        setCrosshair: async (position, updateViews = false, immediate = false) => {
          // Wait for any pending resizes to complete before updating crosshair
          const currentState = get();
          const resizePromises = Object.values(currentState.resizeInFlight).filter(p => p !== null);
          
          if (resizePromises.length > 0) {
            console.log(`[viewStateStore] Waiting for ${resizePromises.length} pending resize(s) before updating crosshair`);
            try {
              await Promise.all(resizePromises);
              console.log(`[viewStateStore] All resizes complete, proceeding with crosshair update`);
            } catch (error) {
              console.warn(`[viewStateStore] Resize failed, but continuing with crosshair update:`, error);
            }
          }
          
          // For immediate updates (like slider drags), bypass coalescing
          const storeWithCoalescing = get() as ViewStateStore & { _originalSet?: typeof set };
          const setter = immediate && storeWithCoalescing._originalSet ? storeWithCoalescing._originalSet : set;
          
          setter((state) => {
            const [x, y, z] = position;
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
            
            console.log(`[viewStateStore] Updated slice positions for crosshair at [${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}]`);
            
            // Notify backend about crosshair update for each view
            // This ensures the backend knows the current view dimensions when reslicing
            const viewTypes: ViewType[] = ['axial', 'sagittal', 'coronal'];
            viewTypes.forEach(viewType => {
              const view = views[viewType];
              const pixelWidth = Math.sqrt(view.u_mm[0]**2 + view.u_mm[1]**2 + view.u_mm[2]**2);
              const pixelHeight = Math.sqrt(view.v_mm[0]**2 + view.v_mm[1]**2 + view.v_mm[2]**2);
              const widthMm = pixelWidth * view.dim_px[0];
              const heightMm = pixelHeight * view.dim_px[1];
              
              const planeId = { axial: 0, coronal: 1, sagittal: 2 }[viewType];
              
              // Don't await - fire and forget for performance
              getApiService().updateFrameForSynchronizedView(
                widthMm,
                heightMm,
                [x, y, z],
                planeId
              ).catch(error => {
                console.error(`[viewStateStore] Failed to update backend for ${viewType} crosshair:`, error);
              });
            });
          }
          });
        },
        
        updateView: (viewType, plane) => set((state) => {
          state.viewState.views[viewType] = plane;
        }),
        
        updateViewDimensions: async (viewType, dimensions) => {
          console.log(`[viewStateStore] Updating ${viewType} dimensions to ${dimensions[0]}x${dimensions[1]}`);
          
          const [newWidth, newHeight] = dimensions;
          
          // Guard against zero or negative dimensions
          if (newWidth <= 0 || newHeight <= 0) {
            console.warn(`[viewStateStore] Invalid dimensions for ${viewType}: ${newWidth}x${newHeight}, skipping update`);
            return;
          }
          
          // Get current state without triggering re-render
          const currentState = get();
          const view = currentState.viewState.views[viewType];
          const [oldWidth, oldHeight] = view.dim_px;
          
          // If dimensions haven't actually changed, skip the update
          if (oldWidth === newWidth && oldHeight === newHeight) {
            return;
          }
          
          // Guard against zero old dimensions (initial state)
          if (oldWidth <= 0 || oldHeight <= 0) {
            // Just update dimensions without adjusting vectors or origin
            set((state) => {
              state.viewState.views[viewType].dim_px = dimensions;
            });
            return;
          }
          
          // Perform all calculations up-front
          const centerOffset = [
            view.u_mm[0] * oldWidth / 2 + view.v_mm[0] * oldHeight / 2,
            view.u_mm[1] * oldWidth / 2 + view.v_mm[1] * oldHeight / 2,
            view.u_mm[2] * oldWidth / 2 + view.v_mm[2] * oldHeight / 2
          ];
          const worldCenter = [
            view.origin_mm[0] + centerOffset[0],
            view.origin_mm[1] + centerOffset[1],
            view.origin_mm[2] + centerOffset[2]
          ];
          
          console.log(`[viewStateStore] World center before resize: [${worldCenter[0].toFixed(2)}, ${worldCenter[1].toFixed(2)}, ${worldCenter[2].toFixed(2)}]`);
          
          // Calculate new center offset
          const newCenterOffset = [
            view.u_mm[0] * newWidth / 2 + view.v_mm[0] * newHeight / 2,
            view.u_mm[1] * newWidth / 2 + view.v_mm[1] * newHeight / 2,
            view.u_mm[2] * newWidth / 2 + view.v_mm[2] * newHeight / 2
          ];
          
          // Calculate new origin to keep the same world center visible
          const newOrigin = [
            worldCenter[0] - newCenterOffset[0],
            worldCenter[1] - newCenterOffset[1],
            worldCenter[2] - newCenterOffset[2]
          ] as [number, number, number];
          
          // Calculate view dimensions in mm for backend
          const pixelWidth = Math.sqrt(view.u_mm[0]**2 + view.u_mm[1]**2 + view.u_mm[2]**2);
          const pixelHeight = Math.sqrt(view.v_mm[0]**2 + view.v_mm[1]**2 + view.v_mm[2]**2);
          const widthMm = pixelWidth * newWidth;
          const heightMm = pixelHeight * newHeight;
          
          // Map view type to plane ID (backend convention)
          const planeId = { axial: 0, coronal: 1, sagittal: 2 }[viewType];
          
          // Create the resize promise
          const resizePromise = (async () => {
            try {
              // AWAIT the frame update to complete in the backend
              await getApiService().updateFrameForSynchronizedView(
                widthMm,
                heightMm,
                currentState.viewState.crosshair.world_mm as [number, number, number],
                planeId
              );
              console.log(`[viewStateStore] Backend notified and ready for ${viewType} resize: ${widthMm.toFixed(1)}x${heightMm.toFixed(1)}mm`);
              
              // NOW update the state - this will trigger the coalesced render
              set((state) => {
                const viewToUpdate = state.viewState.views[viewType];
                viewToUpdate.dim_px = dimensions;
                viewToUpdate.origin_mm = newOrigin;
                
                console.log(`[viewStateStore] Updated ${viewType}:`, {
                  origin_mm: viewToUpdate.origin_mm,
                  u_mm: viewToUpdate.u_mm,  // Unchanged
                  v_mm: viewToUpdate.v_mm,  // Unchanged
                  dim_px: viewToUpdate.dim_px,
                  worldCenterAfter: [
                    viewToUpdate.origin_mm[0] + newCenterOffset[0],
                    viewToUpdate.origin_mm[1] + newCenterOffset[1],
                    viewToUpdate.origin_mm[2] + newCenterOffset[2]
                  ]
                });
                
                // Clear the resize promise after state is updated
                state.resizeInFlight[viewType] = null;
              });
            } catch (error) {
              console.error(`[viewStateStore] Failed to update backend for ${viewType}:`, error);
              // Clear the resize promise on error
              set((state) => {
                state.resizeInFlight[viewType] = null;
              });
              throw error; // Re-throw to maintain the promise rejection
            }
          })();
          
          // Track the resize promise
          set((state) => {
            state.resizeInFlight[viewType] = resizePromise;
          });
          
          // Wait for the resize to complete
          await resizePromise;
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