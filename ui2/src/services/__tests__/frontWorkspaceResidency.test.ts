import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  evicted: [] as string[],
  load: vi.fn(),
  emit: vi.fn(),
  setLayerError: vi.fn(),
}));
vi.mock('@/services/LayerEvictionService', () => ({
  layerEvictionService: { evictedFrontLayers: () => h.evicted },
}));
vi.mock('@/services/LayerService', () => ({ getLayerService: () => ({ loadLayerData: h.load }) }));
vi.mock('@/events/EventBus', () => ({ getEventBus: () => ({ emit: h.emit, on: vi.fn() }) }));
const meta = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock('@/stores/layerStore', () => ({
  useLayerStore: {
    getState: () => ({
      setLayerError: h.setLayerError,
      getLayer: (id: string) => ({ id, name: `${id}.nii.gz` }),
      getLayerMetadata: (id: string) => meta.get(id),
      setLayerMetadata: (id: string, value: Record<string, unknown>) => meta.set(id, value),
    }),
  },
}));

import { ensureFrontWorkspaceResident, noteBackendRelease, restoreIfFrontVisible } from '@/services/frontWorkspaceResidency';
import { GpuSlotsFullError } from '@/utils/formatTauriError';

describe('front workspace residency', () => {
  beforeEach(() => {
    h.evicted = [];
    h.load.mockReset().mockResolvedValue(undefined);
    h.emit.mockReset();
    h.setLayerError.mockReset();
  });

  it('uploads again the evicted visible layers of the tab now in front, in order', async () => {
    h.evicted = ['a', 'b'];
    await ensureFrontWorkspaceResident(() => true);
    expect(h.load.mock.calls).toEqual([['a'], ['b']]);
  });

  it('stops when another tab comes to the front (stale pass)', async () => {
    h.evicted = ['a', 'b', 'c'];
    let current = true;
    h.load.mockImplementation(async (id: string) => {
      if (id === 'a') current = false;
    });
    await ensureFrontWorkspaceResident(() => current);
    expect(h.load.mock.calls).toEqual([['a']]);
  });

  it('a full GPU raises one refusal alert, not a layer error, and stops', async () => {
    h.evicted = ['a', 'b'];
    h.load.mockRejectedValue(new GpuSlotsFullError(13));
    await ensureFrontWorkspaceResident(() => true);
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(h.setLayerError).toHaveBeenCalledWith('a', null);
    expect(h.emit).toHaveBeenCalledWith(
      'ui.notification',
      expect.objectContaining({ alert: true, subject: 'a.nii.gz', type: 'warning' }),
    );
  });

  it('restores an evicted layer only when it is visible in the front tab now', async () => {
    h.evicted = ['a'];
    await restoreIfFrontVisible('b');
    expect(h.load).not.toHaveBeenCalled();
    await restoreIfFrontVisible('a');
    expect(h.load).toHaveBeenCalledWith('a');
  });

  // The backend watchdog released a lease the UI believed resident.
  it('marks a watchdog release non-resident and announces it once', () => {
    meta.set('w', { gpuResident: true, dimensions: [4, 4, 4] });
    noteBackendRelease('w');
    expect(meta.get('w')).toMatchObject({ gpuResident: false, evicted: true, dimensions: [4, 4, 4] });
    expect(h.emit).toHaveBeenCalledWith('layer.gpu.evicted', { layerId: 'w', reason: 'watchdog' });
    h.emit.mockClear();
    noteBackendRelease('w');
    noteBackendRelease('unknown');
    expect(h.emit).not.toHaveBeenCalled();
  });
});
