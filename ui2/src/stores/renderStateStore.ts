/**
 * RenderStateStore - Centralized store for rendering state management
 * 
 * This store manages rendering state (isRendering, error, lastImage) per view/tag
 * instead of having it scattered across components. This reduces system brittleness
 * by providing a single source of truth for render state.
 * 
 * Key benefits:
 * - Eliminates duplicated state logic across components
 * - Provides consistent error handling
 * - Manages ImageBitmap lifecycle centrally
 * - Enables better debugging and monitoring
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export interface RenderState {
  isRendering: boolean;
  error: Error | null;
  lastImage: ImageBitmap | null;
  lastRenderTime?: number;
  renderCount: number;
}

interface RenderStateStore {
  // State per identifier (tag or viewType) - using plain object for React reactivity
  states: { [id: string]: RenderState };
  
  // Actions
  setRendering: (id: string, isRendering: boolean) => void;
  setError: (id: string, error: Error | null) => void;
  setImage: (id: string, image: ImageBitmap | null) => void;
  getState: (id: string) => RenderState;
  clearState: (id: string) => void;
  clearAllStates: () => void;
  
  // Debugging helpers
  getAllStates: () => { [id: string]: RenderState };
  getActiveRenders: () => string[];
}

// Default state for new views
const defaultRenderState: RenderState = {
  isRendering: false,
  error: null,
  lastImage: null,
  lastRenderTime: undefined,
  renderCount: 0
};

export const useRenderStateStore = create<RenderStateStore>()(
  immer((set, get) => ({
    states: {},
    
    setRendering: (id, isRendering) => {
      set((state) => {
        // Ensure state exists for this ID
        if (!(id in state.states)) {
          state.states[id] = { ...defaultRenderState };
        }
        
        const renderState = state.states[id];
        renderState.isRendering = isRendering;
        
        if (isRendering) {
          // Clear any previous error when starting a new render
          renderState.error = null;
          console.log(`[RenderStateStore] Starting render for ${id}`);
        } else {
          // Update render time when completing
          renderState.lastRenderTime = Date.now();
          renderState.renderCount++;
          console.log(`[RenderStateStore] Completed render for ${id} (count: ${renderState.renderCount})`);
        }
      });
    },
    
    setError: (id, error) => {
      set((state) => {
        // Ensure state exists for this ID
        if (!(id in state.states)) {
          state.states[id] = { ...defaultRenderState };
        }
        
        const renderState = state.states[id];
        renderState.error = error;
        renderState.isRendering = false; // Error stops rendering
        
        if (error) {
          console.error(`[RenderStateStore] Error for ${id}:`, error.message);
        } else {
          console.log(`[RenderStateStore] Cleared error for ${id}`);
        }
      });
    },
    
    setImage: (id, image) => {
      set((state) => {
        // Ensure state exists for this ID
        if (!(id in state.states)) {
          state.states[id] = { ...defaultRenderState };
        }
        
        const renderState = state.states[id];
        
        // Clean up old image if it exists
        if (renderState.lastImage && renderState.lastImage !== image) {
          // Note: ImageBitmap.close() is not available in all browsers
          // but we should call it if available to free memory
          if ('close' in renderState.lastImage && typeof renderState.lastImage.close === 'function') {
            try {
              renderState.lastImage.close();
              console.log(`[RenderStateStore] Disposed old image for ${id}`);
            } catch (e) {
              console.warn(`[RenderStateStore] Failed to close ImageBitmap for ${id}:`, e);
            }
          }
        }
        
        renderState.lastImage = image;
        
        if (image) {
          console.log(`[RenderStateStore] Stored new image for ${id} (${image.width}x${image.height})`);
        } else {
          console.log(`[RenderStateStore] Cleared image for ${id}`);
        }
      });
    },
    
    getState: (id) => {
      const states = get().states;
      
      // Return existing state or default
      if (id in states) {
        return states[id];
      }
      
      // Return a copy of default state for new IDs
      return { ...defaultRenderState };
    },
    
    clearState: (id) => {
      set((state) => {
        const renderState = state.states[id];
        
        if (renderState) {
          // Clean up ImageBitmap if it exists
          if (renderState.lastImage && 'close' in renderState.lastImage) {
            try {
              renderState.lastImage.close();
              console.log(`[RenderStateStore] Disposed image for ${id} during clear`);
            } catch (e) {
              console.warn(`[RenderStateStore] Failed to close ImageBitmap for ${id}:`, e);
            }
          }
          
          delete state.states[id];
          console.log(`[RenderStateStore] Cleared state for ${id}`);
        }
      });
    },
    
    clearAllStates: () => {
      set((state) => {
        // Clean up all ImageBitmaps
        Object.entries(state.states).forEach(([id, renderState]) => {
          if (renderState.lastImage && 'close' in renderState.lastImage) {
            try {
              renderState.lastImage.close();
              console.log(`[RenderStateStore] Disposed image for ${id} during clear all`);
            } catch (e) {
              console.warn(`[RenderStateStore] Failed to close ImageBitmap for ${id}:`, e);
            }
          }
        });
        
        state.states = {};
        console.log(`[RenderStateStore] Cleared all render states`);
      });
    },
    
    getAllStates: () => {
      return get().states;
    },
    
    getActiveRenders: () => {
      const states = get().states;
      const active: string[] = [];
      
      Object.entries(states).forEach(([id, state]) => {
        if (state.isRendering) {
          active.push(id);
        }
      });
      
      return active;
    }
  }))
);

// Helper hooks for component usage
export function useRenderState(id: string): RenderState {
  // Subscribe directly to the state object for proper reactivity
  return useRenderStateStore((state) => state.states[id] || defaultRenderState);
}

export function useIsRendering(id: string): boolean {
  return useRenderStateStore((state) => state.states[id]?.isRendering || false);
}

export function useRenderError(id: string): Error | null {
  return useRenderStateStore((state) => state.states[id]?.error || null);
}

export function useLastImage(id: string): ImageBitmap | null {
  return useRenderStateStore((state) => state.states[id]?.lastImage || null);
}

// Debug helper for development
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as any).__renderStateStore = useRenderStateStore;
}