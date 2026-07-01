import type { StudioComparePaneSpec } from "./StudioComparePaneSpec";
import type { StudioMaterializationJobState } from "./StudioMaterializationJobState";
export type StudioMaterializationJobStatus = {
    jobId: string;
    state: StudioMaterializationJobState;
    startedAtMs: bigint | null;
    finishedAtMs: bigint | null;
    progress: number | null;
    message: string | null;
    result: Array<StudioComparePaneSpec> | null;
    error: string | null;
};
