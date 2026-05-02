import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayerStore } from '@/stores/layerStore';

const mockTransport = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@/services/transport', () => ({
  getTransport: () => mockTransport,
}));

import { sparklineProvider } from '../sparklineProvider';

describe('sparklineProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockTransport.invoke.mockReset();
    useLayerStore.setState({
      layers: [],
      selectedLayerId: null,
      layerMetadata: new Map(),
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('requests voxel timeseries through transport for 4D layers and returns sparkline SVG', async () => {
    useLayerStore.setState({
      layers: [
        {
          id: 'layer-4d',
          name: 'BOLD',
          volumeId: 'vol-4d',
          type: 'functional',
          visible: true,
          order: 0,
          timeSeriesInfo: {
            num_timepoints: 4,
            tr: 2,
            temporal_unit: 'seconds',
            acquisition_time: null,
          },
        },
      ],
      layerMetadata: new Map([
        [
          'layer-4d',
          {
            worldToVoxel: [
              1, 0, 0, 0,
              0, 1, 0, 0,
              0, 0, 1, 0,
              0, 0, 0, 1,
            ],
            dimensions: [8, 8, 8],
          },
        ],
      ]),
    });
    mockTransport.invoke.mockResolvedValue([0.5, 1.5, 1.0, 2.0]);

    const resultPromise = sparklineProvider.getInfo({
      worldCoord: [1, 2, 3],
      viewId: 'axial',
      screenPos: { x: 10, y: 12 },
      activeLayerId: 'layer-4d',
    });

    await vi.advanceTimersByTimeAsync(201);
    const result = await resultPromise;

    expect(mockTransport.invoke).toHaveBeenCalledWith('sample_voxel_timeseries', {
      volumeId: 'vol-4d',
      voxelX: 1,
      voxelY: 2,
      voxelZ: 3,
    });
    expect(result).toHaveLength(1);
    expect(result?.[0].label).toBe('Timeseries');
    expect(result?.[0].value).toContain('<svg');
  });

  it('skips transport for non-timeseries layers', async () => {
    useLayerStore.setState({
      layers: [
        {
          id: 'layer-3d',
          name: 'T1w',
          volumeId: 'vol-3d',
          type: 'anatomical',
          visible: true,
          order: 0,
        },
      ],
      layerMetadata: new Map([
        [
          'layer-3d',
          {
            worldToVoxel: [
              1, 0, 0, 0,
              0, 1, 0, 0,
              0, 0, 1, 0,
              0, 0, 0, 1,
            ],
            dimensions: [8, 8, 8],
          },
        ],
      ]),
    });

    const resultPromise = sparklineProvider.getInfo({
      worldCoord: [1, 2, 3],
      viewId: 'axial',
      screenPos: { x: 10, y: 12 },
      activeLayerId: 'layer-3d',
    });

    await vi.advanceTimersByTimeAsync(201);
    const result = await resultPromise;

    expect(result).toBeNull();
    expect(mockTransport.invoke).not.toHaveBeenCalled();
  });
});
