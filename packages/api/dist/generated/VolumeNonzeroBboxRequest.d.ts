export type VolumeNonzeroBboxRequest = {
    volumeId?: string | null;
    layerId?: string | null;
    /**
     * Voxels with |value| > threshold count as non-zero (default 0).
     */
    threshold?: number | null;
    timepoint?: number | null;
};
