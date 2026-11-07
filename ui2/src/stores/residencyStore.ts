/**
 * residencyStore - the backend's residency report (R5b): what each layer's
 * residency is, which frames demand it, and why one was refused.
 *
 * Reports arrive as `residency-changed` events and from `get_residency_state`.
 * Every report carries the next `seq`: an older or equal one is dropped, and
 * a jump past the next one means an event was missed, so the store fetches
 * the current report.
 *
 * When the report's `owner` is `backend` (R5c, `BRAINFLOW_BACKEND_RESIDENCY`)
 * the backend decides admission and eviction. The store then keeps each
 * layer's `gpuResident` flag in step with the report, and raises one alert
 * when a layer becomes refused (again after it was drawn or its reason
 * changed), naming why.
 */

import { create } from 'zustand';
import type { ResidencyRefusal, ResidencyReport } from '@brainflow/api';
import { getTransport } from '@/services/transport';
import { safeListen, safeUnlisten } from '@/utils/eventUtils';
import { useLayerStore } from '@/stores/layerStore';
import { getEventBus } from '@/events/EventBus';

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

/** Whether the backend owns admission and eviction (R5c). */
export function backendOwnsResidency(): boolean {
  return useResidencyStore.getState().report?.owner === 'backend';
}

/** Why a layer is not drawn, for its alert. */
export function refusalMessage(
  name: string,
  refusal: ResidencyRefusal,
  bindingCapacity: number,
): string {
  switch (refusal) {
    case 'draw_cap':
      return `${name} is not drawn: a view draws at most ${bindingCapacity} layers.`;
    case 'front_exceeds_budget':
      return `${name} is not drawn: this tab's layers need more GPU memory than the budget allows.`;
    case 'held_by_pinned':
      return `${name} is not drawn: the GPU memory it needs is held by pinned layers (an open segmentation or Studio panes).`;
    case 'oversized_request':
      return `${name} is not drawn: it is larger than the whole GPU budget.`;
    case 'volume_missing':
      return `${name} is not drawn: its volume is no longer loaded.`;
    case 'upload_failed':
      return `${name} is not drawn: its upload to the GPU failed.`;
  }
}

/** The refusal each layer was last alerted for. */
const alerted = new Map<string, ResidencyRefusal>();

/** Keep the layer store in step with a backend-owned report. */
function syncLayers(report: ResidencyReport): void {
  const layers = useLayerStore.getState();
  for (const entry of report.layers) {
    const layer = layers.getLayer(entry.layer_id);
    if (!layer) continue;
    const metadata = layers.getLayerMetadata(entry.layer_id);
    const resident = entry.state === 'resident';
    const gone = entry.state === 'evicted' || entry.state === 'refused';
    if (metadata && (resident || gone) && metadata.gpuResident !== resident) {
      layers.setLayerMetadata(entry.layer_id, {
        ...metadata,
        gpuResident: resident,
        evicted: gone,
      });
    }
    if (entry.state === 'refused' && entry.refusal) {
      if (alerted.get(entry.layer_id) === entry.refusal) continue;
      alerted.set(entry.layer_id, entry.refusal);
      getEventBus().emit('ui.notification', {
        type: 'warning',
        message: refusalMessage(
          layer.name ?? entry.layer_id,
          entry.refusal,
          report.binding_capacity,
        ),
        subject: layer.name ?? entry.layer_id,
        alert: true,
        logSource: 'layer',
      });
    } else {
      alerted.delete(entry.layer_id);
    }
  }
}

export const useResidencyStore = create<ResidencyStoreState>()((set, get) => ({
  report: null,
  apply: (report, fetched = false) => {
    const current = get().report;
    if (current && report.seq <= current.seq) return;
    set({ report });
    if (report.owner === 'backend') syncLayers(report);
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

/** Test hook: forget which refusals were alerted. */
export function resetResidencyAlertsForTests(): void {
  alerted.clear();
}

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
