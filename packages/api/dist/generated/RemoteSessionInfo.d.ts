/**
 * A signed-in SSH session available for browsing remote folders.
 */
export type RemoteSessionInfo = {
    host: string;
    port: number;
    user: string;
    /**
     * The account's home directory on the server.
     */
    home: string;
};
