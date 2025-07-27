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

// Global state for coalescing - persists across store instances
let pendingState: ViewState | null = null;
let rafId: number | null = null;
let isEnabled = true;
let lastFlushedState: ViewState | null = null;

// Callback for backend updates - will be injected
let backendUpdateCallback: ((viewState: ViewState) => void) | null = null;

/**
 * Check if only dimensions changed between two ViewStates
 */
function isDimensionOnlyChange(current: ViewState, previous: ViewState | null): boolean {
  if (!previous) return false;
  
  // Compare everything except view dimensions
  const currentWithoutDims = {
    layers: current.layers,
    crosshair: current.crosshair
  };
  
  const previousWithoutDims = {
    layers: previous.layers,
    crosshair: previous.crosshair
  };
  
  // If layers or crosshair changed, it's not dimension-only
  return JSON.stringify(currentWithoutDims) === JSON.stringify(previousWithoutDims);
}

/**
 * Flush the pending state to the backend
 */
function flushState(forceDimensionUpdate = false) {
  const flushTime = performance.now();
  if (pendingState && backendUpdateCallback && isEnabled) {
    // Check if we're currently dragging - if so, skip flush
    const isDragging = useLayoutDragStore.getState().isDragging;
    if (isDragging && !forceDimensionUpdate) {
      console.log(`[coalesceMiddleware ${flushTime.toFixed(0)}ms] 🚧 Skipping flush - drag in progress`);
      // Don't clear pendingState - we want to flush it when drag ends
      rafId = null;
      // Important: Keep the pending state but schedule another check
      // This ensures we flush immediately when dragging stops
      rafId = requestAnimationFrame(() => flushState());
      return;
    }
    
    // Check if this is a dimension-only update
    if (!forceDimensionUpdate && isDimensionOnlyChange(pendingState, lastFlushedState)) {
      console.log(`[coalesceMiddleware ${flushTime.toFixed(0)}ms] 📏 Skipping dimension-only update - no radiological content changed`);
      pendingState = null;
      rafId = null;
      return;
    }
    
    if (forceDimensionUpdate) {
      console.log(`[coalesceMiddleware ${flushTime.toFixed(0)}ms] 🚀 FORCE flushing state (dimension update) to backend`);
    } else {
      console.log(`[coalesceMiddleware ${flushTime.toFixed(0)}ms] 🚀 Flushing state with content changes to backend`);
    }
    
    // Check for problematic intensity values
    pendingState.layers.forEach(layer => {
      if (layer.intensity && 
          layer.intensity[0] > 1969 && layer.intensity[0] < 1970 &&
          layer.intensity[1] > 7878 && layer.intensity[1] < 7879) {
        console.error(`[coalesceMiddleware] 🚨 FLUSHING PROBLEMATIC INTENSITY VALUES for layer ${layer.id}:`, layer.intensity);
        console.trace('Stack trace for problematic flush:');
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
          
          // Check for problematic intensity values being queued
          newState.viewState.layers.forEach(layer => {
            if (layer.intensity && 
                layer.intensity[0] > 1969 && layer.intensity[0] < 1970 &&
                layer.intensity[1] > 7878 && layer.intensity[1] < 7879) {
              console.error(`[coalesceMiddleware] 📥 QUEUING PROBLEMATIC INTENSITY VALUES for layer ${layer.id}:`, layer.intensity);
              console.trace('Stack trace for problematic queue:');
            }
          });
          
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
              rafId = setTimeout(() => flushState(), config.timeoutDelay || 16) as any;
            } else {
              rafId = requestAnimationFrame(() => flushState());
            }
          } else {
            // console.log(`[coalesceMiddleware ${queueTime.toFixed(0)}ms] Flush already scheduled, updating pending state`);
            // If we're dragging, we need to keep rescheduling to check when drag ends
            const isDragging = useLayoutDragStore.getState().isDragging;
            if (isDragging && pendingState) {
              // Cancel current schedule and reschedule
              if (typeof rafId === 'number' && rafId > 0) {
                cancelAnimationFrame(rafId);
              } else {
                clearTimeout(rafId as any);
              }
              rafId = requestAnimationFrame(() => flushState());
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
    console.log('[coalesceUtils.flush] Force flush called with forceDimensionUpdate:', forceDimensionUpdate);
    console.log('[coalesceUtils.flush] Pending state exists:', pendingState !== null);
    console.log('[coalesceUtils.flush] Is dragging:', useLayoutDragStore.getState().isDragging);
    
    // Cancel any scheduled flush
    if (rafId) {
      if (typeof rafId === 'number' && rafId > 0) {
        cancelAnimationFrame(rafId);
      } else {
        clearTimeout(rafId as any);
      }
      rafId = null;
    }
    
    // Force flush with dimension update flag
    flushState(forceDimensionUpdate);
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