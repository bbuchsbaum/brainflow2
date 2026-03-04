import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { subscribeWithSelector } from 'zustand/middleware';

export interface LayerDisplayOptions {
  showBorder: boolean;
  borderThicknessPx: number;
  showOrientationMarkers: boolean;
  showValueOnHover: boolean;
}

export interface DisplayOptionsState {
  // Per-layer options by layerId
  options: Map<string, LayerDisplayOptions>;

  // Actions
  setOptions: (layerId: string, partial: Partial<LayerDisplayOptions>) => void;
  getOptions: (layerId: string) => LayerDisplayOptions;
}

const DEFAULT_OPTIONS: LayerDisplayOptions = Object.freeze({
  showBorder: false,
  borderThicknessPx: 1,
  showOrientationMarkers: true,
  showValueOnHover: true,
});

export const useDisplayOptionsStore = create<DisplayOptionsState>()(
  subscribeWithSelector(
    immer((set, get) => ({
      options: new Map<string, LayerDisplayOptions>(),

      setOptions: (layerId, partial) => {
        set((state) => {
          const current = state.options.get(layerId) ?? { ...DEFAULT_OPTIONS };
          const next = { ...current, ...partial } as LayerDisplayOptions;
          state.options.set(layerId, next);
        });
      },

      getOptions: (layerId) => {
        const map = get().options;
        return map.get(layerId) ?? DEFAULT_OPTIONS;
      },
    }))
  )
);
