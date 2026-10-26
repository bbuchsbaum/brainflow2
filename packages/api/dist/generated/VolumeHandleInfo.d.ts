import type { StatisticInfo } from "./StatisticInfo";
import type { TimeSeriesInfo } from "./TimeSeriesInfo";
import type { VolumeType } from "./VolumeType";
/**
 * Information about a loaded volume (supports both 3D and 4D)
 */
export type VolumeHandleInfo = {
    id: string;
    name: string;
    /**
     * Variable dimensions to support both 3D [x,y,z] and 4D [x,y,z,t]
     */
    dims: Array<number>;
    dtype: string;
    volume_type: VolumeType;
    /**
     * For 4D volumes: number of timepoints
     */
    num_timepoints: number | null;
    /**
     * For 4D volumes: current timepoint being displayed
     */
    current_timepoint: number | null;
    /**
     * Additional time series metadata (if applicable)
     */
    time_series_info: TimeSeriesInfo | null;
    /**
     * Statistic carried by the NIfTI header (intent code or an SPM-style
     * description). Absent for non-statistical images and non-NIfTI sources.
     */
    statistic?: StatisticInfo;
    /**
     * `true` when the NIfTI header declares a label map (`intent_code` 1002,
     * `NIFTI_INTENT_LABEL`); absent otherwise.
     */
    is_label_map?: boolean;
};
