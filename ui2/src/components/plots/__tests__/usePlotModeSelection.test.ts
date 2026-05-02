/**
 * usePlotModeSelection — selection-policy state machine
 * (mote `bd-01KQK24YYRXCDJKAPE6SBB84JE`).
 *
 * Covers the four ACs from the mote:
 *   1. Mount with a 4D active layer → starts in crosshair-time-series.
 *   2. While source='auto', switching active layer 3D→4D adapts the mode.
 *   3. Manually picking histogram while a 4D layer is active preserves
 *      histogram across active-layer changes between 4D layers.
 *   4. Manually picking crosshair-time-series with a 4D layer, then switching
 *      to a 3D layer where it is unsupported, transiently falls back to the
 *      first supported mode (histogram). The store value AND selectionSource
 *      are NOT mutated — switching back to a 4D layer restores the user pick.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { usePlotModeStore } from '@/stores/plotModeStore';
import { useLayerStore } from '@/stores/layerStore';
import { histogramPlot } from '../histogramPlot.mode';
import { crosshairTimeSeriesPlot } from '../crosshairTimeSeriesPlot.mode';
import {
  pickFirstSupportedMode,
  usePlotModeSelection,
} from '../plotMode.helpers';
import type { PlotMode, PlotModeContext } from '../plotHost.types';

const MODES: PlotMode[] = [histogramPlot, crosshairTimeSeriesPlot];

function ctxFor(layerId: string | undefined, crosshair?: [number, number, number]): PlotModeContext {
  return {
    layerId,
    layerName: layerId,
    crosshairMm: crosshair,
    width: 0,
    height: 0,
  };
}

function seedLayer(id: string, opts: { fourD?: boolean } = {}) {
  const layer = opts.fourD
    ? { id, name: id, type: 'volume', timeSeriesInfo: { num_timepoints: 200 } }
    : { id, name: id, type: 'volume' };
  act(() => {
    useLayerStore.setState({
      layers: [layer as never],
      selectedLayerId: id,
      layerMetadata: new Map([
        [
          id,
          {
            dataRange: { min: 0, max: 100 },
            worldToVoxel: [
              1, 0, 0, 0,
              0, 1, 0, 0,
              0, 0, 1, 0,
              0, 0, 0, 1,
            ] as never,
            dimensions: [100, 100, 100],
          } as never,
        ],
      ]),
      loadingLayers: new Set(),
      errorLayers: new Map(),
    });
  });
}

function clearLayers() {
  act(() => {
    useLayerStore.setState({
      layers: [],
      selectedLayerId: null,
      layerMetadata: new Map(),
      loadingLayers: new Set(),
      errorLayers: new Map(),
    });
    usePlotModeStore.getState().resetPlotModeStore();
  });
}

describe('pickFirstSupportedMode', () => {
  it('returns the first id whose supports(ctx) reports supported=true', () => {
    expect(pickFirstSupportedMode(MODES, ctxFor('vol-1'))).toBe('histogram');
  });

  it('skips modes that report supported=false', () => {
    // No layer → histogram reports no-layer; time-series also reports no-layer.
    expect(pickFirstSupportedMode(MODES, ctxFor(undefined))).toBeUndefined();
  });

  it('returns time-series when histogram is unregistered and the ctx is 4D + crosshair', () => {
    seedLayer('vol-4d', { fourD: true });
    try {
      const id = pickFirstSupportedMode([crosshairTimeSeriesPlot], ctxFor('vol-4d', [10, 20, 30]));
      expect(id).toBe('crosshair-time-series');
    } finally {
      clearLayers();
    }
  });
});

describe('usePlotModeSelection — auto mode (ACs #1 + #2)', () => {
  beforeEach(() => clearLayers());

  it('AC#1 — initializes the store with histogram for a 3D active layer (mount)', () => {
    seedLayer('vol-3d');
    const { result } = renderHook(() =>
      usePlotModeSelection({ modes: MODES, layerCtx: ctxFor('vol-3d') }),
    );

    // After the init effect runs, the store is populated with the auto default.
    expect(usePlotModeStore.getState().activePlotModeId).toBe('histogram');
    expect(usePlotModeStore.getState().selectionSource).toBe('auto');
    expect(result.current.modeId).toBe('histogram');
  });

  it('AC#1 — initializes the store with crosshair-time-series for a 4D active layer (mount)', () => {
    seedLayer('vol-4d', { fourD: true });
    const { result } = renderHook(() =>
      usePlotModeSelection({
        modes: MODES,
        layerCtx: ctxFor('vol-4d', [10, 20, 30]),
      }),
    );

    expect(usePlotModeStore.getState().activePlotModeId).toBe('crosshair-time-series');
    expect(usePlotModeStore.getState().selectionSource).toBe('auto');
    expect(result.current.modeId).toBe('crosshair-time-series');
  });

  it('AC#2 — re-derives the mode on 3D → 4D layer change while source is auto', () => {
    seedLayer('vol-3d');
    const { result, rerender } = renderHook(
      ({ ctx }: { ctx: PlotModeContext }) =>
        usePlotModeSelection({ modes: MODES, layerCtx: ctx }),
      { initialProps: { ctx: ctxFor('vol-3d') } },
    );
    expect(result.current.modeId).toBe('histogram');

    // Replace the active layer with a 4D one and rerender with the new ctx.
    seedLayer('vol-4d', { fourD: true });
    rerender({ ctx: ctxFor('vol-4d', [10, 20, 30]) });

    expect(usePlotModeStore.getState().activePlotModeId).toBe('crosshair-time-series');
    expect(usePlotModeStore.getState().selectionSource).toBe('auto');
    expect(result.current.modeId).toBe('crosshair-time-series');
  });

  it('AC#2 — re-derives the mode on 4D → 3D layer change while source is auto', () => {
    seedLayer('vol-4d', { fourD: true });
    const { result, rerender } = renderHook(
      ({ ctx }: { ctx: PlotModeContext }) =>
        usePlotModeSelection({ modes: MODES, layerCtx: ctx }),
      { initialProps: { ctx: ctxFor('vol-4d', [10, 20, 30]) } },
    );
    expect(result.current.modeId).toBe('crosshair-time-series');

    seedLayer('vol-3d');
    rerender({ ctx: ctxFor('vol-3d') });

    expect(usePlotModeStore.getState().activePlotModeId).toBe('histogram');
    expect(usePlotModeStore.getState().selectionSource).toBe('auto');
    expect(result.current.modeId).toBe('histogram');
  });
});

describe('usePlotModeSelection — user pick is sticky (AC #3)', () => {
  beforeEach(() => clearLayers());

  it('preserves a manual histogram pick across 4D → 4D active-layer changes', () => {
    seedLayer('vol-4da', { fourD: true });
    const { result, rerender } = renderHook(
      ({ ctx }: { ctx: PlotModeContext }) =>
        usePlotModeSelection({ modes: MODES, layerCtx: ctx }),
      { initialProps: { ctx: ctxFor('vol-4da', [10, 20, 30]) } },
    );
    expect(result.current.modeId).toBe('crosshair-time-series');

    // User clicks the Histogram tab while a 4D layer is active.
    act(() => {
      result.current.onModeChange('histogram');
    });
    expect(usePlotModeStore.getState().activePlotModeId).toBe('histogram');
    expect(usePlotModeStore.getState().selectionSource).toBe('user');
    expect(result.current.modeId).toBe('histogram');

    // Swap to a different 4D layer — auto resolver would normally pick
    // crosshair-time-series, but the user pick must stick.
    seedLayer('vol-4db', { fourD: true });
    rerender({ ctx: ctxFor('vol-4db', [10, 20, 30]) });

    expect(usePlotModeStore.getState().activePlotModeId).toBe('histogram');
    expect(usePlotModeStore.getState().selectionSource).toBe('user');
    expect(result.current.modeId).toBe('histogram');
  });

  it('preserves a manual crosshair-time-series pick across 4D → 4D active-layer changes', () => {
    seedLayer('vol-4da', { fourD: true });
    const { result, rerender } = renderHook(
      ({ ctx }: { ctx: PlotModeContext }) =>
        usePlotModeSelection({ modes: MODES, layerCtx: ctx }),
      { initialProps: { ctx: ctxFor('vol-4da', [10, 20, 30]) } },
    );

    act(() => {
      // User reaffirms the time-series pick (now with selectionSource='user').
      result.current.onModeChange('crosshair-time-series');
    });
    expect(usePlotModeStore.getState().selectionSource).toBe('user');

    seedLayer('vol-4db', { fourD: true });
    rerender({ ctx: ctxFor('vol-4db', [10, 20, 30]) });

    expect(usePlotModeStore.getState().activePlotModeId).toBe('crosshair-time-series');
    expect(usePlotModeStore.getState().selectionSource).toBe('user');
    expect(result.current.modeId).toBe('crosshair-time-series');
  });
});

describe('usePlotModeSelection — transient fallback (AC #4)', () => {
  beforeEach(() => clearLayers());

  it('falls back to the first supported mode when the user pick becomes unsupported', () => {
    seedLayer('vol-4d', { fourD: true });
    const { result, rerender } = renderHook(
      ({ ctx }: { ctx: PlotModeContext }) =>
        usePlotModeSelection({ modes: MODES, layerCtx: ctx }),
      { initialProps: { ctx: ctxFor('vol-4d', [10, 20, 30]) } },
    );

    // Lock in crosshair-time-series as a user pick.
    act(() => {
      result.current.onModeChange('crosshair-time-series');
    });
    expect(usePlotModeStore.getState().activePlotModeId).toBe('crosshair-time-series');
    expect(usePlotModeStore.getState().selectionSource).toBe('user');

    // Switch to a 3D layer — crosshair-time-series no longer supports.
    seedLayer('vol-3d');
    rerender({ ctx: ctxFor('vol-3d') });

    // Visible mode falls back to histogram, but the store retains the user pick.
    expect(result.current.modeId).toBe('histogram');
    expect(usePlotModeStore.getState().activePlotModeId).toBe('crosshair-time-series');
    expect(usePlotModeStore.getState().selectionSource).toBe('user');

    // Returning to a 4D layer restores the visible user pick.
    seedLayer('vol-4d-b', { fourD: true });
    rerender({ ctx: ctxFor('vol-4d-b', [10, 20, 30]) });
    expect(result.current.modeId).toBe('crosshair-time-series');
  });

  it('does not flip selectionSource back to auto during a transient fallback', () => {
    seedLayer('vol-4d', { fourD: true });
    const { result, rerender } = renderHook(
      ({ ctx }: { ctx: PlotModeContext }) =>
        usePlotModeSelection({ modes: MODES, layerCtx: ctx }),
      { initialProps: { ctx: ctxFor('vol-4d', [10, 20, 30]) } },
    );
    act(() => result.current.onModeChange('crosshair-time-series'));

    seedLayer('vol-3d');
    rerender({ ctx: ctxFor('vol-3d') });

    expect(usePlotModeStore.getState().selectionSource).toBe('user');
  });
});
