import type { RemoteAuthChallenge } from "./RemoteAuthChallenge";
import type { RemoteHostKeyChallenge } from "./RemoteHostKeyChallenge";
import type { RemoteMountInfo } from "./RemoteMountInfo";
/**
 * Result of a remote mount connection step.
 */
export type RemoteMountConnectResult = {
    "status": "connected";
    mount: RemoteMountInfo;
} | {
    "status": "need_host_key";
    challenge: RemoteHostKeyChallenge;
} | {
    "status": "need_auth";
    challenge: RemoteAuthChallenge;
};
