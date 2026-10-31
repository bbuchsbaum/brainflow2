import { afterEach, describe, expect, it, vi } from 'vitest';

const { listeners, emitted } = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  emitted: [] as Array<[string, unknown]>,
}));
vi.mock('@/utils/eventUtils', () => ({
  safeListen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(name, handler);
    return () => listeners.delete(name);
  }),
  safeUnlisten: vi.fn(async (fn?: () => void) => fn?.()),
  safeEmit: vi.fn(async (name: string, payload: unknown) => {
    emitted.push([name, payload]);
  }),
}));

import { destroyViewDisplayMenuService, initializeViewDisplayMenuService } from '../ViewDisplayMenuService';
import { useViewDisplaySettingsStore } from '@/stores/viewDisplaySettingsStore';

describe('View › Radiological Convention (QA features 2026-10-31 §2)', () => {
  afterEach(() => {
    destroyViewDisplayMenuService();
    useViewDisplaySettingsStore.getState().setRadiological(false);
    emitted.length = 0;
  });

  it('is off by default, toggles from the menu and reports every change for the check mark', async () => {
    expect(useViewDisplaySettingsStore.getState().radiological).toBe(false);
    initializeViewDisplayMenuService();
    await Promise.resolve();
    expect(emitted.at(-1)).toEqual(['radiological-convention-changed', { enabled: false }]);
    listeners.get('view-display-action')!({ payload: { action: 'toggle-radiological' } });
    expect(useViewDisplaySettingsStore.getState().radiological).toBe(true);
    expect(emitted.at(-1)).toEqual(['radiological-convention-changed', { enabled: true }]);
    // Any other writer (the view's context menu) is reported too.
    useViewDisplaySettingsStore.getState().toggleRadiological();
    expect(emitted.at(-1)).toEqual(['radiological-convention-changed', { enabled: false }]);
  });

  it('persists the setting', () => {
    useViewDisplaySettingsStore.getState().setRadiological(true);
    const saved = JSON.parse(localStorage.getItem('brainflow2-view-display-settings') ?? '{}');
    expect(saved.state).toEqual({ radiological: true });
  });
});
