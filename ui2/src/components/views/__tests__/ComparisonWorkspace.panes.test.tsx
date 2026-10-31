import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useComparisonStore } from '@/stores/comparisonStore';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';

/** QA features 2026-10-31 §6: Compare opens with two panes; a 2/3/4 pane count. */

vi.mock('../ComparisonPanel', () => ({
  ComparisonPanel: ({ panel, letter }: { panel: { id: string; visibleLayerIds: Set<string> }; letter: string }) => (
    <div data-testid="pane" data-letter={letter}>
      {[...panel.visibleLayerIds].join(',')}
    </div>
  ),
}));
vi.mock('../CompareSharedColorbar', () => ({ CompareSharedColorbar: () => null }));

import { ComparisonWorkspace } from '../ComparisonWorkspace';

const WS = 'compare-panes-ws';
const view = (id: string) => ({ id, name: id, volumeId: id, visible: true, opacity: 1 });

describe('ComparisonWorkspace panes', () => {
  const original = useViewStateStore.getState().getWorkspaceViewState;
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })));
    useComparisonStore.getState().clearWorkspace(WS);
    useLayerStore.setState({
      layers: ['t1', 'z1', 'z2', 'z3'].map((id) => ({ id, name: id, volumeId: id, type: 'volume', visible: true })) as never,
    });
    const state = { ...useViewStateStore.getState().viewState, layers: ['t1', 'z1', 'z2', 'z3'].map(view) };
    useViewStateStore.setState({ getWorkspaceViewState: (() => state) as never });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useViewStateStore.setState({ getWorkspaceViewState: original });
    useComparisonStore.getState().clearWorkspace(WS);
  });

  it('opens with two panes over four layers, the maps first', () => {
    render(<ComparisonWorkspace workspaceId={WS} />);
    expect(screen.getAllByTestId('pane').map((p) => p.textContent)).toEqual(['z1', 'z2']);
    expect(screen.getByRole('radio', { name: '2' })).toHaveAttribute('aria-checked', 'true');
  });

  it('the pane count shows 3 or 4 panes and back', () => {
    render(<ComparisonWorkspace workspaceId={WS} />);
    act(() => fireEvent.click(screen.getByRole('radio', { name: '4' })));
    expect(screen.getAllByTestId('pane').map((p) => p.textContent)).toEqual(['z1', 'z2', 'z3', 't1']);
    act(() => fireEvent.click(screen.getByRole('radio', { name: '3' })));
    expect(screen.getAllByTestId('pane')).toHaveLength(3);
  });
});
