import type { AnalysisInput } from "./AnalysisInput";
/**
 * Request payload for starting an analysis job.
 */
export type AnalysisStartRequest = {
    analysis_id: string;
    inputs: Array<AnalysisInput>;
    params: any;
};
