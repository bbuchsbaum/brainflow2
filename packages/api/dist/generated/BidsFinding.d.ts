export type BidsFinding = {
    /**
     * Stable across scans.
     */
    id: string;
    /**
     * `validator`, `content` or `note`.
     */
    tag: string;
    /**
     * `error`, `warning` or `info`.
     */
    severity: string;
    code: string;
    title: string;
    detail: string;
    subject: string | null;
    session: string | null;
    run_ids: Array<string>;
    file: string | null;
};
