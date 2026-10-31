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

/**
 * A surface tab: a live surface view or a placeholder from the last session
 * (`surfacePlaceholder`, components/layout/surfaceTabRestore.ts). Neither has
 * a slice layout, so the layout pills are disabled while one is in front.
 */
export function isSurfaceTabComponent(componentType: string | null | undefined): boolean {
  return componentType === 'surfaceView' || componentType === 'surfacePlaceholder';
}

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
