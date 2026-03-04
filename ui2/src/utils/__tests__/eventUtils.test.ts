import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isNoopUnlisten, safeListen, safeUnlisten } from '../eventUtils';

describe('eventUtils.safeUnlisten', () => {
  let originalTauri: unknown;
  let originalEventInternals: unknown;

  beforeEach(() => {
    originalTauri = (window as any).__TAURI__;
    originalEventInternals = (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__;
  });

  afterEach(() => {
    (window as any).__TAURI__ = originalTauri;
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = originalEventInternals;
    vi.restoreAllMocks();
  });

  it('skips unlisten when tauri event internals are unavailable', async () => {
    (window as any).__TAURI__ = {};
    delete (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__;

    const unlisten = vi.fn(() => {
      throw new Error('should not run');
    });

    await expect(safeUnlisten(unlisten)).resolves.toBeUndefined();
    expect(unlisten).not.toHaveBeenCalled();
  });

  it('calls unlisten when tauri event internals are available', async () => {
    (window as any).__TAURI__ = {};
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      registerListener: vi.fn(),
      unregisterListener: vi.fn(),
    };

    const unlisten = vi.fn(() => Promise.resolve());

    await safeUnlisten(unlisten);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});

describe('eventUtils.safeListen', () => {
  it('returns tagged noop unlisten when not in tauri', async () => {
    const unlisten = await safeListen('test-event', () => {});
    expect(isNoopUnlisten(unlisten)).toBe(true);
  });
});
