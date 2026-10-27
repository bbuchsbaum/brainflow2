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
import { useClusterStore } from '@/stores/clusterStore';
import { shortLayerLabel } from '@/components/views/viewportFrame/frameFormat';

export type SeriesRegion = { region: RegionLocus; label: string } | { region: null; issue: string };

export async function regionAtCrosshair(world: readonly [number, number, number]): Promise<SeriesRegion> {
  const hit = await resolveAtlasRegionAtWorld([world[0], world[1], world[2]]);
  if (!hit) return { region: null, issue: 'No atlas or label region at the crosshair. Load a parcel atlas and move into a region.' };
  return {
    region: { labelSource: { type: 'layer', layerId: hit.layerId }, labelIds: [hit.labelId] },
    label: formatRegionLabel(hit.entry),
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
