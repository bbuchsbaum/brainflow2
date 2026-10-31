/**
 * The Analysis module in the shell: stage and bridge match, default-off
 * contributions, its tab, teardown and restore of saved `analysis-workbench`
 * tabs. Lives with the framework tests because it drives the shell.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BRIDGE_MODULES } from '@brainflow/api';
import analysisManifest, { ANALYSIS_WORKBENCH } from '@/modules/analysis/module';
import { useAnalysisStore } from '@/modules/analysis/stores/analysisStore';
import { moduleRegistry } from '@/modules/registry';
import { useModuleSettingsStore } from '@/modules/settingsStore';
import { MockTransport, setTransport } from '@/services/transport';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { ModuleWorkspace } from '@/components/modules/ModuleWorkspace';

const descriptor = {
  id: 'smooth',
  name: 'Gaussian smoothing',
  version: '1.0.0',
  api_version: '1',
  description: 'Smooth a volume.',
  inputs: ['volume'],
  params_schema: {},
  outputs: ['volume'],
  runner: { type: 'builtin' },
};

const setAnalysis = (on: boolean) => useModuleSettingsStore.getState().setModuleEnabled('analysis', on);

describe('the Analysis module', () => {
  beforeEach(() => {
    localStorage.clear();
    useModuleSettingsStore.setState({ enabled: {}, pinned: [] });
    useWorkspaceStore.setState({ workspaces: new Map(), activeWorkspaceId: null, parkedWorkspaces: new Map() });
  });
  afterEach(() => {
    moduleRegistry.connectShell(null);
    setAnalysis(false);
  });

  it('is experimental, desktop-only and matches its bridge module', () => {
    expect(analysisManifest.stage).toBe('experimental');
    expect(analysisManifest.hosts).toEqual(['desktop']);
    expect(BRIDGE_MODULES.analysis.stage).toBe(analysisManifest.stage);
    expect(BRIDGE_MODULES.analysis.version).toBe(analysisManifest.version);
    expect(moduleRegistry.getModule('analysis')).toBe(analysisManifest);
  });

  it('is off by default and then contributes nothing, but its persisted tab type stays known', () => {
    expect(moduleRegistry.isEnabled('analysis')).toBe(false);
    expect(moduleRegistry.getTools().map((t) => t.type)).not.toContain(ANALYSIS_WORKBENCH);
    expect(moduleRegistry.getCommands().map((c) => c.id)).not.toContain('analysis.open');
    expect(moduleRegistry.getMenuItems()).toEqual([]);
    expect(moduleRegistry.getEnabledBridgeModules()).not.toContain('analysis');
    expect(moduleRegistry.workspaceModule(ANALYSIS_WORKBENCH)).toBe('analysis');
    expect(moduleRegistry.getToolDescriptor(ANALYSIS_WORKBENCH)?.title).toBe('Analysis Workbench');
  });

  it('switched on, it is where Analysis always was, unpinned and without a shortcut', async () => {
    setAnalysis(true);
    const tool = moduleRegistry.getTools().find((t) => t.type === ANALYSIS_WORKBENCH);
    expect(tool).toMatchObject({ label: 'Analysis', shortLabel: 'Analysis', stage: 'experimental' });
    expect(tool?.shortcutKey).toBeUndefined();
    expect(moduleRegistry.getMenuItems()).toEqual([{ command: 'analysis.open', label: 'Analysis', path: 'view/workspace' }]);
    expect(moduleRegistry.getKeybindings()).toEqual([]);
    expect(moduleRegistry.getProposals()).toEqual({ pinned: [], openAtStartup: [] });
    expect(moduleRegistry.getEnabledBridgeModules()).toContain('analysis');

    const openWorkspace = vi.fn(async () => 'ws-analysis');
    moduleRegistry.connectShell({ openWorkspace, activeWorkspaceType: () => null });
    await expect(moduleRegistry.executeCommand('analysis.open')).resolves.toBe(true);
    expect(openWorkspace).toHaveBeenCalledWith(ANALYSIS_WORKBENCH);
  });

  it('renders the workbench in its tab and loads the analyses through its bridge client', async () => {
    const transport = new MockTransport();
    transport.setMockResponse('list_analyses', [descriptor]);
    setTransport(transport);
    setAnalysis(true);
    render(<ModuleWorkspace workspaceId="ws-a" workspaceType={ANALYSIS_WORKBENCH} />);
    expect(await screen.findByRole('button', { name: 'Run Analysis' })).toBeInTheDocument();
    await waitFor(() => expect(useAnalysisStore.getState().descriptors).toHaveLength(1));
    expect(transport.getCallLog().map((c) => c.cmd)).toContain('list_analyses');
  });

  it('switching it off resets the session and drops responses still in flight', async () => {
    setAnalysis(true);
    await moduleRegistry.ensureActive('analysis');
    let release!: (value: unknown) => void;
    const transport = new MockTransport();
    transport.setMockResponse('list_analyses', () => new Promise((resolve) => (release = resolve)));
    setTransport(transport);
    useAnalysisStore.setState({ jobs: [{ job_id: 'j1' } as never], loadStatus: 'idle' });
    const loading = useAnalysisStore.getState().loadAnalyses();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));

    setAnalysis(false);
    expect(useAnalysisStore.getState().jobs).toEqual([]);
    expect(useAnalysisStore.getState().loadStatus).toBe('idle');
    release([descriptor]);
    await loading;
    expect(useAnalysisStore.getState().descriptors).toEqual([]);
  });

  it('a saved analysis-workbench tab restores while the module is on and is kept while off', async () => {
    const saved = {
      version: 3,
      state: {
        workspaces: [
          [
            'analysis-workbench-1',
            {
              id: 'analysis-workbench-1',
              type: ANALYSIS_WORKBENCH,
              title: 'Analysis Workbench',
              presetId: null,
              timestamp: 1700000000000,
              isActive: true,
              layoutConfig: { root: { type: 'component', componentType: 'AnalysisWorkbenchWorkspace', title: 'Analysis Workbench', componentState: {} } },
              panelStates: [],
            },
          ],
        ],
        activeWorkspaceId: 'analysis-workbench-1',
      },
    };
    localStorage.setItem('brainflow2-workspace', JSON.stringify(saved));
    setAnalysis(true);
    await useWorkspaceStore.persist.rehydrate();
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('analysis-workbench-1');

    localStorage.setItem('brainflow2-workspace', JSON.stringify(saved));
    setAnalysis(false);
    await useWorkspaceStore.persist.rehydrate();
    expect(useWorkspaceStore.getState().workspaces.size).toBe(0);
    expect([...useWorkspaceStore.getState().parkedWorkspaces.keys()]).toEqual(['analysis-workbench-1']);
    setAnalysis(true);
    useWorkspaceStore.getState().unparkModuleWorkspaces('analysis');
    expect(useWorkspaceStore.getState().workspaces.get('analysis-workbench-1')?.type).toBe(ANALYSIS_WORKBENCH);

    // Upgrading from a v2 payload while Analysis is off parks the tab and saves it.
    localStorage.setItem('brainflow2-workspace', JSON.stringify({ ...saved, version: 2 }));
    setAnalysis(false);
    await useWorkspaceStore.persist.rehydrate();
    expect([...useWorkspaceStore.getState().parkedWorkspaces.keys()]).toEqual(['analysis-workbench-1']);
    const written = JSON.parse(localStorage.getItem('brainflow2-workspace')!);
    expect(written.version).toBe(3);
    expect(written.state.parkedWorkspaces.map(([id]: [string]) => id)).toEqual(['analysis-workbench-1']);
  });
});
