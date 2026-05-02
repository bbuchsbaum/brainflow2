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
    <div
      data-testid="allotment-mock"
      data-orientation={vertical ? 'vertical' : 'horizontal'}
    >
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

  const AllotmentWithPane = Allotment as typeof Allotment & { Pane: typeof Pane };
  AllotmentWithPane.Pane = Pane;
  return { Allotment: AllotmentWithPane, default: AllotmentWithPane };
});

vi.mock('../OrthogonalPanelsWorkspace', () => ({
  OrthogonalPanelsWorkspace: () => (
    <div data-testid="orthogonal-panels-workspace-stub">orthogonal</div>
  ),
}));

vi.mock('../SurfaceViewPanel', () => ({
  SurfaceViewPanel: () => (
    <div data-testid="surface-view-panel-stub">surface</div>
  ),
}));

vi.mock('@/components/layout/BottomWorkbenchDock', () => ({
  BottomWorkbenchDock: ({
    plot,
    activity,
    log,
  }: {
    plot: React.ReactNode;
    activity: React.ReactNode;
    log: React.ReactNode;
  }) => (
    <div data-testid="bottom-workbench-dock-stub">
      <div data-testid="dock-slot-plot">{plot}</div>
      <div data-testid="dock-slot-activity">{activity}</div>
      <div data-testid="dock-slot-log">{log}</div>
    </div>
  ),
}));

vi.mock('@/components/panels/PlotPanel', () => ({
  PlotPanel: (props: { defaultMode?: string }) => (
    <div
      data-testid="plot-panel-stub"
      data-default-mode={props.defaultMode ?? ''}
    >
      plot-panel
    </div>
  ),
}));

vi.mock('@/components/panels/InspectorAnnotatePanel', () => ({
  InspectorAnnotatePanel: () => (
    <div data-testid="inspector-annotate-panel-stub">inspector-annotate</div>
  ),
}));

vi.mock('@/components/panels/ActivityPanel', () => ({
  ActivityPanel: () => <div data-testid="activity-panel-stub">activity</div>,
}));

vi.mock('@/components/panels/LogPanel', () => ({
  LogPanel: () => <div data-testid="log-panel-stub">log</div>,
}));

vi.mock('../PinnedTimeRow', () => ({
  PinnedTimeRow: () => <div data-testid="pinned-time-row-stub">pinned</div>,
}));

import { IntegratedVolumeSurfaceWorkspace } from '../IntegratedVolumeSurfaceWorkspace';
import { useLayerStore } from '@/stores/layerStore';

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
  });

  it('composes the orthogonal region, surface region, inspector rail, and bottom dock without modifying their internals', () => {
    render(<IntegratedVolumeSurfaceWorkspace />);

    expect(screen.getByTestId('integrated-volume-surface-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('integrated-workspace-orthogonal-region')).toBeInTheDocument();
    expect(screen.getByTestId('orthogonal-panels-workspace-stub')).toBeInTheDocument();
    expect(screen.getByTestId('integrated-workspace-surface-region')).toBeInTheDocument();
    expect(screen.getByTestId('surface-view-panel-stub')).toBeInTheDocument();
    expect(screen.getByTestId('integrated-workspace-inspector-region')).toBeInTheDocument();
    expect(screen.getByTestId('inspector-annotate-panel-stub')).toBeInTheDocument();
    expect(screen.getByTestId('bottom-workbench-dock-stub')).toBeInTheDocument();
  });

  it('routes PlotPanel, ActivityPanel, and LogPanel into the dock slots', () => {
    render(<IntegratedVolumeSurfaceWorkspace />);

    expect(screen.getByTestId('dock-slot-plot')).toContainElement(screen.getByTestId('plot-panel-stub'));
    expect(screen.getByTestId('dock-slot-activity')).toContainElement(
      screen.getByTestId('activity-panel-stub'),
    );
    expect(screen.getByTestId('dock-slot-log')).toContainElement(
      screen.getByTestId('log-panel-stub'),
    );
  });

  it('falls back to histogram mode when no layer is selected (resolver default)', () => {
    render(<IntegratedVolumeSurfaceWorkspace />);

    expect(screen.getByTestId('plot-panel-stub').getAttribute('data-default-mode')).toBe('histogram');
  });

  it('defaults the bottom dock plot to histogram for a 3D layer (resolver — 3D scalar)', () => {
    seedLayer({ id: 'vol-1', name: 'T1w', type: 'volume' });

    render(<IntegratedVolumeSurfaceWorkspace />);

    expect(screen.getByTestId('plot-panel-stub').getAttribute('data-default-mode')).toBe('histogram');
  });

  it('defaults the bottom dock plot to crosshair-time-series for a 4D layer (resolver — fMRI)', () => {
    seedLayer({
      id: 'vol-1',
      name: 'BOLD run-01',
      type: 'volume',
      timeSeriesInfo: { num_timepoints: 200 },
    });

    render(<IntegratedVolumeSurfaceWorkspace />);

    expect(screen.getByTestId('plot-panel-stub').getAttribute('data-default-mode')).toBe(
      'crosshair-time-series',
    );
  });

  it('omits the pinned time row when no layer is selected', () => {
    render(<IntegratedVolumeSurfaceWorkspace />);

    expect(screen.getByTestId('integrated-volume-surface-workspace').getAttribute('data-pinned-time-row')).toBe('false');
    expect(screen.queryByTestId('pinned-time-row-stub')).toBeNull();
  });

  it('omits the pinned time row when the active layer is 3D', () => {
    seedLayer({ id: 'vol-1', name: 'Sample 3D', type: 'volume' });

    render(<IntegratedVolumeSurfaceWorkspace />);

    expect(screen.getByTestId('integrated-volume-surface-workspace').getAttribute('data-pinned-time-row')).toBe('false');
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

    expect(screen.getByTestId('integrated-volume-surface-workspace').getAttribute('data-pinned-time-row')).toBe('true');
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
    expect(screen.getByTestId('integrated-volume-surface-workspace').getAttribute('data-pinned-time-row')).toBe('false');
  });

  it('does not import-time fail when the surface store has no surfaces (empty-state passes through to SurfaceViewPanel)', () => {
    // SurfaceViewPanel itself owns the empty-state UI. The shell must compose
    // the panel without a surfaceHandle and let the panel decide what to show.
    render(<IntegratedVolumeSurfaceWorkspace />);
    expect(screen.getByTestId('surface-view-panel-stub')).toBeInTheDocument();
  });
});
