import type { StudioAuditSeverity } from "./StudioAuditSeverity";
import type { StudioJoinIssueDetail } from "./StudioJoinIssueDetail";
export type StudioJoinAuditSummary = {
    matchedRows: number;
    unmatchedRows: number;
    duplicateKeys: number;
    severity: StudioAuditSeverity;
    issueDetails: Array<StudioJoinIssueDetail>;
};
