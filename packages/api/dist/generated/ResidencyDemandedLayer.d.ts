import type { ResidencyPin } from "./ResidencyPin";
/**
 * One layer of a frame's demand.
 */
export type ResidencyDemandedLayer = {
    layer_id: string;
    volume_id: string;
    pin: ResidencyPin | null;
};
