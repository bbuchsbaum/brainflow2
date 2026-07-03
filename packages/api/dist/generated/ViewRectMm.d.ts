/**
 * A renderer-agnostic description of a 2D viewing rectangle in world space
 *
 * This type ensures both CPU and GPU renderers show exactly the same region
 * by providing a single source of truth for view calculations.
 *
 * # Coordinate System Contract
 *
 * This struct defines the critical contract between backend view calculations and frontend rendering:
 *
 * - `origin_mm`: World coordinates of the top-left pixel center
 * - `u_mm`: Per-pixel world displacement vector for moving right (X direction)
 * - `v_mm`: Per-pixel world displacement vector for moving down (Y direction)
 * - `width_px`/`height_px`: Actual pixel dimensions (may differ from requested)
 *
 * # Important Notes for Frontend Integration
 *
 * - The u_mm and v_mm vectors are already scaled to pixel size by `vec3_scale(direction, pixel_size)`
 * - Frontend should use these vectors directly without further scaling
 * - Dimensions may differ from requested to preserve square pixels and aspect ratios
 * - This dimension adjustment is intentional behavior, not an error condition
 * - Square pixels are essential in medical imaging to preserve anatomical proportions
 *
 * # Dimension Preservation Strategy
 *
 * The `full_extent` method prioritizes anatomical accuracy over exact dimension matching:
 * 1. Calculate required pixel size for square pixels: `max(width_mm/req_width, height_mm/req_height)`
 * 2. Use this pixel size to determine actual dimensions that fit the anatomical extent
 * 3. The resulting dimensions ensure square pixels and complete anatomical coverage
 *
 * For a typical MNI brain (193×229×193 voxels):
 * - Anatomical extent might be ~193mm × ~229mm
 * - Requested 512×512 would create different pixel sizes for X/Y
 * - Actual 432×512 ensures square pixels and complete brain coverage
 *
 * This is medical imaging best practice - square pixels preserve anatomical proportions.
 */
export type ViewRectMm = {
    /**
     * Upper-left pixel center in world coordinates (mm)
     */
    origin_mm: [number, number, number];
    /**
     * World-space vector for one pixel to the right (mm)
     * NOTE: Already scaled by pixel_size - do not scale further in frontend
     */
    u_mm: [number, number, number];
    /**
     * World-space vector for one pixel downward (mm)
     * NOTE: Already scaled by pixel_size - do not scale further in frontend
     */
    v_mm: [number, number, number];
    /**
     * Width in pixels (may differ from requested for square pixel preservation)
     */
    width_px: number;
    /**
     * Height in pixels (may differ from requested for square pixel preservation)
     */
    height_px: number;
};
