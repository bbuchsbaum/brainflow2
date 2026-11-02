import type { ViewRectMm } from "./ViewRectMm";
export type SegmentationSlice = {
    revision: number;
    plane: ViewRectMm;
    labels: Array<[number, number, number, number]>;
    previousLabels: Array<[number, number, number, number]>;
    nextLabels: Array<[number, number, number, number]>;
};
