import type { StudioGeneratedNeuroTabsFile } from "./StudioGeneratedNeuroTabsFile";
import type { StudioImportCandidate } from "./StudioImportCandidate";
export type StudioDiscoveryPromotionResult = {
    datasetId: string;
    manifestPath?: string | null;
    files: Array<StudioGeneratedNeuroTabsFile>;
    preview?: StudioImportCandidate | null;
    message: string;
};
