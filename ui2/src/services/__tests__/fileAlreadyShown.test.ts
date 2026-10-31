import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));

import { fileAlreadyShown } from '../DisplayLifecycleOrchestrator';
import { useLayerStore, type LayerInfo } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';

describe('opening a file already shown (QA 2026-10-31: loaded 3× with no warning)', () => {
  it('is detected for the view that shows it', () => {
    useLayerStore.getState().clearLayers();
    useLayerStore.getState().addLayer({
      id: 't1',
      name: 'T1',
      volumeId: 't1',
      type: 'anatomical',
      visible: true,
      order: 0,
      sourcePath: '/d/T1w.nii.gz',
    } as LayerInfo);
    const key = useViewStateStore.getState().activeWorkspaceKey;
    useViewStateStore.getState().setViewState((state) => {
      state.layers = [{ id: 't1', name: 'T1', volumeId: 't1', visible: true, opacity: 1 } as never];
    });
    expect(fileAlreadyShown('/d/T1w.nii.gz', key)).toBe(true);
    expect(fileAlreadyShown('/d/other.nii.gz', key)).toBe(false);
    // Another workspace does not show it.
    expect(fileAlreadyShown('/d/T1w.nii.gz', 'elsewhere')).toBe(false);
    useLayerStore.getState().clearLayers();
  });
});
