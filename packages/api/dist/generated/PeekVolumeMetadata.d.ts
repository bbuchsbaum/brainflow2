/**
 * Lightweight, header-only metadata for the Files-panel preview.
 *
 * Returned by the `peek_volume_metadata` command without ever
 * loading the volume data into the GPU. Fields are camelCase in the
 * generated TypeScript bindings.
 */
export type PeekVolumeMetadata = {
    /**
     * Path that was probed.
     */
    path: string;
    /**
     * Discriminator: "nifti" | "gifti".
     */
    kind: string;
    /**
     * Spatial (and optional time) dimensions.
     */
    dims: Array<number>;
    /**
     * Voxel size in mm. Empty for surface meshes.
     */
    voxelSize: Array<number>;
    /**
     * Data type string (e.g. "f32", "i16", "u8") if known.
     */
    dtype: string | null;
    /**
     * True when the probe identifies the volume as 4D.
     */
    isFourD: boolean;
    /**
     * Number of time points if applicable.
     */
    numTimepoints: number | null;
    /**
     * Repetition time in seconds if applicable.
     */
    tr: number | null;
};
