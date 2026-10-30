/**
 * Whether a newly loaded volume is selected when it is committed: only a
 * single user-opened load is (QA 2026-10-29 §5.2). A load that overlaps any
 * other volume, template or atlas load (a multi-file drop or dialog, a batch)
 * leaves the selection where it was, as do programmatic loads (which never
 * ask).
 */
import { useLoadingQueueStore, type LoadingQueueItem } from '@/stores/loadingQueueStore';

const VOLUME_LOADS: ReadonlySet<LoadingQueueItem['type']> = new Set(['volume-load', 'template', 'atlas']);

/** Another volume-producing load is queued or running. */
export function otherVolumeLoadsPending(excludeQueueId?: string | null): boolean {
  const { queue, activeLoads } = useLoadingQueueStore.getState();
  const pending = (item: LoadingQueueItem) =>
    item.id !== excludeQueueId &&
    VOLUME_LOADS.has(item.type) &&
    (item.status === 'queued' || item.status === 'loading');
  return queue.some(pending) || [...activeLoads.values()].some(pending);
}

/**
 * Tracks one load from now until `dispose`: `autoSelect()` is true at commit
 * only when no other volume load overlapped it at any point.
 */
export function trackSingleLoad(queueId?: string | null): {
  autoSelect: () => boolean;
  dispose: () => void;
} {
  let overlapped = otherVolumeLoadsPending(queueId);
  const unsubscribe = useLoadingQueueStore.subscribe(() => {
    if (!overlapped && otherVolumeLoadsPending(queueId)) overlapped = true;
  });
  return {
    autoSelect: () => !overlapped && !otherVolumeLoadsPending(queueId),
    dispose: unsubscribe,
  };
}
