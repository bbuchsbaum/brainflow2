import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { registerFixtureModule } from '@/modules/__tests__/fixtureModule';
import { useModuleSettingsStore } from '@/modules/settingsStore';
import { BottomWorkbenchDock } from '../BottomWorkbenchDock';

registerFixtureModule();

const slots = {
  plot: <div data-testid="slot-plot" />,
  activity: <div data-testid="slot-activity" />,
  log: <div data-testid="slot-log" />,
  clusters: <div data-testid="slot-clusters" />,
};

describe('BottomWorkbenchDock with a module dock tab', () => {
  beforeEach(() => useModuleSettingsStore.setState({ enabled: {} }));

  it('adds the module tab after the core tabs and renders it lazily', async () => {
    render(<BottomWorkbenchDock {...slots} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Activity', 'Plot', 'Clusters', 'Log', 'History']);
    fireEvent.click(screen.getByTestId('bottom-dock-tab-fixture.history'));
    expect(await screen.findByTestId('fixture-history')).toBeInTheDocument();
  });

  it('falls back to the default tab when the remembered tab’s module is off', () => {
    const { rerender } = render(<BottomWorkbenchDock {...slots} activeTab="fixture.history" />);
    act(() => useModuleSettingsStore.getState().setModuleEnabled('fixture', false));
    rerender(<BottomWorkbenchDock {...slots} activeTab="fixture.history" />);
    expect(screen.getByTestId('bottom-workbench-dock')).toHaveAttribute('data-active-tab', 'plot');
    expect(screen.getByTestId('slot-plot')).toBeInTheDocument();
  });
});
