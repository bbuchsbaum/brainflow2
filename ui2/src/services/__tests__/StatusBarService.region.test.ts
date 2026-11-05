import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveRegion } = vi.hoisted(() => ({ resolveRegion: vi.fn() }));
vi.mock('@/services/atlasRegionLookup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/atlasRegionLookup')>()),
  resolveAtlasRegionAtWorld: resolveRegion,
}));

import { getStatusBarService } from '../StatusBarService';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import { useStatusReadoutStore } from '@/stores/statusReadoutStore';
import { useMouseCoordinateStore } from '@/stores/mouseCoordinateStore';
import { useStatusBarStore } from '@/stores/statusBarStore';
import { getEventBus } from '@/events/EventBus';
import type { AtlasStats } from '@/types/atlas';

const viewLayer = (id: string, name: string) => ({ id, name, visible: true }) as never;

describe('StatusBarService region slot', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resolveRegion.mockReset().mockResolvedValue(null);
    useInspectorSelectionStore.setState({ activeItemId: null, activeItemKind: null });
    useStatusReadoutStore.setState({ override: null });
    useLayerStore.setState({ selectedLayerId: 'olsen' });
    useViewStateStore.setState((s) => ({
      viewState: {
        ...s.viewState,
        layers: [viewLayer('t1', 'T1'), viewLayer('aseg', 'ASEG'), viewLayer('olsen', 'Olsen MTL')],
      },
    }));
  });

  afterEach(() => {
    getStatusBarService().cleanup();
    vi.useRealTimers();
  });

  it('looks the region up in the layer the Layer/Value slots report', async () => {
    getStatusBarService().initialize();
    await vi.advanceTimersByTimeAsync(100);
    expect(resolveRegion).toHaveBeenLastCalledWith(expect.any(Array), 'olsen');

    // Selecting another layer re-reads the region from it.
    useLayerStore.setState({ selectedLayerId: 'aseg' });
    await vi.advanceTimersByTimeAsync(100);
    expect(resolveRegion).toHaveBeenLastCalledWith(expect.any(Array), 'aseg');

    // A Compare pane's readout claim wins, as it does for Layer/Value.
    useStatusReadoutStore.getState().claim({ source: 'pane-a', layerId: 't1', name: 'T1' });
    await vi.advanceTimersByTimeAsync(100);
    expect(resolveRegion).toHaveBeenLastCalledWith(expect.any(Array), 't1');
  });

  describe('pointer region (status Pointer group)', () => {
    const entry = (roi: string) => ({ label_id: 1, roi, color: [10, 20, 30] as [number, number, number] });
    const hit = (roi: string) => ({ layerId: 'olsen', labelId: 1, entry: entry(roi) });
    const pointerRegion = () => useStatusBarStore.getState().values.pointerRegion ?? null;

    beforeEach(() => {
      // 2 mm atlas grid: voxel boundaries at odd mm.
      useLayerStore.setState({
        layers: [
          {
            id: 'olsen',
            name: 'Olsen MTL',
            volumeId: 'olsen',
            type: 'label',
            visible: true,
            order: 0,
            atlasPaletteLegend: [entry('L hippocampus')],
          },
        ] as never,
        layerMetadata: new Map([
          [
            'olsen',
            {
              voxelToWorld: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1],
              worldToVoxel: [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1],
              dimensions: [50, 50, 50],
            },
          ],
        ]) as never,
      });
      useMouseCoordinateStore.getState().clearMousePosition();
      useStatusBarStore.getState().setBatch([
        ['pointerRegion', null],
        ['pointerRegionColor', null],
      ]);
    });

    it('names the region under the pointer, for the reported layer', async () => {
      resolveRegion.mockResolvedValue(hit('L hippocampus'));
      getStatusBarService().initialize();
      useMouseCoordinateStore.getState().setMousePosition([10, 10, 10], 'axial');
      await vi.advanceTimersByTimeAsync(100);
      expect(resolveRegion).toHaveBeenCalledWith([10, 10, 10], 'olsen');
      expect(pointerRegion()).toBe('L hippocampus');
      expect(useStatusBarStore.getState().values.pointerRegionColor).toBe('rgb(10, 20, 30)');
    });

    it('blanks at once when the pointer leaves, and a late answer is dropped', async () => {
      let answer: (v: unknown) => void = () => {};
      resolveRegion.mockResolvedValueOnce(hit('L hippocampus'));
      getStatusBarService().initialize();
      useMouseCoordinateStore.getState().setMousePosition([10, 10, 10], 'axial');
      await vi.advanceTimersByTimeAsync(100);
      expect(pointerRegion()).toBe('L hippocampus');

      // Leaving clears synchronously.
      useMouseCoordinateStore.getState().clearMousePosition();
      expect(pointerRegion()).toBeNull();

      // A lookup still in flight when the pointer leaves never lands.
      resolveRegion.mockImplementationOnce(() => new Promise((r) => (answer = r)));
      await vi.advanceTimersByTimeAsync(100);
      useMouseCoordinateStore.getState().setMousePosition([20, 20, 20], 'axial');
      useMouseCoordinateStore.getState().clearMousePosition();
      answer(hit('L entorhinal'));
      await vi.advanceTimersByTimeAsync(100);
      expect(pointerRegion()).toBeNull();
    });

    it('moving to another voxel blanks the old region until the new one is known', async () => {
      resolveRegion.mockResolvedValue(hit('L hippocampus'));
      getStatusBarService().initialize();
      useMouseCoordinateStore.getState().setMousePosition([10, 10, 10], 'axial');
      await vi.advanceTimersByTimeAsync(100);
      expect(pointerRegion()).toBe('L hippocampus');

      // Same voxel (2 mm grid): the reading stays current.
      useMouseCoordinateStore.getState().setMousePosition([10.4, 10, 10], 'axial');
      expect(pointerRegion()).toBe('L hippocampus');

      // Another voxel: blank immediately, then the new answer.
      let answer: (v: unknown) => void = () => {};
      resolveRegion.mockImplementation(() => new Promise((r) => (answer = r)));
      useMouseCoordinateStore.getState().setMousePosition([30, 10, 10], 'axial');
      expect(pointerRegion()).toBeNull();
      await vi.advanceTimersByTimeAsync(100);
      answer(hit('L perirhinal'));
      await vi.advanceTimersByTimeAsync(0);
      expect(pointerRegion()).toBe('L perirhinal');
    });
  });
});

describe('StatusBarService binding diagnostics', () => {
  const atlasStats = (binding: Partial<AtlasStats> = {}) => ({
    totalLayers: 13,
    usedLayers: 2,
    freeLayers: 11,
    allocations: 2,
    releases: 0,
    highWatermark: 2,
    fullEvents: 0,
    is3D: true,
    ...binding,
  });

  beforeEach(() => {
    getStatusBarService().cleanup();
    useStatusBarStore.getState().removeValue('bindingGroupsPerFrame');
    useStatusBarStore.getState().removeValue('bindingCacheHits');
  });

  afterEach(() => getStatusBarService().cleanup());

  it('derives groups per frame and cache-hit rate from atlas.metrics', () => {
    getStatusBarService().initialize();
    getEventBus().emit('atlas.metrics', {
      stats: atlasStats({ bindingFrames: 3, bindingGroupsCreated: 1, bindingCacheHits: 2 }),
      timestamp: 1,
    });

    expect(useStatusBarStore.getState().values.bindingGroupsPerFrame).toBe('0.33 (3 frames)');
    expect(useStatusBarStore.getState().values.bindingCacheHits).toBe('67% (2/3)');
  });

  it('clears old binding metrics for zero-frame and older backend payloads', () => {
    getStatusBarService().initialize();
    const eventBus = getEventBus();
    eventBus.emit('atlas.metrics', {
      stats: atlasStats({ bindingFrames: 3, bindingGroupsCreated: 1, bindingCacheHits: 2 }),
      timestamp: 1,
    });
    eventBus.emit('atlas.metrics', {
      stats: atlasStats({ bindingFrames: 0, bindingGroupsCreated: 0, bindingCacheHits: 0 }),
      timestamp: 2,
    });
    expect(useStatusBarStore.getState().values.bindingGroupsPerFrame).toBeUndefined();
    expect(useStatusBarStore.getState().values.bindingCacheHits).toBeUndefined();

    eventBus.emit('atlas.metrics', {
      stats: atlasStats({ bindingFrames: 3, bindingGroupsCreated: 1, bindingCacheHits: 2 }),
      timestamp: 3,
    });
    eventBus.emit('atlas.metrics', { stats: atlasStats(), timestamp: 4 });
    expect(useStatusBarStore.getState().values.bindingGroupsPerFrame).toBeUndefined();
    expect(useStatusBarStore.getState().values.bindingCacheHits).toBeUndefined();
  });

  it('publishes byte residency and logical/draw capacities for Diagnostics', () => {
    getStatusBarService().initialize();
    getEventBus().emit('atlas.metrics', {
      stats: atlasStats({
        residentTextureBytes: 300 * 1024 * 1024,
        residencyBudgetBytes: 512 * 1024 * 1024,
        residentTextureSlots: 14,
        residentTextureLimit: 20,
        drawTextureCapacity: 13,
      }),
      timestamp: 1,
    });
    expect(useStatusBarStore.getState().values.residencyBytes).toBe('300 MiB / 512 MiB');
    expect(useStatusBarStore.getState().values.residentTextures).toBe('14 / 20');
    expect(useStatusBarStore.getState().values.drawTextureCapacity).toBe('13');
  });
});
