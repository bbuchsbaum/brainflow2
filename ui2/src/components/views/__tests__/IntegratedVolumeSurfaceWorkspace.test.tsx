import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

vi.mock('allotment', () => {
  type AllotmentMockProps = {
    children: React.ReactNode;
    vertical?: boolean;
    proportionalLayout?: boolean;
  };
  const Allotment = ({ children, vertical }: AllotmentMockProps) => (
    <div data-testid="allotment-mock" data-orientation={vertical ? 'vertical' : 'horizontal'}>
      {children}
    </div>
  );

  type PaneMockProps = {
    children: React.ReactNode;
    minSize?: number;
    preferredSize?: number | string;
    snap?: boolean;
  };
  const Pane = ({ children, minSize, preferredSize, snap }: PaneMockProps) => (
    <div
      data-testid="allotment-pane"
      data-minsize={minSize}
      data-preferred={preferredSize === undefined ? '' : String(preferredSize)}
      data-snap={snap ? 'true' : 'false'}
    >
      {children}
    </div>
  );

  const AllotmentWithPane = Allotment as typeof Allotment & {
    Pane: typeof Pane;
  };
  AllotmentWithPane.Pane = Pane;
  return { Allotment: AllotmentWithPane, default: AllotmentWithPane };
});

vi.mock('../OrthogonalPanelsWorkspace', () => ({
  OrthogonalPanelsWorkspace: () => (
    <div data-testid="orthogonal-panels-workspace-stub">orthogonal</div>
  ),
}));

// The workspace imports the surface panel through its lazy boundary
// (SurfaceViewPanelLazy) so Three.js stays out of the main bundle. Mock that
// module so the stub renders synchronously (no Suspense fallback) in tests.
vi.mock('../SurfaceViewPanelLazy', () => ({
  SurfaceViewPanel: () => <div data-testid="surface-view-panel-stub">surface</div>,
}));

vi.mock('../PinnedTimeRow', () => ({
  PinnedTimeRow: () => <div data-testid="pinned-time-row-stub">pinned</div>,
}));

vi.mock('@/components/ui/ArrangementMenu', () => ({
  ArrangementMenu: ({ showSplit }: { showSplit?: boolean }) => (
    <div data-testid="arrangement-menu-stub" data-show-split={showSplit ? 'true' : 'false'} />
  ),
}));

import { IntegratedVolumeSurfaceWorkspace } from '../IntegratedVolumeSurfaceWorkspace';
import { useLayerStore } from '@/stores/layerStore';
import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';

function resetLayerStore() {
  act(() => {
    useLayerStore.setState({
      layers: [],
      selectedLayerId: null,
      layerMetadata: new Map(),
      loadingLayers: new Set(),
      errorLayers: new Map(),
    });
  });
}

function seedLayer(layer: Record<string, unknown>) {
  act(() => {
    useLayerStore.setState({
      layers: [layer as never],
      selectedLayerId: (layer as { id: string }).id,
      layerMetadata: new Map(),
      loadingLayers: new Set(),
      errorLayers: new Map(),
    });
  });
}

describe('IntegratedVolumeSurfaceWorkspace', () => {
  beforeEach(() => {
    resetLayerStore();
    useLayoutSettingsStore.getState().resetLayoutSettings();
  });

  it('composes the orthogonal and surface regions without a dock or a second inspector', () => {
    render(<IntegratedVolumeSurfaceWorkspace />);

    expect(screen.getByTestId('integrated-volume-surface-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('integrated-workspace-orthogonal-region')).toBeInTheDocument();
    expect(screen.getByTestId('orthogonal-panels-workspace-stub')).toBeInTheDocument();
    expect(screen.getByTestId('integrated-workspace-surface-region')).toBeInTheDocument();
    expect(screen.getByTestId('surface-view-panel-stub')).toBeInTheDocument();

    // The bottom Activity|Plot|Log dock is now shell-level (CenterWithBottomDock
    // wraps every imaging mode), so Integrated no longer embeds its own dock…
    expect(screen.queryByTestId('bottom-workbench-dock')).not.toBeInTheDocument();
    // …nor a second inspector — the single shell right-rail Inspector serves
    // every mode (Design.md §12 / §20: no duplicate control surfaces).
    expect(screen.queryByTestId('integrated-workspace-inspector-region')).not.toBeInTheDocument();
  });

  it('renders the corner arrangement menu with the split toggle enabled', () => {
    render(<IntegratedVolumeSurfaceWorkspace />);
    const menu = screen.getByTestId('arrangement-menu-stub');
    expect(menu).toBeInTheDocument();
    expect(menu).toHaveAttribute('data-show-split', 'true');
  });

  it('reflects the integrated split orientation from the store', () => {
    const { rerender } = render(<IntegratedVolumeSurfaceWorkspace />);
    expect(screen.getByTestId('integrated-volume-surface-workspace')).toHaveAttribute(
      'data-split',
      'horizontal',
    );

    act(() => {
      useLayoutSettingsStore.getState().setIntegratedSplit('vertical');
    });
    rerender(<IntegratedVolumeSurfaceWorkspace />);
    expect(screen.getByTestId('integrated-volume-surface-workspace')).toHaveAttribute(
      'data-split',
      'vertical',
    );
  });

  it('omits the pinned time row when no layer is selected', () => {
    render(<IntegratedVolumeSurfaceWorkspace />);

    expect(
      screen
        .getByTestId('integrated-volume-surface-workspace')
        .getAttribute('data-pinned-time-row'),
    ).toBe('false');
    expect(screen.queryByTestId('pinned-time-row-stub')).toBeNull();
  });

  it('omits the pinned time row when the active layer is 3D', () => {
    seedLayer({ id: 'vol-1', name: 'Sample 3D', type: 'volume' });

    render(<IntegratedVolumeSurfaceWorkspace />);

    expect(
      screen
        .getByTestId('integrated-volume-surface-workspace')
        .getAttribute('data-pinned-time-row'),
    ).toBe('false');
    expect(screen.queryByTestId('pinned-time-row-stub')).toBeNull();
  });

  it('mounts the pinned time row when the active layer is 4D', () => {
    seedLayer({
      id: 'vol-1',
      name: 'BOLD run-01',
      type: 'volume',
      timeSeriesInfo: { num_timepoints: 200 },
    });

    render(<IntegratedVolumeSurfaceWorkspace />);

    expect(
      screen
        .getByTestId('integrated-volume-surface-workspace')
        .getAttribute('data-pinned-time-row'),
    ).toBe('true');
    expect(screen.getByTestId('pinned-time-row-stub')).toBeInTheDocument();
  });

  it('toggles the pinned time row reactively when the active layer changes between 4D and 3D', () => {
    seedLayer({
      id: 'vol-1',
      name: 'BOLD run-01',
      type: 'volume',
      timeSeriesInfo: { num_timepoints: 200 },
    });

    render(<IntegratedVolumeSurfaceWorkspace />);

    expect(screen.getByTestId('pinned-time-row-stub')).toBeInTheDocument();

    seedLayer({ id: 'vol-2', name: 'Anatomy', type: 'volume' });

    expect(screen.queryByTestId('pinned-time-row-stub')).toBeNull();
    expect(
      screen
        .getByTestId('integrated-volume-surface-workspace')
        .getAttribute('data-pinned-time-row'),
    ).toBe('false');
  });

  it('does not import-time fail when the surface store has no surfaces (empty-state passes through to SurfaceViewPanel)', () => {
    // SurfaceViewPanel itself owns the empty-state UI. The shell must compose
    // the panel without a surfaceHandle and let the panel decide what to show.
    render(<IntegratedVolumeSurfaceWorkspace />);
    expect(screen.getByTestId('surface-view-panel-stub')).toBeInTheDocument();
  });
});
