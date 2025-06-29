/**
 * Texture coordinates within the atlas
 */
export type TextureCoordinates = {
    /**
     * Minimum U coordinate (0.0 to 1.0)
     */
    u_min: number;
    /**
     * Minimum V coordinate (0.0 to 1.0)
     */
    v_min: number;
    /**
     * Maximum U coordinate (0.0 to 1.0)
     */
    u_max: number;
    /**
     * Maximum V coordinate (0.0 to 1.0)
     */
    v_max: number;
};
