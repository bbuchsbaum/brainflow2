import type { RemoteMountOrigin } from "./RemoteMountOrigin";
/**
 * Mounted remote folder metadata returned after a successful SSH mount.
 */
export type RemoteMountInfo = {
    mount_id: string;
    local_path: string;
    display_name: string;
    origin: RemoteMountOrigin;
};
