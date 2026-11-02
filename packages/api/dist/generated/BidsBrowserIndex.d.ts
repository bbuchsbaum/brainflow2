import type { BidsDerivativeInfo } from "./BidsDerivativeInfo";
import type { BidsExclusion } from "./BidsExclusion";
import type { BidsFinding } from "./BidsFinding";
import type { BidsParticipantRow } from "./BidsParticipantRow";
import type { BidsRunRecord } from "./BidsRunRecord";
import type { BidsSeriesModal } from "./BidsSeriesModal";
import type { BidsSubjectDerivative } from "./BidsSubjectDerivative";
import type { BidsVariantGroup } from "./BidsVariantGroup";
/**
 * Everything the BIDS browser knows about a dataset. Columns and counts are
 * derived from this in the UI model; the backend reports per-run facts.
 */
export type BidsBrowserIndex = {
    scan_id: string;
    dataset_path: string;
    name: string;
    bids_version: string;
    dataset_version: string | null;
    doi: string | null;
    license: string | null;
    authors: Array<string>;
    /**
     * Modal Manufacturer, ManufacturersModelName and field strength.
     */
    scanner: string | null;
    is_remote: boolean;
    /**
     * False when the scan was cancelled or superseded: results are partial.
     */
    complete: boolean;
    /**
     * True when every directory was walked: always for a local dataset, and
     * for a remote one when the server walk finished. Otherwise an absent file
     * is unknown, not missing.
     */
    listing_complete: boolean;
    default_author: string;
    previous_scan_at: string | null;
    new_subjects: Array<string>;
    total_file_count: number;
    total_size_bytes: number;
    /**
     * Files this scan has covered, of `total_file_count`. A complete scan
     * covers all of them, whether read or served from the stored index.
     */
    files_read: number;
    /**
     * Files actually opened; unchanged subjects are served from the index.
     */
    files_opened: number;
    /**
     * Sessions in acquisition order, from `acq_time` in sessions or scans
     * files. Empty when the dataset does not say.
     */
    session_order: Array<string>;
    participants: Array<BidsParticipantRow>;
    participant_columns: Array<string>;
    /**
     * Natural order, without the `sub-` prefix. Includes subjects found on
     * disk that participants.tsv does not list.
     */
    subjects: Array<string>;
    runs: Array<BidsRunRecord>;
    series_modal: Array<BidsSeriesModal>;
    variants: Array<BidsVariantGroup>;
    findings: Array<BidsFinding>;
    derivatives: Array<BidsDerivativeInfo>;
    derivative_status: Array<BidsSubjectDerivative>;
    exclusions: Array<BidsExclusion>;
    /**
     * `derivatives/brainflow/dataset_description.json` already exists.
     */
    exclusions_described: boolean;
};
