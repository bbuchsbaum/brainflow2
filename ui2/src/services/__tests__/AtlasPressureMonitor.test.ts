import { describe, it, expect } from 'vitest';
import {
  getLowWatermarkNotification,
  shouldEmitLowWatermarkNotification,
} from '../AtlasPressureMonitor';
import type { AtlasStats } from '@/types/atlas';

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
