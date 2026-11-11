import { getApiService } from '@/services/apiService';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { StudioGridHeader } from './studioBackground';

/**
 * The header of the Studio member loaded from `sourcePath`: the grid facts
 * the background default is judged from (studioBackground.ts). Read from the
 * volume the active view already holds, so nothing is opened or downloaded;
 * null when that view has no layer of the path (the load failed, or has not
 * finished).
 */
export async function readMemberGridHeader(sourcePath: string): Promise<StudioGridHeader | null> {
  const path = sourcePath.trim();
  if (!path) return null;
  const inView = new Set(useViewStateStore.getState().viewState.layers.map((layer) => layer.id));
  const { layers, layerMetadata } = useLayerStore.getState();
  const layer = layers.find(
    (candidate) =>
      inView.has(candidate.id) &&
      (layerMetadata.get(candidate.id)?.sourcePath ?? candidate.sourcePath) === path,
  );
  if (!layer?.volumeId) return null;
  const info = await getApiService().getNiftiHeaderInfo(layer.volumeId);
  return {
    dims: info.dimensions,
    voxelToWorld: info.voxel_to_world,
    sformCode: info.sform_code,
    qformCode: info.qform_code,
  };
}
