import type { FrameReadbackMode } from "./FrameReadbackMode";
/**
 * Options controlling how request_frame completes after GPU submission.
 */
export type FrameRequestOptions = {
    readback_mode: FrameReadbackMode;
};
