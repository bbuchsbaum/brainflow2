import type { SegmentationIdentity } from "./SegmentationIdentity";
import type { SegmentationLabelDefinition } from "./SegmentationLabelDefinition";
import type { SegmentationRegistration } from "./SegmentationRegistration";
export type SegmentationSessionSetup = {
    workspaceId: string;
    workspaceInstance: string;
    referenceVolumeId: string;
    identity: SegmentationIdentity;
    normalAxis: number;
    labels: Array<SegmentationLabelDefinition>;
    secondaryVolumeId: string | null;
    registration: SegmentationRegistration | null;
};
