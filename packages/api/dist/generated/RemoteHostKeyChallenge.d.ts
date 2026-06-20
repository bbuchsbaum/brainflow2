/**
 * Host-key confirmation challenge details from interactive SSH connection flow.
 */
export type RemoteHostKeyChallenge = {
    challenge_id: string;
    host: string;
    port: number;
    algorithm: string;
    sha256_fingerprint: string;
    /**
     * "unknown" or "mismatch"
     */
    disposition: string;
};
