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
          value: '123.457', // toFixed(3)
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
          value: '0.000',
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
          value: '-5.123',
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
          value: '0.000', // toFixed(3) rounds small values
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
          value: '12345678.900',
          priority: 20,
          group: 'intensity',
        },
      ]);
    });
  });
});
