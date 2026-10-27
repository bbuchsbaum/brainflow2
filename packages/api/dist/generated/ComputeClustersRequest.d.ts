import type { ClusterSign } from "./ClusterSign";
export type ComputeClustersRequest = {
    volumeId?: string | null;
    layerId?: string | null;
    /**
     * Absolute threshold (>= 0): positive voxels need `v > threshold`,
     * negative voxels `v < -threshold`.
     */
    threshold: number;
    /**
     * Default "both".
     */
    sign?: ClusterSign | null;
    /**
     * Face (6), face+edge (18) or face+edge+corner (26) adjacency; default 26.
     */
    connectivity?: number | null;
    /**
     * Clusters smaller than this are dropped (counted in `discardedClusters`);
     * default 1.
     */
    minVoxels?: number | null;
    timepoint?: number | null;
    /**
     * Cap on returned rows (default 500); `truncated` reports a cut.
     */
    maxClusters?: number | null;
};
