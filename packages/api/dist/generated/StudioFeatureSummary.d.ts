import type { StudioSupportKind } from "./StudioSupportKind";
import type { StudioValueRole } from "./StudioValueRole";
export type StudioFeatureSummary = {
    valueRole?: StudioValueRole;
    units?: string;
    id: string;
    label: string;
    kind: StudioSupportKind;
};
