/**
 * How a NIfTI file stores its voxels, as its header declares.
 */
export type NiftiStorageInfo = {
    /**
     * Header `datatype` name ("int16", "uint8", "float32", …), or
     * "code N" for a code the reader does not know.
     */
    datatype: string;
    /**
     * Header `bitpix`.
     */
    bitpix: number;
    /**
     * Header `scl_slope` (0 means no scaling).
     */
    scl_slope: number;
    /**
     * Header `scl_inter`.
     */
    scl_inter: number;
    /**
     * Header `cal_min` (display window hint; 0 with `cal_max` 0 when unset).
     */
    cal_min: number;
    /**
     * Header `cal_max`.
     */
    cal_max: number;
};
