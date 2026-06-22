import type { StudioComparePaneBinding } from "./StudioComparePaneBinding";
import type { StudioComparePaneStatus } from "./StudioComparePaneStatus";
export type StudioComparePaneSpec = {
    id: string;
    title: string;
    subtitle: string;
    status: StudioComparePaneStatus;
    reason: string;
    recipe: string | null;
    binding: StudioComparePaneBinding | null;
};
