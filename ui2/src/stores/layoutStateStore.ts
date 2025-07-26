/**
 * LayoutStateStore - Manages layout-specific state that doesn't need backend updates
 * 
 * This store handles UI layout concerns like panel sizes, visibility, and arrangement
 * that are purely frontend concerns and don't affect rendering.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { subscribeWithSelector } from 'zustand/middleware';
import { persist } from 'zustand/middleware';

export interface LayoutState {
  // Split pane sizes (percentages)
  splitSizes: {
    vertical: number[];    // Top/bottom split
    horizontal: number[];  // Left/right split in bottom pane
  };
  
  // Panel visibility
  panelVisibility: {
    axial: boolean;
    sagittal: boolean;
    coronal: boolean;
    controls: boolean;
    statusBar: boolean;
  };
  
  // Layout mode
  layoutMode: 'flexible' | 'golden' | 'single';
  
  // Active view for single mode
  activeView: 'axial' | 'sagittal' | 'coronal';
}

interface LayoutStateStore {
  layoutState: LayoutState;
  
  // Actions
  updateSplitSizes: (direction: 'vertical' | 'horizontal', sizes: number[]) => void;
  togglePanelVisibility: (panelId: keyof LayoutState['panelVisibility']) => void;
  setPanelVisibility: (panelId: keyof LayoutState['panelVisibility'], visible: boolean) => void;
  setLayoutMode: (mode: LayoutState['layoutMode']) => void;
  setActiveView: (view: LayoutState['activeView']) => void;
  resetLayout: () => void;
}

const defaultLayoutState: LayoutState = {
  splitSizes: {
    vertical: [50, 50],
    horizontal: [50, 50]
  },
  panelVisibility: {
    axial: true,
    sagittal: true,
    coronal: true,
    controls: true,
    statusBar: true
  },
  layoutMode: 'flexible',
  activeView: 'axial'
};

export const useLayoutStateStore = create<LayoutStateStore>()(
  persist(
    subscribeWithSelector(
      immer((set, get) => ({
        layoutState: defaultLayoutState,
        
        updateSplitSizes: (direction, sizes) => set((state) => {
          console.log(`[LayoutStateStore] Updating ${direction} split sizes:`, sizes);
          state.layoutState.splitSizes[direction] = sizes;
        }),
        
        togglePanelVisibility: (panelId) => set((state) => {
          state.layoutState.panelVisibility[panelId] = !state.layoutState.panelVisibility[panelId];
          console.log(`[LayoutStateStore] Toggled ${panelId} visibility to:`, state.layoutState.panelVisibility[panelId]);
        }),
        
        setPanelVisibility: (panelId, visible) => set((state) => {
          state.layoutState.panelVisibility[panelId] = visible;
          console.log(`[LayoutStateStore] Set ${panelId} visibility to:`, visible);
        }),
        
        setLayoutMode: (mode) => set((state) => {
          console.log(`[LayoutStateStore] Changing layout mode from ${state.layoutState.layoutMode} to ${mode}`);
          state.layoutState.layoutMode = mode;
        }),
        
        setActiveView: (view) => set((state) => {
          state.layoutState.activeView = view;
          console.log(`[LayoutStateStore] Set active view to:`, view);
        }),
        
        resetLayout: () => set((state) => {
          console.log('[LayoutStateStore] Resetting layout to defaults');
          state.layoutState = defaultLayoutState;
        })
      }))
    ),
    {
      name: 'brainflow2-layout',
      // Only persist user preferences, not runtime dimensions
      partialize: (state) => ({
        layoutState: {
          splitSizes: state.layoutState.splitSizes,
          panelVisibility: state.layoutState.panelVisibility,
          layoutMode: state.layoutState.layoutMode,
          activeView: state.layoutState.activeView
        }
      }),
      // Merge persisted state with defaults to ensure all fields exist
      merge: (persistedState, currentState) => {
        const merged = {
          ...currentState,
          ...(persistedState as any),
          layoutState: {
            ...defaultLayoutState,
            ...(persistedState as any)?.layoutState
          }
        };
        return merged;
      }
    }
  )
);