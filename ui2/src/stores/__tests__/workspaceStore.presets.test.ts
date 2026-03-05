import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { WORKSPACE_PRESETS } from '@/types/workspacePresets';
import { initializeViewRegistry } from '@/services/ViewRegistry';

describe('workspace presets', () => {
  beforeEach(() => {
    localStorage.clear();
    initializeViewRegistry();
    useWorkspaceStore.setState({
      workspaces: new Map(),
      activeWorkspaceId: null,
    });
  });

  it('defines four core presets', () => {
    expect(WORKSPACE_PRESETS.map((preset) => preset.id)).toEqual([
      'read',
      'explore',
      'analyze',
      'compare',
    ]);
  });

  it('reuses existing workspace when the same preset is applied again', async () => {
    const firstWorkspaceId = await useWorkspaceStore.getState().applyWorkspacePreset('read');
    const secondWorkspaceId = await useWorkspaceStore.getState().applyWorkspacePreset('read');

    const state = useWorkspaceStore.getState();
    expect(secondWorkspaceId).toBe(firstWorkspaceId);
    expect(state.workspaces.size).toBe(1);
    expect(state.activeWorkspaceId).toBe(firstWorkspaceId);
    expect(state.workspaces.get(firstWorkspaceId)?.presetId).toBe('read');
  });

  it('creates distinct workspaces for different presets', async () => {
    const readWorkspaceId = await useWorkspaceStore.getState().applyWorkspacePreset('read');
    const compareWorkspaceId = await useWorkspaceStore.getState().applyWorkspacePreset('compare');

    const state = useWorkspaceStore.getState();
    expect(state.workspaces.size).toBe(2);
    expect(readWorkspaceId).not.toBe(compareWorkspaceId);
    expect(state.activeWorkspaceId).toBe(compareWorkspaceId);
    expect(state.workspaces.get(compareWorkspaceId)?.presetId).toBe('compare');
  });
});
