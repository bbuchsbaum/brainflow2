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
  /** |threshold|; null while the field is empty or invalid. */
  threshold: number | null;
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
  computedAt: number;
}

export type ClusterStatus = 'idle' | 'computing' | 'ready' | 'error';

interface ClusterStore {
  params: ClusterParams;
  status: ClusterStatus;
  result: ClusterResult | null;
  error: string | null;
  /** Selected cluster id (1-based rank), or null. */
  selectedId: number | null;
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
    }),
}));
