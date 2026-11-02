export type SegmentationPreview = {
    revision: number;
    written: Array<[number, number, number]>;
    blocked: Array<[number, number, number]>;
    blockedLabels: Array<number>;
};
