import type { BidsFdSummary } from "./BidsFdSummary";
import type { BidsFieldmapLink } from "./BidsFieldmapLink";
import type { BidsHeaderSummary } from "./BidsHeaderSummary";
import type { BidsIqms } from "./BidsIqms";
import type { BidsMetaValue } from "./BidsMetaValue";
/**
 * One image file of the raw dataset. Companions are not runs.
 */
export type BidsRunRecord = {
    /**
     * File stem including the BIDS suffix, e.g. `sub-01_ses-02_task-nback_run-1_bold`.
     */
    id: string;
    subject: string;
    session: string | null;
    datatype: string;
    suffix: string;
    task: string | null;
    acq: string | null;
    dir: string | null;
    run: string | null;
    echo: string | null;
    path: string;
    rel_path: string;
    size_bytes: number;
    /**
     * e.g. `task-nback_bold`, `T1w`, `epi_dir-AP`. Keeps acq/ce/rec/dir/echo apart.
     */
    series: string;
    /**
     * Effective acquisition metadata with provenance.
     */
    sidecar: Array<BidsMetaValue>;
    header: BidsHeaderSummary | null;
    /**
     * `None` is the modal acquisition of the series.
     */
    variant_id: string | null;
    fmap: BidsFieldmapLink | null;
    fd: BidsFdSummary | null;
    iqms: BidsIqms | null;
    has_events: boolean;
    /**
     * RFC 3339, UTC.
     */
    mtime: string | null;
};
