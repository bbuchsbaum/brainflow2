export type VolumeBounds = {
    min: [number, number, number];
    max: [number, number, number];
    center: [number, number, number];
    dims: [number, number, number];
    /**
     * World centre of voxel `floor((dims - 1) / 2)`: a voxel-centred default
     * position (`center` falls on a voxel edge along even dimensions).
     */
    center_voxel_world?: [number, number, number];
};
