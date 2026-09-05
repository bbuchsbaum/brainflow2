import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataLayer } from 'neurosurface';
import type { ParcelTableRequest, SurfaceParcelTable } from '@brainflow/api';
import { SurfaceParcelOverlayService, scatterParcelValues } from '../SurfaceParcelOverlayService';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
const request = {
  sourceVolumeId: '',
  text: '',
  delimiter: ',',
  keyColumn: 'id',
  keyKind: 'id',
  hemisphereColumn: null,
  networkColumn: null,
  allowPartial: false,
} satisfies ParcelTableRequest;
const table: SurfaceParcelTable = {
  parcelIds: [1, 2, 3],
  preview: {
    atlasName: 'Test',
    atlasParcels: 3,
    headers: ['id', 'linear', 'quadratic'],
    rowCount: 3,
    matchedParcels: 3,
    missingParcels: 0,
    bindingError: null,
    keyExamples: [],
    dictionarySha256: 'dict',
    tableSha256: 'hash',
    columns: [
      { name: 'linear', range: [-2, 0], finiteCount: 2, missingCount: 1, error: null },
      { name: 'quadratic', range: [0, 4], finiteCount: 3, missingCount: 0, error: null },
    ],
  },
  columns: { linear: [null, 0, -2, null], quadratic: [null, 0, 4, 1] },
};
const target = { surfaceId: 'lh', layerId: 'atlas', dictionaryId: 'dict' };
const overlays = () =>
  [...useSurfaceStore.getState().surfaces.values()].flatMap((s) =>
    [...s.layers.values()].filter((l) => l.parcelOverlay),
  );
beforeEach(() => {
  useSurfaceStore.setState({ surfaces: new Map() });
  for (const [id, labels] of [
    ['lh', [0, 2, 1]],
    ['rh', [3, 1, 0]],
  ] as const) {
    useSurfaceStore
      .getState()
      .addSurface({
        handle: id,
        name: id,
        visible: true,
        geometry: { vertices: new Float32Array(9), faces: new Uint32Array([0, 1, 2]) },
        layers: new Map(),
        metadata: { vertexCount: 3, faceCount: 1, path: 'test' },
      });
    useSurfaceStore
      .getState()
      .addDataLayer(id, {
        id: 'atlas',
        name: 'Atlas',
        labels: new Uint32Array(labels),
        values: new Float32Array(labels),
        parcelDictionaryId: 'dict',
        colormap: 'categorical',
        range: [0, 3],
        dataRange: [0, 3],
        opacity: 1,
      });
  }
});
describe('surface parcel values', () => {
  it('uses attached vertex codes, preserves zero and missing alpha through the actual surface DataLayer', () => {
    const values = scatterParcelValues(new Uint32Array([3, 0, 1, 2, 1]), table.columns.linear!);
    expect([...values]).toEqual([NaN, NaN, 0, -2, 0]);
    const data = new DataLayer('test', values, null, 'viridis', { range: [-2, 2] });
    const rgba = data.getRGBAData(5);
    expect([rgba[3], rgba[7], rgba[11], rgba[15], rgba[19]]).toEqual([0, 0, 1, 1, 1]);
    data.setThreshold([-1, 1]);
    expect(data.getRGBAData(5)[11]).toBe(0);
    expect(() => scatterParcelValues(new Uint32Array([20]), table.columns.linear!)).toThrow(
      'outside',
    );
  });
  it('creates and switches both hemispheres; overlay survives source removal and remains independent', async () => {
    const service = new SurfaceParcelOverlayService({ invoke: vi.fn().mockResolvedValue(table) });
    await service.create(target, request, 'linear', 'Stats');
    const first = overlays()[0];
    expect(overlays()).toHaveLength(2);
    expect([...first.values]).toEqual([NaN, -2, 0]);
    expect(useInspectorSelectionStore.getState().activeItemId).toBe(`lh::${first.id}`);
    await service.create(target, request, 'linear', 'Other');
    useSurfaceStore.getState().removeDataLayer('lh', 'atlas');
    await service.selectColumn('lh', first.id, 'quadratic');
    expect(overlays().filter((l) => l.parcelOverlay?.selectedColumn === 'quadratic')).toHaveLength(
      2,
    );
    expect(overlays().filter((l) => l.parcelOverlay?.selectedColumn === 'linear')).toHaveLength(2);
    expect(overlays().find((l) => l.id === first.id)?.values).toEqual(
      new Float32Array([NaN, 4, 0]),
    );
    useSurfaceStore.getState().removeSurface('rh');
    await service.selectColumn('lh', first.id, 'linear');
    expect(overlays()).toHaveLength(2);
  });
  it('publishes nothing if a source mesh changes while binding', async () => {
    const service = new SurfaceParcelOverlayService({
      invoke: vi.fn().mockImplementation(async () => {
        useSurfaceStore.getState().removeSurface('rh');
        return table;
      }),
    });
    await expect(service.create(target, request, 'linear', 'Stats')).rejects.toThrow('changed');
    expect(overlays()).toHaveLength(0);
  });
});
