/**
 * Active Panel Store
 *
 * Tracks which GoldenLayout component is currently active/focused.
 * This is used for operations that should target the "active view",
 * such as exporting a snapshot.
 */

import { create } from 'zustand';

export interface ActivePanelState {
  componentType: string | null;
  componentState: Record<string, unknown> | null;
}

interface ActivePanelStore extends ActivePanelState {
  setActivePanel: (componentType: string | null, componentState?: Record<string, unknown> | null) => void;
  clearActivePanel: () => void;
}

export const useActivePanelStore = create<ActivePanelStore>((set) => ({
  componentType: null,
  componentState: null,

  setActivePanel: (componentType, componentState = null) => {
    set({ componentType, componentState });
  },

  clearActivePanel: () => {
    set({ componentType: null, componentState: null });
  }
}));

