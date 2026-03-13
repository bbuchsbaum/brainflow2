/**
 * Result of loading a surface template
 */
export type SurfaceTemplateResult = {
    /**
     * Whether loading succeeded
     */
    success: boolean;
    /**
     * Surface handle for loaded geometry
     */
    surface_handle: string | null;
    /**
     * Vertex count
     */
    vertex_count: number | null;
    /**
     * Face count
     */
    face_count: number | null;
    /**
     * Space name
     */
    space: string;
    /**
     * Geometry type
     */
    geometry_type: string;
    /**
     * Hemisphere
     */
    hemisphere: string;
    /**
     * Error message if failed
     */
    error_message: string | null;
};
