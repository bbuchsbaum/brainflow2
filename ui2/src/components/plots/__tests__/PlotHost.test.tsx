import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { PlotHost } from '../PlotHost';
import type { PlotMode } from '../plotHost.types';

function makeMode(overrides: Partial<PlotMode> & Pick<PlotMode, 'id' | 'label'>): PlotMode {
  return {
    supports: () => ({ supported: true }),
    render: () => <div data-testid={`mode-body-${overrides.id}`}>{overrides.label} body</div>,
    ...overrides,
  };
}

describe('PlotHost', () => {
  it('renders the mode selector and the first registered mode by default', () => {
    const histogramRender = vi.fn(() => <div data-testid="mode-body-histogram">hist</div>);
    const tsRender = vi.fn(() => <div data-testid="mode-body-ts">ts</div>);
    const modes: PlotMode[] = [
      makeMode({ id: 'histogram', label: 'Histogram', render: histogramRender }),
      makeMode({ id: 'time-series', label: 'Time Series', render: tsRender }),
    ];

    render(<PlotHost modes={modes} layerId="vol-1" layerName="vol-1" />);

    expect(screen.getByTestId('plot-host')).toHaveAttribute('data-mode', 'histogram');
    expect(screen.getByTestId('plot-host')).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('plot-host-mode-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('mode-body-histogram')).toBeInTheDocument();
    expect(histogramRender).toHaveBeenCalled();
    expect(tsRender).not.toHaveBeenCalled();
  });

  it('honors defaultModeId and switches modes on tab click', () => {
    const onModeChange = vi.fn();
    const modes: PlotMode[] = [
      makeMode({ id: 'histogram', label: 'Histogram' }),
      makeMode({ id: 'time-series', label: 'Time Series' }),
    ];

    render(
      <PlotHost
        modes={modes}
        defaultModeId="time-series"
        onModeChange={onModeChange}
        layerId="vol-1"
      />,
    );

    expect(screen.getByTestId('plot-host')).toHaveAttribute('data-mode', 'time-series');
    expect(screen.getByTestId('mode-body-time-series')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('plot-host-mode-histogram'));
    expect(onModeChange).toHaveBeenLastCalledWith('histogram');
    expect(screen.getByTestId('plot-host')).toHaveAttribute('data-mode', 'histogram');
    expect(screen.getByTestId('mode-body-histogram')).toBeInTheDocument();
  });

  it('switches to a dropdown selector when more than 4 modes are registered', () => {
    const modes: PlotMode[] = [
      makeMode({ id: 'a', label: 'A' }),
      makeMode({ id: 'b', label: 'B' }),
      makeMode({ id: 'c', label: 'C' }),
      makeMode({ id: 'd', label: 'D' }),
      makeMode({ id: 'e', label: 'E' }),
    ];
    render(<PlotHost modes={modes} layerId="vol-1" />);
    expect(screen.queryByTestId('plot-host-mode-tabs')).toBeNull();
    expect(screen.getByTestId('plot-host-mode-select')).toBeInTheDocument();
  });

  it('respects controlled modeId prop', () => {
    const onModeChange = vi.fn();
    const modes: PlotMode[] = [
      makeMode({ id: 'histogram', label: 'Histogram' }),
      makeMode({ id: 'time-series', label: 'Time Series' }),
    ];

    const { rerender } = render(
      <PlotHost modes={modes} modeId="histogram" onModeChange={onModeChange} layerId="vol-1" />,
    );
    expect(screen.getByTestId('plot-host')).toHaveAttribute('data-mode', 'histogram');

    fireEvent.click(screen.getByTestId('plot-host-mode-time-series'));
    // Controlled host doesn't update internal selection — caller must rerender.
    expect(onModeChange).toHaveBeenLastCalledWith('time-series');
    expect(screen.getByTestId('plot-host')).toHaveAttribute('data-mode', 'histogram');

    rerender(
      <PlotHost modes={modes} modeId="time-series" onModeChange={onModeChange} layerId="vol-1" />,
    );
    expect(screen.getByTestId('plot-host')).toHaveAttribute('data-mode', 'time-series');
  });

  it('renders the loading state and skips mode rendering when loading=true', () => {
    const histogramRender = vi.fn(() => <div data-testid="mode-body-histogram">hist</div>);
    const modes: PlotMode[] = [makeMode({ id: 'histogram', label: 'Histogram', render: histogramRender })];

    render(<PlotHost modes={modes} loading layerId="vol-1" />);
    expect(screen.getByTestId('plot-host')).toHaveAttribute('data-state', 'loading');
    expect(screen.getByTestId('plot-host-loading')).toBeInTheDocument();
    expect(histogramRender).not.toHaveBeenCalled();
    expect(screen.queryByTestId('mode-body-histogram')).toBeNull();
  });

  it('renders the error state and surfaces the error message', () => {
    const modes: PlotMode[] = [makeMode({ id: 'histogram', label: 'Histogram' })];
    render(<PlotHost modes={modes} error={new Error('compute failed')} layerId="vol-1" />);
    expect(screen.getByTestId('plot-host')).toHaveAttribute('data-state', 'error');
    expect(screen.getByTestId('plot-host-error')).toHaveTextContent(/compute failed/);
  });

  it('renders the no-modes empty state when no modes are registered', () => {
    render(<PlotHost modes={[]} />);
    expect(screen.getByTestId('plot-host')).toHaveAttribute('data-state', 'no-modes');
    expect(screen.getByTestId('plot-host-empty-no-modes')).toBeInTheDocument();
  });

  it('renders the unsupported-layer empty state when the active mode reports it', () => {
    const modes: PlotMode[] = [
      makeMode({
        id: 'time-series',
        label: 'Time Series',
        supports: () => ({
          supported: false,
          reason: 'unsupported-layer',
          message: 'Time series requires a 4D volume.',
        }),
        render: () => <div data-testid="mode-body-ts" />,
      }),
    ];
    render(<PlotHost modes={modes} layerId="vol-1" />);
    expect(screen.getByTestId('plot-host')).toHaveAttribute('data-state', 'unsupported-layer');
    expect(screen.getByTestId('plot-host-empty-unsupported-layer')).toHaveTextContent(
      /4D volume/,
    );
    expect(screen.queryByTestId('mode-body-ts')).toBeNull();
  });

  it('renders the no-crosshair empty state when the active mode reports it', () => {
    const modes: PlotMode[] = [
      makeMode({
        id: 'time-series',
        label: 'Time Series',
        supports: (ctx) =>
          ctx.crosshairMm
            ? { supported: true }
            : { supported: false, reason: 'no-crosshair' },
      }),
    ];
    render(<PlotHost modes={modes} layerId="vol-1" />);
    expect(screen.getByTestId('plot-host')).toHaveAttribute('data-state', 'no-crosshair');
    expect(screen.getByTestId('plot-host-empty-no-crosshair')).toBeInTheDocument();
  });

  it('renders the no-layer empty state when the active mode reports it', () => {
    const modes: PlotMode[] = [
      makeMode({
        id: 'histogram',
        label: 'Histogram',
        supports: (ctx) =>
          ctx.layerId
            ? { supported: true }
            : { supported: false, reason: 'no-layer' },
      }),
    ];
    render(<PlotHost modes={modes} />);
    expect(screen.getByTestId('plot-host')).toHaveAttribute('data-state', 'no-layer');
    expect(screen.getByTestId('plot-host-empty-no-layer')).toBeInTheDocument();
  });

  it('renders mode-contributed toolbar fragments and only for the active mode', () => {
    const histToolbar = vi.fn(() => <button data-testid="hist-toolbar-btn">log</button>);
    const tsToolbar = vi.fn(() => <button data-testid="ts-toolbar-btn">reset</button>);
    const modes: PlotMode[] = [
      makeMode({ id: 'histogram', label: 'Histogram', toolbar: histToolbar }),
      makeMode({ id: 'time-series', label: 'Time Series', toolbar: tsToolbar }),
    ];

    render(<PlotHost modes={modes} layerId="vol-1" />);
    expect(screen.getByTestId('hist-toolbar-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('ts-toolbar-btn')).toBeNull();

    fireEvent.click(screen.getByTestId('plot-host-mode-time-series'));
    expect(screen.getByTestId('ts-toolbar-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('hist-toolbar-btn')).toBeNull();
  });

  it('passes layer/crosshair/size context to the active mode', () => {
    const supports = vi.fn(() => ({ supported: true } as const));
    const renderFn = vi.fn(() => <div data-testid="mode-body-ts" />);
    const modes: PlotMode[] = [
      { id: 'time-series', label: 'Time Series', supports, render: renderFn },
    ];

    render(
      <PlotHost
        modes={modes}
        layerId="vol-1"
        layerName="vol-1"
        crosshairMm={[10, 20, 30]}
      />,
    );

    expect(renderFn).toHaveBeenCalled();
    const ctx = renderFn.mock.calls[0][0];
    expect(ctx.layerId).toBe('vol-1');
    expect(ctx.layerName).toBe('vol-1');
    expect(ctx.crosshairMm).toEqual([10, 20, 30]);
    // jsdom layout returns 0, but the field is wired through.
    expect(typeof ctx.width).toBe('number');
    expect(typeof ctx.height).toBe('number');
  });

  it('falls back to the first registered mode when the current id disappears', () => {
    const initialModes: PlotMode[] = [
      makeMode({ id: 'histogram', label: 'Histogram' }),
      makeMode({ id: 'time-series', label: 'Time Series' }),
    ];
    const { rerender } = render(
      <PlotHost modes={initialModes} defaultModeId="time-series" layerId="vol-1" />,
    );
    expect(screen.getByTestId('plot-host')).toHaveAttribute('data-mode', 'time-series');

    // Time series mode is unregistered; host should fall back to the new first mode.
    const reducedModes: PlotMode[] = [makeMode({ id: 'histogram', label: 'Histogram' })];
    rerender(<PlotHost modes={reducedModes} defaultModeId="time-series" layerId="vol-1" />);
    expect(screen.getByTestId('plot-host')).toHaveAttribute('data-mode', 'histogram');
  });
});
