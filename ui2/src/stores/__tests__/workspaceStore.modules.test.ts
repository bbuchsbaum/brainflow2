/**
 * Module tool tabs in the workspace store: switching a module off parks its
 * tabs (remembered, persisted), switching it on restores them, restore at
 * launch skips tabs of modules that are off, and a fixed startup list
 * replaces the previous session's tabs.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_TOOL, registerFixtureModule } from '@/modules/__tests__/fixtureModule';
import { useModuleSettingsStore } from '@/modules/settingsStore';
import { moduleRegistry } from '@/modules/registry';
import { useWorkspaceStore } from '../workspaceStore';
import { partitionByModuleAvailability } from '../workspaceRestorePolicy';

registerFixtureModule();

const STORAGE_KEY = 'brainflow2-workspace';
const ws = (id: string, type: string, timestamp: number) => ({
  id,
  type,
  title: id,
  presetId: null,
  timestamp,
  isActive: false,
  layoutConfig: { root: { type: 'component', componentType: 'EmptyView', title: id, componentState: {} } },
  panelStates: [],
});

function setFixture(on: boolean) {
  useModuleSettingsStore.getState().setModuleEnabled('fixture', on);
}

describe('workspace store: module tabs', () => {
  beforeEach(() => {
    localStorage.clear();
    useModuleSettingsStore.setState({ enabled: {}, startup: { mode: 'restore', tabs: ['orthogonal-flexible'] } });
    useWorkspaceStore.setState({ workspaces: new Map(), activeWorkspaceId: null, parkedWorkspaces: new Map() });
  });

  it('opens a module tool once, named by its manifest, and refuses it while off', async () => {
    const id = await useWorkspaceStore.getState().createWorkspace(FIXTURE_TOOL);
    expect(useWorkspaceStore.getState().workspaces.get(id)?.title).toBe('Fixture tool');
    await expect(useWorkspaceStore.getState().createWorkspace(FIXTURE_TOOL)).resolves.toBe(id);
    setFixture(false);
    useWorkspaceStore.setState({ workspaces: new Map(), activeWorkspaceId: null });
    await expect(useWorkspaceStore.getState().createWorkspace(FIXTURE_TOOL)).rejects.toThrow(/not available/);
  });

  it('parks the tabs of a module switched off and brings them back, keeping the active view', async () => {
    const store = useWorkspaceStore.getState();
    const view = await store.createWorkspace('orthogonal-flexible');
    const tool = await store.createWorkspace(FIXTURE_TOOL);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(tool);

    setFixture(false);
    useWorkspaceStore.getState().parkModuleWorkspaces('fixture');
    let state = useWorkspaceStore.getState();
    expect([...state.workspaces.keys()]).toEqual([view]);
    expect(state.activeWorkspaceId).toBe(view);
    expect([...state.parkedWorkspaces.keys()]).toEqual([tool]);
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.state.parkedWorkspaces.map(([id]: [string]) => id)).toEqual([tool]);

    setFixture(true);
    useWorkspaceStore.getState().unparkModuleWorkspaces('fixture');
    state = useWorkspaceStore.getState();
    expect([...state.workspaces.keys()]).toEqual([view, tool]);
    expect(state.activeWorkspaceId).toBe(view);
    expect(state.parkedWorkspaces.size).toBe(0);
  });

  it('no-ops when a module has no tabs to park or restore', () => {
    const before = useWorkspaceStore.getState();
    before.parkModuleWorkspaces('fixture');
    before.unparkModuleWorkspaces('fixture');
    expect(useWorkspaceStore.getState()).toBe(before);
  });

  it('restore at launch parks tabs of a module that is off, and unparks them once it is on', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 3,
        state: {
          workspaces: [
            ['view', ws('view', 'orthogonal-flexible', 1)],
            ['tool', ws('tool', FIXTURE_TOOL, 2)],
          ],
          activeWorkspaceId: 'tool',
        },
      }),
    );
    setFixture(false);
    await useWorkspaceStore.persist.rehydrate();
    let state = useWorkspaceStore.getState();
    expect([...state.workspaces.keys()]).toEqual(['view']);
    expect(state.activeWorkspaceId).toBe('view');
    expect([...state.parkedWorkspaces.keys()]).toEqual(['tool']);

    // Next launch, the module is on again: the parked tab comes back.
    setFixture(true);
    await useWorkspaceStore.persist.rehydrate();
    state = useWorkspaceStore.getState();
    expect([...state.workspaces.keys()].sort()).toEqual(['tool', 'view']);
    expect(state.parkedWorkspaces.size).toBe(0);
  });

  it('a fixed startup list replaces the previous session but keeps parked tabs', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 3,
        state: {
          workspaces: [['view', ws('view', 'mosaic', 1)]],
          activeWorkspaceId: 'view',
          parkedWorkspaces: [['tool', ws('tool', FIXTURE_TOOL, 2)]],
        },
      }),
    );
    setFixture(false);
    useModuleSettingsStore.getState().setStartupMode('fixed');
    await useWorkspaceStore.persist.rehydrate();
    const state = useWorkspaceStore.getState();
    expect(state.workspaces.size).toBe(0);
    expect(state.activeWorkspaceId).toBeNull();
    expect([...state.parkedWorkspaces.keys()]).toEqual(['tool']);
  });

  it('a v2 payload upgraded while a module is off keeps that module’s tab parked (and saved)', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        state: {
          workspaces: [
            ['view', ws('view', 'orthogonal-flexible', 1)],
            ['tool', ws('tool', FIXTURE_TOOL, 2)],
          ],
          activeWorkspaceId: 'tool',
        },
      }),
    );
    setFixture(false);
    await useWorkspaceStore.persist.rehydrate();
    const state = useWorkspaceStore.getState();
    expect([...state.workspaces.keys()]).toEqual(['view']);
    expect([...state.parkedWorkspaces.keys()]).toEqual(['tool']);
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.version).toBe(3);
    expect(saved.state.parkedWorkspaces.map(([id]: [string]) => id)).toEqual(['tool']);
  });

  it('a fixed startup list with nothing it can open keeps the previous session', async () => {
    const saved = JSON.stringify({
      version: 3,
      state: { workspaces: [['view', ws('view', 'mosaic', 1)]], activeWorkspaceId: 'view' },
    });
    setFixture(false);
    // Only a tool whose module is off: nothing usable.
    useModuleSettingsStore.setState({ startup: { mode: 'fixed', tabs: [FIXTURE_TOOL] } });
    localStorage.setItem(STORAGE_KEY, saved);
    await useWorkspaceStore.persist.rehydrate();
    expect([...useWorkspaceStore.getState().workspaces.keys()]).toEqual(['view']);
    // An empty list (an older payload) behaves the same.
    useModuleSettingsStore.setState({ startup: { mode: 'fixed', tabs: [] } });
    localStorage.setItem(STORAGE_KEY, saved);
    await useWorkspaceStore.persist.rehydrate();
    expect([...useWorkspaceStore.getState().workspaces.keys()]).toEqual(['view']);
  });

  it('drops parked tabs of types this build does not know', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 3,
        state: { workspaces: [], activeWorkspaceId: null, parkedWorkspaces: [['old', ws('old', 'retired.tool', 1)]] },
      }),
    );
    await useWorkspaceStore.persist.rehydrate();
    expect(useWorkspaceStore.getState().parkedWorkspaces.size).toBe(0);
  });
});

describe('partitionByModuleAvailability', () => {
  it('keeps one tab per tool when a parked tool comes back beside an open one', () => {
    const open = new Map([['a', ws('a', FIXTURE_TOOL, 1)]]);
    const parked = new Map([
      ['b', ws('b', FIXTURE_TOOL, 2)],
      ['c', ws('c', 'off.tool', 3)],
    ]);
    const parts = partitionByModuleAvailability(open, parked, (type) => type !== 'off.tool');
    expect([...parts.workspaces.keys()]).toEqual(['a']);
    expect([...parts.parked.keys()]).toEqual(['c']);
    expect(moduleRegistry.workspaceModule(FIXTURE_TOOL)).toBe('fixture');
  });
});
