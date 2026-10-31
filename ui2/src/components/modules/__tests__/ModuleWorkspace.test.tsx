import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FIXTURE_TOOL, fixtureActivate, registerFixtureModule } from '@/modules/__tests__/fixtureModule';
import { useModuleSettingsStore } from '@/modules/settingsStore';
import { defineModule } from '@/modules/api';
import { moduleRegistry } from '@/modules/registry';
import { ModuleWorkspace } from '../ModuleWorkspace';

registerFixtureModule();
moduleRegistry.register(
  defineModule({
    id: 'broken',
    title: 'Broken',
    description: 'Fails to activate.',
    version: '0.1.0',
    stage: 'preview',
    hosts: ['desktop', 'browser'],
    contributes: {
      workspaces: [
        { id: 'broken.tool', title: 'Broken tool', label: 'Broken', component: () => Promise.resolve({ default: () => null }) },
      ],
    },
    activate: () => Promise.reject(new Error('chunk failed to load')),
  }),
);

describe('ModuleWorkspace', () => {
  beforeEach(() => {
    useModuleSettingsStore.setState({ enabled: {} });
  });

  it('activates the module once, then renders its tool component', async () => {
    const before = fixtureActivate.calls;
    render(<ModuleWorkspace workspaceId="ws-1" workspaceType={FIXTURE_TOOL} />);
    const tool = await screen.findByTestId('fixture-tool');
    expect(tool).toHaveAttribute('data-workspace-id', 'ws-1');
    expect(fixtureActivate.calls).toBe(before + 1);
    expect(moduleRegistry.isActive('fixture')).toBe(true);
  });

  it('says when the module is switched off', () => {
    useModuleSettingsStore.getState().setModuleEnabled('fixture', false);
    render(<ModuleWorkspace workspaceId="ws-1" workspaceType={FIXTURE_TOOL} />);
    expect(screen.getByTestId('module-workspace-off')).toHaveTextContent('Fixture is switched off');
  });

  it('shows why a module could not start', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ModuleWorkspace workspaceId="ws-2" workspaceType="broken.tool" />);
    expect(await screen.findByTestId('module-workspace-failed')).toHaveTextContent('chunk failed to load');
    error.mockRestore();
  });

  it('reports an unknown type', () => {
    render(<ModuleWorkspace workspaceId="ws-3" workspaceType="nobody.tool" />);
    expect(screen.getByTestId('workspace-router-unknown')).toHaveTextContent('nobody.tool');
  });
});
