import type { StudioFieldBindingAvailability } from "./StudioFieldBindingAvailability";
import type { StudioSupportKind } from "./StudioSupportKind";
export type StudioFieldBindingSummary = {
    role: string;
    featureId: string | null;
    sourceLocator: string | null;
    sourcePath: string | null;
    relativePath: string | null;
    selector: string | null;
    supportKind: StudioSupportKind;
    supportLabel: string | null;
    availability: StudioFieldBindingAvailability;
    isPrimary: boolean;
};
