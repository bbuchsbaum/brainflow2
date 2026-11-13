/**
 * A top-level description key the card has no field for.
 */
export type DatasetOtherField = {
    key: string;
    /**
     * The value as compact JSON, cut at a bounded length.
     */
    value: string;
    truncated: boolean;
};
