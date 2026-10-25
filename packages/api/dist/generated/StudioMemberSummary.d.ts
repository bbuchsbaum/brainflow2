import type { StudioFieldBindingSummary } from "./StudioFieldBindingSummary";
export type StudioMemberSummary = {
    id: string;
    /**
     * Complete imported metadata for this observation, independent of the UI preview.
     * None denotes a legacy record without a complete metadata snapshot.
     */
    designValues?: {
        [key in string]?: string;
    } | null;
    sourcePath: string | null;
    bindings?: Array<StudioFieldBindingSummary> | null;
};
