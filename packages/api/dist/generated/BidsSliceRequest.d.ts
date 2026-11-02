export type BidsSliceRequest = {
    path: string;
    /**
     * `mean`, `first`, `tsnr` or `anat`.
     */
    kind: string;
    world_z_mm: number | null;
    max_px: number;
};
