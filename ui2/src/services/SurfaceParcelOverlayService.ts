import { nanoid } from 'nanoid';
import type { ParcelTablePreview, ParcelTableRequest, SurfaceParcelTable } from '@brainflow/api';
import { TauriTransport, type BackendTransport } from './transport';
import { parcelWindow } from './ParcelOverlayService';
import { useSurfaceStore, type SurfaceDataLayer } from '@/stores/surfaceStore';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';

export interface SurfaceParcelTarget {
  surfaceId: string;
  layerId: string;
  dictionaryId: string;
}
export interface SurfaceParcelOverlay {
  tableName: string;
  selectedColumn: string;
  table: SurfaceParcelTable;
  groupId: string;
  sourceLayerId: string;
  labelCodes: Uint32Array;
}

/** Codes are already attached to this mesh. No row ordering or mesh registration is inferred. */
export function scatterParcelValues(labels: Uint32Array, values: (number | null)[]): Float32Array {
  return Float32Array.from(labels, (code) => {
    if (code === 0) return NaN;
    if (code >= values.length)
      throw new Error(`Surface label ${code} is outside the atlas dictionary`);
    return values[code] ?? NaN;
  });
}

export class SurfaceParcelOverlayService {
  private transport: BackendTransport;
  constructor(transport: BackendTransport = new TauriTransport()) {
    this.transport = transport;
  }

  preview(target: SurfaceParcelTarget, request: ParcelTableRequest): Promise<ParcelTablePreview> {
    return this.transport.invoke('preview_surface_parcel_table', {
      dictionaryId: target.dictionaryId,
      request,
    });
  }

  async create(
    target: SurfaceParcelTarget,
    request: ParcelTableRequest,
    column: string,
    tableName: string,
  ): Promise<void> {
    const sources: { surfaceId: string; layer: SurfaceDataLayer; vertices: Float32Array }[] = [];
    for (const [surfaceId, surface] of useSurfaceStore.getState().surfaces) {
      for (const layer of surface.layers.values()) {
        if (
          layer.parcelDictionaryId === target.dictionaryId &&
          layer.labels &&
          !layer.parcelOverlay
        ) {
          sources.push({ surfaceId, layer, vertices: surface.geometry.vertices });
        }
      }
    }
    if (!sources.some((s) => s.surfaceId === target.surfaceId && s.layer.id === target.layerId)) {
      throw new Error('The source surface parcellation has been removed');
    }
    const table = await this.transport.invoke<SurfaceParcelTable>('bind_surface_parcel_table', {
      dictionaryId: target.dictionaryId,
      request,
    });
    if (table.preview.dictionarySha256 !== target.dictionaryId)
      throw new Error('The atlas dictionary changed');
    const range = table.preview.columns.find((c) => c.name === column && !c.error)?.range;
    const values = table.columns[column];
    if (!range || !values) throw new Error('Select a numeric column');
    const codes = new Set(table.parcelIds);
    for (const source of sources) {
      if (source.layer.labels!.length * 3 !== source.vertices.length)
        throw new Error('Surface geometry no longer matches its parcellation');
      for (const code of source.layer.labels!) {
        if (code !== 0 && !codes.has(code))
          throw new Error(`Surface code ${code} is not in this atlas dictionary`);
      }
    }
    const groupId = nanoid();
    // Prepare before publishing: a mismatched code or changed mesh cannot leave half an overlay.
    const overlays = sources.map((source) => ({
      ...source,
      overlay: {
        id: nanoid(),
        name: `${tableName} · ${column}`,
        visible: true,
        values: scatterParcelValues(source.layer.labels!, values),
        range: parcelWindow(range),
        dataRange: range,
        opacity: 1,
        threshold: [0, 0],
        colormap: range[0] < 0 ? 'coolwarm' : 'viridis',
        parcelOverlay: {
          tableName,
          selectedColumn: column,
          table,
          groupId,
          sourceLayerId: source.layer.id,
          labelCodes: source.layer.labels!,
        },
      } satisfies SurfaceDataLayer,
    }));
    useSurfaceStore.setState((state) => {
      for (const source of sources) {
        const surface = state.surfaces.get(source.surfaceId);
        const layer = surface?.layers.get(source.layer.id);
        if (
          surface?.geometry.vertices !== source.vertices ||
          layer?.labels !== source.layer.labels ||
          layer?.parcelDictionaryId !== target.dictionaryId
        ) {
          throw new Error('The source surface parcellation changed during import');
        }
      }
      const surfaces = new Map(state.surfaces);
      for (const { surfaceId, overlay } of overlays) {
        const surface = surfaces.get(surfaceId)!;
        surfaces.set(surfaceId, {
          ...surface,
          layers: new Map(surface.layers).set(overlay.id, overlay),
        });
      }
      return { surfaces };
    });
    const selected = overlays.find(
      (s) => s.surfaceId === target.surfaceId && s.layer.id === target.layerId,
    )!;
    useInspectorSelectionStore.getState().setActive({
      id: `${target.surfaceId}::${selected.overlay.id}`,
      kind: 'surface-overlay',
      group: 'surface',
      name: selected.overlay.name,
      subtitle: 'parcel values',
      visible: true,
      opacity: 1,
      ref: {
        type: 'surface-overlay',
        surfaceId: target.surfaceId,
        surfaceLayerId: selected.overlay.id,
      },
    });
  }

  async selectColumn(surfaceId: string, layerId: string, column: string): Promise<void> {
    const info = useSurfaceStore
      .getState()
      .surfaces.get(surfaceId)
      ?.layers.get(layerId)?.parcelOverlay;
    if (!info || info.selectedColumn === column) return;
    const range = info.table.preview.columns.find((c) => c.name === column && !c.error)?.range;
    const values = info.table.columns[column];
    if (!range || !values) throw new Error('Select a numeric column');
    useSurfaceStore.setState((state) => {
      const surfaces = new Map(state.surfaces);
      for (const [id, surface] of surfaces) {
        const layers = new Map(surface.layers);
        let changed = false;
        for (const [key, layer] of layers) {
          if (layer.parcelOverlay?.groupId !== info.groupId) continue;
          layers.set(key, {
            ...layer,
            name: `${info.tableName} · ${column}`,
            values: scatterParcelValues(layer.parcelOverlay.labelCodes, values),
            range: parcelWindow(range),
            dataRange: range,
            threshold: [0, 0],
            parcelOverlay: { ...layer.parcelOverlay, selectedColumn: column },
          });
          changed = true;
        }
        if (changed) surfaces.set(id, { ...surface, layers });
      }
      return { surfaces };
    });
  }
}
export const surfaceParcelOverlayService = new SurfaceParcelOverlayService();
