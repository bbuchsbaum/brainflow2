/**
 * When a workspace comes to the front, upload again the visible layers that
 * were evicted while it was behind (LayerEvictionService evicts layers shown
 * only in background tabs). Each upload goes through the ordinary GPU
 * promotion (`loadLayerData` → `ensureGpuResidentForLayer`), which makes
 * room first. A later switch supersedes the pass: its remaining layers are
 * left to the next front workspace's pass (AGENTS.md async ownership).
 */

import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import { getEventBus } from '@/events/EventBus';
import { getLayerService } from './LayerService';
import { layerEvictionService } from './LayerEvictionService';
import { gpuTextureSlotsFullLimit, gpuTextureSlotsFullMessage } from '@/utils/formatTauriError';

/** Re-upload the front workspace's evicted visible layers, one at a time. */
export async function ensureFrontWorkspaceResident(isCurrent: () => boolean): Promise<void> {
  for (const id of layerEvictionService.evictedFrontLayers()) {
    if (!isCurrent()) return;
    try {
      await getLayerService().loadLayerData(id);
    } catch (error) {
      if (!isCurrent()) return;
      const limit = gpuTextureSlotsFullLimit(error);
      if (limit === null) continue; // recorded on the layer by loadLayerData
      // Not a failure of the layer: the slots hold other tabs' pinned layers.
      useLayerStore.getState().setLayerError(id, null);
      const name = useLayerStore.getState().getLayer(id)?.name ?? id;
      getEventBus().emit('ui.notification', {
        type: 'warning',
        message: `Cannot draw ${name} in this tab: ${gpuTextureSlotsFullMessage(limit)}`,
        subject: name,
        alert: true,
        logSource: 'layer',
      });
      // Every later layer would meet the same full GPU.
      return;
    }
  }
}

let stopWatching: (() => void) | null = null;

/** Start watching the front workspace (once); returns the unsubscribe. */
export function startFrontWorkspaceResidency(): () => void {
  if (stopWatching) return stopWatching;
  let front = useViewStateStore.getState().activeWorkspaceKey;
  let generation = 0;
  const unsubscribe = useViewStateStore.subscribe((state) => {
    if (state.activeWorkspaceKey === front) return;
    front = state.activeWorkspaceKey;
    const run = (generation += 1);
    const key = front;
    const isCurrent = () =>
      run === generation && useViewStateStore.getState().activeWorkspaceKey === key;
    // After the switch's own store writes settle (never during a render).
    queueMicrotask(() => {
      if (!isCurrent()) return;
      void ensureFrontWorkspaceResident(isCurrent).catch((error) => {
        console.warn('[frontWorkspaceResidency] Could not restore evicted layers:', error);
      });
    });
  });
  stopWatching = () => {
    unsubscribe();
    stopWatching = null;
  };
  return stopWatching;
}
