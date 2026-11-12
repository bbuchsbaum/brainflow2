import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { BottomWorkbenchDock } from '@/components/layout/BottomWorkbenchDock';
import { SET_STUDIO_DOCK_TABS, POPULATION_VALUES_TAB } from '../populationDock';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { usePopulationViewStore } from '@/stores/populationViewStore';
import { StudioDesignPanel } from '../StudioDesignPanel';

vi.mock('@/services/SampleProvider', () => ({
  sampleProvider: { sample: vi.fn(() => new Promise(() => {})) },
}));
vi.mock('@/services/transport', () => ({ getTransport: () => ({ invoke: vi.fn() }) }));
// The centre: a lens marker, so only what StudioCenterPane itself adds is checked.
vi.mock('../LensCanvas', () => ({ LensCanvas: () => <div data-testid="lens">lens</div> }));
vi.mock('@/services/TemplateService', () => ({
  getTemplateService: () => ({ getTemplateCatalog: async () => [] }),
}));

const state = () => useSetStudioStore.getState();
beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  state().loadDemoSession();
  state().setActiveLens('population');
});
afterEach(cleanup);
const slots = { plot: <div>plot body</div>, activity: <div />, log: <div /> };

describe('the Set studio dock\'s Values tab', () => {
  it('is the first tab, and says what to do before anything is pinned', async () => {
    render(
      <BottomWorkbenchDock
        {...slots}
        extraTabs={SET_STUDIO_DOCK_TABS}
        activeTab={POPULATION_VALUES_TAB}
        onActiveTabChange={vi.fn()}
      />,
    );
    const tabs = within(screen.getByTestId('bottom-dock-tablist')).getAllByRole('tab');
    expect(tabs[0]).toHaveTextContent('Values');
    expect(tabs[0]).toHaveAttribute('data-testid', `bottom-dock-tab-${POPULATION_VALUES_TAB}`);
    // The tab is lazy: its first load can outlast the default wait.
    const empty = await screen.findByTestId('population-values-empty', {}, { timeout: 5000 });
    // Nothing pinned: one quiet line, never a centred hero (A8).
    expect(empty).toHaveTextContent(/^Nothing pinned ·/);
    expect(empty).toHaveClass('h-7');
    // No tab-bar badge text: the tab is just "Values".
    expect(tabs[0].textContent).toBe('Values');
    fireEvent.click(within(empty).getByRole('button', { name: 'Pin crosshair' }));
    expect(state().population.pinnedProbe).not.toBeNull();
    // The header holds the cutout width (one home, read by tiles and cutouts).
    fireEvent.change(screen.getByRole('combobox', { name: 'Cutout width' }), {
      target: { value: '48' },
    });
    expect(usePopulationViewStore.getState().cutoutWidthMm).toBe(48);
    // Selection commands are not here: they are the Inspector's.
    for (const name of ['All', 'None', 'Focused only', 'Undo selection', 'Refresh', 'Hide values'])
      expect(screen.queryByRole('button', { name, exact: true })).toBeNull();
  });
});

describe('the values below the images', () => {
  it('are gone from the Set studio centre: they are the dock\'s Values tab', async () => {
    const { StudioCenterPane } = await import('../StudioCenterPane');
    render(<StudioCenterPane />);
    expect(screen.getByTestId('lens')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Population values' })).toBeNull();
  });
});

describe('the Subjects list in the Population lens', () => {
  const listed = () =>
    screen
      .getAllByRole('button')
      .map((button) => button.textContent ?? '')
      .filter((text) => /^sub00\d/.test(text))
      .map((text) => text.slice(0, 6));

  it('follows the lens order by default, can list by ID, and hides its own Sort', () => {
    act(() =>
      usePopulationViewStore
        .getState()
        .setLensOrder({ ids: ['sub004', 'sub002', 'sub006', 'sub001', 'sub003', 'sub005'], label: 'Similarity order' }),
    );
    render(<StudioDesignPanel />);
    const order = screen.getByRole('group', { name: 'Subjects order' });
    expect(within(order).getByRole('radio', { name: 'Montage' })).toBeChecked();
    expect(within(order).getByRole('status')).toHaveTextContent(
      'Same order as the montage: Similarity order',
    );
    const lens = ['sub004', 'sub002', 'sub006', 'sub001', 'sub003', 'sub005'];
    expect(listed()).toEqual(lens.filter((id) => listed().includes(id)));
    expect(listed()[0]).toBe('sub004');
    // Its own Sort would be a second order: hidden here.
    expect(screen.queryByText('Design order')).toBeNull();
    fireEvent.click(within(order).getByRole('radio', { name: 'ID' }));
    expect(usePopulationViewStore.getState().subjectsOrder).toBe('id');
    expect(listed()).toEqual([...listed()].sort());
    expect(listed()[0]).toBe('sub001');
    act(() => usePopulationViewStore.getState().setSubjectsOrder('montage'));
  });

  it('keeps its own Sort in the other lenses', () => {
    act(() => state().setActiveLens('deck'));
    render(<StudioDesignPanel />);
    expect(screen.queryByRole('group', { name: 'Subjects order' })).toBeNull();
  });
});
