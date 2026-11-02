/**
 * CuBIDS-style acquisition group. Letters start at `A` per series; the modal
 * group has no entry.
 */
export type BidsVariantGroup = {
    id: string;
    series: string;
    name: string;
    diff: string;
    note: string;
    keys: Array<string>;
    run_ids: Array<string>;
};
