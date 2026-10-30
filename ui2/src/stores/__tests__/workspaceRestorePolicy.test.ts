import { beforeEach, describe, expect, it } from 'vitest';

import { pruneLegacyViewSprawl, restoreWorkspaces } from '../workspaceRestorePolicy';
import { useWorkspaceStore } from '../workspaceStore';
import type { WorkspaceType } from '@/types/workspace';

type W = { id: string; type: WorkspaceType; timestamp: number; presetId?: string | null };

const ws = (
  id: string,
  type: WorkspaceType,
  timestamp: number,
  presetId: string | null = null,
): W => ({
  id,
  type,
  timestamp,
  presetId,
});

const asMap = (list: W[]) => new Map(list.map((w) => [w.id, w]));

describe('restoreWorkspaces (relaunch restores the user-created tabs)', () => {
  it('keeps every view tab, duplicates of a layout included, and the active one active', () => {
    const { workspaces, activeWorkspaceId } = restoreWorkspaces(
      asMap([
        ws('orth-1', 'orthogonal-flexible', 1),
        ws('orth-2', 'orthogonal-flexible', 2),
        ws('mosaic', 'mosaic', 3),
        ws('cmp', 'comparison', 4),
      ]),
      'orth-1',
    );
    expect([...workspaces.keys()]).toEqual(['orth-1', 'orth-2', 'mosaic', 'cmp']);
    expect(activeWorkspaceId).toBe('orth-1');
  });

  it('keeps tool tabs, one per tool (the active one, else the latest)', () => {
    const { workspaces } = restoreWorkspaces(
      asMap([
        ws('view', 'orthogonal-locked', 1),
        ws('studio-old', 'set-studio', 2),
        ws('studio-new', 'set-studio', 3),
        ws('bids-active', 'bids-explorer', 4),
        ws('bids-late', 'bids-explorer', 5),
        ws('analysis', 'analysis-workbench', 6),
      ]),
      'bids-active',
    );
    expect([...workspaces.keys()]).toEqual(['view', 'studio-new', 'bids-active', 'analysis']);
  });

  it('drops workspaces of an unknown type and falls back to the latest when the active id is stale', () => {
    const { workspaces, activeWorkspaceId } = restoreWorkspaces(
      asMap([
        ws('a', 'mosaic', 1),
        ws('ghost', 'hologram' as WorkspaceType, 9),
        ws('b', 'integrated', 2),
      ]),
      'gone',
    );
    expect([...workspaces.keys()]).toEqual(['a', 'b']);
    expect(activeWorkspaceId).toBe('b');
  });
});

describe('pruneLegacyViewSprawl (one-time v2 cleanup)', () => {
  it('keeps one view per display mode, preferring the active one', () => {
    const { workspaces, activeWorkspaceId } = pruneLegacyViewSprawl(
      asMap([
        ws('int-1', 'integrated', 1),
        ws('int-2', 'integrated', 2),
        ws('int-3', 'integrated', 3),
        ws('int-4', 'integrated', 4),
        ws('orth-1', 'orthogonal-flexible', 5),
        ws('orth-locked', 'orthogonal-locked', 6),
        ws('cmp-1', 'comparison', 7),
        ws('cmp-2', 'comparison', 8),
      ]),
      'int-3',
    );
    expect([...workspaces.keys()]).toEqual(['int-3', 'orth-locked', 'cmp-2']);
    expect(activeWorkspaceId).toBe('int-3');
  });

  it('keeps tool workspaces and preset launches', () => {
    const { workspaces } = pruneLegacyViewSprawl(
      asMap([
        ws('orth-1', 'orthogonal-flexible', 1),
        ws('read', 'orthogonal-flexible', 2, 'read'),
        ws('studio', 'set-studio', 3),
        ws('bids', 'bids-explorer', 4),
      ]),
      'studio',
    );
    expect([...workspaces.keys()]).toEqual(['orth-1', 'read', 'studio', 'bids']);
  });
});

describe('workspaceStore rehydrate applies the restore policy', () => {
  const STORAGE_KEY = 'brainflow2-workspace';
  const layoutConfig = {
    root: { type: 'component', componentType: 'EmptyView', title: 'x', componentState: {} },
  };
  const entry = (
    id: string,
    type: WorkspaceType,
    timestamp: number,
    presetId: string | null = null,
  ) => [
    id,
    { id, type, title: id, presetId, timestamp, isActive: false, layoutConfig, panelStates: [] },
  ];

  beforeEach(() => localStorage.removeItem(STORAGE_KEY));

  it('restores every current-version tab with its layout and keeps the active one active', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          workspaces: [
            entry('mosaic-1', 'mosaic', 1),
            entry('mosaic-2', 'mosaic', 2),
            entry('studio', 'set-studio', 3, 'studio'),
          ],
          activeWorkspaceId: 'mosaic-1',
        },
        version: 3,
      }),
    );

    await useWorkspaceStore.persist.rehydrate();

    const state = useWorkspaceStore.getState();
    expect([...state.workspaces.keys()]).toEqual(['mosaic-1', 'mosaic-2', 'studio']);
    expect(state.workspaces.get('mosaic-2')?.type).toBe('mosaic');
    expect(state.workspaces.get('mosaic-2')?.layoutConfig).toEqual(layoutConfig);
    expect(state.activeWorkspaceId).toBe('mosaic-1');
    expect(state.workspaces.get('mosaic-1')?.isActive).toBe(true);
    expect(state.workspaces.get('mosaic-2')?.isActive).toBe(false);
  });

  it('migrates a v2 payload once: drops the auto-created duplicates and the retired view presets', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          workspaces: [
            entry('int-1', 'integrated', 1),
            entry('int-2', 'integrated', 2),
            entry('int-3', 'integrated', 3),
            entry('orth', 'orthogonal-flexible', 4),
            entry('read', 'orthogonal-locked', 5, 'read'),
          ],
          activeWorkspaceId: 'int-2',
        },
        version: 2,
      }),
    );

    await useWorkspaceStore.persist.rehydrate();

    const state = useWorkspaceStore.getState();
    expect([...state.workspaces.keys()]).toEqual(['int-2', 'orth', 'read']);
    expect(state.workspaces.get('read')?.presetId).toBeNull();
    expect(state.activeWorkspaceId).toBe('int-2');
    expect(state.workspaces.get('int-2')?.isActive).toBe(true);
    expect(state.workspaces.get('orth')?.isActive).toBe(false);
  });
});
