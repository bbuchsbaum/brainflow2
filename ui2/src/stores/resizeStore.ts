/**
 * Resize Store - Manages resize state to coordinate render target updates
 */

import { create } from 'zustand';

interface ResizeState {
  isResizing: boolean;
  pendingDimensions: { width: number; height: number } | null;
  renderTargetDimensions: { width: number; height: number };
  
  // Actions
  startResize: (width: number, height: number) => void;
  completeResize: () => void;
  cancelResize: () => void;
  updateRenderTargetDimensions: (width: number, height: number) => void;
  
  // Queries
  shouldBlockRender: () => boolean;
  hasPendingResize: () => boolean;
}

export const useResizeStore = create<ResizeState>((set, get) => ({
  isResizing: false,
  pendingDimensions: null,
  renderTargetDimensions: { width: 0, height: 0 },
  
  startResize: (width: number, height: number) => {
    console.log(`[ResizeStore] Starting resize: ${width}x${height}`);
    set({
      isResizing: true,
      pendingDimensions: { width, height }
    });
  },
  
  completeResize: () => {
    const state = get();
    if (state.pendingDimensions) {
      console.log(`[ResizeStore] Completing resize: ${state.pendingDimensions.width}x${state.pendingDimensions.height}`);
      set({
        isResizing: false,
        pendingDimensions: null,
        renderTargetDimensions: state.pendingDimensions
      });
    }
  },
  
  cancelResize: () => {
    console.log(`[ResizeStore] Cancelling resize`);
    set({
      isResizing: false,
      pendingDimensions: null
    });
  },
  
  updateRenderTargetDimensions: (width: number, height: number) => {
    console.log(`[ResizeStore] Updating render target dimensions: ${width}x${height}`);
    set({
      renderTargetDimensions: { width, height }
    });
  },
  
  shouldBlockRender: () => {
    const state = get();
    return state.isResizing;
  },
  
  hasPendingResize: () => {
    const state = get();
    return state.pendingDimensions !== null;
  }
}));