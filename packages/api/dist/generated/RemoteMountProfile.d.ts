/**
 * Saved remote connection profile metadata.
 */
export type RemoteMountProfile = {
    id: string;
    name: string;
    host: string;
    port: number;
    user: string;
    remote_path: string;
    auth_method: string;
    key_path: string | null;
    verify_host_key: boolean;
    accept_unknown_host_keys: boolean;
    known_hosts_path: string | null;
    has_password: boolean;
    has_key_passphrase: boolean;
    updated_at_ms: bigint;
};
