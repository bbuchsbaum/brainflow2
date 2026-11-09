/**
 * residencyStore - the backend's residency report (R5b): what each layer's
 * residency is, which frames demand it, and why one was refused.
 *
 * Reports arrive as `residency-changed` events and from `get_residency_state`.
 * Every report carries the next `seq`: an older or equal one is dropped, and
 * a jump past the next one means an event was missed, so the store fetches
 * the current report.
 *
 * The backend decides admission and eviction (R6). The store keeps each
 * layer's `gpuResident` flag in step with the report, announces
 * `layer.gpu.ready` when the backend makes a layer resident (so the views
 * that left it out draw again), and raises one alert when a layer becomes
 * refused (again after it was drawn or its reason changed), naming why.
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

const residentCount = (report: ResidencyReport): number =>
  report.layers.filter((layer) => layer.state === 'resident').length;

/**
 * Whether `next` frees GPU room `prev` held: fewer bytes in use, or fewer
 * resident layers (fixed slots). Panes refused for want of room retry then.
 */
export function residencyFreed(
  prev: ResidencyReport | null,
  next: ResidencyReport | null,
): boolean {
  if (!prev || !next || next.seq <= prev.seq) return false;
  return next.used_bytes < prev.used_bytes || residentCount(next) < residentCount(prev);
}

/** Why layers are not drawn, for their alert; `names` holds at least one. */
export function refusalMessage(
  names: readonly string[],
  refusal: ResidencyRefusal,
  bindingCapacity: number,
): string {
  const who =
    names.length === 1 ? `${names[0]} is` : `${names[0]} and ${names.length - 1} more are`;
  switch (refusal) {
    case 'draw_cap':
      return `${who} not drawn: a view draws at most ${bindingCapacity} layers.`;
    case 'front_exceeds_budget':
      return `${who} not drawn: this tab's layers need more GPU memory than the budget allows.`;
    case 'held_by_pinned':
      return `${who} not drawn: the GPU memory needed is held by pinned layers (an open segmentation or Studio panes).`;
    case 'oversized_request':
      return `${who} not drawn: larger than the whole GPU budget.`;
    case 'volume_missing':
      return `${who} not drawn: the volume is no longer loaded.`;
    case 'upload_failed':
      return `${who} not drawn: the upload to the GPU failed.`;
  }
}

/**
 * Tab-and-reason pairs already alerted (`frame|refusal`). One alert per tab
 * and reason: switching tabs, or adding another layer past the same cap, does
 * not alert again; the row badge keeps showing which layers are not drawn.
 * A pair is forgotten when its tab closes (no layer lists the frame).
 */
const alerted = new Set<string>();

/** Keep the layer store in step with the backend's report. */
function syncLayers(report: ResidencyReport): void {
  const layers = useLayerStore.getState();
  // New alerts, by tab and reason, with the layers they name.
  const fresh = new Map<string, { refusal: ResidencyRefusal; names: string[] }>();
  const frames = new Set<string>();
  for (const entry of report.layers) {
    for (const frame of entry.frames) frames.add(frame);
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
      // Admitted by the backend (a frame's demand): nothing in the view state
      // changed, so the views that left it out draw again on this.
      if (resident) getEventBus().emit('layer.gpu.ready', { layerId: entry.layer_id });
    }
    if (entry.state !== 'refused' || !entry.refusal) continue;
    for (const frame of entry.frames) {
      const key = `${frame}|${entry.refusal}`;
      if (alerted.has(key)) continue;
      const group = fresh.get(key) ?? { refusal: entry.refusal, names: [] };
      group.names.push(layer.name ?? entry.layer_id);
      fresh.set(key, group);
    }
  }
  // Forget the pairs of tabs that closed.
  for (const key of [...alerted]) {
    if (!frames.has(key.slice(0, key.lastIndexOf('|')))) alerted.delete(key);
  }
  // One notification per reason, even when several tabs got it at once.
  const byRefusal = new Map<ResidencyRefusal, Set<string>>();
  for (const [key, group] of fresh) {
    alerted.add(key);
    const names = byRefusal.get(group.refusal) ?? new Set<string>();
    for (const name of group.names) names.add(name);
    byRefusal.set(group.refusal, names);
  }
  for (const [refusal, names] of byRefusal) {
    const list = [...names];
    getEventBus().emit('ui.notification', {
      type: 'warning',
      message: refusalMessage(list, refusal, report.binding_capacity),
      subject: list[0],
      alert: true,
      logSource: 'layer',
    });
  }
}

export const useResidencyStore = create<ResidencyStoreState>()((set, get) => ({
  report: null,
  apply: (report, fetched = false) => {
    const current = get().report;
    if (current && report.seq <= current.seq) return;
    set({ report });
    syncLayers(report);
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

/**
 * The backend's stale-lease watchdog released a layer nothing demanded: mark
 * it non-resident, so a later show asks for it again and nothing counts it
 * as held.
 */
export function noteBackendRelease(layerId: string): void {
  const store = useLayerStore.getState();
  const meta = store.getLayerMetadata(layerId);
  if (!meta || meta.gpuResident === false) return;
  store.setLayerMetadata(layerId, { ...meta, gpuResident: false, evicted: true });
}

/**
 * Follow `residency-changed` and the watchdog's `layer-gpu-released` for the
 * app's lifetime; idempotent.
 */
export function startResidencyStore(): () => void {
  if (stopListening) return stopListening;
  const off = safeListen<ResidencyReport>('residency-changed', (event) => {
    if (event?.payload) useResidencyStore.getState().apply(event.payload);
  });
  const offReleased = safeListen<{ layerId?: string }>('layer-gpu-released', (event) => {
    const layerId = event?.payload?.layerId;
    if (typeof layerId === 'string') noteBackendRelease(layerId);
  });
  void useResidencyStore.getState().refresh();
  stopListening = () => {
    void safeUnlisten(off);
    void safeUnlisten(offReleased);
    stopListening = null;
  };
  return stopListening;
}
