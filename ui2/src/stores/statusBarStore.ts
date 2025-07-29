/**
 * StatusBarStore - Zustand store for status bar state
 * Manages status bar updates outside of React Context to avoid render loops
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { ReactNode } from 'react';

interface StatusBarState {
  values: Record<string, string | ReactNode>;
  setValue: (id: string, value: string | ReactNode) => void;
  setBatch: (entries: Array<[string, string | ReactNode]>) => void;
  removeValue: (id: string) => void;
  clear: () => void;
}

export const useStatusBarStore = create<StatusBarState>()(
  subscribeWithSelector((set) => ({
    values: {
      coordSys: 'LPI',
      crosshair: '(0.0, 0.0, 0.0)',
      mouse: '--',
      layer: 'None',
      fps: '--',
      gpu: 'Ready'
    },
    setValue: (id, value) => set((state) => ({
      values: { ...state.values, [id]: value }
    })),
    setBatch: (entries) => set((state) => ({
      values: { ...state.values, ...Object.fromEntries(entries) }
    })),
    removeValue: (id) => set((state) => {
      const { [id]: _, ...rest } = state.values;
      return { values: rest };
    }),
    clear: () => set({ 
      values: {
        coordSys: 'LPI',
        crosshair: '(0.0, 0.0, 0.0)',
        mouse: '--',
        layer: 'None',
        fps: '--',
        gpu: 'Ready'
      }
    })
  }))
);

// Selector hooks for individual slots
export const useStatusBarSlot = (id: string) => {
  return useStatusBarStore((state) => state.values[id]);
};