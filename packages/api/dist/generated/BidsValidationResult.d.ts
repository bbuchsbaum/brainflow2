import type { BidsValidationIssue } from "./BidsValidationIssue";
export type BidsValidationResult = {
    passed: boolean;
    critical_count: number;
    warning_count: number;
    issues: Array<BidsValidationIssue>;
};
