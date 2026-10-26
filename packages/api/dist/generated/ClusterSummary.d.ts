import type { ClusterPolarity } from "./ClusterPolarity";
export type ClusterSummary = {
    /**
     * 1-based rank in the returned order (|peak| descending).
     */
    id: number;
    sign: ClusterPolarity;
    voxelCount: number;
    volumeMm3: number;
    /**
     * Signed value at the voxel with the largest |value|.
     */
    peakValue: number;
    peakIjk: [number, number, number];
    /**
     * World centre of the peak voxel.
     */
    peakMm: [number, number, number];
    meanValue: number;
    /**
     * Unweighted centre of mass (mean voxel position), voxel coordinates.
     */
    centroidIjk: [number, number, number];
    /**
     * Unweighted centre of mass in world mm.
     */
    centroidMm: [number, number, number];
    /**
     * Centre of mass weighted by |value|, world mm.
     */
    weightedCentroidMm: [number, number, number];
    /**
     * Inclusive voxel bounding box.
     */
    bboxIjkMin: [number, number, number];
    bboxIjkMax: [number, number, number];
    /**
     * World envelope of the bounding-box voxel centres.
     */
    bboxMmMin: [number, number, number];
    bboxMmMax: [number, number, number];
};
