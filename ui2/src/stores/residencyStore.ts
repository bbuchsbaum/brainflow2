/**
 * residencyStore - the backend's residency report (R5b): what each layer's
 * residency is, which frames demand it, and why one was refused.
 *
 * Reports arrive as `residency-changed` events and from `get_residency_state`.
 * Every report carries the next `seq`: an older or equal one is dropped, and
 * a jump past the next one means an event was missed, so the store fetches
 * the current report.
 */

import { create } from 'zustand';
import type { ResidencyReport } from '@brainflow/api';
import { getTransport } from '@/services/transport';
import { safeListen, safeUnlisten } from '@/utils/eventUtils';

interface ResidencyStoreState {
  report: ResidencyReport | null;
  /**
   * Apply a report unless it is older than the one held. An event that skips
   * past the next `seq` means one was missed: fetch the current report. A
   * fetched report (`fetched`) never fetches again, since fetching takes a
   * `seq` of its own.
   */
  apply: (report: ResidencyReport, fetched?: boolean) => void;
  /** Fetch the current report. */
  refresh: () => Promise<void>;
}

export const useResidencyStore = create<ResidencyStoreState>()((set, get) => ({
  report: null,
  apply: (report, fetched = false) => {
    const current = get().report;
    if (current && report.seq <= current.seq) return;
    set({ report });
    if (!fetched && current && report.seq > current.seq + 1) void get().refresh();
  },
  refresh: async () => {
    try {
      const report = await getTransport().invoke<ResidencyReport | null>('get_residency_state');
      if (report) get().apply(report, true);
    } catch (error) {
      // Before the renderer starts there is nothing to report yet.
      console.debug('[residencyStore] get_residency_state failed:', error);
    }
  },
}));

let stopListening: (() => void) | null = null;

/** Follow `residency-changed` for the app's lifetime; idempotent. */
export function startResidencyStore(): () => void {
  if (stopListening) return stopListening;
  const off = safeListen<ResidencyReport>('residency-changed', (event) => {
    if (event?.payload) useResidencyStore.getState().apply(event.payload);
  });
  void useResidencyStore.getState().refresh();
  stopListening = () => {
    void safeUnlisten(off);
    stopListening = null;
  };
  return stopListening;
}
