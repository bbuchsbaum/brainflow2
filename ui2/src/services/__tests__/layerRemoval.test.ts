import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRemoveLayer, mockEmit } = vi.hoisted(() => ({
  mockRemoveLayer: vi.fn(),
  mockEmit: vi.fn(),
}));

vi.mock('@/services/LayerService', () => ({
  getLayerService: () => ({ removeLayer: mockRemoveLayer }),
}));
vi.mock('@/events/EventBus', () => ({
  getEventBus: () => ({ emit: mockEmit, on: vi.fn(() => () => {}) }),
}));

import { neighbourAfterRemoval, removeLayerFromScene, selectedVolumeLayerId } from '../layerRemoval';
import { useLayerStore, type LayerInfo } from '@/stores/layerStore';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import { useLogStore } from '@/stores/logStore';

const layer = (id: string): LayerInfo =>
  ({ id, name: id, volumeId: id, type: 'anatomical', visible: true, order: 0 }) as LayerInfo;

describe('neighbourAfterRemoval', () => {
  it('prefers the next row, then the previous one', () => {
    expect(neighbourAfterRemoval(['a', 'b', 'c'], 'b')).toBe('c');
    expect(neighbourAfterRemoval(['a', 'b', 'c'], 'c')).toBe('b');
    expect(neighbourAfterRemoval(['a'], 'a')).toBeNull();
    expect(neighbourAfterRemoval(['a'], 'x')).toBeNull();
  });
});

describe('removeLayerFromScene', () => {
  beforeEach(() => {
    mockRemoveLayer.mockReset().mockResolvedValue(undefined);
    mockEmit.mockReset();
    useLayerStore.getState().clearLayers();
    ['a', 'b', 'c'].forEach((id) => useLayerStore.getState().addLayer(layer(id)));
    useInspectorSelectionStore.setState({ activeItemId: 'b', activeItemKind: 'volume-overlay' });
    useLayerStore.getState().selectLayer('b');
  });

  it('moves the selection to the neighbour before tearing the layer down', async () => {
    mockRemoveLayer.mockImplementation(async (id: string) => {
      // The neighbour is already selected when teardown starts.
      expect(useLayerStore.getState().selectedLayerId).toBe('c');
      useLayerStore.getState().removeLayer(id);
    });
    await expect(removeLayerFromScene('b')).resolves.toBe(true);
    expect(mockRemoveLayer).toHaveBeenCalledWith('b');
    expect(useInspectorSelectionStore.getState().activeItemId).toBe('c');
    expect(selectedVolumeLayerId()).toBe('c');
  });

  it('leaves the selection alone when another layer is removed', async () => {
    await removeLayerFromScene('a');
    expect(useInspectorSelectionStore.getState().activeItemId).toBe('b');
  });

  it('reports a failed removal', async () => {
    mockRemoveLayer.mockRejectedValue(new Error('backend gone'));
    await expect(removeLayerFromScene('c')).resolves.toBe(false);
    expect(mockEmit).toHaveBeenCalledWith(
      'ui.notification',
      expect.objectContaining({ type: 'error', message: expect.stringContaining('Could not remove c') }),
    );
  });

  it('logs the removed file by name, not by layer id', async () => {
    useLayerStore.getState().addLayer({
      ...layer('vol-123'),
      name: 'T1w',
      sourcePath: '/data/study/anat/T1w.nii.gz',
    } as LayerInfo);
    useLogStore.getState().clear();
    await removeLayerFromScene('vol-123');
    const messages = useLogStore.getState().entries.map((e) => e.message);
    expect(messages).toEqual(['Removed T1w.nii.gz']);
  });

  it('logs nothing when the removal fails', async () => {
    useLogStore.getState().clear();
    mockRemoveLayer.mockRejectedValue(new Error('backend gone'));
    await removeLayerFromScene('c');
    expect(useLogStore.getState().entries.some((e) => e.message.startsWith('Removed'))).toBe(false);
  });

  it('ignores an unknown layer', async () => {
    await expect(removeLayerFromScene('zz')).resolves.toBe(false);
    expect(mockRemoveLayer).not.toHaveBeenCalled();
  });

  it('gives the selection back when the removal fails (review W7)', async () => {
    mockRemoveLayer.mockRejectedValue(new Error('backend gone'));
    await removeLayerFromScene('b');
    expect(useInspectorSelectionStore.getState()).toMatchObject({ activeItemId: 'b', activeItemKind: 'volume-overlay' });
    expect(useLayerStore.getState().selectedLayerId).toBe('b');
  });

  it('does not take the Inspector when it shows something else (review W7)', async () => {
    useInspectorSelectionStore.setState({ activeItemId: 's1', activeItemKind: 'surface-geometry' });
    mockRemoveLayer.mockImplementation(async (id: string) => useLayerStore.getState().removeLayer(id));
    await removeLayerFromScene('b');
    expect(useInspectorSelectionStore.getState()).toMatchObject({ activeItemId: 's1', activeItemKind: 'surface-geometry' });
    expect(useLayerStore.getState().selectedLayerId).toBe('c');
  });
});

