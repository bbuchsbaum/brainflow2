import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface FeatureFlagStore {
  multiViewBatch: boolean;
  setMultiViewBatchEnabled: (enabled: boolean) => void;
  toggleMultiViewBatch: () => void;
  integratedWorkspaceV1: boolean;
  setIntegratedWorkspaceV1Enabled: (enabled: boolean) => void;
  toggleIntegratedWorkspaceV1: () => void;
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
      integratedWorkspaceV1: false,
      setIntegratedWorkspaceV1Enabled: (enabled) => {
        set({ integratedWorkspaceV1: enabled });
      },
      toggleIntegratedWorkspaceV1: () => {
        set({ integratedWorkspaceV1: !get().integratedWorkspaceV1 });
      }
    }),
    {
      name: 'brainflow-feature-flags'
    }
  )
);
