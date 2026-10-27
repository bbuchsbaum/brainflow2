/**
 * Region loci for series (phase 4 E2/E3):
 * - `region`: the atlas / label region at the crosshair (the active atlas
 *   layer's label there), `{ labelSource: { type: 'layer' }, labelIds: [id] }`;
 * - `cluster`: the cluster row selected in the Clusters tab, through the
 *   table's cluster-id label volume (compute_clusters `emitLabelVolume`),
 *   `{ labelSource: { type: 'volume', volumeId }, labelIds: [cluster id] }`.
 */
import type { RegionLocus } from '@brainflow/api';
import { formatRegionLabel, resolveAtlasRegionAtWorld } from '@/services/atlasRegionLookup';
import { useLayerStore } from '@/stores/layerStore';
import type { SeriesSettings } from '@/stores/seriesStore';
import { useClusterStore } from '@/stores/clusterStore';
import { shortLayerLabel } from '@/components/views/viewportFrame/frameFormat';

export type SeriesRegion = { region: RegionLocus; label: string } | { region: null; issue: string };

export async function regionAtCrosshair(world: readonly [number, number, number]): Promise<SeriesRegion> {
  const hit = await resolveAtlasRegionAtWorld([world[0], world[1], world[2]]);
  if (!hit) return { region: null, issue: 'No atlas or label region at the crosshair. Load a parcel atlas and move into a region.' };
  return {
    region: { labelSource: { type: 'layer', layerId: hit.layerId }, labelIds: [hit.labelId] },
    label: withAtlas(formatRegionLabel(hit.entry), hit.layerId),
  };
}

export function selectedClusterRegion(): SeriesRegion {
  const { result, selectedId } = useClusterStore.getState();
  if (!result || selectedId === null)
    return { region: null, issue: 'Compute clusters and select a row in the Clusters tab.' };
  const volumeId = result.table.labelVolumeId;
  if (!volumeId) return { region: null, issue: 'Compute the cluster table again to use its clusters as regions.' };
  return {
    region: { labelSource: { type: 'volume', volumeId }, labelIds: [selectedId] },
    label: `cluster ${selectedId} of ${shortLayerLabel(result.layerName)}`,
  };
}

/** A parcel picked from a label layer's legend. */
export function pickedRegion(layerId: string, labelId: number): SeriesRegion {
  const layer = useLayerStore.getState().layers.find((l) => l.id === layerId);
  const entry = layer?.atlasPaletteLegend?.find((e) => e.label_id === labelId);
  if (!layer || !entry) return { region: null, issue: 'The picked region is no longer available. Pick another.' };
  return {
    region: { labelSource: { type: 'layer', layerId }, labelIds: [labelId] },
    label: withAtlas(formatRegionLabel(entry), layerId),
  };
}

/** The region a series locus asks for (null for a voxel / sphere locus). */
export async function resolveSeriesRegion(
  settings: Pick<SeriesSettings, 'locus' | 'regionPick'>,
  world: readonly [number, number, number],
): Promise<SeriesRegion | null> {
  if (settings.locus === 'cluster') return selectedClusterRegion();
  if (settings.locus !== 'region') return null;
  return settings.regionPick
    ? pickedRegion(settings.regionPick.layerId, settings.regionPick.labelId)
    : regionAtCrosshair(world);
}

/** "L sensorimotor (atlas-synth3_dseg)": the region with its atlas (v0 fidelity: name the atlas). */
function withAtlas(region: string, layerId: string): string {
  const name = useLayerStore.getState().layers.find((l) => l.id === layerId)?.name;
  return name ? `${region} (${shortLayerLabel(name)})` : region;
}
