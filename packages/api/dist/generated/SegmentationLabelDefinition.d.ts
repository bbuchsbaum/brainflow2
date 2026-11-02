export type SegmentationLabelDefinition = {
    id: number;
    name: string;
    abbreviation: string;
    color: [number, number, number];
    parent: number | null;
};
