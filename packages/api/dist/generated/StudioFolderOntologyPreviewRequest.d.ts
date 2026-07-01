export type StudioFolderOntologyPreviewRequest = {
    root: string;
    maxDepth?: number | null;
    maxFiles?: number | null;
    includePatterns: Array<string>;
    excludePatterns: Array<string>;
};
