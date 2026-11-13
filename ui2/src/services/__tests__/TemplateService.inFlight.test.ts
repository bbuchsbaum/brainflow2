import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLoadingQueueStore } from '@/stores/loadingQueueStore';
import { TemplateService } from '../TemplateService';

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  emit: vi.fn(),
  loadVolume: vi.fn(),
}));

vi.mock('../transport', () => ({ invokeBackend: h.invoke }));
vi.mock('@/events/EventBus', () => ({ getEventBus: () => ({ emit: h.emit }) }));
vi.mock('../VolumeLoadingService', () => ({
  getVolumeLoadingService: () => ({ loadVolume: h.loadVolume }),
}));
vi.mock('@/stores/logStore', () => ({ addLogEntry: vi.fn() }));

const ID = 'MNI152NLin2009cAsym_T1w_1mm';
const result = {
  template_id: ID,
  template_metadata: { id: ID, name: 'MNI152 T1w (1mm)', template_type: 'T1w' },
  volume_handle_info: { id: 'vol-1', name: ID, dims: [2, 2, 2], dtype: 'f32', volume_type: 'Volume3D' },
};
const notifications = () =>
  h.emit.mock.calls.filter(([event]) => event === 'ui.notification').map(([, payload]) => payload);

describe('TemplateService: a template asked for while it is loading (review item 6)', () => {
  let finish!: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    useLoadingQueueStore.setState({ queue: [], activeLoads: new Map(), completed: [] });
    h.invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(result);
        }),
    );
    h.loadVolume.mockResolvedValue({ id: 'vol-1' });
  });

  it('a quiet request shows no toast and waits for the load under way', async () => {
    const service = TemplateService.getInstance();
    const menu = service.loadTemplateById(ID);
    let joined: { joined: boolean } | null = null;
    const quiet = service
      .loadTemplateBySourcePath(`template:${ID}`, { quiet: true })
      .then((outcome) => (joined = outcome));
    await Promise.resolve();
    await Promise.resolve();
    // Still waiting, silently, and no second backend load.
    expect(joined).toBeNull();
    expect(notifications()).toEqual([]);
    expect(h.invoke).toHaveBeenCalledTimes(1);

    finish();
    expect(await menu).toEqual({ joined: false });
    await quiet;
    expect(joined).toEqual({ joined: true });
    expect(h.loadVolume).toHaveBeenCalledTimes(1);
  });

  it("the user's own second request is still told the template is loading", async () => {
    const service = TemplateService.getInstance();
    const first = service.loadTemplateById(ID);
    expect(await service.loadTemplateById(ID)).toEqual({ joined: false });
    expect(notifications()).toEqual([
      { type: 'info', message: `Template is already being loaded: ${ID}` },
    ]);
    finish();
    await first;
  });

  it('a quiet request after a failed load starts its own', async () => {
    h.invoke.mockRejectedValueOnce({ Input: { code: 1, details: 'offline' } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = TemplateService.getInstance();
    await service.loadTemplateById(ID, { quiet: true });
    const again = service.loadTemplateById(ID, { quiet: true });
    await Promise.resolve();
    finish();
    expect(await again).toEqual({ joined: false });
    expect(h.invoke).toHaveBeenCalledTimes(2);
  });
});
