import type { ClusterExtentInference } from "./ClusterExtentInference";
import type { ClusterSign } from "./ClusterSign";
import type { ClusterSummary } from "./ClusterSummary";
import type { ExtentWithheld } from "./ExtentWithheld";
import type { SearchVolume } from "./SearchVolume";
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
    maxPeaksPerCluster: number;
    minPeakDistanceMm: number;
    /**
     * Present only when `extent` was requested.
     */
    extentInference: ClusterExtentInference | null;
    /**
     * Registered cluster-id label volume (`emitLabelVolume`): voxel value =
     * cluster `id`, 0 elsewhere, on the analysed grid. Usable as a region
     * locus (`labelSource: { type: "volume", volumeId }`, `labelIds: [id]`).
     */
    labelVolumeId?: string;
    /**
     * Search volume used for cluster formation and extent inference (always
     * set by `compute_clusters`).
     */
    searchVolume?: SearchVolume;
    /**
     * Set when `extent` was requested but its p values were withheld (e.g. a
     * pre-thresholded map without `searchMask`); `extentInference` and every
     * `pFweExtent`/`pUncorrectedExtent` are then null.
     */
    extentWithheld?: ExtentWithheld;
};
