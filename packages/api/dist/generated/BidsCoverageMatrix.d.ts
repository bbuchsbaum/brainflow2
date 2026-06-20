import type { BidsCoverageCell } from "./BidsCoverageCell";
import type { BidsCoverageColumn } from "./BidsCoverageColumn";
export type BidsCoverageMatrix = {
    subjects: Array<string>;
    columns: Array<BidsCoverageColumn>;
    cells: Array<Array<BidsCoverageCell>>;
};
