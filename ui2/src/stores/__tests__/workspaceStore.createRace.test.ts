/**
 * A module switched off while its tab is being created: the tab must not be
 * added after parking already ran (it would never be parked).
 */
import { describe, expect, it, vi } from 'vitest';

const gate = vi.hoisted(() => {
  let release!: () => void;
  let reached!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const atGate = new Promise<void>((resolve) => (reached = resolve));
  return { release, reached, released, atGate };
});

// The layout factory is imported lazily by createWorkspace; hold it there.
vi.mock('@/services/ViewRegistry', async () => {
  gate.reached();
  await gate.released;
  return {
    ViewRegistry: {
      createLayout: () => ({ root: { type: 'component', componentType: 'X', title: 'X', componentState: {} } }),
    },
  };
});

import { FIXTURE_TOOL, registerFixtureModule } from '@/modules/__tests__/fixtureModule';
import { useModuleSettingsStore } from '@/modules/settingsStore';
import { useWorkspaceStore } from '../workspaceStore';
import { openTool } from '@/services/workspaceNavigation';

registerFixtureModule();

describe('createWorkspace while the module is switched off', () => {
  it('does not add the tab; openTool resolves null instead of rejecting', async () => {
    useModuleSettingsStore.setState({ enabled: {} });
    useWorkspaceStore.setState({ workspaces: new Map(), activeWorkspaceId: null, parkedWorkspaces: new Map() });
    const creating = useWorkspaceStore.getState().createWorkspace(FIXTURE_TOOL);
    const opening = openTool(FIXTURE_TOOL);
    await gate.atGate;
    useModuleSettingsStore.getState().setModuleEnabled('fixture', false);
    useWorkspaceStore.getState().parkModuleWorkspaces('fixture');
    gate.release();
    await expect(creating).rejects.toThrow(/not available/);
    await expect(opening).resolves.toBeNull();
    expect(useWorkspaceStore.getState().workspaces.size).toBe(0);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
  });
});
