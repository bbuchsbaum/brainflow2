/**
 * Information about which slice was uploaded
 */
export type SliceInfo = {
    /**
     * Axis along which the slice was taken (0=X/Sagittal, 1=Y/Coronal, 2=Z/Axial)
     */
    axis: number;
    /**
     * Index of the slice along the axis
     */
    index: number;
    /**
     * Human-readable axis name
     */
    axis_name: string;
    /**
     * Slice dimensions [width, height]
     */
    dimensions: [number, number];
};
