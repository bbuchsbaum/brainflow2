/**
 * Coalescing Updates Middleware for ViewStateStore
 * 
 * This middleware collects rapid state changes and sends only the latest state 
 * to the backend in a requestAnimationFrame loop. This prevents overwhelming
 * the backend with rapid UI updates (e.g., during slider drags).
 * 
 * Implementation follows the architectural blueprint pattern.
 */

import type { StateCreator } from 'zustand/vanilla';
import type { ViewState } from '@/types/viewState';
import { useLayoutDragStore } from '@/stores/layoutDragStore';
import { useDragSourceStore } from '@/stores/dragSourceStore';

// Global state for coalescing - persists across store instances
let pendingState: ViewState | null = null;
let rafId: number | null = null;
// If any caller requests a force-dimension flush, we coalesce that flag
// and honor it on the next scheduled flush without running immediately.
let pendingForceDimensionUpdate = false;
let isEnabled = true;
let lastFlushedState: ViewState | null = null;

// Callback for backend updates - will be injected
let backendUpdateCallback: ((viewState: ViewState) => void) | null = null;

/**
 * Check if only dimensions changed between two ViewStates
 * Now properly handles the views field and dim_px comparisons
 */
function isDimensionOnlyChange(current: ViewState, previous: ViewState | null): boolean {
  if (!previous) return false;
  
  // Compare layers and crosshair - these should be identical for dimension-only changes
  if (JSON.stringify(current.layers) !== JSON.stringify(previous.layers)) {
    return false;
  }
  
  if (JSON.stringify(current.crosshair) !== JSON.stringify(previous.crosshair)) {
    return false;
  }
  
  // Compare views, but exclude dim_px fields - only dim_px should change in dimension-only updates
  const viewTypes: (keyof typeof current.views)[] = ['axial', 'sagittal', 'coronal'];
  
  for (const viewType of viewTypes) {
    const currentView = current.views[viewType];
    const previousView = previous.views[viewType];
    
    if (!currentView && !previousView) continue;
    if (!currentView || !previousView) return false;
    
    // Compare everything except dim_px
    if (JSON.stringify(currentView.origin_mm) !== JSON.stringify(previousView.origin_mm) ||
        JSON.stringify(currentView.u_mm) !== JSON.stringify(previousView.u_mm) ||
        JSON.stringify(currentView.v_mm) !== JSON.stringify(previousView.v_mm)) {
      return false;
    }
    
    // dim_px is allowed to be different in dimension-only changes
  }
  
  return true;
}

/**
 * Flush the pending state to the backend
 */
function flushState(forceDimensionUpdate = false) {
  const flushTime = performance.now();
  if (pendingState && backendUpdateCallback && isEnabled) {
    // Check for different types of dragging
    const isLayoutDragging = useLayoutDragStore.getState().isDragging;
    const dragSource = useDragSourceStore.getState().draggingSource;
    const isSliderDragging = dragSource === 'slider';
    
    // Different behavior for different drag types
    if (isLayoutDragging && !forceDimensionUpdate) {
      console.log(`[coalesceMiddleware ${flushTime.toFixed(0)}ms] 🚧 Skipping flush - layout drag in progress`);
      // Don't clear pendingState - we want to flush it when drag ends
      rafId = null;
      // Important: Keep the pending state but schedule another check
      // This ensures we flush immediately when dragging stops
      rafId = requestAnimationFrame(() => flushState());
      return;
    }
    
    // For slider dragging, we want immediate updates
    if (isSliderDragging) {
      console.log(`[coalesceMiddleware ${flushTime.toFixed(0)}ms] 🎛️ Slider drag detected - allowing immediate flush`);
    }
    
    // Check if this is a dimension-only update
    // IMPORTANT: Always allow dimension updates to pass through for proper rendering after resize
    if (!forceDimensionUpdate && isDimensionOnlyChange(pendingState, lastFlushedState)) {
      console.log(`[coalesceMiddleware ${flushTime.toFixed(0)}ms] 📏 Dimension-only update detected - allowing for proper resize handling`);
      // Don't skip dimension updates - they're essential for proper rendering after panel resizes
    }
    
    if (forceDimensionUpdate) {
      console.log(`[coalesceMiddleware ${flushTime.toFixed(0)}ms] 🚀 FORCE flushing state (dimension update) to backend`);
    } else {
      console.log(`[coalesceMiddleware ${flushTime.toFixed(0)}ms] 🚀 Flushing state with content changes to backend`);
    }
    
    // Add data source tracking
    console.log(`[coalesceMiddleware] Flushing state with ${pendingState.layers.length} layers:`);
    pendingState.layers.forEach((layer, index) => {
      console.log(`[coalesceMiddleware] Layer ${index}: id=${layer.id}, type=${layer.type}, intensity=${JSON.stringify(layer.intensity)}`);
    });
    
    // Enhanced intensity monitoring
    pendingState.layers.forEach((layer, index) => {
      if (layer.intensity && Array.isArray(layer.intensity) && layer.intensity.length >= 2) {
        const [min, max] = layer.intensity;
        
        // Remove the false positive check for specific values - these are valid default values
        // The old check was: if (min > 1969 && min < 1970 && max > 7878 && max < 7879)
        // This triggered for valid 20%-80% default intensity ranges
        
        // Additional sanity checks for all intensity values
        if (!isFinite(min) || !isFinite(max) || min >= max) {
          console.warn(`[coalesceMiddleware] ⚠️ Suspicious intensity values for layer ${layer.id}:`, {
            intensity: layer.intensity,
            isMinFinite: isFinite(min),
            isMaxFinite: isFinite(max),
            validRange: min < max
          });
        }
      } else if (layer.intensity) {
        console.warn(`[coalesceMiddleware] ⚠️ Invalid intensity structure for layer ${layer.id}:`, {
          intensity: layer.intensity,
          isArray: Array.isArray(layer.intensity),
          length: layer.intensity?.length
        });
      }
    });
    
    try {
      // Store this state as the last flushed state
      lastFlushedState = JSON.parse(JSON.stringify(pendingState)); // Deep clone
      backendUpdateCallback(pendingState);
    } catch (error) {
      console.error('[coalesceMiddleware] Error flushing state to backend:', error);
    }
    pendingState = null;
  } else {
    if (!pendingState) {
      console.log(`[coalesceMiddleware ${flushTime.toFixed(0)}ms] No pending state to flush`);
    } else if (!backendUpdateCallback) {
      console.log(`[coalesceMiddleware ${flushTime.toFixed(0)}ms] No backend callback set`);
    } else if (!isEnabled) {
      console.log(`[coalesceMiddleware ${flushTime.toFixed(0)}ms] Coalescing disabled`);
    }
  }
  rafId = null;
  // Reset the coalesced force flag after a flush completes
  pendingForceDimensionUpdate = false;
}

/**
 * Configuration for coalescing middleware
 */
export interface CoalesceConfig {
  /**
   * Callback to send state updates to backend
   */
  onStateUpdate?: (viewState: ViewState) => void;
  
  /**
   * Whether coalescing is enabled (default: true)
   * Useful for testing or debugging
   */
  enabled?: boolean;
  
  /**
   * Use setTimeout instead of requestAnimationFrame
   * Useful for testing environments
   */
  useTimeout?: boolean;
  
  /**
   * Timeout delay in ms when useTimeout is true
   */
  timeoutDelay?: number;
}

/**
 * Coalescing middleware implementation
 * 
 * This middleware intercepts state changes and batches them using
 * requestAnimationFrame to prevent overwhelming the backend.
 */
export const coalesceUpdatesMiddleware = <T extends { viewState: ViewState }>(
  config: CoalesceConfig = {}
) => {
  return (stateCreator: StateCreator<T>) => {
    return (set: any, get: any, api: any) => {
      // Configure coalescing for this store instance
      const localBackendCallback = config.onStateUpdate || backendUpdateCallback;
      const localIsEnabled = config.enabled !== false;
      
      // Create a coalesced set function
      const coalescedSet = (updater: any) => {
        // Apply the state change immediately for UI responsiveness
        const result = set(updater);
        
        // If we have a viewState in the new state, coalesce the backend update
        const newState = get();
        if (newState && newState.viewState && localIsEnabled) {
          const queueTime = performance.now();
          // console.log(`[coalesceMiddleware ${queueTime.toFixed(0)}ms] 📥 QUEUING state update:`);
          // console.log(`  - layers: ${newState.viewState.layers.length}`);
          // console.log(`  - layer ids:`, newState.viewState.layers.map(l => l.id));
          // console.log(`  - layer details:`, newState.viewState.layers.map(l => ({
          //   id: l.id,
          //   volumeId: l.volumeId,
          //   visible: l.visible,
          //   opacity: l.opacity,
          //   intensity: l.intensity,
          //   threshold: l.threshold,
          //   colormap: l.colormap
          // })));
          
          // Removed false positive tracking for specific intensity values
          // The old check for values around 1969-1970 and 7878-7879 was triggering
          // on valid default 20%-80% intensity ranges
          
          // Store the latest state for batching
          pendingState = newState.viewState;
          
          // Update global callback if provided locally
          if (localBackendCallback) {
            backendUpdateCallback = localBackendCallback;
          }
          
          // Schedule flush if not already scheduled
          if (!rafId) {
            // console.log(`[coalesceMiddleware ${queueTime.toFixed(0)}ms] Scheduling flush via ${config.useTimeout ? 'setTimeout' : 'requestAnimationFrame'}`);
            if (config.useTimeout) {
              const force = pendingForceDimensionUpdate;
              rafId = setTimeout(() => flushState(force), config.timeoutDelay || 16) as any;
            } else {
              const force = pendingForceDimensionUpdate;
              rafId = requestAnimationFrame(() => flushState(force));
            }
          } else {
            // console.log(`[coalesceMiddleware ${queueTime.toFixed(0)}ms] Flush already scheduled, updating pending state`);
            // If we're dragging, we need to keep rescheduling to check when drag ends
            const isLayoutDragging = useLayoutDragStore.getState().isDragging;
            const dragSource = useDragSourceStore.getState().draggingSource;
            const isSliderDragging = dragSource === 'slider';
            
            // For layout dragging, keep rescheduling
            if (isLayoutDragging && pendingState) {
              // Cancel current schedule and reschedule
              if (typeof rafId === 'number' && rafId > 0) {
                cancelAnimationFrame(rafId);
              } else {
                clearTimeout(rafId as any);
              }
              const force = pendingForceDimensionUpdate;
              rafId = requestAnimationFrame(() => flushState(force));
            }
            // For slider dragging, let the flush happen normally
            else if (isSliderDragging) {
              console.log(`[coalesceMiddleware ${queueTime.toFixed(0)}ms] 🎛️ Slider drag - allowing normal flush`);
            }
          }
        }
        
        return result;
      };
      
      // Create the store with the coalesced set function
      const store = stateCreator(coalescedSet, get, api);
      
      // Return store with additional metadata
      return {
        ...store,
        // Expose the original set for internal use
        _originalSet: (updater: any) => {
          // Apply the state change immediately without coalescing
          const result = set(updater);
          
          // Get the new state and immediately send to backend
          const newState = get();
          const effectiveCallback = localBackendCallback || backendUpdateCallback;
          if (newState && newState.viewState && effectiveCallback && localIsEnabled) {
            console.log('[coalesceMiddleware] Immediate update - bypassing coalescing');
            try {
              effectiveCallback(newState.viewState);
              // Update last flushed state so we don't re-send the same state
              lastFlushedState = JSON.parse(JSON.stringify(newState.viewState));
              // Clear any pending state since we just sent it
              pendingState = null;
              // Cancel any scheduled flush
              if (rafId) {
                if (typeof rafId === 'number' && rafId > 0) {
                  cancelAnimationFrame(rafId);
                } else {
                  clearTimeout(rafId as any);
                }
                rafId = null;
              }
            } catch (error) {
              console.error('[coalesceMiddleware] Error sending immediate update:', error);
            }
          }
          
          return result;
        }
      };
    };
  };
};

/**
 * Utility functions for managing coalescing
 */
export const coalesceUtils = {
  /**
   * Set the backend update callback
   */
  setBackendCallback: (callback: (viewState: ViewState) => void) => {
    backendUpdateCallback = callback;
  },
  
  /**
   * Enable or disable coalescing
   */
  setEnabled: (enabled: boolean) => {
    isEnabled = enabled;
  },
  
  /**
   * Force flush any pending state immediately
   */
  flush: (forceDimensionUpdate = false) => {
    console.log('[coalesceUtils.flush] Requested flush (scheduled). forceDimensionUpdate:', forceDimensionUpdate);
    console.log('[coalesceUtils.flush] Pending state exists:', pendingState !== null);
    console.log('[coalesceUtils.flush] Layout dragging:', useLayoutDragStore.getState().isDragging);
    console.log('[coalesceUtils.flush] Drag source:', useDragSourceStore.getState().draggingSource);

    // Record that a forced dimension update has been requested; this will be
    // honored on the next scheduled flush without executing during render.
    if (forceDimensionUpdate) pendingForceDimensionUpdate = true;

    // If no flush is scheduled yet, schedule one now. Otherwise, let the
    // existing schedule pick up the coalesced pending state and force flag.
    if (!rafId) {
      const force = pendingForceDimensionUpdate;
      if (typeof window !== 'undefined' && 'requestAnimationFrame' in window) {
        rafId = requestAnimationFrame(() => flushState(force));
      } else {
        rafId = setTimeout(() => flushState(force), 16) as any;
      }
    }
  },
  
  /**
   * Get whether there is a pending state update
   */
  hasPendingUpdate: () => pendingState !== null,
  
  /**
   * Clear any pending updates without flushing
   */
  clearPending: () => {
    if (rafId) {
      if (typeof rafId === 'number' && rafId > 0) {
        cancelAnimationFrame(rafId);
      } else {
        clearTimeout(rafId as any);
      }
      rafId = null;
    }
    pendingState = null;
    lastFlushedState = null;
  }
};

/**
 * Type helper for stores using coalescing middleware
 */
export type WithCoalescing<T> = T & {
  _originalSet: (updater: any) => void;
};
