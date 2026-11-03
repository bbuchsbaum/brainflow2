export type ReleaseResult = {
    success: boolean;
    message: string;
    /**
     * Whether this call freed a GPU texture slot (a live lease or mapping
     * was released). False for a no-op release and for non-GPU unloads.
     */
    freed: boolean;
};
