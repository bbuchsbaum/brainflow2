import type { ParcelTablePreview } from "./ParcelTablePreview";
/**
 * Compact retained table; values are indexed by canonical parcel code, never row order.
 */
export type SurfaceParcelTable = {
    parcelIds: Array<number>;
    preview: ParcelTablePreview;
    columns: {
        [key in string]?: Array<number | null>;
    };
};
