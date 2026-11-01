/**
 * A click places the crosshair only on the image data (p3 native check #9:
 * a click in a Compare/Mosaic margin put it at (-93, 178, 9), outside the
 * volume). The click-to-world mapping itself is untouched
 * (slicePlacementAgreement.test.ts); only acceptance is tested here.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewPlane } from '@/types/coordinates';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import { isClickOnData, unionWorldBoxes, volumeEdgeBounds } from '../clickDataBounds';
import { SLIDER_HEIGHT } from '../constants';

// The last props each SliceViewport received (one component per test).
interface ViewportProps {
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

const INSIDE: [number, number, number] = [10, -20, 0];
const LEFT_MARGIN: [number, number, number] = [-40, 0, 0];
// The report's point: far above the brain on an axial panel.
const TOP_MARGIN: [number, number, number] = [-93, 178, 9];

let setCrosshairSpy: ReturnType<typeof vi.fn>;
let originalSetCrosshair: unknown;

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
  useViewStateStore.getState().setViewState((state) => {
    state.layers = [
      {
        id: 'layer-1',
        name: 'Layer 1',
        volumeId: 'volume-1',
        visible: true,
        opacity: 1,
        colormap: 'gray',
        intensity: [0, 1],
        threshold: [0, 0],
      },
    ];
    state.views.axial = AXIAL;
    return state;
  });
  useLayerStore.setState({ layerMetadata: new Map([['layer-1', METADATA]]) } as never);
  originalSetCrosshair = useViewStateStore.getState().setCrosshair;
  setCrosshairSpy = vi.fn().mockResolvedValue(undefined);
  useViewStateStore.setState({ setCrosshair: setCrosshairSpy } as never);
});

afterEach(() => {
  useViewStateStore.setState({ setCrosshair: originalSetCrosshair } as never);
  useLayerStore.setState({ layerMetadata: new Map() } as never);
  vi.unstubAllGlobals();
});

describe('isClickOnData', () => {
  const bounds = volumeEdgeBounds(METADATA)!;

  it('accepts the data rectangle up to the outer voxel edges and rejects the margins', () => {
    expect(isClickOnData(INSIDE, AXIAL, bounds)).toBe(true);
    expect(isClickOnData([30, -30, 0], AXIAL, bounds)).toBe(true); // outer edge
    expect(isClickOnData([30.2, 0, 0], AXIAL, bounds)).toBe(false);
    expect(isClickOnData(LEFT_MARGIN, AXIAL, bounds)).toBe(false);
    expect(isClickOnData(TOP_MARGIN, AXIAL, bounds)).toBe(false);
  });

  it('tests the in-plane axes only (the slice position is not a margin)', () => {
    expect(isClickOnData([0, 0, 80], AXIAL, bounds)).toBe(true);
    const sagittal: ViewPlane = {
      origin_mm: [80, 50, 50],
      u_mm: [0, -1, 0],
      v_mm: [0, 0, -1],
      dim_px: [100, 100],
    };
    expect(isClickOnData([80, 0, 0], sagittal, bounds)).toBe(true);
    expect(isClickOnData([0, 0, 45], sagittal, bounds)).toBe(false);
  });

  it('accepts every click while the volume extent is unknown', () => {
    expect(isClickOnData(TOP_MARGIN, AXIAL, null)).toBe(true);
  });

  it('unions layer extents (a statistic map wider than the anatomy counts)', () => {
    const wide = {
      min: [-80, -10, -10] as [number, number, number],
      max: [80, 10, 10] as [number, number, number],
    };
    const box = unionWorldBoxes([bounds, null, wide])!;
    expect(box.min).toEqual([-80, -30, -30]);
    expect(box.max).toEqual([80, 30, 30]);
  });
});

describe('Compare panel clicks', () => {
  it('moves the crosshair for a click on the image and ignores the panel margin', async () => {
    const { ComparisonPanel } = await import('../ComparisonPanel');
    render(
      <ComparisonPanel
        workspaceId="compare-click"
        panel={{ id: 'p1', label: 'T1', visibleLayerIds: new Set(['layer-1']), viewType: 'axial' }}
        width={400}
        height={300}
        layerNames={new Map([['layer-1', 'T1']])}
        onRemoveLayer={vi.fn()}
        onRemovePanel={vi.fn()}
        onViewTypeChange={vi.fn()}
      />,
    );
    const onWorldClick = viewport.props?.onWorldClick as (w: [number, number, number]) => void;
    expect(onWorldClick).toBeTypeOf('function');

    act(() => onWorldClick(TOP_MARGIN));
    act(() => onWorldClick(LEFT_MARGIN));
    expect(setCrosshairSpy).not.toHaveBeenCalled();

    act(() => onWorldClick(INSIDE));
    expect(setCrosshairSpy).toHaveBeenCalledTimes(1);
    expect(setCrosshairSpy.mock.calls[0][0]).toEqual(INSIDE);
  });
});

describe('Orthogonal slice view clicks', () => {
  it('moves the crosshair for a click on the image and ignores the letterbox', async () => {
    const { SliceView } = await import('../SliceView');
    render(<SliceView viewId="axial" width={320} height={260} />);
    const onWorldClick = viewport.props?.onWorldClick as (
      w: [number, number, number],
      e: unknown,
    ) => void;
    expect(onWorldClick).toBeTypeOf('function');

    act(() => onWorldClick(LEFT_MARGIN, {}));
    act(() => onWorldClick(TOP_MARGIN, {}));
    expect(setCrosshairSpy).not.toHaveBeenCalled();

    act(() => onWorldClick(INSIDE, {}));
    expect(setCrosshairSpy).toHaveBeenCalledTimes(1);
    expect(setCrosshairSpy.mock.calls[0][0]).toEqual(INSIDE);
  });
});

describe('Mosaic tile clicks', () => {
  it('moves the crosshair for a click on the tile image and ignores the tile padding', async () => {
    const { MosaicCell } = await import('../MosaicCell');
    const service = {
      getViewPlaneForTag: () => AXIAL,
      getSlicePositionForTag: () => 4,
      calculateCrosshairForCell: () => ({ screenCoord: null, isActive: false }),
    };
    const onCrosshairClick = vi.fn();
    render(
      <MosaicCell
        workspaceId="mosaic-click"
        renderService={service as never}
        width={100}
        height={100}
        tag="mosaic-click-axial-4"
        sliceIndex={4}
        axis="axial"
        onCrosshairClick={onCrosshairClick}
      />,
    );
    const props = viewport.props!;
    // The tile's bitmap fills the canvas (100 × 100 px, 1 mm per pixel).
    const canvas = {
      width: 100,
      height: 100,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    };
    act(() => {
      props.onCanvasReady!(canvas);
      props.customRender!({}, {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        imageWidth: 100,
        imageHeight: 100,
      });
    });
    const click = (clientX: number, clientY: number) => {
      const event = { button: 0, clientX, clientY, preventDefault: vi.fn() };
      act(() => props.onMouseDown!(event));
      return event;
    };

    // Pixel (5, 50) -> x -45 mm: padding left of the brain inside the bitmap.
    click(5, 50);
    // Pixel (50, 2) -> y 48 mm: padding above the brain.
    click(50, 2);
    expect(onCrosshairClick).not.toHaveBeenCalled();

    // Pixel (60, 70) -> (10, -20) mm on the tile's slice.
    const event = click(60, 70);
    expect(onCrosshairClick).toHaveBeenCalledTimes(1);
    expect(onCrosshairClick.mock.calls[0][0]).toEqual([10, -20, 4]);
    expect(event.preventDefault).toHaveBeenCalled();
  });
});

describe('Mosaic tile clicks on a HiDPI (2×) canvas', () => {
  it('map the same pixel to the same world point as at 1×', async () => {
    const { MosaicCell } = await import('../MosaicCell');
    const service = {
      getViewPlaneForTag: () => AXIAL,
      getSlicePositionForTag: () => 4,
      calculateCrosshairForCell: () => ({ screenCoord: null, isActive: false }),
    };
    const onCrosshairClick = vi.fn();
    render(
      <MosaicCell
        workspaceId="mosaic-click-2x"
        renderService={service as never}
        width={100}
        height={100}
        tag="mosaic-click-2x-axial-4"
        sliceIndex={4}
        axis="axial"
        onCrosshairClick={onCrosshairClick}
      />,
    );
    const props = viewport.props!;
    // Backing store 200 × 200 for a 100 × 100 CSS tile; the custom render
    // gets the CSS placement (ui2's viewport divides by the ratio).
    const canvas = {
      width: 200,
      height: 200,
      dataset: { pixelRatio: '2' },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    };
    act(() => {
      props.onCanvasReady!(canvas);
      props.customRender!({}, { x: 0, y: 0, width: 100, height: 100, imageWidth: 100, imageHeight: 100 });
    });
    const event = { button: 0, clientX: 60, clientY: 70, preventDefault: vi.fn() };
    act(() => props.onMouseDown!(event));
    expect(onCrosshairClick.mock.calls[0][0]).toEqual([10, -20, 4]);
  });
});

