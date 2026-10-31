/**
 * Cluster table state (UI redesign phase 3, item 5): the parameters in the
 * Clusters dock toolbar and the last computed table (`compute_clusters`).
 * One table at a time, tied to the layer and parameters it was computed for,
 * so the panel can say when it is stale.
 */
import { create } from 'zustand';
import type { ClusterSign, ClusterTable } from '@brainflow/api';

export type ClusterConnectivity = 6 | 18 | 26;

export interface ClusterParams {
  /** |threshold| (the positive tail's when two are typed); null while the field is empty or invalid. */
  threshold: number | null;
  /**
   * The negative tail's |threshold| when it differs (an asymmetric layer
   * threshold the user then edited); null: the same as `threshold`.
   */
  negativeThreshold: number | null;
  /**
   * Two threshold fields (negative and positive tail) kept while the user
   * edits them (review of N6, M3): entered from an asymmetric layer
   * threshold, left only through "Make symmetric" or "Use layer threshold".
   */
  split: boolean;
  /** Follow the layer's display threshold until the user edits the field. */
  linked: boolean;
  sign: ClusterSign;
  connectivity: ClusterConnectivity;
  /** Minimum cluster size in voxels; null while the field is empty. */
  minVoxels: number | null;
  /**
   * Opt-in cluster-level p (Gaussian random field theory, phase 4 C2). Off
   * by default: every p value rests on the user's smoothness assumption.
   */
  extentP: boolean;
  /** FWHM in mm as typed: one value ("8") or one per voxel axis ("6 6 8"). */
  fwhmText: string;
  /**
   * Layer whose finite non-zero voxels bound the search (a brain mask), or
   * null for the map's own non-zero voxels (the backend default).
   */
  searchMaskLayerId: string | null;
}

export interface ClusterResult {
  layerId: string;
  layerName: string;
  table: ClusterTable;
  /** Region at each cluster's peak (same order as `table.clusters`); null without an atlas. */
  regions: Array<string | null>;
  /** Region at each sub-peak (`subPeakRegions[i][j]` for `table.clusters[i].subPeaks[j]`). */
  subPeakRegions?: Array<Array<string | null>>;
  /** Name of the search mask layer at compute time (null: the map's non-zero voxels). */
  maskName?: string | null;
  computedAt: number;
}

export type ClusterStatus = 'idle' | 'computing' | 'ready' | 'error';

/**
 * The strongest peak of a statistic layer at its display threshold
 * (clusters on load, QA features 2026-10-31 §8): the Inspector's "Peak z
 * 6.41 at (−40, −20, 50)". `value` / `mm` are null when no voxel passes.
 */
export interface LayerPeak {
  threshold: number;
  /** Negative tail's |threshold| when it differs (sign "both"). */
  negativeThreshold?: number | null;
  /** Which tail(s) were searched: the readout says |z| > t, z > t or z < −t. */
  sign: ClusterSign;
  value: number | null;
  mm: [number, number, number] | null;
  clusters: number;
}

interface ClusterStore {
  params: ClusterParams;
  status: ClusterStatus;
  result: ClusterResult | null;
  error: string | null;
  /** Selected cluster id (1-based rank), or null. */
  selectedId: number | null;
  /** Strongest peak per statistic layer, from the automatic cluster runs. */
  peaks: Record<string, LayerPeak>;
  setPeak: (layerId: string, peak: LayerPeak | null) => void;
  setParams: (patch: Partial<ClusterParams>) => void;
  setComputing: () => void;
  setResult: (result: ClusterResult) => void;
  setError: (message: string) => void;
  /** A computation was cancelled (superseded): back to the last table, no error. */
  cancelComputing: () => void;
  select: (id: number | null) => void;
  reset: () => void;
}

/** Defaults (critics, v0): 26-connectivity like FSL `cluster`; min 1 voxel so 6 vs 26 is visible. */
export const DEFAULT_CLUSTER_PARAMS: ClusterParams = {
  threshold: null,
  negativeThreshold: null,
  split: false,
  linked: true,
  sign: 'both',
  connectivity: 26,
  minVoxels: 1,
  extentP: false,
  fwhmText: '',
  searchMaskLayerId: null,
};

export const useClusterStore = create<ClusterStore>((set) => ({
  params: { ...DEFAULT_CLUSTER_PARAMS },
  status: 'idle',
  result: null,
  error: null,
  selectedId: null,
  peaks: {},
  setPeak: (layerId, peak) =>
    set((state) => {
      if (!peak) {
        if (!(layerId in state.peaks)) return state;
        const rest = { ...state.peaks };
        delete rest[layerId];
        return { peaks: rest };
      }
      return { peaks: { ...state.peaks, [layerId]: peak } };
    }),
  setParams: (patch) => set((state) => ({ params: { ...state.params, ...patch } })),
  setComputing: () => set({ status: 'computing', error: null }),
  setResult: (result) => set({ status: 'ready', result, error: null, selectedId: null }),
  setError: (message) => set({ status: 'error', error: message }),
  cancelComputing: () =>
    set((state) =>
      state.status === 'computing' ? { status: state.result ? 'ready' : 'idle', error: null } : state,
    ),
  select: (id) => set((state) => (state.selectedId === id ? state : { selectedId: id })),
  reset: () =>
    set({
      params: { ...DEFAULT_CLUSTER_PARAMS },
      status: 'idle',
      result: null,
      error: null,
      selectedId: null,
      peaks: {},
    }),
}));
