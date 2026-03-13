import { create } from 'zustand';

export type AppMode = 'imaging' | 'studio';

interface AppModeStoreState {
  mode: AppMode;
  previousMode: AppMode | null;
  enterStudioMode: () => void;
  enterImagingMode: () => void;
}

export const useAppModeStore = create<AppModeStoreState>((set, get) => ({
  mode: 'imaging',
  previousMode: null,

  enterStudioMode: () => {
    if (get().mode === 'studio') {
      return;
    }

    set((state) => ({
      previousMode: state.mode,
      mode: 'studio',
    }));
  },

  enterImagingMode: () => {
    if (get().mode === 'imaging') {
      return;
    }

    set((state) => ({
      previousMode: state.mode,
      mode: 'imaging',
    }));
  },
}));
