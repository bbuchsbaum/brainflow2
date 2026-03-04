export type Connectivity = 'Six' | 'TwentySix';

export type MaskKind = 'Cluster' | 'UserDefined' | { Other: string };

export interface ClusterMaskParams {
  threshold: number;
  min_voxels: number;
  connectivity: Connectivity;
  split_local_minima?: number | null;
  timepoint?: number | null;
}

export interface ClusterSummary {
  id: number;
  size_vox: number;
  peak_value: number;
  peak_ijk: [number, number, number];
  peak_mm: [number, number, number];
  centroid_ijk: [number, number, number];
  centroid_mm: [number, number, number];
  bbox_min: [number, number, number];
  bbox_max: [number, number, number];
}

export interface AlphaMaskHandle {
  layer_id: string;
  timepoint?: number | null;
  mask_id: number;
}

export interface ComputeAlphaMaskResult {
  mask: AlphaMaskHandle;
  clusters?: ClusterSummary[] | null;
  kind: MaskKind;
}
