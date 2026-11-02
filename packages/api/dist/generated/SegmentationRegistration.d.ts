export type SegmentationRegistration = {
    "status": "aligned";
    confirmer: string;
    confirmedAtMs: number;
    transformHash: string;
    view: [number, number, number, number, number, number, number, number, number, number, number, number];
} | {
    "status": "withoutSecondary";
    reason: string;
};
