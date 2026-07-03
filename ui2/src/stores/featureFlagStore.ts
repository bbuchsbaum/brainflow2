import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface FeatureFlagStore {
  multiViewBatch: boolean;
  setMultiViewBatchEnabled: (enabled: boolean) => void;
  toggleMultiViewBatch: () => void;
  mosaicBatchRender: boolean;
  setMosaicBatchRenderEnabled: (enabled: boolean) => void;
  toggleMosaicBatchRender: () => void;
  integratedWorkspaceV1: boolean;
  setIntegratedWorkspaceV1Enabled: (enabled: boolean) => void;
  toggleIntegratedWorkspaceV1: () => void;
}

/**
 * Persist migration for `brainflow-feature-flags`.
 *
 * v0 -> v1: the integrated workspace graduated from a dev-only gate to a
 * shipped view mode. Existing local sessions persisted the old default-off
 * value, so force-enable it on upgrade. Exported for unit testing.
 */
export function migrateFeatureFlags(persisted: unknown, version: number): FeatureFlagStore {
  const state = (persisted ?? {}) as FeatureFlagStore;
  if (version < 1) {
    state.integratedWorkspaceV1 = true;
  }
  return state;
}

export const useFeatureFlagStore = create<FeatureFlagStore>()(
  persist(
    (set, get) => ({
      multiViewBatch: false,
      setMultiViewBatchEnabled: (enabled) => {
        set({ multiViewBatch: enabled });
      },
      toggleMultiViewBatch: () => {
        set({ multiViewBatch: !get().multiViewBatch });
      },
      // Mosaic packed-batch render path: when on, MosaicRenderService issues one
      // `batch_render_slices` call per <=25-cell chunk instead of one render per
      // cell. Default off; falls back to the per-cell path on any error.
      mosaicBatchRender: false,
      setMosaicBatchRenderEnabled: (enabled) => {
        set({ mosaicBatchRender: enabled });
      },
      toggleMosaicBatchRender: () => {
        set({ mosaicBatchRender: !get().mosaicBatchRender });
      },
      // Shipped view mode (vol2surf M2): the integrated surface+volume
      // workspace is reachable by default via the top-bar "Integrated" pill and
      // the View menu. The toggle is retained for any future opt-out surface.
      integratedWorkspaceV1: true,
      setIntegratedWorkspaceV1Enabled: (enabled) => {
        set({ integratedWorkspaceV1: enabled });
      },
      toggleIntegratedWorkspaceV1: () => {
        set({ integratedWorkspaceV1: !get().integratedWorkspaceV1 });
      },
    }),
    {
      name: 'brainflow-feature-flags',
      version: 1,
      migrate: migrateFeatureFlags,
    },
  ),
);
