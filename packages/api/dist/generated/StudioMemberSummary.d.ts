import type { StudioFieldBindingSummary } from "./StudioFieldBindingSummary";
export type StudioMemberSummary = {
    id: string;
    sourcePath: string | null;
    bindings?: Array<StudioFieldBindingSummary> | null;
};
