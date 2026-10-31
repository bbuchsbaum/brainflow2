import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listeners, store, nav, emitted } = vi.hoisted(() => {
  const listeners = new Map<string, (event: { payload: unknown }) => unknown>();
  const store = {
    activateWorkspace: vi.fn(),
    closeWorkspace: vi.fn(),
    activeWorkspaceId: 'w1' as string | null,
    workspaces: new Map([['w1', { type: 'mosaic' }]]),
    subscribers: [] as Array<() => void>,
  };
  const nav = {
    openNewView: vi.fn(async () => 'new-view'),
    openTool: vi.fn(async () => 'tool'),
    setCurrentTabLayout: vi.fn(() => 'applied'),
    goToWorkspaceType: vi.fn(),
    isModalDialogOpen: vi.fn(() => false),
    currentTabTakesLayout: vi.fn(() => true),
  };
  const emitted: Array<[string, unknown]> = [];
  return { listeners, store, nav, emitted };
});

vi.mock('@/utils/eventUtils', () => ({
  safeListen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => unknown) => {
    listeners.set(event, handler);
    return () => {};
  }),
  safeUnlisten: vi.fn(),
  safeEmit: vi.fn(async (event: string, payload: unknown) => {
    emitted.push([event, payload]);
  }),
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: {
    getState: () => store,
    subscribe: (fn: () => void) => {
      store.subscribers.push(fn);
      return () => {
        store.subscribers = store.subscribers.filter((f) => f !== fn);
      };
    },
  },
}));

vi.mock('@/services/workspaceNavigation', () => nav);

const layout = vi.hoisted(() => ({ closeFrontTab: vi.fn(() => true) }));
vi.mock('@/services/layoutService', () => ({ getLayoutService: () => layout }));

import { useWorkspaceMenuListener } from '../useWorkspaceMenuListener';
import { useFeatureFlagStore } from '@/stores/featureFlagStore';

const emit = (action: string, payload?: Record<string, unknown>) =>
  listeners.get('workspace-action')!({ payload: { action, payload } });

describe('useWorkspaceMenuListener (View › Workspace / View › Layout)', () => {
  beforeEach(async () => {
    listeners.clear();
    Object.values(nav).forEach((fn) => fn.mockClear());
    nav.isModalDialogOpen.mockReturnValue(false);
    emitted.length = 0;
    store.activateWorkspace.mockClear();
    renderHook(() => useWorkspaceMenuListener());
    await waitFor(() => expect(listeners.has('workspace-action')).toBe(true));
  });

  it('New View (Cmd+T) opens a new view tab', async () => {
    await emit('new-view');
    expect(nav.openNewView).toHaveBeenCalledTimes(1);
  });

  it('Cmd+1–Cmd+4 set the current tab layout and never open a tab', async () => {
    await emit('set-layout', { layout: 'orthogonal' });
    await emit('set-layout', { layout: 'orthogonal-flexible' });
    await emit('set-layout', { layout: 'compare' });
    expect(nav.setCurrentTabLayout.mock.calls).toEqual([
      ['orthogonal'],
      ['orthogonal-flexible'],
      ['compare'],
    ]);
    expect(nav.openNewView).not.toHaveBeenCalled();
    expect(nav.openTool).not.toHaveBeenCalled();
  });

  it('Cmd+5 / Cmd+6 open a tool (or refocus it)', async () => {
    await emit('open-tool', { type: 'set-studio' });
    await emit('open-tool', { type: 'bids-explorer' });
    expect(nav.openTool.mock.calls).toEqual([['set-studio'], ['bids-explorer']]);
  });

  it('a startup --workspace request goes through the same navigation rules', async () => {
    await emit('new-workspace', { type: 'mosaic' });
    expect(nav.goToWorkspaceType).toHaveBeenCalledWith('mosaic');
    expect(nav.openNewView).not.toHaveBeenCalled();
  });

  it('drops layout, New view and tool requests while a modal dialog is open', async () => {
    nav.isModalDialogOpen.mockReturnValue(true);
    await emit('set-layout', { layout: 'mosaic' });
    await emit('new-view');
    await emit('open-tool', { type: 'set-studio' });
    expect(nav.setCurrentTabLayout).not.toHaveBeenCalled();
    expect(nav.openNewView).not.toHaveBeenCalled();
    expect(nav.openTool).not.toHaveBeenCalled();
  });

  it('reports the Integrated feature flag so the native Integrated item can be disabled', async () => {
    const initial = useFeatureFlagStore.getState().integratedWorkspaceV1;
    expect(emitted).toContainEqual(['integrated-layout-availability', { enabled: initial }]);
    useFeatureFlagStore.setState({ integratedWorkspaceV1: !initial });
    expect(emitted.at(-1)).toEqual(['integrated-layout-availability', { enabled: !initial }]);
    useFeatureFlagStore.setState({ integratedWorkspaceV1: initial });
  });

  // QA 2026-10-30 F47: View › Layout had no check mark on the current layout.
  it('reports the front tab layout so View › Layout can check it', async () => {
    const layouts = () =>
      emitted.filter(([name]) => name === 'current-layout-changed').map(([, p]) => p);
    expect(layouts().at(-1)).toEqual({ layout: 'mosaic' });

    store.workspaces.set('w1', { type: 'orthogonal-flexible' });
    store.subscribers.forEach((fn) => fn());
    expect(layouts().at(-1)).toEqual({ layout: 'orthogonal-flexible' });

    // A tool or surface tab in front: nothing is checked.
    nav.currentTabTakesLayout.mockReturnValue(false);
    store.subscribers.forEach((fn) => fn());
    expect(layouts().at(-1)).toEqual({ layout: null });
    nav.currentTabTakesLayout.mockReturnValue(true);

    // A no-op layout request still re-reports (macOS toggles a clicked check item).
    const before = layouts().length;
    await emit('set-layout', { layout: 'orthogonal' });
    expect(layouts().length).toBe(before + 1);
    store.workspaces.set('w1', { type: 'mosaic' });
  });

  // QA 2026-10-31 N1: ⌘W is File › Close Tab, not Close Window.
  it('Close Tab (Cmd+W) closes the front tab, and not behind a dialog', async () => {
    layout.closeFrontTab.mockClear();
    await emit('close-tab');
    expect(layout.closeFrontTab).toHaveBeenCalledTimes(1);
    nav.isModalDialogOpen.mockReturnValue(true);
    await emit('close-tab');
    expect(layout.closeFrontTab).toHaveBeenCalledTimes(1);
  });
});
