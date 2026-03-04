/**
 * TooltipStore - Global hover tooltip state for views (orthogonal, mosaic, etc.)
 * Designed to be generic so atlas region labels, intensities, and coordinates
 * can all share the same overlay mechanism.
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export type ViewId = 'axial' | 'sagittal' | 'coronal' | 'mosaic' | 'lightbox';

export type TooltipKind = 'atlas-region' | 'intensity' | 'coord' | 'custom';

export interface ViewTooltipEntry {
  kind: TooltipKind;
  label: string;
  value?: string;
  priority?: 'normal' | 'high';
}

export interface ViewTooltipState {
  viewId: ViewId;
  screen: { x: number; y: number };
  world: [number, number, number];
  entries: ViewTooltipEntry[];
}

interface TooltipStoreState {
  tooltip: ViewTooltipState | null;
  setTooltip: (tooltip: ViewTooltipState) => void;
  clearTooltip: () => void;
}

// Simple shallow comparison to avoid redundant updates
function shallowEqualTooltip(a: ViewTooltipState | null, b: ViewTooltipState | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.viewId !== b.viewId) return false;
  if (a.screen.x !== b.screen.x || a.screen.y !== b.screen.y) return false;
  if (a.world[0] !== b.world[0] || a.world[1] !== b.world[1] || a.world[2] !== b.world[2]) {
    return false;
  }
  if (a.entries.length !== b.entries.length) return false;
  for (let i = 0; i < a.entries.length; i++) {
    const ea = a.entries[i];
    const eb = b.entries[i];
    if (ea.kind !== eb.kind || ea.label !== eb.label || ea.value !== eb.value || ea.priority !== eb.priority) {
      return false;
    }
  }
  return true;
}

export const useTooltipStore = create<TooltipStoreState>()(
  subscribeWithSelector((set, get) => ({
    tooltip: null,
    setTooltip: (next) => {
      const current = get().tooltip;
      if (shallowEqualTooltip(current, next)) {
        return;
      }
      set({ tooltip: next });
    },
    clearTooltip: () => {
      if (get().tooltip === null) return;
      set({ tooltip: null });
    },
  })),
);

