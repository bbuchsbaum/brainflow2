import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface FeatureFlagStore {
  multiViewBatch: boolean;
  setMultiViewBatchEnabled: (enabled: boolean) => void;
  toggleMultiViewBatch: () => void;
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
      }
    }),
    {
      name: 'brainflow-feature-flags'
    }
  )
);
