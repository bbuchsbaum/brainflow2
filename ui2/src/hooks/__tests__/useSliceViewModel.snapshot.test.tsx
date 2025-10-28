import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

type ViewStateSnapshot = {
  viewState: {
    crosshair: { world_mm: [number, number, number]; visible: boolean };
    views: Record<'axial' | 'sagittal' | 'coronal', {
      origin_mm: [number, number, number];
      u_mm: [number, number, number];
      v_mm: [number, number, number];
      dim_px: [number, number];
    }>;
    layers: any[];
  };
  resizeInFlight: Record<string, Promise<void> | null>;
  setViewState: ReturnType<typeof vi.fn>;
  setCrosshair: ReturnType<typeof vi.fn>;
  setCrosshairVisible: ReturnType<typeof vi.fn>;
};

function createViewState(): ViewStateSnapshot {
  return {
  viewState: {
    crosshair: { world_mm: [0, 0, 0], visible: true },
    views: {
      axial: {
        origin_mm: [0, 0, 0],
        u_mm: [1, 0, 0],
        v_mm: [0, 1, 0],
        dim_px: [512, 512],
      },
      sagittal: {
        origin_mm: [0, 0, 0],
        u_mm: [0, 1, 0],
        v_mm: [0, 0, -1],
        dim_px: [512, 512],
      },
      coronal: {
        origin_mm: [0, 0, 0],
        u_mm: [1, 0, 0],
        v_mm: [0, 0, -1],
        dim_px: [512, 512],
      },
    },
    layers: [],
  },
  resizeInFlight: { axial: null, sagittal: null, coronal: null, mosaic: null, surface: null },
  setViewState: vi.fn(),
  setCrosshair: vi.fn(),
  setCrosshairVisible: vi.fn(),
  };
}

const viewStateStoreMock = vi.hoisted(() => {
  const state = createViewState();
  const useViewStateStore = ((selector?: (snapshot: ViewStateSnapshot) => any) => {
    return selector ? selector(state) : state;
  }) as any;
  useViewStateStore.getState = () => state;
  useViewStateStore.setState = vi.fn();
  useViewStateStore.subscribe = vi.fn(() => vi.fn());
  useViewStateStore.destroy = vi.fn();
  return { state, useViewStateStore };
});

const layerStoreMock = vi.hoisted(() => {
  const state = {
    layers: [] as any[],
    loadingLayers: new Set<string>(),
  };
  const useLayerStore = ((selector?: (snapshot: typeof state) => any) => {
    return selector ? selector(state) : state;
  }) as any;
  useLayerStore.getState = () => state;
  useLayerStore.setState = vi.fn();
  useLayerStore.subscribe = vi.fn(() => vi.fn());
  useLayerStore.destroy = vi.fn();
  return { state, useLayerStore };
});

const renderStateStoreMock = vi.hoisted(() => {
  const contexts = new Map<string, any>();
  return {
    getState: () => ({
      registerContext: (ctx: any) => contexts.set(ctx.id, ctx),
      getContext: (id: string) => contexts.get(id),
    }),
  };
});

const crosshairSettingsState = {
  settings: {
    visible: true,
    activeColor: '#ffffff',
    activeThickness: 1,
    activeStyle: 'solid' as const,
    viewOverrides: {} as Record<string, any>,
  },
};

vi.mock('@/stores/viewStateStore', () => ({
  __esModule: true,
  useViewStateStore: viewStateStoreMock.useViewStateStore,
}));

vi.mock('@/stores/layerStore', () => ({
  __esModule: true,
  useLayerStore: layerStoreMock.useLayerStore,
}));

vi.mock('@/stores/renderStateStore', () => ({
  __esModule: true,
  useRenderStateStore: { getState: renderStateStoreMock.getState },
}));

vi.mock('@/stores/displayOptionsStore', () => ({
  __esModule: true,
  useDisplayOptionsStore: {
    getState: () => ({ options: new Map<string, any>() }),
  },
}));

vi.mock('@/stores/crosshairSettingsStore', () => ({
  __esModule: true,
  useCrosshairSettingsStore: ((selector?: (snapshot: typeof crosshairSettingsState) => any) => {
    return selector ? selector(crosshairSettingsState) : crosshairSettingsState;
  }) as any,
}));

const timeNavMock = vi.hoisted(() => ({
  has4DVolume: vi.fn(() => false),
  getMode: vi.fn(() => 'slice'),
  previousTimepoint: vi.fn(),
  nextTimepoint: vi.fn(),
  getTimeInfo: vi.fn(() => null),
}));

vi.mock('@/services/TimeNavigationService', () => ({
  __esModule: true,
  getTimeNavigationService: () => timeNavMock,
}));

vi.mock('@/services/SliceNavigationService', () => ({
  __esModule: true,
  getSliceNavigationService: () => ({
    getSliceRange: () => ({ min: -100, max: 100, step: 1, current: 0 }),
    updateSlicePosition: vi.fn(),
    has4DVolume: () => false,
    getMode: () => 'slice',
  }),
}));

vi.mock('@/services/RenderCoordinator', () => ({
  __esModule: true,
  getRenderCoordinator: () => ({ requestRender: vi.fn() }),
  setMultiViewBatchEnabled: vi.fn(),
}));

import { useSliceViewModel } from '../useSliceViewModel';

describe('useSliceViewModel snapshot stability', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('does not mutate snapshots during render (no render-phase writes)', () => {
    const { result } = renderHook(() => useSliceViewModel('axial', { width: 512, height: 512 }));

    expect(result.current.viewPlane).toBeDefined();
    expect(result.current.renderContext).toBeDefined();

    const calls = errorSpy.mock.calls.map((c) => String(c[0]));
    const churnLogs = calls.filter((msg) => msg.includes('Snapshot changed between reads in one render'));
    expect(churnLogs.length).toBe(0);
  });
});
