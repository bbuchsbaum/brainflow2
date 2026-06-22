import type { StudioExpressionKind } from "./StudioExpressionKind";
export type StudioFieldExpressionSummary = {
    id: string;
    label: string;
    kind: StudioExpressionKind;
    recipe: string;
    cohortId: string | null;
};
