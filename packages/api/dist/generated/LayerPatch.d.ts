/**
 * Patch for updating layer properties
 */
export type LayerPatch = {
    opacity: number | null;
    colormap: string | null;
    window_center: number | null;
    window_width: number | null;
    intensity_min: number | null;
    intensity_max: number | null;
    threshold_low: number | null;
    threshold_high: number | null;
    threshold_mode: string | null;
    blend_mode: string | null;
};
