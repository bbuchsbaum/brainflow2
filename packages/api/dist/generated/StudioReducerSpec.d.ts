import type { StudioReducerKind } from "./StudioReducerKind";
export type StudioReducerSpec = {
    id: string;
    label: string;
    kind: StudioReducerKind;
    role: string;
    cohortId?: string | null;
    excludedMemberId?: string | null;
};
