import type { StudioJoinAuditSummary } from "./StudioJoinAuditSummary";
import type { StudioSupportAuditSummary } from "./StudioSupportAuditSummary";
export type StudioIngestAuditSummary = {
    sourceLabel: string;
    join: StudioJoinAuditSummary;
    support: StudioSupportAuditSummary;
    notes: Array<string>;
};
