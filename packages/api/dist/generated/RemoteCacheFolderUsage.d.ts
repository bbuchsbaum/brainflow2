/**
 * Downloaded files for one remote folder.
 */
export type RemoteCacheFolderUsage = {
    /**
     * Set while the folder is mounted.
     */
    mount_id: string | null;
    /**
     * `user@host:/path` when known, else the cache directory name.
     */
    label: string;
    bytes: number;
    /**
     * Unix ms of the last use, if recorded.
     */
    last_used_ms: number | null;
};
