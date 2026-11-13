/**
 * Header facts of a NIfTI file, read from its first bytes.
 */
export type SidecarHeader = {
    dim: Array<number>;
    /**
     * One per entry of `dim`; the fourth is the header's time step.
     */
    voxelSizes: Array<number>;
    /**
     * Storage type on disk, such as `int16`.
     */
    datatype: string | null;
    trSeconds: number | null;
    nVolumes: number | null;
    qformCode: number;
    sformCode: number;
};
