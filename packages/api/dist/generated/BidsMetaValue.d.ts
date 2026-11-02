export type BidsMetaValue = {
    key: string;
    /**
     * JSON-encoded value.
     */
    value: string;
    /**
     * Relative path of the supplying file, or `NIfTI`.
     */
    source: string;
    /**
     * `run`, `dataset` or `nifti`.
     */
    source_kind: string;
};
