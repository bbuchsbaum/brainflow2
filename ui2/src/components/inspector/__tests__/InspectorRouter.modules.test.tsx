import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useFeatureFlagStore } from '@/stores/featureFlagStore';
import type { DisplayModeInfo } from '@/hooks/useDisplayMode';
import { FIXTURE_TOOL, registerFixtureModule } from '@/modules/__tests__/fixtureModule';
import { moduleRegistry } from '@/modules/registry';
import { useModuleSettingsStore } from '@/modules/settingsStore';

vi.mock('@/services/transport', () => ({ getTransport: () => ({ invoke: vi.fn() }) }));
vi.mock('../imaging/InspectorLoadDialogs', () => ({ AtlasPicker: () => null, ProjectionPicker: () => null }));
vi.mock('@/components/inspector/imaging/ImagingInspector', () => ({
  ImagingInspector: () => <div data-testid="imaging-body">imaging</div>,
}));
vi.mock('@/hooks/useSceneStack', () => ({ useSceneStack: () => ({ totalCount: 0 }) }));

let displayMode: DisplayModeInfo = { mode: 'integrated', label: 'Integrated', workspaceType: 'integrated' };
vi.mock('@/hooks/useDisplayMode', () => ({ useDisplayMode: () => displayMode }));

import { InspectorRouter } from '@/components/inspector/InspectorRouter';

registerFixtureModule();

describe('InspectorRouter with a module', () => {
  beforeEach(() => {
    useFeatureFlagStore.getState().setExperimentalFeatures(false);
    useModuleSettingsStore.setState({ enabled: {} });
    displayMode = { mode: 'integrated', label: 'Integrated', workspaceType: 'integrated' };
  });

  it('renders the inspector body a module tool declares, once the module is active', async () => {
    displayMode = { mode: 'module-tool', label: 'Fixture', workspaceType: FIXTURE_TOOL };
    await moduleRegistry.ensureActive('fixture');
    render(<InspectorRouter />);
    expect(await screen.findByTestId('fixture-inspector')).toBeInTheDocument();
  });

  it('adds a module inspector mode as a tab, without Experimental features', async () => {
    render(<InspectorRouter />);
    const tabs = screen.getByRole('tablist', { name: 'Inspector mode' });
    expect([...tabs.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Inspect', 'Fixture mode']);
    fireEvent.click(screen.getByRole('tab', { name: 'Fixture mode' }));
    expect(await screen.findByTestId('fixture-mode')).toBeInTheDocument();

    // The module goes off: its tab disappears and the Inspector comes back.
    act(() => useModuleSettingsStore.getState().setModuleEnabled('fixture', false));
    expect(screen.queryByRole('tablist', { name: 'Inspector mode' })).toBeNull();
    expect(screen.getByTestId('imaging-body')).toBeInTheDocument();
  });
});
