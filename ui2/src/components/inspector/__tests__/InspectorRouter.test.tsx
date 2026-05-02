import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DisplayMode, DisplayModeInfo } from '@/hooks/useDisplayMode';

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

vi.mock('@/components/inspector/analysis/AnalysisInspector', () => ({
  AnalysisInspector: () => <div data-testid="analysis-body">analysis</div>,
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
    setMode('set-studio', 'Set Studio');
    render(<InspectorRouter />);
    expect(screen.getByTestId('studio-body')).toBeInTheDocument();
  });

  it('renders the bids body for bids', () => {
    setMode('bids', 'BIDS');
    render(<InspectorRouter />);
    expect(screen.getByTestId('bids-body')).toBeInTheDocument();
  });

  it('renders the analysis body for analysis', () => {
    setMode('analysis', 'Analysis');
    render(<InspectorRouter />);
    expect(screen.getByTestId('analysis-body')).toBeInTheDocument();
  });

  it('renders the context toolbar with Load + Annotate (no inner INSPECTOR title)', () => {
    setMode('integrated', 'Integrated');
    render(<InspectorRouter />);
    // Stage A: the inner INSPECTOR title and `Active view: <mode>` subtitle
    // are removed. The dock tab carries "INSPECTOR"; the panel header is a
    // thin context toolbar with the load action + annotate mode toggle.
    expect(screen.queryByText(/Active view:/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /annotate/i })).toBeInTheDocument();
  });

  it('toggles annotate mode via the Annotate button', () => {
    setMode('integrated', 'Integrated');
    render(<InspectorRouter />);
    const annotateBtn = screen.getByRole('button', { name: /annotate/i });
    expect(annotateBtn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(annotateBtn);
    expect(annotateBtn).toHaveAttribute('aria-pressed', 'true');
  });
});
