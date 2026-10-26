import type { LoadedSurface } from '@/stores/surfaceStore';
import type { ColorbarLayer } from '../viewportFrame/ViewportColorbar';
import { shortLayerLabel } from '../viewportFrame/frameFormat';
import { inferStatisticFromName, statisticUnits } from '@/utils/statistic';

/** The overlay the colorbar describes: the topmost visible scalar data layer. */
export function surfaceColorbarLayer(
  surface: LoadedSurface | null | undefined,
): ColorbarLayer | null {
  if (!surface) return null;
  const layers = [...surface.layers.values()].filter(
    (l) => l.visible !== false && !l.rgba && !l.labels && !l.atlasConfig && l.values?.length > 0,
  );
  const top = layers[layers.length - 1];
  if (!top) return null;
  return {
    layerId: top.id,
    name: top.name,
    colormap: top.colormap,
    intensity: top.range,
    threshold: top.threshold ?? [0, 0],
    dataRange: { min: top.dataRange[0], max: top.dataRange[1] },
    // Statistic grammar like a volume colorbar: a z / t map named as one
    // ("lh.zstat1.func.gii") gets its symbol, marked as inferred ("z*").
    units: statisticUnits(inferStatisticFromName(top.name), {
      min: top.dataRange[0],
      max: top.dataRange[1],
    }),
    unitsFromName: !!inferStatisticFromName(top.name),
    nameLabel: shortLayerLabel(top.name),
  };
}


/** "0.75rem" / "36px" -> px (16 px per rem), for the frame's top inset. */
export function cssLengthPx(value: string | undefined): number {
  if (!value) return 0;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return 0;
  return value.trim().endsWith('rem') ? n * 16 : n;
}
