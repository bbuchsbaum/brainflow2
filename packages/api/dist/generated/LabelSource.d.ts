/**
 * Where the label volume of a region comes from.
 */
export type LabelSource = {
    "type": "layer";
    layerId: string;
} | {
    "type": "volume";
    volumeId: string;
} | {
    "type": "path";
    path: string;
    expectedSha256?: string | null;
};
