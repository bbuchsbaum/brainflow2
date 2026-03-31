import { describe, it, expect } from 'vitest';
import {
  getLowWatermarkNotification,
  pickAtlasEvictionCandidate,
  shouldEmitLowWatermarkNotification,
} from '../AtlasPressureMonitor';
import type { AtlasStats } from '@/types/atlas';
import type { LayerInfo } from '@/stores/layerStore';

const makeLayer = (overrides: Partial<LayerInfo>): LayerInfo => ({
  id: overrides.id ?? `layer-${Math.random()}`,
  name: overrides.name ?? overrides.id ?? 'layer',
  volumeId: overrides.volumeId ?? overrides.id ?? 'vol',
  type: overrides.type ?? 'anatomical',
  visible: overrides.visible ?? true,
  order: overrides.order ?? 0,
  loading: overrides.loading,
  error: overrides.error,
});

describe('pickAtlasEvictionCandidate', () => {
  it('prioritises hidden layers', () => {
    const layers: LayerInfo[] = [
      makeLayer({ id: 'base', order: 0, visible: true }),
      makeLayer({ id: 'hidden', order: 1, visible: false }),
      makeLayer({ id: 'recent', order: 2, visible: true })
    ];

    const candidate = pickAtlasEvictionCandidate(layers);
    expect(candidate?.id).toBe('hidden');
  });

  it('falls back to non-anatomical layers when none hidden', () => {
    const layers: LayerInfo[] = [
      makeLayer({ id: 'base', order: 0, type: 'anatomical' }),
      makeLayer({ id: 'functional', order: 1, type: 'functional' }),
      makeLayer({ id: 'mask', order: 2, type: 'mask' })
    ];

    const candidate = pickAtlasEvictionCandidate(layers);
    expect(candidate?.id).toBe('functional');
  });

  it('avoids ejecting the first anatomical layer when it is the only option', () => {
    const layers: LayerInfo[] = [
      makeLayer({ id: 'base', order: 0, type: 'anatomical' }),
      makeLayer({ id: 'secondary', order: 1, type: 'anatomical' })
    ];

    const candidate = pickAtlasEvictionCandidate(layers);
    expect(candidate?.id).toBe('secondary');
  });

  it('returns null when there are no layers', () => {
    expect(pickAtlasEvictionCandidate([])).toBeNull();
  });
});

describe('getLowWatermarkNotification', () => {
  const baseStats: AtlasStats = {
    totalLayers: 8,
    usedLayers: 6,
    freeLayers: 2,
    allocations: 10,
    releases: 2,
    highWatermark: 6,
    fullEvents: 0,
    is3D: false,
  };

  it('treats zero free layers as a warning, not an exhaustion error', () => {
    const notification = getLowWatermarkNotification({
      ...baseStats,
      usedLayers: 8,
      freeLayers: 0,
    });

    expect(notification.level).toBe('warning');
    expect(notification.message).toContain('at capacity');
    expect(notification.message).not.toContain('exhausted');
  });

  it('reports low capacity when free layers remain', () => {
    const notification = getLowWatermarkNotification(baseStats);

    expect(notification.level).toBe('warning');
    expect(notification.message).toContain('capacity low');
    expect(notification.message).toContain('2 free');
  });
});

describe('shouldEmitLowWatermarkNotification', () => {
  it('suppresses low-watermark warnings for 3D atlas mode', () => {
    expect(
      shouldEmitLowWatermarkNotification({
        totalLayers: 1,
        usedLayers: 1,
        freeLayers: 0,
        allocations: 2,
        releases: 1,
        highWatermark: 1,
        fullEvents: 0,
        is3D: true,
      })
    ).toBe(false);
  });

  it('keeps low-watermark warnings enabled for layered 2D atlas mode', () => {
    expect(
      shouldEmitLowWatermarkNotification({
        totalLayers: 8,
        usedLayers: 8,
        freeLayers: 0,
        allocations: 10,
        releases: 2,
        highWatermark: 8,
        fullEvents: 0,
        is3D: false,
      })
    ).toBe(true);
  });
});
