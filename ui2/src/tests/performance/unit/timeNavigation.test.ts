import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, renderHook, render, fireEvent, waitFor } from '@testing-library/react';
import { createElement } from 'react';

import { useTimeNavigation } from '@/hooks/useTimeNavigation';
import { TimeSlider } from '@/components/ui/TimeSlider';
import { getTimeNavigationService } from '@/services/TimeNavigationService';
import type { LayerInfo } from '@/stores/layerStore';
import type { ViewState } from '@/types/viewState';

const mockApiService = {
  setVolumeTimepoint: vi.fn<Promise<void>, [string, number]>(() => Promise.resolve()),
  getVolumeTimepoint: vi.fn<Promise<number | null>, [string]>(() => Promise.resolve(0)),
};

vi.mock('@/services/apiService', () => ({
  getApiService: () => mockApiService,
}));

function clone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function createInitialViewState(): ViewState {
  return {
  views: {
    axial: { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, 1, 0], dim_px: [512, 512] },
    sagittal: { origin_mm: [0, 0, 0], u_mm: [0, 1, 0], v_mm: [0, 0, -1], dim_px: [512, 512] },
    coronal: { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, 0, -1], dim_px: [512, 512] },
    surface: { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, 1, 0], dim_px: [512, 512] },
  },
  crosshair: { world_mm: [0, 0, 0], visible: true },
  layers: [],
  timepoint: 0,
  };
}

const storeMocks = vi.hoisted(() => {
  const layerStoreState = {
    layers: [] as LayerInfo[],
  };

  const updateLayer = vi.fn((id: string, updates: Partial<LayerInfo>) => {
    const index = layerStoreState.layers.findIndex(layer => layer.id === id);
    if (index !== -1) {
      layerStoreState.layers[index] = {
        ...layerStoreState.layers[index],
        ...updates,
      };
    }
  });

  const useLayerStoreMock = ((selector?: (state: any) => any) => {
    const state = {
      layers: layerStoreState.layers,
      updateLayer,
    };
    return selector ? selector(state) : state;
  }) as any;

  useLayerStoreMock.getState = () => ({
    layers: layerStoreState.layers,
    updateLayer,
  });
  useLayerStoreMock.setState = vi.fn();
  useLayerStoreMock.subscribe = vi.fn(() => vi.fn());
  useLayerStoreMock.destroy = vi.fn();

  const viewStateStoreState = {
    viewState: createInitialViewState(),
  };

  const setViewState = (updater: (state: ViewState) => ViewState | void) => {
    const draft = clone(viewStateStoreState.viewState);
    const result = updater(draft);
    viewStateStoreState.viewState = result ?? draft;
  };

  const viewStateStoreApi = {
    get viewState() {
      return viewStateStoreState.viewState;
    },
    set viewState(state: ViewState) {
      viewStateStoreState.viewState = state;
    },
    setViewState,
    resizeInFlight: {
      axial: null,
      sagittal: null,
      coronal: null,
      mosaic: null,
      surface: null,
    } as Record<string, null>,
  };

  const useViewStateStoreMock = ((selector?: (state: typeof viewStateStoreApi) => any) => {
    const state = {
      ...viewStateStoreApi,
      viewState: viewStateStoreState.viewState,
    };
    return selector ? selector(state) : state;
  }) as any;

  useViewStateStoreMock.getState = () => ({
    ...viewStateStoreApi,
    viewState: viewStateStoreState.viewState,
  });
  useViewStateStoreMock.setState = vi.fn();
  useViewStateStoreMock.subscribe = vi.fn(() => vi.fn());
  useViewStateStoreMock.destroy = vi.fn();

  return {
    layerStoreState,
    updateLayer,
    useLayerStoreMock,
    viewStateStoreState,
    setViewState,
    viewStateStoreApi,
    useViewStateStoreMock,
  };
});

vi.mock('@/stores/layerStore', () => ({
  useLayerStore: storeMocks.useLayerStoreMock,
}));

vi.mock('@/stores/viewStateStore', () => ({
  useViewStateStore: storeMocks.useViewStateStoreMock,
}));

const make4DLayer = (): LayerInfo => ({
  id: 'layer-4d',
  name: 'Functional Series',
  volumeId: 'volume-4d',
  type: 'functional',
  visible: true,
  order: 0,
  opacity: 1,
  colormap: 'gray',
  intensity: [0, 1000],
  threshold: [0, 1000],
  volumeType: 'TimeSeries4D',
  timeSeriesInfo: {
    num_timepoints: 10,
    tr: 2,
    temporal_unit: 's',
    acquisition_time: null,
  },
  currentTimepoint: 0,
});

const resetStores = () => {
  storeMocks.layerStoreState.layers = [];
  storeMocks.updateLayer.mockClear();
  storeMocks.viewStateStoreState.viewState = createInitialViewState();
  mockApiService.setVolumeTimepoint.mockClear();
  mockApiService.getVolumeTimepoint.mockClear();
};

const install4DLayer = () => {
  storeMocks.layerStoreState.layers = [make4DLayer()];
};

describe('Time Navigation Integration', () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('detects presence of 4D volume', () => {
    const { result: noLayer } = renderHook(() => useTimeNavigation());
    expect(noLayer.current.has4DVolume()).toBe(false);

    install4DLayer();
    const { result: withLayer } = renderHook(() => useTimeNavigation());
    expect(withLayer.current.has4DVolume()).toBe(true);
  });

  it('persists timepoint changes and updates layer metadata', async () => {
    install4DLayer();
    const { result } = renderHook(() => useTimeNavigation());

    await act(async () => {
      result.current.setTimepoint(5);
      await Promise.resolve();
    });

    expect(storeMocks.viewStateStoreState.viewState.timepoint).toBe(5);
    expect(storeMocks.updateLayer).toHaveBeenCalledWith('layer-4d', { currentTimepoint: 5 });
    expect(storeMocks.layerStoreState.layers[0].currentTimepoint).toBe(5);
    expect(mockApiService.setVolumeTimepoint).toHaveBeenCalledWith('volume-4d', 5);
  });

  it('clamps requested timepoint to available range', async () => {
    install4DLayer();
    const { result } = renderHook(() => useTimeNavigation());

    await act(async () => {
      result.current.setTimepoint(15);
      await Promise.resolve();
    });

    expect(storeMocks.viewStateStoreState.viewState.timepoint).toBe(9);
    expect(mockApiService.setVolumeTimepoint).toHaveBeenCalledWith('volume-4d', 9);
  });

  it('provides immediate visual feedback in TimeSlider while throttling backend updates', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    install4DLayer();
    const { container } = render(createElement(TimeSlider));

    const track = container.querySelector('[data-testid="time-slider-track"]') as HTMLElement;
    expect(track).toBeTruthy();

    // Mock geometry for consistent calculations
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 200,
      bottom: 20,
      width: 200,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const callsBeforeInteraction = mockApiService.setVolumeTimepoint.mock.calls.length;

    fireEvent.mouseDown(track, { clientX: 0 });

    await act(async () => {
      vi.advanceTimersByTime(5);
      await Promise.resolve();
    });

    fireEvent.mouseMove(document, { clientX: 50 });

    await act(async () => {
      vi.advanceTimersByTime(5);
      await Promise.resolve();
    });

    fireEvent.mouseMove(document, { clientX: 100 });

    await act(async () => {
      vi.advanceTimersByTime(5);
      await Promise.resolve();
    });

    fireEvent.mouseMove(document, { clientX: 150 });

    const callsDuringDrag = mockApiService.setVolumeTimepoint.mock.calls.slice(callsBeforeInteraction);
    expect(callsDuringDrag.length).toBeLessThanOrEqual(2);

    await act(async () => {
      vi.advanceTimersByTime(11);
      await Promise.resolve();
    });

    expect(storeMocks.viewStateStoreState.viewState.timepoint).toBe(7);
    const trailingCalls = mockApiService.setVolumeTimepoint.mock.calls.slice(callsBeforeInteraction);
    const timepoints = trailingCalls.map(([, timepoint]) => timepoint);
    expect(timepoints).toContain(7);
    expect(timepoints.filter(tp => tp === 7)).toHaveLength(1);
  });

  it('TimeNavigationService.setTimepoint synchronises backend and metadata', async () => {
    install4DLayer();
    const service = getTimeNavigationService();

    await act(async () => {
      service.setTimepoint(4);
      await Promise.resolve();
    });

    expect(storeMocks.layerStoreState.layers[0].currentTimepoint).toBe(4);
    expect(mockApiService.setVolumeTimepoint).toHaveBeenCalledWith('volume-4d', 4);
  });
});
