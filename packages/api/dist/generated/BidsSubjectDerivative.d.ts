export type BidsSubjectDerivative = {
    subject: string;
    name: string;
    /**
     * `current`, `partial`, `missing`, `stale`, `no_local_data`, or
     * `unrecorded`: outputs exist but their source version does not say what
     * they were built from.
     */
    status: string;
};
