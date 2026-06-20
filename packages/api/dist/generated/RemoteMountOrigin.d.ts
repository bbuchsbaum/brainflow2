/**
 * Information about the remote origin backing a mounted folder.
 */
export type RemoteMountOrigin = {
    mount_id: string;
    host: string;
    port: number;
    user: string;
    remote_path: string;
    label: string;
};
