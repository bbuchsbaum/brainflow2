import type { StudioImportCapability } from "./StudioImportCapability";
import type { StudioImportProvenanceKind } from "./StudioImportProvenanceKind";
import type { StudioImportReadiness } from "./StudioImportReadiness";
export type StudioImportContract = {
    readiness: StudioImportReadiness;
    provenanceKind: StudioImportProvenanceKind;
    provenanceLabel: string;
    canImport: boolean;
    capabilities: Array<StudioImportCapability>;
    reason: string;
};
