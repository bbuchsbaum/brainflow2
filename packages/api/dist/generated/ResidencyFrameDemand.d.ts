import type { ResidencyDemandedLayer } from "./ResidencyDemandedLayer";
import type { ResidencyPriority } from "./ResidencyPriority";
/**
 * A frame's whole demand, as the UI publishes it.
 */
export type ResidencyFrameDemand = {
    /**
     * Per-frame revision; must increase with every message for the frame.
     */
    epoch: number;
    priority: ResidencyPriority;
    /**
     * Layers the frame draws, bottom of the stack first.
     */
    layers: Array<ResidencyDemandedLayer>;
    /**
     * Hidden pinned layers kept resident without drawing.
     */
    held: Array<ResidencyDemandedLayer>;
};
