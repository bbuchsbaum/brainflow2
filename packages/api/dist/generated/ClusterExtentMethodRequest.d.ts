import type { RftExtentRequest } from "./RftExtentRequest";
/**
 * Opt-in cluster-level inference, tagged by method id. Only `"rft-extent"`
 * is implemented; the id set lives in `neuro_inference::ClusterMethodId`.
 */
export type ClusterExtentMethodRequest = {
    "method": "rft-extent";
} & RftExtentRequest;
