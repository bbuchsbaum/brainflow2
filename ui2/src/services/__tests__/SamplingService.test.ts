import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  sampleLayerAtWorld,
  __resetSamplingServiceErrorCacheForTests,
} from '../SamplingService';

vi.mock('@brainflow/api', () => ({
  sampleLayerValueAtWorld: vi.fn(),
}));

let mockSampleLayerValueAtWorld: ReturnType<typeof vi.fn>;

describe('SamplingService', () => {
  beforeEach(async () => {
    const mod: any = await import('@brainflow/api');
    mockSampleLayerValueAtWorld = mod.sampleLayerValueAtWorld as ReturnType<typeof vi.fn>;
    mockSampleLayerValueAtWorld.mockReset();
    __resetSamplingServiceErrorCacheForTests();
  });

  it('returns sampled value when backend succeeds', async () => {
    mockSampleLayerValueAtWorld.mockResolvedValue(42.1234);

    const result = await sampleLayerAtWorld({
      layerId: 'layer-1',
      world: [1.0, 2.0, 3.0],
    });

    expect(result.value).toBeCloseTo(42.1234);
    expect(result.error).toBeUndefined();
    expect(mockSampleLayerValueAtWorld).toHaveBeenCalledWith('layer-1', [1.0, 2.0, 3.0]);
  });

  it('returns null value and error when backend throws', async () => {
    const error = new Error('boom');
    mockSampleLayerValueAtWorld.mockRejectedValue(error);

    const result = await sampleLayerAtWorld({
      layerId: 'layer-err',
      world: [10, 20, 30],
    });

    expect(result.value).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe('boom');
  });

  it('logs at most once per layer/coord error key', async () => {
    mockSampleLayerValueAtWorld.mockRejectedValue(new Error('boom'));

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const opts = {
      layerId: 'layer-log',
      world: [5, 6, 7] as [number, number, number],
    };

    await sampleLayerAtWorld(opts);
    await sampleLayerAtWorld(opts);

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });
});
