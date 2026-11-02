import type { BidsCheck } from "./BidsCheck";
export type BidsFieldmapLink = {
    source_id: string | null;
    fmap_run_ids: Array<string>;
    /**
     * `B0FieldSource`, `IntendedFor` or `none`.
     */
    via: string;
    checks: Array<BidsCheck>;
};
