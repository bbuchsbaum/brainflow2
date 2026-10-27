import type { SeriesAxisKind } from "./SeriesAxisKind";
export type StudioFolderOntologyFactor = {
    name: string;
    source: string;
    values: Array<string>;
    confidence: number;
    /**
     * Proposed series axis for this factor (a `lag-*`/`time-*` token or a
     * lag/time column whose values are all numeric).
     */
    seriesAxis?: SeriesAxisKind;
};
