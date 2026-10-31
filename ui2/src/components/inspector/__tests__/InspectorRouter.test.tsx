import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useFeatureFlagStore } from '@/stores/featureFlagStore';
import type { DisplayMode, DisplayModeInfo } from '@/hooks/useDisplayMode';

const openFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/services/transport', () => ({ getTransport: () => ({ invoke: openFile }) }));
vi.mock('../imaging/InspectorLoadDialogs', () => ({
  AtlasPicker: () => <div role="dialog">Atlas catalog</div>,
  ProjectionPicker: () => <div role="dialog">Projection picker</div>,
}));

let currentDisplayMode: DisplayModeInfo = {
  mode: 'integrated',
  label: 'Integrated',
  workspaceType: 'integrated',
};

vi.mock('@/hooks/useDisplayMode', () => ({
  useDisplayMode: () => currentDisplayMode,
}));

vi.mock('@/components/inspector/imaging/ImagingInspector', () => ({
  ImagingInspector: () => <div data-testid="imaging-body">imaging</div>,
}));

vi.mock('@/components/studio/StudioInspectorPanel', () => ({
  StudioInspectorPanel: () => <div data-testid="studio-body">studio</div>,
}));

vi.mock('@/components/inspector/bids/BidsInspector', () => ({
  BidsInspector: () => <div data-testid="bids-body">bids</div>,
}));

vi.mock('@/hooks/useSceneStack', () => ({
  useSceneStack: () => ({
    volumes: [],
    surfaces: [],
    mappings: [],
    totalCount: 0,
  }),
}));

vi.mock('@/stores/inspectorSelectionStore', () => ({
  useInspectorSelectionStore: (selector: any) =>
    selector({ activeItemId: null, activeItemKind: null }),
}));

import { InspectorRouter } from '@/components/inspector/InspectorRouter';

function setMode(mode: DisplayMode, label = mode) {
  currentDisplayMode = {
    mode,
    label,
    workspaceType: null,
  };
}

describe('InspectorRouter', () => {
  beforeEach(() => {
    setMode('integrated', 'Integrated');
    useFeatureFlagStore.getState().setExperimentalFeatures(false);
  });

  it('renders the imaging body for orthogonal/integrated/mosaic/compare', () => {
    for (const mode of ['orthogonal', 'integrated', 'mosaic', 'compare', 'surface'] as const) {
      setMode(mode);
      const { unmount } = render(<InspectorRouter />);
      expect(screen.getByTestId('imaging-body')).toBeInTheDocument();
      unmount();
    }
  });

  it('renders the studio body for set-studio', () => {
    setMode('set-studio', 'Set studio');
    render(<InspectorRouter />);
    expect(screen.getByTestId('studio-body')).toBeInTheDocument();
  });

  it('renders the bids body for bids', () => {
    setMode('bids', 'BIDS');
    render(<InspectorRouter />);
    expect(screen.getByTestId('bids-body')).toBeInTheDocument();
  });

  it('hides the unfinished Annotate tab unless Experimental features is on', () => {
    setMode('integrated', 'Integrated');
    useFeatureFlagStore.getState().setExperimentalFeatures(false);
    const { unmount } = render(<InspectorRouter />);
    expect(screen.queryByRole('tablist', { name: 'Inspector mode' })).toBeNull();
    expect(screen.queryByRole('tab', { name: /annotate/i })).toBeNull();
    expect(screen.queryByText(/Annotate mode is not yet enabled/)).toBeNull();
    // The body is the Inspector itself, not a tab panel pointing at a missing tab.
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(screen.getByRole('button', { name: /load/i })).toBeInTheDocument();
    unmount();
    act(() => useFeatureFlagStore.getState().setExperimentalFeatures(true));
    render(<InspectorRouter />);
    expect(screen.getByRole('tab', { name: /annotate/i })).toBeInTheDocument();
  });

  it('renders the context toolbar with Load + Annotate (no inner INSPECTOR title)', () => {
    setMode('integrated', 'Integrated');
    useFeatureFlagStore.getState().setExperimentalFeatures(true);
    render(<InspectorRouter />);
    // Stage A: the inner INSPECTOR title and `Active view: <mode>` subtitle
    // are removed. The dock tab carries "INSPECTOR"; the panel header is a
    // thin context toolbar with the load action + annotate mode toggle.
    expect(screen.queryByText(/Active view:/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load/i })).toBeInTheDocument();
    // Inspect / Annotate switch the pane's content: flat tabs (V5 taxonomy).
    expect(screen.getByRole('tablist', { name: 'Inspector mode' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /annotate/i })).toBeInTheDocument();
  });

  it('toggles annotate mode via the Inspect / Annotate tabs', () => {
    setMode('integrated', 'Integrated');
    useFeatureFlagStore.getState().setExperimentalFeatures(true);
    render(<InspectorRouter />);
    const annotate = screen.getByRole('tab', { name: /annotate/i });
    const inspect = screen.getByRole('tab', { name: /inspect$/i });
    expect(annotate).toHaveAttribute('aria-selected', 'false');
    expect(inspect).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(annotate);
    expect(annotate).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/Annotate mode is not yet enabled/)).toBeInTheDocument();
    // The visible body is the selected tab's panel.
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', annotate.id);
    fireEvent.click(inspect);
    expect(inspect).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText(/Annotate mode is not yet enabled/)).toBeNull();
    // Keyboard: ArrowRight moves to and selects Annotate (automatic activation).
    inspect.focus();
    fireEvent.keyDown(inspect, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /annotate/i })).toHaveAttribute('aria-selected', 'true');
  });
  it('opens the canonical file dialog from both file actions', () => {
    render(<InspectorRouter />);
    for (const name of ['Load volume…', 'Load surface…']) {
      fireEvent.click(screen.getByRole('button', { name: 'Load' }));
      fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(name) }));
    }
    expect(openFile).toHaveBeenCalledWith('open_file_dialog');
    expect(openFile).toHaveBeenCalledTimes(2);
  });

  it('opens atlas selection and supports Escape and arrow-key navigation', () => {
    render(<InspectorRouter />);
    const trigger = screen.getByRole('button', { name: 'Load' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: /Load volume/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: /Load surface/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: /Load atlas/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Atlas catalog');
  });
});
