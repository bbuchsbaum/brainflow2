import type { RemoteCacheFolderUsage } from "./RemoteCacheFolderUsage";
/**
 * Disk used by downloaded remote files.
 */
export type RemoteCacheUsage = {
    total_bytes: number;
    budget_bytes: number;
    /**
     * Whether the budget comes from BRAINFLOW_REMOTE_CACHE_BYTES (then it
     * cannot be changed from the app).
     */
    budget_from_env: boolean;
    folders: Array<RemoteCacheFolderUsage>;
};
