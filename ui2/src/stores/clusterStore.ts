import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { ClusterSummary, AlphaMaskHandle } from '@/types/alphaMask';

export interface ClusterState {
  byLayer: Map<string, {
    status: 'idle' | 'computing' | 'ready' | 'error';
    summaries: ClusterSummary[];
    mask?: AlphaMaskHandle;
    error?: string;
  }>;
  setComputing: (layerId: string) => void;
  setResult: (layerId: string, mask: AlphaMaskHandle, summaries: ClusterSummary[]) => void;
  setError: (layerId: string, error: string) => void;
  clear: (layerId: string) => void;
}

export const useClusterStore = create<ClusterState>()(immer((set) => ({
  byLayer: new Map(),
  setComputing: (layerId) => set((state) => {
    state.byLayer.set(layerId, { status: 'computing', summaries: [] });
  }),
  setResult: (layerId, mask, summaries) => set((state) => {
    state.byLayer.set(layerId, { status: 'ready', summaries, mask });
  }),
  setError: (layerId, error) => set((state) => {
    state.byLayer.set(layerId, { status: 'error', summaries: [], error });
  }),
  clear: (layerId) => set((state) => {
    state.byLayer.delete(layerId);
  }),
})));

