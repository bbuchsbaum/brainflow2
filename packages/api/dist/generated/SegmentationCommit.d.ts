import type { SegmentationPreview } from "./SegmentationPreview";
import type { SegmentationSessionInfo } from "./SegmentationSessionInfo";
export type SegmentationCommit = {
    session: SegmentationSessionInfo;
    preview: SegmentationPreview | null;
};
