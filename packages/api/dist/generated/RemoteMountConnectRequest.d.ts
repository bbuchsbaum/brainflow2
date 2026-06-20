/**
 * Input payload for starting a remote SSH mount flow.
 */
export type RemoteMountConnectRequest = {
    host: string;
    port: number | null;
    user: string;
    remote_path: string;
    auth_method: string | null;
    password: string | null;
    key_path: string | null;
    key_passphrase: string | null;
    verify_host_key: boolean | null;
    accept_unknown_host_keys: boolean | null;
    known_hosts_path: string | null;
    remember_password: boolean | null;
    save_profile: boolean | null;
    profile_name: string | null;
};
