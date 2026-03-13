import type { AnalysisArtifact } from "./AnalysisArtifact";
import type { AnalysisJobState } from "./AnalysisJobState";
/**
 * Snapshot status for an analysis job.
 */
export type AnalysisJobStatus = {
    job_id: string;
    analysis_id: string;
    state: AnalysisJobState;
    /**
     * Epoch milliseconds.
     */
    started_at_ms: bigint | null;
    finished_at_ms: bigint | null;
    progress: number | null;
    message: string | null;
    artifacts: Array<AnalysisArtifact> | null;
    error: string | null;
};
