import type { SegmentationLabelDefinition } from "./SegmentationLabelDefinition";
export type SegmentationLabelStatus = {
    definition: SegmentationLabelDefinition;
    locked: boolean;
    complete: boolean;
    voxels: number;
    mm3: number;
    sliceVoxels: Array<number>;
};
