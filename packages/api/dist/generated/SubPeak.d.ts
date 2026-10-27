/**
 * A secondary local maximum of a cluster.
 */
export type SubPeak = {
    value: number;
    ijk: [number, number, number];
    /**
     * World centre of the voxel.
     */
    mm: [number, number, number];
};
