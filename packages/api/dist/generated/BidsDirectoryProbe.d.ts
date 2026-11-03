import type { BidsDirectoryStatus } from "./BidsDirectoryStatus";
/**
 * The answer to `probe_bids_directory`. `missing` names the root files the
 * spec requires or recommends that the folder lacks.
 */
export type BidsDirectoryProbe = {
    status: BidsDirectoryStatus;
    missing: Array<string>;
};
