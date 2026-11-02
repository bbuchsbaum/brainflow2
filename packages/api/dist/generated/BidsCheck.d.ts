export type BidsCheck = {
    ok: boolean;
    /**
     * `ok`, `warning` or `error`.
     */
    severity: string;
    text: string;
};
