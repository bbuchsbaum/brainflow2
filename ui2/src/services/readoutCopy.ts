/**
 * "Copy values at crosshair" (P3.6, v1 user critique): one TSV line per
 * visible volume layer, top of the stack first, with the crosshair's world
 * mm and voxel index on the reference grid, the value and its meaning
 * (statistic label, or the region name for label maps). ASCII minus.
 */
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { sampleLayerValue } from '@/hooks/useLayerValueAtWorld';
import { formatRegionLabel } from './atlasRegionLookup';
import { statisticUnits } from '@/utils/statistic';
import { resolveVoxelGridReference, voxelIndexInBounds, worldToVoxelIndex } from '@/utils/voxelSnap';
import { getEventBus } from '@/events/EventBus';

export async function valuesAtCrosshairTsv(): Promise<string> {
  const viewState = useViewStateStore.getState().viewState;
  const { layers, layerMetadata } = useLayerStore.getState();
  const world = viewState.crosshair.world_mm;
  const reference = resolveVoxelGridReference(layers, layerMetadata);
  const index = reference ? worldToVoxelIndex([world[0], world[1], world[2]], reference) : null;
  const ijk = index && voxelIndexInBounds(index, reference?.dims) ? index : null;
  const visible = [...viewState.layers].reverse().filter((l) => l.visible && l.volumeId);
  const rows = await Promise.all(
    visible.map(async (viewLayer) => {
      const layer = layers.find((l) => l.id === viewLayer.id);
      const value = await sampleLayerValue(viewLayer.id, [world[0], world[1], world[2]], layer?.currentTimepoint ?? 0);
      let meaning = statisticUnits(layer?.statistic, layerMetadata.get(viewLayer.id)?.dataRange) ?? '';
      if (value !== null && layer?.type === 'label' && layer.atlasPaletteLegend?.length) {
        const entry = layer.atlasPaletteLegend.find((e) => e.label_id === Math.round(value));
        meaning = entry ? formatRegionLabel(entry) : '';
      }
      return [
        layer?.name ?? viewLayer.name,
        ...world.map((v) => v.toFixed(1)),
        ...(ijk ? ijk.map(String) : ['', '', '']),
        value === null ? '' : String(Number(value.toFixed(6))),
        meaning,
      ].join('\t');
    }),
  );
  const header = ['layer', 'x_mm', 'y_mm', 'z_mm', 'i', 'j', 'k', 'value', 'statistic_or_region'].join('\t');
  return [header, ...rows].join('\n').replace(/−/g, '-') + '\n';
}

export async function copyValuesAtCrosshair(): Promise<void> {
  try {
    await navigator.clipboard.writeText(await valuesAtCrosshairTsv());
    getEventBus().emit('ui.notification', { type: 'info', message: 'Values at the crosshair copied (TSV)' });
  } catch {
    getEventBus().emit('ui.notification', { type: 'warning', message: 'Could not copy to the clipboard' });
  }
}
