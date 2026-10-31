import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const nav = vi.hoisted(() => ({ openTool: vi.fn(async () => 'tool') }));
vi.mock('@/services/workspaceNavigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/workspaceNavigation')>()),
  ...nav,
}));

import { PinnedTools } from '../PinnedTools';
import { useModuleSettingsStore } from '@/modules/settingsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { FIXTURE_TOOL, registerFixtureModule } from '@/modules/__tests__/fixtureModule';

registerFixtureModule();

describe('PinnedTools', () => {
  beforeEach(() => {
    nav.openTool.mockClear();
    useModuleSettingsStore.setState({ enabled: {}, pinned: [] });
    useWorkspaceStore.setState({ workspaces: new Map(), activeWorkspaceId: null });
  });

  it('renders nothing by default', () => {
    const { container } = render(<PinnedTools />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows pinned tools in menu order; a click opens or focuses the tool', () => {
    useModuleSettingsStore.setState({ pinned: [FIXTURE_TOOL, 'set-studio'] });
    render(<PinnedTools />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Studio', 'Fixture']);
    fireEvent.click(buttons[1]);
    expect(nav.openTool).toHaveBeenCalledWith(FIXTURE_TOOL);
  });

  it('marks the tool whose tab is in front, and hides a tool whose module is off', () => {
    useModuleSettingsStore.setState({ pinned: ['bids-explorer', FIXTURE_TOOL] });
    useWorkspaceStore.setState({
      workspaces: new Map([['b', { id: 'b', type: 'bids-explorer' } as never]]),
      activeWorkspaceId: 'b',
    });
    render(<PinnedTools />);
    expect(screen.getByRole('button', { name: 'BIDS' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Fixture' })).not.toHaveAttribute('aria-current');
    act(() => useModuleSettingsStore.getState().setModuleEnabled('fixture', false));
    expect(screen.queryByRole('button', { name: 'Fixture' })).toBeNull();
  });
});
