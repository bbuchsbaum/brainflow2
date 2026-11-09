/**
 * One remote folder's subfolders, for the remote folder picker.
 */
export type RemoteFolderListing = {
    /**
     * Absolute path that was listed.
     */
    path: string;
    /**
     * Its parent, or `None` at `/`.
     */
    parent: string | null;
    /**
     * Subfolder names, sorted.
     */
    folders: Array<string>;
};
