import type { ExtentStatistic } from "./ExtentStatistic";
/**
 * Table-level cluster inference results; every p value depends on
 * `assumption`.
 */
export type ClusterExtentInference = {
    /**
     * Method id, e.g. "rft-extent".
     */
    method: string;
    /**
     * FWHM along the voxel axes, mm (user-supplied).
     */
    fwhmMm: [number, number, number];
    statistic: ExtentStatistic;
    /**
     * t error df, or F numerator df.
     */
    df: number | null;
    /**
     * F denominator df.
     */
    df2: number | null;
    /**
     * "header" or "request".
     */
    statisticSource: string;
    clusterFormingThreshold: number;
    /**
     * Search volume: finite, non-zero voxels of the analysed frame.
     */
    searchVoxels: number;
    /**
     * Resel counts `[R0, R1, R2, R3]` of the search volume.
     */
    resels: [number, number, number, number];
    /**
     * Voxels per resel (`FWHM_x · FWHM_y · FWHM_z` in voxels).
     */
    voxelsPerResel: number;
    /**
     * Expected number of clusters at the threshold.
     */
    expectedClusters: number;
    /**
     * Expected voxels per cluster at the threshold.
     */
    expectedVoxelsPerCluster: number;
    assumption: string;
};
