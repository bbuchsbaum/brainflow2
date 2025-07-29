/**
 * Render Store - Single source of truth for render state
 * Managed exclusively by RenderCoordinator
 */

import { create } from 'zustand';

export interface RenderTargetState {
  width: number;
  height: number;
  isRecreating: boolean;
  lastError: Error | null;
}

export interface RenderState {
  // Render target state
  renderTarget: RenderTargetState;
  
  // Current render operation state
  isRendering: boolean;
  renderError: Error | null;
  
  // Queue state
  queuedJobs: number;
  
  // Last successful render info
  lastRenderTimestamp: number;
  lastRenderDimensions: { width: number; height: number } | null;
}

interface RenderStore extends RenderState {
  // Internal actions - only RenderCoordinator should call these
  _setRenderTarget: (state: Partial<RenderTargetState>) => void;
  _setRenderState: (state: Partial<Pick<RenderState, 'isRendering' | 'renderError' | 'queuedJobs'>>) => void;
  _setLastRender: (timestamp: number, dimensions: { width: number; height: number }) => void;
  
  // Public queries
  isRenderTargetReady: () => boolean;
  shouldBlockRender: () => boolean;
  getRenderTargetState: () => RenderTargetState;
}

export const useRenderStore = create<RenderStore>((set, get) => ({
  // Initial state
  renderTarget: {
    width: 0,
    height: 0,
    isRecreating: false,
    lastError: null
  },
  isRendering: false,
  renderError: null,
  queuedJobs: 0,
  lastRenderTimestamp: 0,
  lastRenderDimensions: null,
  
  // Internal actions
  _setRenderTarget: (targetState) => set((state) => ({
    renderTarget: { ...state.renderTarget, ...targetState }
  })),
  
  _setRenderState: (renderState) => set((state) => ({
    ...state,
    ...renderState
  })),
  
  _setLastRender: (timestamp, dimensions) => set({
    lastRenderTimestamp: timestamp,
    lastRenderDimensions: dimensions
  }),
  
  // Public queries
  isRenderTargetReady: () => {
    const state = get();
    return !state.renderTarget.isRecreating && 
           state.renderTarget.width > 0 && 
           state.renderTarget.height > 0 &&
           !state.renderTarget.lastError;
  },
  
  shouldBlockRender: () => {
    const state = get();
    return state.renderTarget.isRecreating || !!state.renderTarget.lastError;
  },
  
  getRenderTargetState: () => {
    return { ...get().renderTarget };
  }
}));