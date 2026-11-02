import type { SegmentationSnapshot } from "./SegmentationSnapshot";
export type SegmentationSessionInfo = {
    snapshot: SegmentationSnapshot;
    labelVolumeId: string;
    /**
     * The 3D volume to display as the reference: the reference itself, or
     * a session-owned copy of the chosen frame of a 4D reference.
     */
    referenceDisplayVolumeId: string;
    secondaryDisplayVolumeId: string | null;
    paletteId: number | null;
    renderError: string | null;
};
