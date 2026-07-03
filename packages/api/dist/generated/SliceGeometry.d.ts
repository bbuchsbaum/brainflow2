/**
 * A complete, orientation-agnostic description of one 2D slice
 */
export type SliceGeometry = {
    /**
     * World-space anchor (pixel 0,0)
     */
    origin_mm: [number, number, number];
    /**
     * World-space step for one pixel to the right
     */
    u_mm: [number, number, number];
    /**
     * World-space step for one pixel down
     */
    v_mm: [number, number, number];
    /**
     * Width × height of the raster
     */
    dim_px: [number, number];
};
