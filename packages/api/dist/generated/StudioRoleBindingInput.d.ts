import type { StudioFieldBindingAvailability } from "./StudioFieldBindingAvailability";
import type { StudioSupportKind } from "./StudioSupportKind";
export type StudioRoleBindingInput = {
    memberId: string;
    role: string;
    featureId?: string | null;
    sourcePath?: string | null;
    supportKind: StudioSupportKind;
    supportLabel?: string | null;
    availability: StudioFieldBindingAvailability;
};
