import { create } from 'zustand';
import type { FramePlane } from './frameFormat';

/** Per-view layout facts the colorbar host choice needs (CSS px). */
export interface FrameSlot {
  /** Canvas-area size. */
  area: number;
  /** Free width between the image's right edge and the right orientation letter. */
  room: number;
}

interface ViewportFrameState {
  slots: Partial<Record<FramePlane, FrameSlot>>;
  setSlot: (plane: FramePlane, slot: FrameSlot | null) => void;
}

/**
 * Orthogonal views publish their canvas area and right-margin room here so a
 * single view can host the colorbar (GoldenLayout panels have separate React
 * roots, so this cannot be context).
 */
export const useViewportFrameStore = create<ViewportFrameState>((set, get) => ({
  slots: {},
  setSlot: (plane, slot) => {
    const prev = get().slots[plane];
    if (!slot && !prev) return;
    if (slot && prev && prev.area === slot.area && prev.room === slot.room) return;
    const slots = { ...get().slots };
    if (slot) slots[plane] = slot;
    else delete slots[plane];
    set({ slots });
  },
}));

/** Width a colorbar needs beside the image (box + gaps). */
export const COLORBAR_BESIDE_MIN_ROOM = 136;

/**
 * Host: among views whose right margin can hold the colorbar beside the
 * image, the largest; otherwise the largest view (corner fallback).
 * Ties go to axial, then coronal, then sagittal.
 */
export function chooseColorbarHost(
  slots: Partial<Record<FramePlane, FrameSlot>>,
  minRoom = COLORBAR_BESIDE_MIN_ROOM,
): FramePlane | null {
  const order: FramePlane[] = ['axial', 'coronal', 'sagittal'];
  const pick = (ok: (s: FrameSlot) => boolean) => {
    let best: FramePlane | null = null;
    let bestArea = 0;
    for (const plane of order) {
      const s = slots[plane];
      if (!s || !ok(s) || s.area <= bestArea) continue;
      best = plane;
      bestArea = s.area;
    }
    return best;
  };
  return pick((s) => s.room >= minRoom) ?? pick(() => true);
}
