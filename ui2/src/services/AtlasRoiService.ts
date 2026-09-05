import type { AtlasRoiLocation } from '@brainflow/api';
import { TauriTransport, type BackendTransport } from './transport';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';

export class AtlasRoiService {
  private transport: BackendTransport;
  constructor(transport: BackendTransport = new TauriTransport()) {
    this.transport = transport;
  }
  locations(volumeId: string): Promise<AtlasRoiLocation[]> {
    return this.transport.invoke('get_atlas_roi_locations', { volumeId });
  }
  async focus(layerId: string, roi: AtlasRoiLocation): Promise<void> {
    if (!roi.worldMm) throw new Error('This ROI has no voxels in the loaded atlas image');
    const state = useViewStateStore.getState();
    if (
      !state.viewState.layers.some((l) => l.id === layerId) ||
      !useLayerStore.getState().layers.some((l) => l.id === layerId)
    )
      return;
    state.setCrosshairVisible(true);
    await state.setCrosshair(roi.worldMm, true, true, state.activeWorkspaceKey);
  }
}
export const atlasRoiService = new AtlasRoiService();
