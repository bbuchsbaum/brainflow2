import { create } from 'zustand';
import type { BidsEventRow } from '@brainflow/api';
import { getEventBus } from '@/events/EventBus';

/** One layer's events, drawn on its time series. */
export interface TimeEventsTrack {
  layerId: string;
  /** What the events belong to, for the caption. */
  label: string;
  events: readonly BidsEventRow[];
  /** 0-based volumes the source flags as non-steady-state. */
  nonSteadyVolumes?: readonly number[];
}

interface TimeEventsState {
  tracks: Record<string, TimeEventsTrack>;
  publish: (track: TimeEventsTrack) => void;
  clear: (layerId: string) => void;
}

export const useTimeEventsStore = create<TimeEventsState>()((set, get) => ({
  tracks: {},
  publish: (track) => set({ tracks: { ...get().tracks, [track.layerId]: track } }),
  clear: (layerId) => {
    const { tracks } = get();
    if (!(layerId in tracks)) return;
    set({ tracks: Object.fromEntries(Object.entries(tracks).filter(([id]) => id !== layerId)) });
  },
}));

// A track lives as long as its layer.
getEventBus().on('layer.removed', ({ layerId }) => useTimeEventsStore.getState().clear(layerId));
