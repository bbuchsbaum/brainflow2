import { useEffect, useMemo, useState } from 'react';
import { useStudioLayerId } from './useStudioLayerId';
import {
  useLoadingQueueStore,
  type LoadingQueueItem,
  type LoadingQueueState,
} from '@/stores/loadingQueueStore';
import { isRemoteConnectionLost, plainRemoteReason } from '@/utils/remoteConnectionError';

/** What a Studio view says while its member's image is still on the way. */
export interface StudioMemberLoad {
  name: string;
  /** One line: where the load is ("Downloading 12.3 / 80.0 MiB"). */
  stage: string;
  /** 0-100 while the stage reports a fraction; null when it does not. */
  progress: number | null;
}

/** What a Studio view says when its member's image could not be opened. */
export interface StudioMemberLoadFailure {
  name: string;
  /** Why, in the loader's words (without the transport's "SSH error:" prefix). */
  reason: string;
  /** The remote connection serving the file is down: reconnecting is the way on. */
  connectionLost: boolean;
}

/** Loads faster than this show no overlay: a cached member must not flash one. */
export const MEMBER_LOAD_REVEAL_MS = 150;

/**
 * The queued or active load of `sourcePath`, by reference: the queue keeps an
 * unchanged item's identity, so this selects without a new object per call.
 */
export function pendingLoadForPath(
  state: Pick<LoadingQueueState, 'queue' | 'activeLoads'>,
  sourcePath: string | null | undefined,
): LoadingQueueItem | null {
  const path = sourcePath?.trim();
  if (!path) return null;
  for (const item of state.activeLoads.values()) if (item.path === path) return item;
  return state.queue.find((item) => item.path === path) ?? null;
}

/**
 * The last finished load of `sourcePath` when it failed, by reference (see
 * {@link pendingLoadForPath}); null when the path's last load succeeded or
 * was cancelled, or it has none in the queue's history.
 */
export function failedLoadForPath(
  state: Pick<LoadingQueueState, 'completed'>,
  sourcePath: string | null | undefined,
): LoadingQueueItem | null {
  const path = sourcePath?.trim();
  if (!path) return null;
  for (let index = state.completed.length - 1; index >= 0; index -= 1) {
    const item = state.completed[index];
    if (item.path === path) return item.status === 'error' ? item : null;
  }
  return null;
}

export function describeMemberLoad(item: LoadingQueueItem): StudioMemberLoad {
  if (item.status === 'queued')
    return { name: item.displayName, stage: 'Waiting to open', progress: null };
  // A finished stage (a completed download, now decoding) has no fraction left.
  const fraction =
    item.progress !== undefined && item.progress < 100 ? Math.max(0, item.progress) : null;
  return { name: item.displayName, stage: item.stage?.trim() || 'Opening', progress: fraction };
}

/**
 * The load a Studio view is waiting on for `sourcePath`, or null: nothing is
 * loading, the member's layer is already there, or the load is too young to
 * be worth showing.
 */
export function useStudioMemberLoad(
  sourcePath: string | null | undefined,
): StudioMemberLoad | null {
  const item = useLoadingQueueStore((state) => pendingLoadForPath(state, sourcePath));
  const displayed = useStudioLayerId(sourcePath) !== null;
  const pendingId = item && !displayed ? item.id : null;
  const [revealedId, setRevealedId] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingId) return;
    const timer = setTimeout(() => setRevealedId(pendingId), MEMBER_LOAD_REVEAL_MS);
    return () => clearTimeout(timer);
  }, [pendingId]);
  return item && pendingId && revealedId === pendingId ? describeMemberLoad(item) : null;
}

/**
 * Why the image of `sourcePath` is not shown, when its last load failed:
 * null while it loads again (a retry), once its layer exists, or for another
 * member (the failure belongs to the path).
 */
export function useStudioMemberLoadFailure(
  sourcePath: string | null | undefined,
): StudioMemberLoadFailure | null {
  const failed = useLoadingQueueStore((state) => failedLoadForPath(state, sourcePath));
  const pending = useLoadingQueueStore((state) => pendingLoadForPath(state, sourcePath) !== null);
  const displayed = useStudioLayerId(sourcePath) !== null;
  return useMemo(
    () =>
      failed && !pending && !displayed
        ? {
            name: failed.displayName,
            reason:
              plainRemoteReason(failed.error?.message ?? '') || 'The image could not be read.',
            connectionLost: isRemoteConnectionLost(failed.error),
          }
        : null,
    [failed, pending, displayed],
  );
}
