import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { SliceView } from '../SliceView';

function clone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);
}

function createDefaultViewState() {
  return {
    crosshair: {
      world_mm: [0, 0, 0] as [number, number, number],
      visible: true,
    },
    views: {
      axial: {
        origin_mm: [0, 0, 0] as [number, number, number],
        u_mm: [1, 0, 0] as [number, number, number],
        v_mm: [0, 1, 0] as [number, number, number],
        dim_px: [512, 512] as [number, number],
      },
      sagittal: {
        origin_mm: [0, 0, 0] as [number, number, number],
        u_mm: [0, 1, 0] as [number, number, number],
        v_mm: [0, 0, -1] as [number, number, number],
        dim_px: [512, 512] as [number, number],
      },
      coronal: {
        origin_mm: [0, 0, 0] as [number, number, number],
        u_mm: [1, 0, 0] as [number, number, number],
        v_mm: [0, 0, -1] as [number, number, number],
        dim_px: [512, 512] as [number, number],
      },
    },
    layers: [] as any[],
  };
}

type ViewStateShape = ReturnType<typeof createDefaultViewState>;

const viewStateStoreMock = vi.hoisted(() => {
  const setCrosshairMock = vi.fn<Promise<void>, [[number, number, number], boolean?, boolean?]>(() =>
    Promise.resolve()
  );
  const setCrosshairVisible = vi.fn();
  let storeApi: {
    viewState: ViewStateShape;
    resizeInFlight: Record<string, Promise<void> | null>;
    setViewState: ReturnType<typeof vi.fn>;
    setCrosshair: typeof setCrosshairMock;
    setCrosshairVisible: typeof setCrosshairVisible;
  };

  const setViewState = vi.fn(
    (updater: (draft: ViewStateShape) => ViewStateShape | void) => {
      const draft = clone(storeApi.viewState);
      const result = updater(draft);
      storeApi.viewState = result ?? draft;
    }
  );

  storeApi = {
    viewState: clone(createDefaultViewState()),
    resizeInFlight: { axial: null, sagittal: null, coronal: null, mosaic: null, surface: null } as Record<
      string,
      Promise<void> | null
    >,
    setViewState,
    setCrosshair: setCrosshairMock,
    setCrosshairVisible,
  };

  const useViewStateStore = ((selector?: (state: typeof storeApi) => any) => {
    const snapshot = {
      viewState: storeApi.viewState,
      setViewState: storeApi.setViewState,
      setCrosshair: storeApi.setCrosshair,
      setCrosshairVisible: storeApi.setCrosshairVisible,
      resizeInFlight: storeApi.resizeInFlight,
    };
    return selector ? selector(snapshot) : snapshot;
  }) as any;

  useViewStateStore.getState = () => ({
    viewState: storeApi.viewState,
    setViewState: storeApi.setViewState,
    setCrosshair: storeApi.setCrosshair,
    setCrosshairVisible: storeApi.setCrosshairVisible,
    resizeInFlight: storeApi.resizeInFlight,
  });
  useViewStateStore.setState = vi.fn();
  useViewStateStore.subscribe = vi.fn(() => vi.fn());
  useViewStateStore.destroy = vi.fn();

  return {
    storeApi,
    useViewStateStore,
    setCrosshairMock,
    setCrosshairVisible,
    setViewState,
    reset() {
      storeApi.viewState = clone(createDefaultViewState());
      storeApi.resizeInFlight = {
        axial: null,
        sagittal: null,
        coronal: null,
        mosaic: null,
        surface: null,
      };
      setViewState.mockClear();
      setCrosshairMock.mockClear();
      setCrosshairVisible.mockClear();
    },
  };
});

const layerStoreMock = vi.hoisted(() => {
  const state = {
    layers: [] as any[],
    loadingLayers: new Set<string>(),
    getLayerMetadata: vi.fn(() => null),
  };

  const useLayerStore = ((selector?: (snapshot: typeof state) => any) => {
    const snapshot = {
      layers: state.layers,
      loadingLayers: state.loadingLayers,
      getLayerMetadata: state.getLayerMetadata,
    };
    return selector ? selector(snapshot) : snapshot;
  }) as any;

  useLayerStore.getState = () => ({
    layers: state.layers,
    loadingLayers: state.loadingLayers,
    getLayerMetadata: state.getLayerMetadata,
  });
  useLayerStore.setState = vi.fn(updater => {
    const current = {
      layers: state.layers,
      loadingLayers: state.loadingLayers,
      getLayerMetadata: state.getLayerMetadata,
    };
    const next = typeof updater === 'function' ? updater(current) : updater;
    state.layers = next.layers ?? state.layers;
  });
  useLayerStore.subscribe = vi.fn(() => vi.fn());
  useLayerStore.destroy = vi.fn();

  return {
    state,
    useLayerStore,
    reset() {
      state.layers = [];
      state.loadingLayers = new Set();
      state.getLayerMetadata.mockReset().mockReturnValue(null);
    },
  };
});

const sliceNavigationMock = vi.hoisted(() => ({
  getSliceRange: vi.fn(() => ({ min: -100, max: 100, step: 1, current: 0 })),
  updateSlicePosition: vi.fn(),
  reset() {
    this.getSliceRange.mockReset().mockReturnValue({ min: -100, max: 100, step: 1, current: 0 });
    this.updateSlicePosition.mockReset();
  },
}));

const apiServiceMock = vi.hoisted(() => ({
  applyAndRenderViewState: vi.fn<Promise<{ width: number; height: number; close: () => void }>, [any]>(() =>
    Promise.resolve({ width: 256, height: 256, close: vi.fn() })
  ),
  reset() {
    this.applyAndRenderViewState.mockClear();
    this.applyAndRenderViewState.mockResolvedValue({ width: 256, height: 256, close: vi.fn() });
  },
}));

vi.mock('@/stores/viewStateStore', () => ({
  __esModule: true,
  useViewStateStore: viewStateStoreMock.useViewStateStore,
}));

vi.mock('@/stores/layerStore', () => ({
  __esModule: true,
  useLayerStore: layerStoreMock.useLayerStore,
}));

vi.mock('@/services/SliceNavigationService', () => ({
  __esModule: true,
  getSliceNavigationService: () => sliceNavigationMock,
}));

vi.mock('@/services/apiService', () => ({
  __esModule: true,
  getApiService: () => apiServiceMock,
}));

describe('SliceView', () => {
  beforeEach(() => {
    viewStateStoreMock.reset();
    layerStoreMock.reset();
    sliceNavigationMock.reset();
    apiServiceMock.reset();
  });

  it('renders fallback placeholder when no layers are available', () => {
    render(<SliceView viewId="axial" width={256} height={256} />);

    expect(screen.getByText('No volumes loaded')).toBeInTheDocument();
    expect(screen.getByText('Double-click a file or drag & drop')).toBeInTheDocument();
    expect(document.querySelector('input[type="range"]')).toBeNull();
  });

  it('shows slice controls when layers exist', () => {
    layerStoreMock.state.layers = [{ id: 'layer-1' }];

    render(<SliceView viewId="sagittal" width={320} height={240} />);

    expect(document.querySelector('input[type="range"]')).toBeTruthy();
    expect(screen.queryByText('No volumes loaded')).toBeNull();
  });

  it('queries the slice navigation service for the active view', () => {
    layerStoreMock.state.layers = [{ id: 'layer-1' }];

    render(<SliceView viewId="coronal" width={256} height={256} />);

    expect(sliceNavigationMock.getSliceRange).toHaveBeenCalledWith('coronal');
  });
});
