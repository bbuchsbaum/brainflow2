/**
 * Remove a volume layer from the scene at the user's request (layer context
 * menu, Delete in the Scene list, ⌘K, Files › Loaded › Unload).
 *
 * The selection moves to the neighbouring row first (the one after it, else
 * the one before), so the Inspector follows to a layer that still exists.
 * Teardown (GPU lease, volume registry, view state in every workspace,
 * frame box, comparison panels, clusters, histograms, label tables, series
 * windows) is `LayerService.removeLayer` → `LayerApiImpl.removeLayer` plus
 * the `layer.removed` listeners.
 */
import { getEventBus } from '@/events/EventBus';
import { getLayerService } from '@/services/LayerService';
import { useLayerStore } from '@/stores/layerStore';
import { focusVolumeLayer, useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import { formatTauriError } from '@/utils/formatTauriError';
import { addLogEntry } from '@/stores/logStore';
import { inspectorVolumeLayerId } from '@/utils/activeLayer';
import { sourceLabel } from '@/utils/logLabels';

/** The layer to select after `removedId` leaves `layerIds` (list order). */
export function neighbourAfterRemoval(
  layerIds: readonly string[],
  removedId: string,
): string | null {
  const index = layerIds.indexOf(removedId);
  if (index < 0) return null;
  return layerIds[index + 1] ?? layerIds[index - 1] ?? null;
}

/** The file a layer came from, for user-facing text ("Removed T1w.nii.gz"). */
export function layerFileLabel(layer: { id: string; name?: string; sourcePath?: string }): string {
  // An atlas or template by its name, not "atlas:olsen_mtl" (QA 2026-10-30 F40).
  return sourceLabel(layer.sourcePath, layer.name, layer.id);
}

export async function removeLayerFromScene(layerId: string): Promise<boolean> {
  const { layers, selectedLayerId } = useLayerStore.getState();
  const layer = layers.find((l) => l.id === layerId);
  if (!layer) return false;

  const inspector = useInspectorSelectionStore.getState();
  const before = {
    activeItemId: inspector.activeItemId,
    activeItemKind: inspector.activeItemKind,
    selectedLayerId,
  };
  const next = neighbourAfterRemoval(
    layers.map((l) => l.id),
    layerId,
  );
  if (before.activeItemId === layerId) {
    // The Inspector showed this volume: it follows to the neighbour.
    if (next) focusVolumeLayer(next);
    else {
      inspector.clear();
      useLayerStore.getState().selectLayer(null);
    }
  } else if (selectedLayerId === layerId) {
    // Only the layer selection pointed here; the Inspector (empty, a surface,
    // another volume) keeps what it shows.
    useLayerStore.getState().selectLayer(
      inspectorVolumeLayerId(before.activeItemId, before.activeItemKind) ?? next,
    );
  }

  try {
    await getLayerService().removeLayer(layerId);
    addLogEntry({ level: 'info', source: 'layer', message: `Removed ${layerFileLabel(layer)}` });
    return true;
  } catch (error) {
    // The layer is still there: give it back its selection.
    if (useLayerStore.getState().getLayer(layerId)) {
      // Layer selection first: its Inspector sync must not override the
      // Inspector item restored after it.
      useLayerStore.getState().selectLayer(before.selectedLayerId);
      useInspectorSelectionStore.setState({
        activeItemId: before.activeItemId,
        activeItemKind: before.activeItemKind,
      });
    }
    getEventBus().emit('ui.notification', {
      type: 'error',
      message: `Could not remove ${layer.name || layerId}. ${formatTauriError(error)}`,
    });
    return false;
  }
}

/** The active volume layer (Inspector item, else layer selection), if any. */
export function selectedVolumeLayerId(): string | null {
  const { activeItemId } = useInspectorSelectionStore.getState();
  const { layers, selectedLayerId } = useLayerStore.getState();
  for (const id of [activeItemId, selectedLayerId]) {
    if (id && layers.some((l) => l.id === id)) return id;
  }
  return null;
}
