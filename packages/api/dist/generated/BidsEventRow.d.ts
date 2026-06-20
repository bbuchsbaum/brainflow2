export type BidsEventRow = {
    onset: number;
    duration: number;
    trial_type: string;
    additional: {
        [key in string]?: string;
    };
};
