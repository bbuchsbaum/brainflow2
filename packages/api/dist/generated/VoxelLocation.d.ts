/**
 * A voxel located by a volume query: value, voxel index and world centre.
 */
export type VoxelLocation = {
    value: number;
    ijk: [number, number, number];
    /**
     * World position of the voxel centre.
     */
    worldMm: [number, number, number];
    /**
     * Frame read (4D volumes only).
     */
    timepoint: number | null;
};
