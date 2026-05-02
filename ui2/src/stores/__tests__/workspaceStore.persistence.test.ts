/**
 * workspaceStore — versioned persistence migration
 * (mote `bd-01KQJSP4GWGW9AJZRNBE5TVX0M`, AC#1 + AC#4).
 *
 * Before this mote, `workspaceStore` ran an unconditional
 * `localStorage.removeItem('brainflow2-workspace')` on every module load,
 * effectively disabling persistence. The mote replaces that with a
 * version-guarded migrate inside `persist`'s options:
 *
 *   - any payload written by the pre-mote (unversioned) codebase is
 *     considered untrusted and reset to defaults — the same effect the
 *     legacy wipe gave, but only on stale payloads, not every reload;
 *   - payloads at the current version pass through unchanged so the user's
 *     workspaces and active workspace id survive a refresh.
 */

import { describe, expect, it, beforeEach } from 'vitest';

import { useWorkspaceStore } from '../workspaceStore';

const STORAGE_KEY = 'brainflow2-workspace';

describe('workspaceStore persistence migration', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it('returns initial state when localStorage is empty (cold start)', async () => {
    await useWorkspaceStore.persist.rehydrate();
    const state = useWorkspaceStore.getState();
    expect(state.activeWorkspaceId).toBeNull();
    expect(state.workspaces.size).toBe(0);
  });

  it('drops untrusted unversioned (legacy v0) payloads back to initial state', async () => {
    // Anything written before this mote had no `version` field. The migrate
    // guard treats those as untrusted and returns initial state.
    const legacyPayload = {
      state: {
        workspaces: [
          ['legacy-id', { id: 'legacy-id', type: 'orthogonal-flexible', title: 'Stale' }],
        ],
        activeWorkspaceId: 'legacy-id',
      },
      // no version field
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacyPayload));

    await useWorkspaceStore.persist.rehydrate();

    const state = useWorkspaceStore.getState();
    expect(state.activeWorkspaceId).toBeNull();
    expect(state.workspaces.size).toBe(0);
  });

  it('drops persisted v1 payloads (right-rail unification migration)', async () => {
    // mote `bd-01KQMFC7B2S8SZYRZX62V6R0FZ`: v1 layout trees still mention the
    // legacy LayerPanel / AtlasPanel / SurfacePanel / StudioInspectorPanel
    // componentTypes. The v1 → v2 migrate drops persisted workspaces so each
    // workspace regenerates its layout via `ViewRegistry.createLayout` and
    // mounts the unified Inspector tab.
    const v1Payload = {
      state: {
        workspaces: [
          [
            'ws-1',
            {
              id: 'ws-1',
              type: 'integrated',
              title: 'Integrated Workspace',
              presetId: null,
              timestamp: 1700000000000,
              isActive: true,
              layoutConfig: {
                root: {
                  type: 'component',
                  componentType: 'EmptyView',
                  title: 'placeholder',
                  componentState: {},
                },
              },
              panelStates: [],
            },
          ],
        ],
        activeWorkspaceId: 'ws-1',
      },
      version: 1,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v1Payload));

    await useWorkspaceStore.persist.rehydrate();

    const state = useWorkspaceStore.getState();
    expect(state.activeWorkspaceId).toBeNull();
    expect(state.workspaces.size).toBe(0);
  });

  it('preserves a current-version payload across rehydrate (no wipe)', async () => {
    // The custom storage layer serializes Maps as arrays; the rehydrate path
    // must reconstruct them. This payload is at the current persistence
    // version (v2 — right-rail unification).
    const versionedPayload = {
      state: {
        workspaces: [
          [
            'ws-1',
            {
              id: 'ws-1',
              type: 'integrated',
              title: 'Integrated Workspace',
              presetId: null,
              timestamp: 1700000000000,
              isActive: true,
              layoutConfig: {
                root: {
                  type: 'component',
                  componentType: 'EmptyView',
                  title: 'placeholder',
                  componentState: {},
                },
              },
              panelStates: [],
            },
          ],
        ],
        activeWorkspaceId: 'ws-1',
      },
      version: 2,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(versionedPayload));

    await useWorkspaceStore.persist.rehydrate();

    const state = useWorkspaceStore.getState();
    expect(state.activeWorkspaceId).toBe('ws-1');
    expect(state.workspaces.size).toBe(1);
    expect(state.workspaces.get('ws-1')?.title).toBe('Integrated Workspace');
  });
});
