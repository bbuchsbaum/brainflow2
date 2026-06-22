import type { StudioCohortOriginKind } from "./StudioCohortOriginKind";
export type StudioCohortSummary = {
    id: string;
    label: string;
    memberCount: number;
    description: string;
    memberIds: Array<string>;
    originKind: StudioCohortOriginKind;
    originLabel: string | null;
};
