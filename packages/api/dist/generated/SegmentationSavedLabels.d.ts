export type SegmentationSavedLabels = {
    sessionId: string;
    revision: number;
    /**
     * Label-volume revision written; lock/complete changes do not move it.
     */
    labelRevision: number;
    labelPath: string;
    tablePath: string;
};
