import type { ParcelOverlayInfo, ParcelTableRequest, ParcelTablePreview } from '@brainflow/api';
import { TauriTransport, type BackendTransport } from './transport';
import { getLayerService } from './LayerService';
import { useLayerStore, type LayerInfo } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import { getEventBus } from '@/events/EventBus';

export function parcelWindow(range: [number, number]): [number, number] {
  const [low, high] = range;
  if (low < 0) {
    const bound = Math.max(Math.abs(low), Math.abs(high));
    return [-bound, bound];
  }
  if (low < high) return [low, high];
  return high > 0 ? [0, high] : [-1, 1];
}

export class ParcelOverlayService {
  // Serializes mutations of each retained table so late replies cannot revert a column.
  private columnRequests = new Map<string, Promise<unknown>>();
  private transport: BackendTransport;
  constructor(transport: BackendTransport = new TauriTransport()) {
    this.transport = transport;
  }

  preview(request: ParcelTableRequest): Promise<ParcelTablePreview> {
    return this.transport.invoke('preview_parcel_table', { request });
  }

  async create(request: ParcelTableRequest, column: string, tableName: string): Promise<void> {
    const workspaceId = useViewStateStore.getState().activeWorkspaceKey;
    const info = await this.transport.invoke<ParcelOverlayInfo>('create_parcel_overlay', {
      request,
      column,
      tableName,
    });
    let published = false;
    try {
      const workspace = useViewStateStore.getState();
      if (workspaceId !== undefined && !workspace.workspaceViewStates.has(workspaceId)) {
        throw new Error('The destination workspace has closed');
      }
      if (!useLayerStore.getState().layers.some((l) => l.volumeId === request.sourceVolumeId)) {
        throw new Error('The source atlas has been removed');
      }
      const range = info.preview.columns.find((c) => c.name === column)?.range;
      if (!range) throw new Error('The selected column has no numeric values');
      useLayerStore.getState().setLayerMetadata(info.volumeId, {
        source: 'parcel-table',
        dataRange: { min: range[0], max: range[1] },
        renderProps: {
          intensity: parcelWindow(range),
          threshold: [0, 0],
          opacity: 1,
          colormap: range[0] < 0 ? 'fmri' : 'viridis',
          interpolation: 'nearest',
          layerMode: 'scalar',
        },
      });
      const layer: Omit<LayerInfo, 'id'> = {
        volumeId: info.volumeId,
        name: `${tableName} · ${column}`,
        type: 'functional',
        source: 'other',
        visible: true,
        order: useLayerStore.getState().layers.length,
        parcelOverlay: info,
      };
      await getLayerService().addLayer(
        layer,
        workspaceId === undefined ? undefined : { workspaceId },
      );
      published = true;
      useLayerStore.getState().setLayerMetadata(info.volumeId, {
        ...useLayerStore.getState().getLayerMetadata(info.volumeId),
        dataRange: { min: range[0], max: range[1] },
      });
      useInspectorSelectionStore.getState().setActive({
        id: info.volumeId,
        kind: 'volume-overlay',
        group: 'volume',
        name: layer.name,
        subtitle: 'parcel values',
        visible: true,
        opacity: 1,
        ref: { type: 'volume', layerId: info.volumeId },
      });
    } finally {
      if (!published) {
        useLayerStore.getState().removeLayer(info.volumeId);
        useLayerStore.getState().clearLayerMetadata?.(info.volumeId);
        await this.transport.invoke('unload_volume', { volumeId: info.volumeId });
      }
    }
  }

  selectColumn(layerId: string, column: string): Promise<void> {
    const task = (this.columnRequests.get(layerId) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const current = useLayerStore
          .getState()
          .layers.find((l) => l.id === layerId)?.parcelOverlay;
        if (!current || current.selectedColumn === column) return;
        const info = await this.transport.invoke<ParcelOverlayInfo>('select_parcel_column', {
          volumeId: current.volumeId,
          column,
        });
        if (!useLayerStore.getState().layers.some((l) => l.id === layerId)) return;
        const range = info.preview.columns.find((c) => c.name === column)?.range;
        if (!range) throw new Error('Column has no numeric range');
        const name = `${info.tableName} · ${column}`;
        useLayerStore.getState().updateLayer(layerId, { parcelOverlay: info, name });
        useLayerStore.getState().setLayerMetadata(layerId, {
          ...useLayerStore.getState().getLayerMetadata(layerId),
          dataRange: { min: range[0], max: range[1] },
        });
        const state = useViewStateStore.getState();
        // Layers have global identities; update every workspace that holds this handle.
        for (const [workspaceId, view] of state.workspaceViewStates) {
          if (!view.layers.some((l) => l.id === layerId)) continue;
          state.setViewState((draft) => {
            const layer = draft.layers.find((l) => l.id === layerId);
            if (layer) {
              layer.name = name;
              layer.intensity = parcelWindow(range);
              layer.threshold = [0, 0];
            }
          }, workspaceId);
        }
        getEventBus().emit('layer.render.changed', {
          layerId,
          renderProps: { intensity: parcelWindow(range), threshold: [0, 0] },
        });
      });
    this.columnRequests.set(layerId, task);
    void task
      .finally(() => {
        if (this.columnRequests.get(layerId) === task) this.columnRequests.delete(layerId);
      })
      .catch(() => {});
    return task;
  }
}
export const parcelOverlayService = new ParcelOverlayService();
