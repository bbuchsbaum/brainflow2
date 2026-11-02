export type BidsHeaderSummary = {
    dim: Array<number>;
    pixdim: Array<number>;
    qform_code: number;
    sform_code: number;
    tr_seconds: number | null;
    n_volumes: number | null;
};
