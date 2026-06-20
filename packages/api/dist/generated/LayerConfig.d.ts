import type { AlphaModConfig } from "./AlphaModConfig";
import type { BlendMode } from "./BlendMode";
import type { InterpolationMode } from "./InterpolationMode";
import type { LayerMode } from "./LayerMode";
import type { ThresholdConfig } from "./ThresholdConfig";
/**
 * Configuration for a single layer.
 */
export type LayerConfig = {
    /**
     * Reference to the volume data.
     */
    volume_id: string;
    /**
     * Layer opacity [0.0 - 1.0].
     */
    opacity: number;
    /**
     * Colormap index.
     */
    colormap_id: number;
    /**
     * How to blend with layers below.
     */
    blend_mode: BlendMode;
    /**
     * Intensity window (min, max).
     */
    intensity_window: [number, number];
    /**
     * Optional threshold range.
     */
    threshold: ThresholdConfig | null;
    /**
     * Layer visibility.
     */
    visible: boolean;
    /**
     * Interpolation mode for sampling.
     */
    interpolation: InterpolationMode;
    /**
     * Rendering mode for shader-side layer semantics.
     */
    layer_mode: LayerMode;
    /**
     * Optional intensity-modulated alpha ("transparent thresholding").
     * `None` (or `mode == Off`) renders identically to a flat-opacity layer.
     */
    alpha_mod: AlphaModConfig | null;
};
