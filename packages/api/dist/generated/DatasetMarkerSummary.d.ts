import type { DatasetPipelineRef } from "./DatasetPipelineRef";
/**
 * The hover summary of a folder that has a `dataset_description.json`.
 */
export type DatasetMarkerSummary = {
    name: string | null;
    datasetType: string | null;
    /**
     * The first `GeneratedBy` entry that has a name.
     */
    generatedBy: DatasetPipelineRef | null;
};
