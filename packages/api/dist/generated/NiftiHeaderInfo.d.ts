import type { DataRange } from "./DataRange";
/**
 * Detailed NIfTI header metadata for display in the UI
 */
export type NiftiHeaderInfo = {
    /**
     * File path/name of the NIfTI file
     */
    filename: string;
    /**
     * Spatial dimensions [x, y, z] (and optionally time)
     */
    dimensions: Array<number>;
    /**
     * Voxel size in mm [x, y, z]
     */
    voxel_spacing: [number, number, number];
    /**
     * Data type string (e.g. "f32", "i16", "u8")
     */
    data_type: string;
    /**
     * 4x4 voxel-to-world affine matrix in row-major order
     */
    voxel_to_world: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
    /**
     * Minimum world-space bounding box corner [x, y, z]
     */
    world_bounds_min: [number, number, number];
    /**
     * Maximum world-space bounding box corner [x, y, z]
     */
    world_bounds_max: [number, number, number];
    /**
     * NIfTI sform code (0 = unknown)
     */
    sform_code: number;
    /**
     * NIfTI qform code (0 = unknown)
     */
    qform_code: number;
    /**
     * Best-effort coordinate-space tag: "MNI", "talairach", "aligned",
     * "scanner", or "unknown". Derived from the sform/qform codes plus a
     * filename hint; heuristic, since codes alone are unreliable (many MNI
     * files ship with code 1). Not authoritative — auto-mount features should
     * treat a non-"MNI" result as "ask the user".
     */
    coordinate_space: string;
    /**
     * Orientation string derived from the affine (e.g. "RAS", "LPI")
     */
    orientation_string: string;
    /**
     * Spatial units string (e.g. "mm", "m", "micron")
     */
    spatial_units: string;
    /**
     * Temporal units string if applicable
     */
    temporal_units: string | null;
    /**
     * Repetition time in seconds (for 4D fMRI)
     */
    tr_seconds: number | null;
    /**
     * Number of time points (for 4D)
     */
    num_timepoints: number | null;
    /**
     * Description string from NIfTI header
     */
    description: string;
    /**
     * Min/max data range of the volume
     */
    data_range: DataRange | null;
};
