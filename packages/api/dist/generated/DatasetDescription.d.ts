import type { DatasetGeneratedBy } from "./DatasetGeneratedBy";
import type { DatasetOtherField } from "./DatasetOtherField";
import type { DatasetSource } from "./DatasetSource";
/**
 * The standard fields of a `dataset_description.json`, as far as they parsed.
 */
export type DatasetDescription = {
    name: string | null;
    bidsVersion: string | null;
    datasetType: string | null;
    license: string | null;
    authors: Array<string>;
    acknowledgements: string | null;
    howToAcknowledge: string | null;
    funding: Array<string>;
    ethicsApprovals: Array<string>;
    referencesAndLinks: Array<string>;
    datasetDoi: string | null;
    /**
     * One entry per declared HED schema.
     */
    hedVersion: Array<string>;
    /**
     * The non-standard free-text `Description`, when a dataset has one.
     */
    description: string | null;
    generatedBy: Array<DatasetGeneratedBy>;
    sourceDatasets: Array<DatasetSource>;
    /**
     * Every other top-level key, in file order. A standard key whose value
     * has the wrong shape is kept here too, so nothing is hidden.
     */
    otherFields: Array<DatasetOtherField>;
};
