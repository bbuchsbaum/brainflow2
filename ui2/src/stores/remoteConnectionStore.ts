/**
 * What the UI knows about the SSH sessions behind its remote mounts, keyed by
 * a mount's local cache root (stable across reconnects; the mount id is not).
 *
 * The backend sends no "session dropped" event, so `down` is learned from the
 * first failure a surface sees (`isRemoteConnectionLost`). `activeEpoch` is
 * the "mount became active" signal: it grows each time a mount is confirmed
 * usable again, and surfaces that failed for this reason try again once per
 * step (`useRecoverOnReconnect`). Only `RemoteReconnectService` writes it.
 */
import { create } from 'zustand';
import type { RemoteMountTarget } from '@/services/RemoteMountService';

export interface RemoteReconnectRequest {
  /** Local cache root of the mount being reconnected. */
  root: string;
  /** The folder to sign in to; the dialog finds its saved profile. */
  target: RemoteMountTarget;
}

interface RemoteConnectionState {
  down: Record<string, true>;
  reconnecting: Record<string, true>;
  activeEpoch: Record<string, number>;
  /** Sign-ins waiting for the dialog; the first one is on screen. */
  requests: RemoteReconnectRequest[];
  /** Mounted `RemoteReconnectHost`s: without one, nobody can show a prompt. */
  hosts: number;
}

export const useRemoteConnectionStore = create<RemoteConnectionState>()(() => ({
  down: {},
  reconnecting: {},
  activeEpoch: {},
  requests: [],
  hosts: 0,
}));

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

/** A failure showed that the mount at `root` has no usable session. */
export function markRemoteMountDown(root: string): void {
  useRemoteConnectionStore.setState((state) =>
    state.down[root] ? state : { down: { ...state.down, [root]: true } },
  );
}

/** The mount at `root` answered again: tell everything waiting on it, once. */
export function markRemoteMountActive(root: string): void {
  useRemoteConnectionStore.setState((state) => ({
    down: without(state.down, root),
    activeEpoch: { ...state.activeEpoch, [root]: (state.activeEpoch[root] ?? 0) + 1 },
  }));
}

/** Forget a mount that was removed from Files. */
export function forgetRemoteMount(root: string): void {
  useRemoteConnectionStore.setState((state) =>
    state.down[root] ? { down: without(state.down, root) } : state,
  );
}

export function setRemoteMountReconnecting(root: string, reconnecting: boolean): void {
  useRemoteConnectionStore.setState((state) => {
    if (Boolean(state.reconnecting[root]) === reconnecting) return state;
    return {
      reconnecting: reconnecting
        ? { ...state.reconnecting, [root]: true }
        : without(state.reconnecting, root),
    };
  });
}

export function resetRemoteConnectionStore(): void {
  useRemoteConnectionStore.setState({
    down: {},
    reconnecting: {},
    activeEpoch: {},
    requests: [],
    hosts: 0,
  });
}
