/**
 * View Layout Store
 * Manages the layout mode for orthogonal views (locked vs flexible)
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ViewLayoutMode } from '@/types/viewLayout';

interface ViewLayoutStore {
  mode: ViewLayoutMode;
  // Actions
  setMode: (mode: ViewLayoutMode) => void;
  toggleMode: () => void;
  
  // Helpers
  isLocked: () => boolean;
  isFlexible: () => boolean;
}

export const useViewLayoutStore = create<ViewLayoutStore>()(
  persist(
    (set, get) => ({
      mode: 'locked' as ViewLayoutMode,
      
      setMode: (mode) => set({ mode }),
      
      toggleMode: () => set((state) => ({
        mode: state.mode === 'locked' ? 'flexible' : 'locked'
      })),
      
      isLocked: () => get().mode === 'locked',
      
      isFlexible: () => get().mode === 'flexible',
    }),
    {
      name: 'brainflow2-view-layout-mode',
      partialize: (state) => ({ mode: state.mode }) // Only persist the mode
    }
  )
);