export type BidsDerivativeInfo = {
    name: string;
    version: string | null;
    source_version: string | null;
    stale: boolean;
    runs: number;
    of: number;
    /**
     * What `runs` and `of` count: `run` or `subject`.
     */
    unit: string;
    root: string;
};
