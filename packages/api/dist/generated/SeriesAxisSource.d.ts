/**
 * Where a series axis lives in a NeuroTabs package.
 */
export type SeriesAxisSource = {
    "type": "observation_column";
    column: string;
} | {
    "type": "feature_axis";
    feature: string;
    axis: string;
    position: number;
};
