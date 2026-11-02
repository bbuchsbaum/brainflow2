import type { SegmentationSnapshot } from "./SegmentationSnapshot";
export type SegmentationSessionInfo = {
    snapshot: SegmentationSnapshot;
    labelVolumeId: string;
    paletteId: number | null;
    renderError: string | null;
};
