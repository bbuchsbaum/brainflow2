/**
 * README text. It is text only; nothing here interprets it.
 */
export type DatasetReadme = {
    fileName: string;
    path: string;
    text: string;
    /**
     * The file is longer than the text returned.
     */
    truncated: boolean;
};
