import type { BidsExclusion } from "./BidsExclusion";
/**
 * The rows on disk after a write, and which of them it added.
 */
export type BidsExclusionWrite = {
    all: Array<BidsExclusion>;
    added: Array<BidsExclusion>;
};
