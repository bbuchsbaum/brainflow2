/**
 * Metadata for 4D time series
 */
export type TimeSeriesInfo = {
    /**
     * Number of time points in the series
     */
    num_timepoints: number;
    /**
     * Repetition time in seconds (if available)
     */
    tr: number | null;
    /**
     * Time unit (e.g., "seconds", "milliseconds")
     */
    temporal_unit: string | null;
    /**
     * Total acquisition time in seconds
     */
    acquisition_time: number | null;
};
