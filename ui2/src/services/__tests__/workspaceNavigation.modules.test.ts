/**
 * Tools from the module registry and startup tabs (Settings › Top bar).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useFeatureFlagStore } from '@/stores/featureFlagStore';
import { initializeViewRegistry } from '@/services/ViewRegistry';
import { useModuleSettingsStore } from '@/modules/settingsStore';
import { FIXTURE_TOOL, registerFixtureModule } from '@/modules/__tests__/fixtureModule';
import {
  ensureDefaultView,
  goToWorkspaceType,
  isToolWorkspaceType,
  openTool,
  resetStartupTabsForTests,
  startupTabCandidates,
  toolDestinations,
} from '../workspaceNavigation';

registerFixtureModule();

const store = () => useWorkspaceStore.getState();
const types = () => [...store().workspaces.values()].map((w) => w.type);

describe('workspaceNavigation with modules', () => {
  beforeEach(() => {
    localStorage.clear();
    initializeViewRegistry();
    resetStartupTabsForTests();
    useWorkspaceStore.setState({ workspaces: new Map(), activeWorkspaceId: null, parkedWorkspaces: new Map() });
    useFeatureFlagStore.setState({ integratedWorkspaceV1: true });
    useModuleSettingsStore.setState({ enabled: {}, startup: { mode: 'restore', tabs: ['orthogonal-flexible'] } });
  });

  it('lists core tools first, then enabled module tools', () => {
    expect(toolDestinations().map((t) => t.type).slice(0, 2)).toEqual(['set-studio', 'bids-explorer']);
    expect(toolDestinations().map((t) => t.type)).toContain(FIXTURE_TOOL);
    useModuleSettingsStore.getState().setModuleEnabled('fixture', false);
    expect(toolDestinations().map((t) => t.type)).not.toContain(FIXTURE_TOOL);
    // Still a tool type (its tabs are parked, not views).
    expect(isToolWorkspaceType(FIXTURE_TOOL)).toBe(true);
  });

  it('opens a module tool once; a switched-off tool does not open', async () => {
    const first = await openTool(FIXTURE_TOOL);
    expect(await openTool(FIXTURE_TOOL)).toBe(first);
    expect(types()).toEqual([FIXTURE_TOOL]);

    useWorkspaceStore.setState({ workspaces: new Map(), activeWorkspaceId: null });
    useModuleSettingsStore.getState().setModuleEnabled('fixture', false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(openTool(FIXTURE_TOOL)).resolves.toBeNull();
    goToWorkspaceType(FIXTURE_TOOL);
    await Promise.resolve();
    expect(types()).toEqual([]);
    warn.mockRestore();
  });

  it('restore mode: launch with nothing saved opens the one default view', async () => {
    await ensureDefaultView({ atLaunch: true });
    expect(types()).toEqual(['orthogonal-flexible']);
  });

  it('fixed mode: launch opens the list in order with the first in front, once', async () => {
    useModuleSettingsStore.setState({
      startup: { mode: 'fixed', tabs: ['mosaic', 'set-studio', FIXTURE_TOOL] },
    });
    const first = await ensureDefaultView({ atLaunch: true });
    expect(types()).toEqual(['mosaic', 'set-studio', FIXTURE_TOOL]);
    expect(store().activeWorkspaceId).toBe(first);
    expect(store().workspaces.get(first!)?.type).toBe('mosaic');

    // Closing every tab later brings back the default view, not the list.
    useWorkspaceStore.setState({ workspaces: new Map(), activeWorkspaceId: null });
    await ensureDefaultView({ atLaunch: true });
    expect(types()).toEqual(['orthogonal-flexible']);
  });

  it('fixed mode skips tools whose module is off, and falls back to the default view', async () => {
    useModuleSettingsStore.setState({
      enabled: { fixture: false },
      startup: { mode: 'fixed', tabs: [FIXTURE_TOOL] },
    });
    await ensureDefaultView({ atLaunch: true });
    expect(types()).toEqual(['orthogonal-flexible']);
  });

  it('offers one view per layout, then the tools, as startup candidates', () => {
    expect(startupTabCandidates().map((c) => c.label)).toEqual([
      'Orthogonal view',
      'Integrated view',
      'Mosaic view',
      'Compare view',
      'Set studio',
      'BIDS',
      'Fixture',
    ]);
    useFeatureFlagStore.setState({ integratedWorkspaceV1: false });
    expect(startupTabCandidates().map((c) => c.type)).not.toContain('integrated');
  });
});
