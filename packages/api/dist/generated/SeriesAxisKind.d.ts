/**
 * Kind of a series axis: physical time, a lag (e.g. FIR bin), or a plain
 * index (frames, members) with no physical spacing.
 */
export type SeriesAxisKind = "time" | "lag" | "index";
