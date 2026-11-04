import type { FrameReadbackMode } from "./FrameReadbackMode";
/**
 * Timing breakdown for a single frame request.
 */
export type FrameDiagnostics = {
    /**
     * CPU-side setup and state preparation before GPU submission.
     */
    prepare_ms: number;
    /**
     * Render pass encoding plus queue submission time.
     */
    render_ms: number;
    /**
     * Texture copy, map, and CPU unpack time.
     */
    readback_ms: number;
    /**
     * Total request_frame wall-clock time.
     */
    total_ms: number;
    /**
     * Number of visible layers prepared for the frame.
     */
    visible_layers: number;
    /**
     * Number of layer slots uploaded to the GPU for this frame.
     */
    updated_layer_slots: number;
    /**
     * Whether the request reused the previously uploaded layer state package.
     */
    reused_layer_state: boolean;
    /**
     * Texture bind groups created while preparing this frame.
     */
    texture_bind_groups_created: number;
    /**
     * Whether this frame reused a cached texture binding group.
     */
    texture_binding_cache_hit: boolean;
    /**
     * Whether the frame bytes were read back synchronously or skipped.
     */
    readback_mode: FrameReadbackMode;
};
