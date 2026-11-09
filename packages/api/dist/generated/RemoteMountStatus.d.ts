/**
 * Live connection state of a mounted remote folder.
 */
export type RemoteMountStatus = {
    mount_id: string;
    /**
     * "connected"; "reconnecting" (dropped, comes back on next use); or
     * "disconnected" (needs a new sign-in).
     */
    state: string;
    /**
     * Mounted folders sharing this mount's SSH session (including itself).
     */
    shared_session_mounts: number;
};
