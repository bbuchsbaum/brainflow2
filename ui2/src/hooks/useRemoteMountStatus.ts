/**
 * Keeps `useRemoteMountStore.statuses` current while remote folders are
 * mounted: every 15 s, every 5 s while one is down, and on window focus
 * (e.g. after the laptop wakes).
 */
import { useEffect } from 'react';
import { getRemoteMountStatuses } from '@/services/RemoteMountService';
import { useRemoteMountStore } from '@/stores/remoteMountStore';

const HEALTHY_POLL_MS = 15_000;
const DEGRADED_POLL_MS = 5_000;

/** Fetch statuses now. */
export async function refreshRemoteMountStatuses(): Promise<void> {
  try {
    useRemoteMountStore.getState().setStatuses(await getRemoteMountStatuses());
  } catch {
    // Status is advisory; the next poll retries.
  }
}

export function useRemoteMountStatusPolling(remoteMountIds: string[]): void {
  const key = remoteMountIds.join('|');
  useEffect(() => {
    if (!key) {
      useRemoteMountStore.getState().setStatuses([]);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      await refreshRemoteMountStatuses();
      if (cancelled) return;
      const degraded = Object.values(useRemoteMountStore.getState().statuses).some(
        (status) => status.state !== 'connected'
      );
      timer = setTimeout(() => void poll(), degraded ? DEGRADED_POLL_MS : HEALTHY_POLL_MS);
    };
    const pollNow = () => {
      if (timer) clearTimeout(timer);
      void poll();
    };
    pollNow();
    window.addEventListener('focus', pollNow);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', pollNow);
    };
  }, [key]);
}
