/**
 * Bounding box of the voxels with |value| > threshold.
 */
export type VolumeNonzeroBbox = {
    /**
     * Inclusive voxel index bounds.
     */
    ijkMin: [number, number, number];
    ijkMax: [number, number, number];
    /**
     * World bounds of the voxel *centres* at the box corners (axis-aligned
     * envelope of the 8 transformed corners). Add half a voxel per side for
     * the voxel-edge extent.
     */
    worldMinMm: [number, number, number];
    worldMaxMm: [number, number, number];
    voxelCount: number;
    timepoint: number | null;
};
