import { afterEach, describe, expect, it, vi } from 'vitest';

const { emits, listeners } = vi.hoisted(() => ({
  emits: [] as Array<[string, unknown]>,
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock('@/utils/eventUtils', () => ({
  safeEmit: vi.fn(async (event: string, payload: unknown) => {
    emits.push([event, payload]);
  }),
  safeListen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(event, handler);
    return () => {};
  }),
  safeUnlisten: vi.fn(),
}));

import { useViewStateStore } from '@/stores/viewStateStore';
import { safeUnlisten } from '@/utils/eventUtils';
import {
  destroyCrosshairMenuService,
  initializeCrosshairMenuService,
} from '../CrosshairMenuService';

describe('CrosshairMenuService: View › Show Crosshair check mark', () => {
  afterEach(() => {
    destroyCrosshairMenuService();
    emits.length = 0;
    listeners.clear();
    useViewStateStore.getState().setCrosshairVisible(true);
  });

  it('reports the visibility on start and on every change, from any source', async () => {
    useViewStateStore.getState().setCrosshairVisible(true);
    initializeCrosshairMenuService();
    expect(emits).toEqual([['crosshair-visibility-changed', { visible: true }]]);

    // Another control (toolbar, settings) hides it.
    useViewStateStore.getState().setCrosshairVisible(false);
    expect(emits.at(-1)).toEqual(['crosshair-visibility-changed', { visible: false }]);

    // The menu item asks the UI to toggle; the check follows the result.
    await vi.waitFor(() => expect(listeners.has('crosshair-action')).toBe(true));
    listeners.get('crosshair-action')!({ payload: { action: 'toggle' } });
    expect(emits.at(-1)).toEqual(['crosshair-visibility-changed', { visible: true }]);

    // Unrelated view-state changes do not re-emit.
    const count = emits.length;
    useViewStateStore.getState().setCrosshairVisible(true);
    expect(emits).toHaveLength(count);
  });

  it('drops a listener whose registration finishes after a StrictMode unmount', async () => {
    initializeCrosshairMenuService();
    // Unmount before safeListen resolves, then mount again.
    destroyCrosshairMenuService();
    initializeCrosshairMenuService();
    await vi.waitFor(() => expect(vi.mocked(safeUnlisten)).toHaveBeenCalled());

    // One toggle flips the crosshair once (two live listeners made it a no-op).
    await vi.waitFor(() => expect(listeners.has('crosshair-action')).toBe(true));
    useViewStateStore.getState().setCrosshairVisible(true);
    listeners.get('crosshair-action')!({ payload: { action: 'toggle' } });
    expect(useViewStateStore.getState().viewState.crosshair.visible).toBe(false);
  });
});
