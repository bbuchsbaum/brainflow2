import type { BidsSliceImage } from "./BidsSliceImage";
export type BidsMedianSliceImage = {
    image: BidsSliceImage;
    runs_used: number;
    /**
     * Runs left out: different grid from the modal one, or unreadable.
     */
    runs_skipped: number;
};
