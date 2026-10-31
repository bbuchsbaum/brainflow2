/**
 * The slice view's display conventions and zoom controls (QA features
 * 2026-10-31 §1–2): radiological mirroring is passed to the shared viewport
 * for axial and coronal only, with swapped letters and an "R | L" badge; a
 * zoomed view shows Fit.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewPlane } from '@/types/coordinates';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import { screen, fireEvent } from '@testing-library/react';
import { useViewDisplaySettingsStore } from '@/stores/viewDisplaySettingsStore';
import { useViewZoomStore } from '@/stores/viewZoomStore';
import { SLIDER_HEIGHT } from '../constants';

// The last props each SliceViewport received (one component per test).
interface ViewportProps {
  mirrorX?: boolean;
  onWorldClick?: (world: [number, number, number], event?: unknown) => void;
  onCanvasReady?: (canvas: unknown) => void;
  customRender?: (ctx: unknown, placement: Record<string, number>) => void;
  onMouseDown?: (event: unknown) => void;
}
const viewport = vi.hoisted(() => ({ props: null as null | ViewportProps }));
vi.mock('../SliceViewport', () => ({
  SliceViewport: (props: ViewportProps) => {
    viewport.props = props;
    return <div data-testid="slice-viewport" />;
  },
}));

vi.mock('@/services/ComparisonRenderService', () => ({
  comparisonTag: (panelId: string, viewType: string) => `comp-${panelId}-${viewType}`,
  getComparisonRenderService: () => ({
    renderPanel: vi.fn().mockResolvedValue(undefined),
    cancelRenders: vi.fn(),
  }),
}));

const AXIAL: ViewPlane = {
  origin_mm: [-50, 50, 0],
  u_mm: [1, 0, 0],
  v_mm: [0, -1, 0],
  dim_px: [100, 100],
};

// Voxel centres -29.5..29.5 (60 voxels of 1 mm): outer edges at ±30 mm.
const METADATA = {
  worldBounds: {
    min: [-29.5, -29.5, -29.5] as [number, number, number],
    max: [29.5, 29.5, 29.5] as [number, number, number],
  },
  dimensions: [60, 60, 60] as [number, number, number],
};

const modelMock = vi.hoisted(() => ({ viewPlane: null as unknown }));
vi.mock('@/hooks/useSliceViewModel', () => ({
  __esModule: true,
  useSliceViewModel: (viewId: string, dims: { width: number; height: number }) => ({
    viewPlane: modelMock.viewPlane,
    crosshair: { world_mm: [0, 0, 0], visible: true },
    layers: [{ id: 'layer-1', visible: true }],
    loadingLayers: new Set<string>(),
    hasLayers: true,
    isLoadingAnyLayer: false,
    canvasHeight: Math.max(1, dims.height - SLIDER_HEIGHT),
    renderContext: {
      id: viewId,
      type: 'slice' as const,
      dimensions: { width: dims.width, height: dims.height - SLIDER_HEIGHT },
      metadata: { viewType: viewId },
    },
    primaryLayer: { id: 'layer-1', visible: true },
    primaryOptions: {
      showBorder: false,
      borderThicknessPx: 1,
      showOrientationMarkers: true,
      showValueOnHover: true,
    },
    crosshairSettings: {
      visible: true,
      activeColor: '#ffffff',
      activeThickness: 1,
      activeStyle: 'solid' as const,
    },
  }),
}));

vi.mock('@/services/SliceNavigationService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/SliceNavigationService')>()),
  getSliceNavigationService: () => ({
    getSliceRange: vi.fn(() => ({ min: -30, max: 30, step: 1, current: 0 })),
    updateSlicePosition: vi.fn(),
    has4DVolume: vi.fn(() => false),
    getMode: vi.fn(() => 'slice'),
  }),
}));


beforeEach(() => {
  viewport.props = null;
  modelMock.viewPlane = AXIAL;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  useViewStateStore.getState().resetToDefaults();
  useViewZoomStore.setState({ zoomed: {} });
});

afterEach(() => {
  useViewDisplaySettingsStore.getState().setRadiological(false);
  vi.unstubAllGlobals();
});

async function renderView(viewId: 'axial' | 'sagittal') {
  const { SliceViewCanvas } = await import('../SliceViewCanvas');
  return render(<SliceViewCanvas viewId={viewId} width={300} height={300} />);
}

describe('radiological convention in a slice view', () => {
  it('off: not mirrored, neurological letters, no badge', async () => {
    await renderView('axial');
    expect(viewport.props?.mirrorX).toBe(false);
    expect(screen.queryByTestId('radiological-badge')).toBeNull();
  });

  it('on: an axial view is mirrored with swapped letters and an R | L badge', async () => {
    useViewDisplaySettingsStore.getState().setRadiological(true);
    const { container } = await renderView('axial');
    expect(viewport.props?.mirrorX).toBe(true);
    expect(screen.getByTestId('radiological-badge').textContent).toBe('R | L');
    const spans = [...container.querySelectorAll<HTMLSpanElement>('span.font-mono')];
    const at = (side: 'left' | 'right') => spans.find((el) => el.style[side] === '6px')?.textContent;
    // The patient's right on the screen's left.
    expect(at('left')).toBe('R');
    expect(at('right')).toBe('L');
  });

  it('on: a sagittal view is not mirrored', async () => {
    useViewDisplaySettingsStore.getState().setRadiological(true);
    modelMock.viewPlane = { origin_mm: [0, 50, 50], u_mm: [0, -1, 0], v_mm: [0, 0, -1], dim_px: [100, 100] };
    await renderView('sagittal');
    expect(viewport.props?.mirrorX).toBe(false);
    expect(screen.queryByTestId('radiological-badge')).toBeNull();
  });
});

describe('Fit control', () => {
  it('appears once the view is zoomed and clears the zoom', async () => {
    await renderView('axial');
    expect(screen.queryByTestId('view-fit')).toBeNull();
    const key = useViewStateStore.getState().activeWorkspaceKey;
    act(() => useViewZoomStore.getState().markZoomed(key, 'axial'));
    const fit = screen.getByTestId('view-fit');
    await act(async () => {
      fireEvent.click(fit);
    });
    expect(useViewZoomStore.getState().zoomed[key]?.axial).toBeUndefined();
  });
});

describe('Compare pane badge', () => {
  it('a mirrored Compare pane shows R | L', async () => {
    useViewDisplaySettingsStore.getState().setRadiological(true);
    useViewStateStore.getState().setViewState((state) => {
      state.layers = [
        { id: 'layer-1', name: 'T1', volumeId: 'volume-1', visible: true, opacity: 1, colormap: 'gray', intensity: [0, 1], threshold: [0, 0] },
      ];
      state.views.axial = AXIAL;
      return state;
    });
    const { ComparisonPanel } = await import('../ComparisonPanel');
    render(
      <ComparisonPanel
        workspaceId="compare-badge"
        panel={{ id: 'p1', label: 'T1', visibleLayerIds: new Set(['layer-1']), viewType: 'axial' }}
        width={400}
        height={300}
        layerNames={new Map([['layer-1', 'T1']])}
        onRemoveLayer={vi.fn()}
        onRemovePanel={vi.fn()}
        onViewTypeChange={vi.fn()}
      />,
    );
    expect(viewport.props?.mirrorX).toBe(true);
    expect(screen.getByTestId('radiological-badge').textContent).toBe('R | L');
  });
});

describe('toggling the convention changes nothing else (QA 2026-10-31 N14)', () => {
  it('keeps the crosshair and the orientation letters', async () => {
    const { useDisplayOptionsStore } = await import('@/stores/displayOptionsStore');
    useViewStateStore.getState().setViewState((state) => {
      state.crosshair = { world_mm: [-40, -20, 53], visible: true };
      return state;
    });
    useDisplayOptionsStore.getState().setOptions('layer-1', { showOrientationMarkers: true });
    await renderView('axial');
    act(() => useViewDisplaySettingsStore.getState().toggleRadiological());
    act(() => useViewDisplaySettingsStore.getState().toggleRadiological());
    expect(useViewStateStore.getState().viewState.crosshair.world_mm).toEqual([-40, -20, 53]);
    expect(useDisplayOptionsStore.getState().getOptions('layer-1').showOrientationMarkers).toBe(true);
  });
});
