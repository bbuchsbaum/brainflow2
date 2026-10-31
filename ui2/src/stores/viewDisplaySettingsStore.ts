/**
 * Persisted display conventions for the slice views.
 *
 * `radiological` (View › Radiological Convention, off by default): axial and
 * coronal panes are shown mirrored left-right, the patient's right on the
 * screen's left (QA features 2026-10-31 §2). It is a display transform in the
 * shared SliceViewport only: view planes, affines, the crosshair and every
 * stored coordinate are unchanged (AGENTS.md coordinate contract).
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ViewType } from '@/types/coordinates';

interface ViewDisplaySettingsState {
  radiological: boolean;
  setRadiological: (on: boolean) => void;
  toggleRadiological: () => void;
}

export const useViewDisplaySettingsStore = create<ViewDisplaySettingsState>()(
  persist(
    (set) => ({
      radiological: false,
      setRadiological: (on) =>
        set((state) => (state.radiological === on ? state : { radiological: on })),
      toggleRadiological: () => set((state) => ({ radiological: !state.radiological })),
    }),
    {
      name: 'brainflow2-view-display-settings',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ radiological: state.radiological }),
    },
  ),
);

/**
 * Whether a pane of `viewType` is drawn mirrored: axial and coronal under the
 * radiological convention. A sagittal pane has no left-right axis.
 */
export function mirrorsView(viewType: ViewType, radiological: boolean): boolean {
  return radiological && (viewType === 'axial' || viewType === 'coronal');
}

/** Hook form of {@link mirrorsView} for the current setting. */
export function useMirrorsView(viewType: ViewType): boolean {
  return useViewDisplaySettingsStore((state) => mirrorsView(viewType, state.radiological));
}
