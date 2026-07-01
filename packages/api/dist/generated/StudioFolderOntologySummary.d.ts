import type { StudioFolderOntologyCandidate } from "./StudioFolderOntologyCandidate";
import type { StudioFolderOntologyWarning } from "./StudioFolderOntologyWarning";
export type StudioFolderOntologySummary = {
    root: string;
    rootExists: boolean;
    sourceLabel?: string | null;
    scannedFiles: number;
    neuroimagingFiles: number;
    truncated: boolean;
    candidates: Array<StudioFolderOntologyCandidate>;
    warnings: Array<StudioFolderOntologyWarning>;
};
