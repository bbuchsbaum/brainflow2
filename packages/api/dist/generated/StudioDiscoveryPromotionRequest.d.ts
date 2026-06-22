import type { StudioImportCandidate } from "./StudioImportCandidate";
export type StudioDiscoveryPromotionRequest = {
    candidate: StudioImportCandidate;
    outputDir?: string | null;
};
