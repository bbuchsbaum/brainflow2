import type { ThresholdMode } from "./ThresholdMode";
/**
 * Threshold configuration.
 */
export type ThresholdConfig = {
    mode: ThresholdMode;
    range: [number, number];
};
