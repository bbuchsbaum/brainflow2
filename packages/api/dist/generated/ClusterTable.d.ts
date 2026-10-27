import type { ClusterSign } from "./ClusterSign";
import type { ClusterSummary } from "./ClusterSummary";
export type ClusterTable = {
    clusters: Array<ClusterSummary>;
    threshold: number;
    sign: ClusterSign;
    connectivity: number;
    minVoxels: number;
    /**
     * Frame analysed (4D volumes only).
     */
    timepoint: number | null;
    voxelVolumeMm3: number;
    /**
     * Voxels passing the threshold, before the size filter.
     */
    suprathresholdVoxels: number;
    /**
     * Clusters at or above `minVoxels` (before `maxClusters` truncation).
     */
    totalClusters: number;
    /**
     * Components dropped for being smaller than `minVoxels`.
     */
    discardedClusters: number;
    truncated: boolean;
};
