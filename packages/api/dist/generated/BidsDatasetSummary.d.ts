import type { BidsCoverageMatrix } from "./BidsCoverageMatrix";
import type { BidsParticipantRow } from "./BidsParticipantRow";
import type { BidsTaskDesign } from "./BidsTaskDesign";
import type { BidsValidationResult } from "./BidsValidationResult";
export type BidsDatasetSummary = {
    path: string;
    name: string;
    bids_version: string;
    license: string | null;
    authors: Array<string>;
    subject_count: number;
    session_ids: Array<string>;
    task_ids: Array<string>;
    modalities: Array<string>;
    total_file_count: number;
    total_size_bytes: bigint;
    coverage: BidsCoverageMatrix;
    participants: Array<BidsParticipantRow>;
    participant_columns: Array<string>;
    task_designs: Array<BidsTaskDesign>;
    validation: BidsValidationResult;
    storage_by_modality: {
        [key in string]?: bigint;
    };
};
