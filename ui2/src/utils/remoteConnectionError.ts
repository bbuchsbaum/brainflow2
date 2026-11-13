/**
 * Tells "the remote connection is down" apart from every other failure of a
 * load, a listing or a read on a remote (SSH) mount. One classifier for every
 * surface that offers Reconnect.
 *
 * Structured bridge codes come first: 8266 is the transport's own drop
 * (`map_remotely_error`, core/api_bridge/src/lib.rs), whatever operation met
 * it. The exact sentences stay as a fallback for failures that reach the UI
 * as text only.
 */
import { formatTauriError, tauriErrorCode } from './formatTauriError';

/**
 * Bridge codes that mean the mount serving a path is not usable:
 * - 8232: a path under the remote cache with no active mount (listing, card);
 * - 8252: `fetch_studio_sources`: no active mount, or its session is gone;
 * - 8262: the mount was unmounted or replaced while a card was being read;
 * - 8266: the SSH session or its transport ended under an operation
 *   (`REMOTE_SESSION_LOST_CODE`).
 */
export const REMOTE_CONNECTION_LOST_CODES: ReadonlySet<number> = new Set([
  8232, 8252, 8262, 8266,
]);

/**
 * The backend's sentences for the same state, for failures that reach the UI
 * as text only (an `Error` built from the message, a queue item's reason):
 * - "SSH session disconnected": `remotely::SshError::Disconnected`, shown as
 *   "SSH error: SSH session disconnected";
 * - "Remote mount is not active for '…'": the text of 8232;
 * - "The remote folder is not connected.": the text of 8252;
 * - "Remote mount … was unmounted or replaced while": the text of 8262;
 * - "Remote mount has been unmounted" / "Remote mount closed": a transfer
 *   whose mount went away under it (remote_transfer.rs, code 8218).
 */
const REMOTE_CONNECTION_LOST_TEXT: readonly RegExp[] = [
  /\bSSH session disconnected\b/,
  /\bRemote mount is not active for\b/,
  /\bThe remote folder is not connected\./,
  /\bRemote mount .* was unmounted or replaced while\b/,
  /\bRemote mount has been unmounted\b/,
  /\bRemote mount closed\b/,
];

function messagesOf(error: unknown, depth = 0): string[] {
  if (error == null || depth > 3) return [];
  if (typeof error === 'string') return [error];
  if (error instanceof Error) {
    return [error.message, ...messagesOf((error as Error & { cause?: unknown }).cause, depth + 1)];
  }
  return [formatTauriError(error)];
}

/** Whether `error` says the remote connection serving a path is down. */
export function isRemoteConnectionLost(error: unknown): boolean {
  if (error == null) return false;
  const code = tauriErrorCode(error);
  if (code !== null && REMOTE_CONNECTION_LOST_CODES.has(code)) return true;
  return messagesOf(error).some((message) =>
    REMOTE_CONNECTION_LOST_TEXT.some((pattern) => pattern.test(message)),
  );
}

/** `remotely`'s category prefixes: they name the layer, not the cause. */
const TRANSPORT_PREFIX = /^\s*(?:SSH error|Filesystem error|I\/O Error):\s*/i;

/** A failure's reason without the transport layer's "SSH error:" prefix. */
export function plainRemoteReason(message: string): string {
  let text = message.trim();
  while (TRANSPORT_PREFIX.test(text)) {
    const stripped = text.replace(TRANSPORT_PREFIX, '');
    if (!stripped) break;
    text = stripped;
  }
  return text;
}

/** What a lost connection is called, with the host when it is known. */
export function connectionLostTitle(host: string | null | undefined): string {
  return host
    ? `The connection to ${host} was lost`
    : 'The connection to the remote folder was lost';
}
