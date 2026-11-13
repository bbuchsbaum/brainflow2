import type { DatasetAnalysis } from "./DatasetAnalysis";
import type { DatasetCardPhase } from "./DatasetCardPhase";
import type { DatasetContents } from "./DatasetContents";
import type { DatasetDescription } from "./DatasetDescription";
import type { DatasetReadme } from "./DatasetReadme";
/**
 * The answer to `get_dataset_card`.
 */
export type DatasetCard = {
    /**
     * How much of the card this is. A request for the descriptions is
     * answered with the full card when that is already known.
     */
    phase: DatasetCardPhase;
    path: string;
    folderName: string;
    hasDescription: boolean;
    /**
     * `None` when there is no description file or none of it parsed.
     */
    description: DatasetDescription | null;
    descriptionIssue: string | null;
    descriptionPath: string | null;
    /**
     * The description file's text, cut at a bounded length.
     */
    descriptionRaw: string | null;
    descriptionRawTruncated: boolean;
    readme: DatasetReadme | null;
    contents: DatasetContents;
    analyses: Array<DatasetAnalysis>;
    /**
     * The folder whose children `analyses` are: this one or its `derivatives/`.
     */
    analysesPath: string | null;
    analysesTruncated: boolean;
    /**
     * Every file whose content this card shows.
     */
    sourcePaths: Array<string>;
};
