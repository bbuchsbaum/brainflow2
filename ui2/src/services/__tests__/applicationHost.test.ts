import type { BackendTransport } from '../transport';
import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => {
  delete (window as Window & { __TAURI__?: unknown }).__TAURI__;
});
describe('application host selection', () => {
  it('preserves an explicitly installed host before considering the environment', async () => {
    vi.resetModules();
    const { setTransport, getTransport } = await import('../transport');
    const installed = { invoke: vi.fn<BackendTransport['invoke']>() };
    setTransport(installed);
    const { selectApplicationHost } = await import('../applicationHost');
    expect(await selectApplicationHost()).toBe(installed);
    expect(getTransport()).toBe(installed);
    expect(installed.invoke).not.toHaveBeenCalled();
  });
  it('selects the existing native transport in Tauri without initializing a browser worker', async () => {
    vi.resetModules();
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {};
    const { selectApplicationHost } = await import('../applicationHost');
    const { TauriTransport, getTransport } = await import('../transport');
    expect(await selectApplicationHost()).toBeInstanceOf(TauriTransport);
    expect(await selectApplicationHost()).toBe(getTransport());
  });
});
