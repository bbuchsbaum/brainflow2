import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listeners, store, nav, emitted } = vi.hoisted(() => {
  const listeners = new Map<string, (event: { payload: unknown }) => unknown>();
  const store = {
    activateWorkspace: vi.fn(),
    closeWorkspace: vi.fn(),
  };
  const nav = {
    openNewView: vi.fn(async () => 'new-view'),
    openTool: vi.fn(async () => 'tool'),
    setCurrentTabLayout: vi.fn(() => 'applied'),
    goToWorkspaceType: vi.fn(),
    isModalDialogOpen: vi.fn(() => false),
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
  useWorkspaceStore: { getState: () => store },
}));

vi.mock('@/services/workspaceNavigation', () => nav);

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
});
