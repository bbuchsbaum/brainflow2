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
 * 
 * MIGRATION: Adding RenderContext support alongside legacy string keys
 * to enable gradual migration from brittle tag/viewType system to
 * type-safe RenderContext system.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { RenderContext } from '@/types/renderContext';

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
  
  // NEW: Context registry for type-safe rendering
  // Maps context ID to full context object
  contexts: { [id: string]: RenderContext };
  
  // Actions - Legacy (still supported)
  setRendering: (id: string, isRendering: boolean) => void;
  setError: (id: string, error: Error | null) => void;
  setImage: (id: string, image: ImageBitmap | null) => void;
  getState: (id: string) => RenderState;
  clearState: (id: string) => void;
  clearAllStates: () => void;
  
  // NEW: Context-aware actions
  registerContext: (context: RenderContext) => void;
  getContext: (id: string) => RenderContext | undefined;
  setRenderingWithContext: (context: RenderContext, isRendering: boolean) => void;
  setImageWithContext: (context: RenderContext, image: ImageBitmap | null) => void;
  getContextsOfType: (type: 'slice' | 'mosaic-cell') => RenderContext[];
  
  // Debugging helpers
  getAllStates: () => { [id: string]: RenderState };
  getActiveRenders: () => string[];
  getAllContexts: () => { [id: string]: RenderContext };
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
    contexts: {},  // NEW: Initialize context registry
    
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
        
        // Trust browser GC to handle ImageBitmap lifecycle
        // Manual close() was causing crashes when React effects still held references
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
          // Trust browser GC to handle ImageBitmap cleanup
          // Manual close() was causing crashes
          delete state.states[id];
          console.log(`[RenderStateStore] Cleared state for ${id}`);
        }
      });
    },
    
    clearAllStates: () => {
      set((state) => {
        // Trust browser GC to handle all ImageBitmap cleanup
        // Manual close() was causing crashes
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
    },
    
    // NEW: Context-aware methods for type-safe rendering
    registerContext: (context) => {
      set((state) => {
        const existing = state.contexts[context.id];
        const sameDims = existing?.dimensions?.width === context.dimensions.width &&
                         existing?.dimensions?.height === context.dimensions.height;
        const sameType = existing?.type === context.type;
        const sameMeta = (() => {
          const a = existing?.metadata || {} as Record<string, unknown>;
          const b = context.metadata || {} as Record<string, unknown>;
          const ak = Object.keys(a);
          const bk = Object.keys(b);
          if (ak.length !== bk.length) return false;
          for (const k of ak) {
            if (!Object.is(a[k], b[k])) return false;
          }
          return true;
        })();

        if (existing && sameDims && sameType && sameMeta) {
          // Idempotent: skip no-op updates to avoid churn
          return;
        }

        state.contexts[context.id] = context;

        // Also ensure state exists for this context
        if (!(context.id in state.states)) {
          state.states[context.id] = { ...defaultRenderState };
        }

        console.log(`[RenderStateStore] Registered/updated context ${context.id} (type: ${context.type})`);
      });
    },
    
    getContext: (id) => {
      return get().contexts[id];
    },
    
    setRenderingWithContext: (context, isRendering) => {
      // Register context if not already registered
      if (!get().contexts[context.id]) {
        get().registerContext(context);
      }
      
      // Use existing setRendering with context ID
      get().setRendering(context.id, isRendering);
    },
    
    setImageWithContext: (context, image) => {
      // Register context if not already registered  
      if (!get().contexts[context.id]) {
        get().registerContext(context);
      }
      
      // Use existing setImage with context ID
      get().setImage(context.id, image);
    },
    
    getContextsOfType: (type) => {
      const contexts = get().contexts;
      const result: RenderContext[] = [];
      
      Object.values(contexts).forEach((context) => {
        if (context.type === type) {
          result.push(context);
        }
      });
      
      return result;
    },
    
    getAllContexts: () => {
      return get().contexts;
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
  
  // Add debug method to inspect contexts
  (window as any).__debugRenderContexts = () => {
    const store = useRenderStateStore.getState();
    const contexts = store.getAllContexts();
    console.table(Object.values(contexts).map(c => ({
      id: c.id,
      type: c.type,
      width: c.dimensions?.width,
      height: c.dimensions?.height,
      workspaceId: c.metadata?.workspaceId,
      viewType: c.metadata?.viewType,
      sliceIndex: c.metadata?.sliceIndex
    })));
    console.log('Total contexts registered:', Object.keys(contexts).length);
    console.log('Mosaic contexts:', store.getContextsOfType('mosaic-cell').length);
    console.log('Slice contexts:', store.getContextsOfType('slice').length);
  };
}
