import { describe, it, expect, vi, beforeEach } from 'vitest';
import { intensityProvider } from '../intensityProvider';
import type { HoverContext } from '@/types/hoverInfo';
import * as SamplingService from '../../SamplingService';

vi.mock('../../SamplingService', () => ({
  sampleLayerAtWorld: vi.fn(),
}));

const mockSampleLayerAtWorld = SamplingService.sampleLayerAtWorld as ReturnType<typeof vi.fn>;

function createMockContext(overrides?: Partial<HoverContext>): HoverContext {
  return {
    worldCoord: [10, 20, 30],
    viewId: 'test-view',
    screenPos: { x: 100, y: 200 },
    activeLayerId: 'layer-1',
    ...overrides,
  };
}

describe('intensityProvider', () => {
  beforeEach(() => {
    mockSampleLayerAtWorld.mockReset();
  });

  describe('provider metadata', () => {
    it('has correct id', () => {
      expect(intensityProvider.id).toBe('intensity');
    });

    it('has correct displayName', () => {
      expect(intensityProvider.displayName).toBe('Intensity');
    });

    it('has priority after coordinates (20)', () => {
      expect(intensityProvider.priority).toBe(20);
    });
  });

  describe('getInfo', () => {
    it('returns null when no activeLayerId is provided', async () => {
      const ctx = createMockContext({ activeLayerId: undefined });

      const result = await intensityProvider.getInfo(ctx);

      expect(result).toBeNull();
      expect(mockSampleLayerAtWorld).not.toHaveBeenCalled();
    });

    it('calls sampleLayerAtWorld with correct parameters', async () => {
      mockSampleLayerAtWorld.mockResolvedValue({ value: 42.5 });
      const ctx = createMockContext({
        activeLayerId: 'my-layer',
        worldCoord: [1.5, 2.5, 3.5],
      });

      await intensityProvider.getInfo(ctx);

      expect(mockSampleLayerAtWorld).toHaveBeenCalledWith({
        layerId: 'my-layer',
        world: [1.5, 2.5, 3.5],
      });
    });

    it('returns formatted intensity value on success', async () => {
      mockSampleLayerAtWorld.mockResolvedValue({ value: 123.456789 });
      const ctx = createMockContext();

      const result = await intensityProvider.getInfo(ctx);

      expect(result).toEqual([
        {
          label: 'Value',
          value: '123.46', // formatLayerValue: 2 decimals, trailing zeros trimmed
          priority: 20,
          group: 'intensity',
        },
      ]);
    });

    it('returns null when sampling returns null value', async () => {
      mockSampleLayerAtWorld.mockResolvedValue({ value: null });
      const ctx = createMockContext();

      const result = await intensityProvider.getInfo(ctx);

      expect(result).toBeNull();
    });

    it('returns null when sampling returns error', async () => {
      mockSampleLayerAtWorld.mockResolvedValue({
        value: null,
        error: new Error('sampling failed'),
      });
      const ctx = createMockContext();

      const result = await intensityProvider.getInfo(ctx);

      expect(result).toBeNull();
    });

    it('handles zero value correctly', async () => {
      mockSampleLayerAtWorld.mockResolvedValue({ value: 0 });
      const ctx = createMockContext();

      const result = await intensityProvider.getInfo(ctx);

      expect(result).toEqual([
        {
          label: 'Value',
          value: '0',
          priority: 20,
          group: 'intensity',
        },
      ]);
    });

    it('handles negative values correctly', async () => {
      mockSampleLayerAtWorld.mockResolvedValue({ value: -5.123 });
      const ctx = createMockContext();

      const result = await intensityProvider.getInfo(ctx);

      expect(result).toEqual([
        {
          label: 'Value',
          value: '\u22125.12', // U+2212 minus
          priority: 20,
          group: 'intensity',
        },
      ]);
    });

    it('handles very small values correctly', async () => {
      mockSampleLayerAtWorld.mockResolvedValue({ value: 0.000001 });
      const ctx = createMockContext();

      const result = await intensityProvider.getInfo(ctx);

      expect(result).toEqual([
        {
          label: 'Value',
          value: '1.0e\u22126', // tiny values in exponent form, never a padded 0.000
          priority: 20,
          group: 'intensity',
        },
      ]);
    });

    it('handles very large values correctly', async () => {
      mockSampleLayerAtWorld.mockResolvedValue({ value: 12345678.9 });
      const ctx = createMockContext();

      const result = await intensityProvider.getInfo(ctx);

      expect(result).toEqual([
        {
          label: 'Value',
          value: '1.2e+7',
          priority: 20,
          group: 'intensity',
        },
      ]);
    });
  });

  it('names the sampled layer and puts its statistic symbol first', async () => {
    const { useLayerStore } = await import('@/stores/layerStore');
    useLayerStore.setState({
      layers: [
        {
          id: 'z',
          name: 'zmap_synthetic.nii.gz',
          volumeId: 'z',
          type: 'volume',
          visible: true,
          order: 0,
          statistic: {
            kind: 'z',
            intentCode: 5,
            intentParams: [0, 0, 0],
            intentName: '',
            dof: [],
            label: 'z',
            fromDescription: false,
            positiveDataLabel: null,
          },
        } as never,
      ],
    });
    mockSampleLayerAtWorld.mockResolvedValue({ value: 5.4312 });
    const result = await intensityProvider.getInfo(createMockContext({ activeLayerId: 'z' }));
    expect(result).toEqual([
      { label: 'zmap_synthetic', value: 'z 5.43', priority: 20, group: 'intensity' },
    ]);
    useLayerStore.setState({ layers: [] });
  });

  it('gives no entry outside a partial-FOV layer (no fabricated 0, review D5)', async () => {
    const { useLayerStore } = await import('@/stores/layerStore');
    useLayerStore.setState({
      layers: [
        { id: 'full', name: 'T1.nii.gz', volumeId: 'full', type: 'volume', visible: true, order: 0 } as never,
        { id: 'slab', name: 'slab_bold.nii.gz', volumeId: 'slab', type: 'volume', visible: true, order: 1 } as never,
      ],
      layerMetadata: new Map([
        // A 10-voxel slab around z = 0 (1 mm, identity-like affine).
        [
          'slab',
          {
            dimensions: [10, 10, 10],
            worldToVoxel: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 5, 5, 1],
          },
        ],
      ]) as never,
    });
    mockSampleLayerAtWorld.mockResolvedValue({ value: 0 });
    const result = await intensityProvider.getInfo(
      createMockContext({ layerIds: ['full', 'slab'], worldCoord: [0, 0, 40] }),
    );
    expect(result?.map((e) => e.label)).toEqual(['T1']);
    expect(mockSampleLayerAtWorld).toHaveBeenCalledTimes(1);
    useLayerStore.setState({ layers: [], layerMetadata: new Map() });
  });
});
