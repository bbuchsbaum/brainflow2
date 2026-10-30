/**
 * The component type of the centre stack's front tab ("Workspace" for a view
 * or tool tab, "surfaceView" for a surface tab).
 *
 * Unlike `activePanelStore`, which follows focus in every stack (Files,
 * Subjects, the bottom dock), this only changes when the centre stack's front
 * tab does, so "a surface tab is in front" survives clicks elsewhere.
 * Written by GoldenLayoutRoot's `activeContentItemChanged` handler.
 */

import { create } from 'zustand';

interface CenterTabStore {
  frontComponentType: string | null;
  setFrontComponentType: (componentType: string | null) => void;
}

export const useCenterTabStore = create<CenterTabStore>((set, get) => ({
  frontComponentType: null,
  setFrontComponentType: (componentType) => {
    if (get().frontComponentType === componentType) return;
    set({ frontComponentType: componentType });
  },
}));
