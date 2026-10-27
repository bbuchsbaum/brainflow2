import { useLayerStore } from '@/stores/layerStore';
import { useComparisonStore } from '@/stores/comparisonStore';
import { isInferredStatistic, statisticUnits } from '@/utils/statistic';
import { shortLayerLabel } from '@/components/views/viewportFrame/frameFormat';

/**
 * Layers that share a window with `layerId` in Compare (v4 fidelity critic):
 * the SAME statistic, df included ("t(24)" with "t(24)", not "t(12)"), both
 * declared in the file (a name-guessed "z*" never shares with a declared z),
 * and shown in this comparison's panels. A layer some panel gives its own
 * window is left alone and reported in `held` ("panel B: zmap_2").
 */
export function sameStatisticLayerIds(
  layerId: string,
  workspaceId: string | null,
): { ids: string[]; held: string[] } {
  const { layers, layerMetadata } = useLayerStore.getState();
  const unitsOf = (id: string) => {
    const layer = layers.find((l) => l.id === id);
    if (!layer?.statistic || isInferredStatistic(layer.statistic)) return null;
    return statisticUnits(layer.statistic, layerMetadata.get(id)?.dataRange);
  };
  const units = unitsOf(layerId);
  if (!units || !workspaceId) return { ids: [], held: [] };
  const panels = useComparisonStore.getState().panels.get(workspaceId) ?? [];
  const shown = new Set(panels.flatMap((p) => [...p.visibleLayerIds]));
  const ids: string[] = [];
  const held: string[] = [];
  for (const l of layers) {
    if (l.id === layerId || !shown.has(l.id) || unitsOf(l.id) !== units) continue;
    const holder = panels.find((p) => p.renderOverrides?.[l.id]?.intensity !== undefined);
    if (holder) held.push(`${shortLayerLabel(l.name)} (${holder.label})`);
    else ids.push(l.id);
  }
  return { ids, held };
}
