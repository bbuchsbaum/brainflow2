/**
 * Execution backend for an analysis.
 * Runner-specific configuration lives in the host and is not part of the UI contract.
 */
export type AnalysisRunnerKind = {
    "type": "builtin";
} | {
    "type": "sidecar";
};
