/**
 * Why requested cluster-extent p values were not computed.
 */
export type ExtentWithheld = {
    /**
     * Error code the request would otherwise have failed with (4080).
     */
    code: number;
    /**
     * User-facing explanation.
     */
    reason: string;
};
