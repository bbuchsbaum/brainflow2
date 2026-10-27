/**
 * Each surface view's camera basis (phase 4, D5), reported by the viewer
 * whenever the camera moves; the surface frame draws its orientation glyph
 * from it. Not persisted.
 */
import { create } from 'zustand';
import type { CameraBasis } from '@/utils/orientationGizmo';

interface SurfaceCameraState {
  bases: Map<string, CameraBasis>;
  setBasis: (surfaceViewId: string, basis: CameraBasis) => void;
}

export const useSurfaceCameraStore = create<SurfaceCameraState>((set) => ({
  bases: new Map(),
  setBasis: (surfaceViewId, basis) =>
    set((state) => {
      const previous = state.bases.get(surfaceViewId);
      if (
        previous &&
        previous.right.every((v, i) => Math.abs(v - basis.right[i]) < 1e-4) &&
        previous.up.every((v, i) => Math.abs(v - basis.up[i]) < 1e-4)
      ) {
        return state;
      }
      const bases = new Map(state.bases);
      bases.set(surfaceViewId, basis);
      return { bases };
    }),
}));
