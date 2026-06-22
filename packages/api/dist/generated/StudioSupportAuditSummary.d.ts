import type { StudioAlignmentClass } from "./StudioAlignmentClass";
import type { StudioAuditSeverity } from "./StudioAuditSeverity";
export type StudioSupportAuditSummary = {
    supportLabel: string;
    alignmentClass: StudioAlignmentClass;
    readyForCompare: boolean;
    severity: StudioAuditSeverity;
};
