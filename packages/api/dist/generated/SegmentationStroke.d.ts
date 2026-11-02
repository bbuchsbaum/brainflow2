import type { SegmentationOperation } from "./SegmentationOperation";
import type { SegmentationPaintOver } from "./SegmentationPaintOver";
import type { SegmentationTool } from "./SegmentationTool";
export type SegmentationStroke = {
    owner: SegmentationOperation;
    labelId: number;
    sliceIndex: number;
    tool: SegmentationTool;
    radiusMm: number;
    pointsWorld: Array<[number, number, number]>;
    paintOver: SegmentationPaintOver;
};
