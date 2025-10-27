/**
 * Selector behaviour smoke tests
 *
 * These tests run against a lightweight mocked view-state store so we can
 * exercise the selector helpers without the coalescing middleware or
 * backend coordination that the production store uses.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const storeMocks = vi.hoisted(() => {
  const { create } = require('zustand');

  const makeInitialViewState = () => ({
    views: {
      axial: {
        origin_mm: [0, 0, 0],
        u_mm: [1, 0, 0],
        v_mm: [0, 1, 0],
        dim_px: [512, 512] as [number, number],
      },
      sagittal: {
        origin_mm: [0, 0, 0],
        u_mm: [0, 1, 0],
        v_mm: [0, 0, -1],
        dim_px: [512, 512] as [number, number],
      },
      coronal: {
        origin_mm: [0, 0, 0],
        u_mm: [1, 0, 0],
        v_mm: [0, 0, -1],
        dim_px: [512, 512] as [number, number],
      },
    },
    crosshair: {
      world_mm: [0, 0, 0] as [number, number, number],
      visible: true,
    },
    layers: [] as Array<any>,
    timepoint: 0,
  });

  const initialState = makeInitialViewState();

  const useStore = create<{
    viewState: ReturnType<typeof makeInitialViewState>;
    setViewState: (updater: (state: ReturnType<typeof makeInitialViewState>) => void) => void;
    setCrosshair: (coords: [number, number, number]) => void;
    resetToDefaults: () => void;
  }>(set => ({
    viewState: structuredClone(initialState),
    setViewState: updater =>
      set(state => {
        const draft = structuredClone(state.viewState);
        updater(draft);
        return { viewState: draft };
      }),
    setCrosshair: coords =>
      set(state => ({
        viewState: {
          ...state.viewState,
          crosshair: { world_mm: coords, visible: true },
        },
      })),
    resetToDefaults: () => set({ viewState: structuredClone(initialState) }),
  }));

  return {
    useStore,
    reset: () => {
      useStore.getState().resetToDefaults();
    },
    makeInitialViewState,
  };
});

vi.mock('@/stores/viewStateStore', () => ({
  useViewStateStore: storeMocks.useStore,
}));

import { useTimepointSelector, useCrosshairSelector } from '@/stores/selectors/viewStateSelectors';
import { useViewStateStore } from '@/stores/viewStateStore';

describe('Selective store selectors', () => {
  beforeEach(() => {
    storeMocks.reset();
    act(() => {
      useViewStateStore.getState().setViewState(state => {
        state.timepoint = 0;
        state.layers = [];
      });
    });
  });

  afterAll(() => {
    vi.unmock('@/stores/viewStateStore');
    vi.resetModules();
  });

  it('useTimepointSelector tracks only the timepoint field', () => {
    const { result } = renderHook(() => useTimepointSelector());
    expect(result.current).toBe(0);

    act(() => {
      useViewStateStore.getState().setCrosshair([10, 20, 30]);
    });
    expect(result.current).toBe(0);

    act(() => {
      useViewStateStore.getState().setViewState(state => {
        state.timepoint = 5;
      });
    });
    expect(result.current).toBe(5);
  });

  it('useCrosshairSelector responds when crosshair coordinates change', () => {
    const { result } = renderHook(() => useCrosshairSelector());
    const before = result.current;

    act(() => {
      const current = useViewStateStore.getState().viewState.crosshair;
      useViewStateStore.getState().setViewState(state => {
        state.crosshair = {
          world_mm: [...current.world_mm],
          visible: current.visible,
        };
      });
    });

    expect(result.current.world_mm).toEqual(before.world_mm);
    expect(result.current.visible).toBe(before.visible);

    act(() => {
      useViewStateStore.getState().setCrosshair([5, 6, 7]);
    });

    expect(result.current.world_mm).toEqual([5, 6, 7]);
  });

  // The remaining selectors are integration-tested alongside the render coordinator.
});
