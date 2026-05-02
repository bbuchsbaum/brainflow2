import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const { lastPlotHostProps } = vi.hoisted(() => ({
  lastPlotHostProps: { current: null as null | Record<string, unknown> },
}));

vi.mock('@/components/plots/PlotHost', () => ({
  PlotHost: (props: Record<string, unknown>) => {
    lastPlotHostProps.current = props;
    return (
      <div
        data-testid="plot-host-stub"
        data-mode-ids={Array.isArray((props as { modes?: { id: string }[] }).modes)
          ? (props as { modes?: { id: string }[] }).modes!.map((m) => m.id).join(',')
          : ''}
        data-default-mode-id={String(props.defaultModeId ?? '')}
        data-layer-id={String(props.layerId ?? '')}
        data-layer-name={String(props.layerName ?? '')}
        data-crosshair-mm={Array.isArray(props.crosshairMm)
          ? (props.crosshairMm as number[]).join(',')
          : ''}
      />
    );
  },
}));

import { PinnedTimeRow } from '../PinnedTimeRow';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';

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

function setCrosshair(world_mm: [number, number, number] | null) {
  act(() => {
    useViewStateStore.getState().setViewState((state) => ({
      ...state,
      crosshair: world_mm
        ? { world_mm, visible: true }
        : { world_mm: [0, 0, 0], visible: false },
    }));
  });
}

describe('PinnedTimeRow', () => {
  beforeEach(() => {
    lastPlotHostProps.current = null;
    resetLayerStore();
    setCrosshair([0, 0, 0]);
  });

  it('returns null when no layer is selected', () => {
    const { container } = render(<PinnedTimeRow />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('plot-host-stub')).toBeNull();
  });

  it('returns null when the active layer is 3D (no timeSeriesInfo)', () => {
    seedLayer({ id: 'vol-1', name: 'Sample 3D', type: 'volume' });

    const { container } = render(<PinnedTimeRow />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when timeSeriesInfo has fewer than 2 timepoints', () => {
    seedLayer({
      id: 'vol-1',
      name: 'Single-frame',
      type: 'volume',
      timeSeriesInfo: { num_timepoints: 1 },
    });

    const { container } = render(<PinnedTimeRow />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a PlotHost in crosshair-time-series mode for a 4D layer', () => {
    seedLayer({
      id: 'vol-1',
      name: 'BOLD run-01',
      type: 'volume',
      timeSeriesInfo: { num_timepoints: 200 },
    });
    setCrosshair([10, 20, 30]);

    render(<PinnedTimeRow />);

    expect(screen.getByTestId('pinned-time-row')).toBeInTheDocument();
    const host = screen.getByTestId('plot-host-stub');
    expect(host.getAttribute('data-mode-ids')).toBe('crosshair-time-series');
    expect(host.getAttribute('data-default-mode-id')).toBe('crosshair-time-series');
    expect(host.getAttribute('data-layer-id')).toBe('vol-1');
    expect(host.getAttribute('data-layer-name')).toBe('BOLD run-01');
    expect(host.getAttribute('data-crosshair-mm')).toBe('10,20,30');
  });

  it('hides the row again when the active layer changes from 4D to 3D', () => {
    seedLayer({
      id: 'vol-1',
      name: 'BOLD run-01',
      type: 'volume',
      timeSeriesInfo: { num_timepoints: 200 },
    });

    const { container } = render(<PinnedTimeRow />);
    expect(screen.getByTestId('plot-host-stub')).toBeInTheDocument();

    act(() => {
      useLayerStore.setState({
        layers: [{ id: 'vol-1', name: 'Sample 3D', type: 'volume' } as never],
        selectedLayerId: 'vol-1',
        layerMetadata: new Map(),
        loadingLayers: new Set(),
        errorLayers: new Map(),
      });
    });

    expect(container.firstChild).toBeNull();
  });

  it('omits crosshairMm from the host when the crosshair is hidden', () => {
    seedLayer({
      id: 'vol-1',
      name: 'BOLD run-01',
      type: 'volume',
      timeSeriesInfo: { num_timepoints: 200 },
    });
    setCrosshair(null);

    render(<PinnedTimeRow />);

    const host = screen.getByTestId('plot-host-stub');
    expect(host.getAttribute('data-crosshair-mm')).toBe('');
  });
});
