export type BidsValidationIssue = {
    severity: string;
    description: string;
    file: string | null;
    rule: string;
};
