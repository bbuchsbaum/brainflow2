import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParcelOverlayInfo, ParcelTableRequest } from '@brainflow/api';
import { ParcelOverlayService, parcelWindow } from '../ParcelOverlayService';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getLayerService } from '../LayerService';
vi.mock('../LayerService', () => ({ getLayerService: vi.fn() }));
const request: ParcelTableRequest = {
  sourceVolumeId: 'atlas',
  text: 'id,beta',
  delimiter: ',',
  keyColumn: 'id',
  keyKind: 'id',
  hemisphereColumn: null,
  networkColumn: null,
  allowPartial: false,
};
const info: ParcelOverlayInfo = {
  volumeId: 'overlay',
  tableName: 'Stats',
  sourceVolumeId: 'atlas',
  selectedColumn: 'beta',
  preview: {
    atlasName: 'Test',
    atlasParcels: 2,
    headers: ['id', 'beta', 't'],
    rowCount: 2,
    matchedParcels: 2,
    missingParcels: 0,
    bindingError: null,
    keyExamples: [],
    dictionarySha256: 'dictionary',
    tableSha256: 'table',
    columns: [
      { name: 'beta', range: [-2, 0], finiteCount: 2, missingCount: 0, error: null },
      { name: 't', range: [-4, 8], finiteCount: 2, missingCount: 0, error: null },
    ],
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  useLayerStore.setState({
    layers: [
      { id: 'atlas', volumeId: 'atlas', name: 'Atlas', type: 'label', visible: true, order: 0 },
    ],
    layerMetadata: new Map(),
  });
});
describe('parcel overlays', () => {
  it('rolls back the provisional volume when the source disappears during import', async () => {
    const invoke = vi.fn().mockImplementation(async (command: string) => {
      if (command === 'create_parcel_overlay') {
        useLayerStore.setState({ layers: [] });
        return info;
      }
    });
    await expect(
      new ParcelOverlayService({ invoke }).create(request, 'beta', 'Stats'),
    ).rejects.toThrow('source atlas');
    expect(invoke).toHaveBeenLastCalledWith('unload_volume', { volumeId: 'overlay' });
    expect(useLayerStore.getState().layerMetadata.has('overlay')).toBe(false);
  });
  it('rolls back after GPU allocation failure', async () => {
    vi.mocked(getLayerService).mockReturnValue({
      addLayer: vi.fn().mockRejectedValue(new Error('GPU full')),
    } as never);
    const invoke = vi.fn().mockResolvedValue(info);
    await expect(
      new ParcelOverlayService({ invoke }).create(request, 'beta', 'Stats'),
    ).rejects.toThrow('GPU full');
    expect(invoke).toHaveBeenLastCalledWith('unload_volume', { volumeId: 'overlay' });
    expect(useLayerStore.getState().layerMetadata.has('overlay')).toBe(false);
  });
  it('updates the independent layer and numeric limits when the column changes', async () => {
    const key = useViewStateStore.getState().activeWorkspaceKey;
    const layer = {
      id: 'overlay',
      volumeId: 'overlay',
      name: 'Stats · beta',
      type: 'functional' as const,
      visible: true,
      order: 1,
      parcelOverlay: info,
    };
    useLayerStore.getState().addLayer(layer);
    useViewStateStore.getState().setViewState((s) => {
      s.layers = [
        {
          id: 'atlas',
          volumeId: 'atlas',
          name: 'Atlas',
          visible: true,
          opacity: 0.4,
          colormap: 'gray',
          intensity: [0, 7],
          threshold: [0, 0],
        },
        {
          id: 'overlay',
          volumeId: 'overlay',
          name: 'Stats · beta',
          visible: true,
          opacity: 0.7,
          colormap: 'fmri',
          intensity: [-2, 2],
          threshold: [-1, 1],
        },
      ];
    }, key);
    const invoke = vi.fn().mockResolvedValue({ ...info, selectedColumn: 't' });
    await new ParcelOverlayService({ invoke }).selectColumn('overlay', 't');
    const [atlas, overlay] = useViewStateStore.getState().viewState.layers;
    expect(atlas.opacity).toBe(0.4);
    expect(atlas.colormap).toBe('gray');
    expect(overlay.intensity).toEqual([-8, 8]);
    expect(overlay.threshold).toEqual([0, 0]);
    expect(overlay.opacity).toBe(0.7);
    expect(
      useLayerStore.getState().layers.find((l) => l.id === 'overlay')?.parcelOverlay
        ?.selectedColumn,
    ).toBe('t');
  });
  it('gives finite increasing windows for zero, constant and signed columns', () => {
    expect(parcelWindow([0, 0])).toEqual([-1, 1]);
    expect(parcelWindow([4, 4])).toEqual([0, 4]);
    expect(parcelWindow([-4, 8])).toEqual([-8, 8]);
  });
});
