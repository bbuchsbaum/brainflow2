/**
 * Active Render Context Store
 *
 * Tracks the last renderable view/canvas the user interacted with.
 * This is the authoritative source for "active image" operations.
 */

import { create } from 'zustand';

interface ActiveRenderContextState {
  activeId: string | null;
  setActive: (id: string) => void;
  clearActive: () => void;
}

export const useActiveRenderContextStore = create<ActiveRenderContextState>((set, get) => ({
  activeId: null,

  setActive: (id) => {
    const current = get().activeId;
    if (Object.is(current, id)) return;
    set({ activeId: id });
  },

  clearActive: () => {
    if (get().activeId === null) return;
    set({ activeId: null });
  }
}));

