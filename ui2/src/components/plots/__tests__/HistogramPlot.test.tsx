import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';

import type { PlotModeContext } from '../plotHost.types';

const { computeHistogramMock, eventBusOnMock, eventBusEmitMock, viewStateStoreMock } = vi.hoisted(
  () => ({
    computeHistogramMock: vi.fn(),
    eventBusOnMock: vi.fn(),
    eventBusEmitMock: vi.fn(),
    viewStateStoreMock: { current: undefined as unknown },
  }),
);

vi.mock('@/services/HistogramService', () => ({
  histogramService: {
    computeHistogram: computeHistogramMock,
  },
}));

vi.mock('@/events/EventBus', () => ({
  getEventBus: () => ({
    on: eventBusOnMock,
    emit: eventBusEmitMock,
  }),
}));

// Use a tiny manual store implementation that mirrors the shape consumed
// by HistogramPlot. We replace the import target rather than trying to mock
// Zustand semantics in jsdom.
vi.mock('@/stores/viewStateStore', () => {
  type Listener = () => void;
  const listeners = new Set<Listener>();
  let state: {
    viewState: {
      layers: Array<{ id: string; intensity: [number, number]; threshold: [number, number]; colormap: string; opacity: number }>;
    };
  } = {
    viewState: { layers: [] },
  };
  const setViewState = (
    updater: (s: typeof state.viewState) => typeof state.viewState,
  ) => {
    state = { ...state, viewState: updater(state.viewState) };
    listeners.forEach((l) => l());
  };
  const useViewStateStore = (<T,>(selector: (s: typeof state) => T) => {
    return React.useSyncExternalStore(
      (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      () => selector(state),
      () => selector(state),
    );
  }) as unknown as {
    <T>(selector: (s: typeof state) => T): T;
    getState: () => typeof state & { setViewState: typeof setViewState };
  };
  useViewStateStore.getState = () => ({ ...state, setViewState });
  viewStateStoreMock.current = { useViewStateStore, setViewState, get state() { return state; } };
  return { useViewStateStore };
});

// Capture the props handed to HistogramChart so we can assert on them.
const histogramChartCalls: Array<Record<string, unknown>> = [];
vi.mock('../HistogramChart', () => ({
  HistogramChart: (props: Record<string, unknown>) => {
    histogramChartCalls.push(props);
    return <div data-testid="histogram-chart-mock" />;
  },
}));

// Imported AFTER the mocks so the module picks them up.
import { HistogramPlotBody } from '../HistogramPlot';
import { histogramPlot } from '../histogramPlot.mode';

function ctxFor(overrides: Partial<PlotModeContext> = {}): PlotModeContext {
  return {
    layerId: 'vol-1',
    layerName: 'vol-1',
    crosshairMm: undefined,
    width: 400,
    height: 300,
    ...overrides,
  };
}

describe('histogramPlot (PlotMode)', () => {
  beforeEach(() => {
    computeHistogramMock.mockReset();
    eventBusOnMock.mockReset();
    eventBusEmitMock.mockReset();
    histogramChartCalls.length = 0;

    eventBusOnMock.mockImplementation(() => () => undefined);
    computeHistogramMock.mockResolvedValue({
      bins: [0, 1, 2],
      totalCount: 3,
      minValue: 0,
      maxValue: 2,
    });
  });

  it('declares the histogram plot identity', () => {
    expect(histogramPlot.id).toBe('histogram');
    expect(histogramPlot.label).toBe('Histogram');
  });

  it('reports unsupported with reason "no-layer" when no layer is selected', () => {
    const result = histogramPlot.supports(ctxFor({ layerId: undefined }));
    expect(result).toEqual({
      supported: false,
      reason: 'no-layer',
      message: expect.any(String),
    });
  });

  it('reports supported when a layer is selected', () => {
    expect(histogramPlot.supports(ctxFor({ layerId: 'vol-1' }))).toEqual({ supported: true });
  });
});

describe('HistogramPlotBody', () => {
  beforeEach(() => {
    computeHistogramMock.mockReset();
    eventBusOnMock.mockReset();
    eventBusEmitMock.mockReset();
    histogramChartCalls.length = 0;

    eventBusOnMock.mockImplementation(() => () => undefined);
    computeHistogramMock.mockResolvedValue({
      bins: [0, 1, 2],
      totalCount: 3,
      minValue: 0,
      maxValue: 2,
    });
  });

  it('fetches the histogram exactly once for the active layer with the legacy request shape', async () => {
    render(<HistogramPlotBody ctx={ctxFor({ layerId: 'vol-1' })} />);

    await waitFor(() => {
      expect(computeHistogramMock).toHaveBeenCalledTimes(1);
    });
    expect(computeHistogramMock).toHaveBeenCalledWith({
      layerId: 'vol-1',
      binCount: 256,
      excludeZeros: true,
    });
  });

  it('refetches exactly once when the layerId changes', async () => {
    const { rerender } = render(<HistogramPlotBody ctx={ctxFor({ layerId: 'vol-1' })} />);
    await waitFor(() => expect(computeHistogramMock).toHaveBeenCalledTimes(1));

    rerender(<HistogramPlotBody ctx={ctxFor({ layerId: 'vol-2' })} />);
    await waitFor(() => expect(computeHistogramMock).toHaveBeenCalledTimes(2));
    expect(computeHistogramMock).toHaveBeenLastCalledWith({
      layerId: 'vol-2',
      binCount: 256,
      excludeZeros: true,
    });
  });

  it('subscribes to layer.render.changed but does NOT trigger a recompute (parity with PlotPanel)', async () => {
    let listener: ((ev: { layerId: string; renderProps: Record<string, unknown> }) => void) | null =
      null;
    eventBusOnMock.mockImplementation((event: string, cb: typeof listener) => {
      if (event === 'layer.render.changed') listener = cb;
      return () => {
        if (listener === cb) listener = null;
      };
    });

    render(<HistogramPlotBody ctx={ctxFor({ layerId: 'vol-1' })} />);
    await waitFor(() => expect(computeHistogramMock).toHaveBeenCalledTimes(1));

    expect(listener).toBeTypeOf('function');
    act(() => {
      listener?.({ layerId: 'vol-1', renderProps: { intensity: [0.1, 0.9] } });
    });

    // Render-changed must not provoke another recompute. HistogramService owns
    // cache invalidation; the body relies on rerenders for new render props.
    expect(computeHistogramMock).toHaveBeenCalledTimes(1);
  });

  it('passes the active layer render props through to HistogramChart', async () => {
    const store = (viewStateStoreMock.current as {
      setViewState: (u: (s: { layers: unknown[] }) => { layers: unknown[] }) => void;
    });
    act(() => {
      store.setViewState((s) => ({
        ...s,
        layers: [
          ...s.layers,
          {
            id: 'vol-1',
            intensity: [0.2, 0.8] as [number, number],
            threshold: [0.4, 0.6] as [number, number],
            colormap: 'viridis',
            opacity: 1,
          },
        ],
      }));
    });

    render(<HistogramPlotBody ctx={ctxFor({ layerId: 'vol-1' })} />);
    await waitFor(() => expect(histogramChartCalls.length).toBeGreaterThan(0));

    const last = histogramChartCalls[histogramChartCalls.length - 1];
    expect(last.intensityWindow).toEqual([0.2, 0.8]);
    expect(last.threshold).toEqual([0.4, 0.6]);
    expect(last.colormap).toBe('viridis');
  });

  it('clamps chart dimensions to minimums when the body is collapsed', async () => {
    render(<HistogramPlotBody ctx={ctxFor({ layerId: 'vol-1', width: 10, height: 10 })} />);
    await waitFor(() => expect(histogramChartCalls.length).toBeGreaterThan(0));
    const last = histogramChartCalls[histogramChartCalls.length - 1];
    expect(last.width).toBeGreaterThanOrEqual(100);
    expect(last.height).toBeGreaterThanOrEqual(80);
  });

  it('renders nothing for layer-data lookup when no layer is selected', async () => {
    render(<HistogramPlotBody ctx={ctxFor({ layerId: undefined })} />);
    await waitFor(() => expect(histogramChartCalls.length).toBeGreaterThan(0));
    const last = histogramChartCalls[histogramChartCalls.length - 1];
    expect(last.intensityWindow).toBeUndefined();
    expect(last.threshold).toBeUndefined();
    expect(last.colormap).toBeUndefined();
    expect(computeHistogramMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('histogram-plot-body')).toBeInTheDocument();
  });
});
