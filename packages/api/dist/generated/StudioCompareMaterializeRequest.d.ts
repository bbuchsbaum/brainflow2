import type { StudioReducerSpec } from "./StudioReducerSpec";
import type { StudioRoleBindingInput } from "./StudioRoleBindingInput";
export type StudioCompareMaterializeRequest = {
    supportLabel: string;
    compareReady: boolean;
    forceRematerialize: boolean;
    activeMemberId: string | null;
    activeMemberSourcePath: string | null;
    cohortMemberSourcePaths: Array<string>;
    compareCohortId: string | null;
    compareCohortLabel: string | null;
    compareCohortMemberCount: number | null;
    activeExpressionLabel: string | null;
    activeExpressionRecipe: string | null;
    reducerSpecs?: Array<StudioReducerSpec> | null;
    activeMemberRoleBindings?: Array<StudioRoleBindingInput> | null;
    cohortMemberRoleBindings?: Array<StudioRoleBindingInput> | null;
};
