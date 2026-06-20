export type BidsTaskDesign = {
    task: string;
    trial_types: Array<string>;
    avg_duration_secs: number;
    total_runs: number;
    events_per_type: {
        [key in string]?: number;
    };
};
