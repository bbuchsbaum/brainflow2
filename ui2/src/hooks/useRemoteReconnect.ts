import { useCallback, useEffect, useRef, useState } from 'react';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { useRemoteConnectionStore } from '@/stores/remoteConnectionStore';
import {
  findRemoteMountFor,
  reconnectRemoteMount,
  type RemoteReconnectOutcome,
} from '@/services/RemoteReconnectService';

export interface RemoteReconnect {
  /** Local cache root of the remote mount that owns the path; null when none does. */
  root: string | null;
  /** The mount's host, as the user typed it ("trillium.alliancecan.ca"). */
  host: string | null;
  /** The mount is known to have no usable session. */
  down: boolean;
  /** A reconnect of this mount is running (started here or anywhere else). */
  reconnecting: boolean;
  /** Why the last reconnect started here did not work; null after a cancel. */
  failure: string | null;
  /** Sign in again. Resolves with how it ended; never rejects. */
  reconnect: () => Promise<RemoteReconnectOutcome>;
}

/**
 * The remote mount behind `path` (or a mount id) and the one way to sign in
 * to it again. `root` is null for a local path: offer no Reconnect then.
 */
export function useRemoteReconnect(path: string | null | undefined): RemoteReconnect {
  // Two primitives, not the mount object: the selectors must not allocate.
  const root = useFileBrowserStore((state) => findRemoteMountFor(path, state)?.root ?? null);
  const host = useFileBrowserStore(
    (state) => findRemoteMountFor(path, state)?.source.host ?? null,
  );
  const down = useRemoteConnectionStore((state) => (root ? Boolean(state.down[root]) : false));
  const reconnecting = useRemoteConnectionStore((state) =>
    root ? Boolean(state.reconnecting[root]) : false,
  );
  const [failure, setFailure] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => setFailure(null), [root]);

  const reconnect = useCallback(async () => {
    setFailure(null);
    const outcome = await reconnectRemoteMount(path);
    if (alive.current) setFailure(outcome.status === 'failed' ? outcome.message : null);
    return outcome;
  }, [path]);

  return { root, host, down, reconnecting, failure, reconnect };
}

/**
 * Try again, once, when the remote mount that owns `path` becomes active
 * again (a reconnect started anywhere, or a session that came back by
 * itself). `recover` runs only while `wanted` is true at that moment: a
 * surface that no longer shows the failure, shows another path, or is gone
 * does nothing. A mount other than the one owning `path` never triggers it.
 */
export function useRecoverOnReconnect(
  path: string | null | undefined,
  wanted: boolean,
  recover: () => void,
): void {
  const root = useFileBrowserStore((state) => findRemoteMountFor(path, state)?.root ?? null);
  const epoch = useRemoteConnectionStore((state) => (root ? (state.activeEpoch[root] ?? 0) : 0));
  const latest = useRef({ wanted, recover });
  latest.current = { wanted, recover };
  const seen = useRef({ root, epoch });
  useEffect(() => {
    const previous = seen.current;
    seen.current = { root, epoch };
    // A different mount's count is not this mount's reconnect.
    if (previous.root !== root || epoch <= previous.epoch) return;
    if (latest.current.wanted) latest.current.recover();
  }, [root, epoch]);
}
