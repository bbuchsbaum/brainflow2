/**
 * One panel-aware writer for a layer's window, threshold or colormap
 * (review R9). In an unlinked Compare, an edit goes to the active panel's own
 * override when the Inspector scope is that panel ("Panel A ·"), exactly as
 * the Inspector does; otherwise it changes the shared layer. The histogram
 * dock's drags and the viewport's window/level drag use it, so no writer
 * silently changes every panel while the Inspector says "Panel A".
 */
import { useComparisonStore } from '@/stores/comparisonStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { compareEditTarget, isFieldLinked } from '@/utils/compareDisplay';
import type { LayerRenderOverride, PanelOverrideField } from '@/types/comparison';

export function writeLayerDisplayField<F extends PanelOverrideField>(
  layerId: string,
  field: F,
  value: NonNullable<LayerRenderOverride[F]>,
): void {
  // The active comparison workspace's edit target (null outside Compare).
  const compare = compareEditTarget();
  if (compare && !isFieldLinked(compare.mode, field)) {
    const store = useComparisonStore.getState();
    if (compare.scope === 'panel') {
      store.setPanelOverride(compare.workspaceId, compare.panel.id, layerId, field, value as never);
      return;
    }
    // "Both": the shared value, and no panel keeps its own.
    store.clearPanelOverride(compare.workspaceId, null, layerId, field);
  }
  useViewStateStore.getState().setViewState((state) => {
    const layer = state.layers.find((l) => l.id === layerId);
    if (layer) (layer as unknown as Record<string, unknown>)[field] = value;
  });
}
