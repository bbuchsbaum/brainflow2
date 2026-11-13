import { create } from 'zustand';

/**
 * Where the Set studio is with bringing a remote set's images into the local
 * cache, for the lenses that read every member together.
 *
 * - `idle`: nothing is being fetched and nothing is waiting on the user.
 * - `checking`: asking the server which of the images are already here.
 * - `fetching`: downloading; `done` of `total` images are here.
 * - `confirm`: the fetch is large (`bytes`); it has not started.
 * - `stopped`: the user stopped it. The images already fetched are kept.
 * - `failed`: it could not finish; `message` says why in plain words.
 */
export type StudioSourceFetchPhase =
  | 'idle'
  | 'checking'
  | 'fetching'
  | 'confirm'
  | 'stopped'
  | 'failed';

export interface StudioSourceFetchState {
  phase: StudioSourceFetchPhase;
  /** The host the images come from ("trillium.alliancecan.ca"). */
  mountLabel: string | null;
  done: number;
  total: number;
  /** Bytes still to fetch, when the server has said. */
  bytes: number;
  message: string | null;
  /**
   * Set with `failed` when the fetch failed because the remote connection was
   * lost: an image of the request, which names the mount to reconnect.
   */
  connectionLostPath?: string | null;
  /** Bumped whenever which images are known to be local changes. */
  revision: number;
  /** Bumped when the user asks to continue, retry or go ahead. */
  attempt: number;
  /**
   * The backend refused an image of this set as not fetched, or its folder as
   * not connected, though the Files panel shows no remote folder for it.
   */
  refused: boolean;
}

export const IDLE_STUDIO_SOURCE_FETCH: Omit<
  StudioSourceFetchState,
  'revision' | 'attempt' | 'refused'
> = {
  phase: 'idle',
  mountLabel: null,
  done: 0,
  total: 0,
  bytes: 0,
  message: null,
  connectionLostPath: null,
};

export const useStudioSourceFetchStore = create<StudioSourceFetchState>(() => ({
  ...IDLE_STUDIO_SOURCE_FETCH,
  revision: 0,
  attempt: 0,
  refused: false,
}));
