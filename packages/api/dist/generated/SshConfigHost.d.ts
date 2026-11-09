/**
 * A concrete `Host` entry from the user's `~/.ssh/config`, offered as a
 * connection shortcut. Fields are what OpenSSH would use for that alias.
 */
export type SshConfigHost = {
    alias: string;
    host_name: string | null;
    user: string | null;
    port: number | null;
    /**
     * Set when the alias connects through a jump host (`ProxyJump`), which
     * remote mounts do not support yet.
     */
    proxy_jump: string | null;
};
