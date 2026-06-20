import type { AlphaModMode } from "./AlphaModMode";
/**
 * Intensity-modulated alpha configuration for a layer.
 *
 * When `mode != Off`, overlay opacity becomes a monotonic function of the
 * two-sided magnitude `|value - center|`, ramped from the threshold up to the
 * top of the visible intensity window. Weak supra-threshold voxels fade into
 * the background; strong voxels are opaque.
 */
export type AlphaModConfig = {
    mode: AlphaModMode;
    /**
     * Gamma exponent for the ramp (used when `mode == Gamma`).
     */
    gamma: number;
    /**
     * Center for the two-sided magnitude (0.0 for signed/diverging maps).
     */
    center: number;
};
