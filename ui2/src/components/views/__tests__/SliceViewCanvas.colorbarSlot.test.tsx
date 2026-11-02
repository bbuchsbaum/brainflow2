/**
 * Each slice view publishes how well it holds the colorbar to its colorbar
 * group, and withdraws it on unmount (QA N16; the Orthogonal host choice).
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SLIDER_HEIGHT } from '../constants';
import { ColorbarGroupContext, useViewportFrameStore } from '../viewportFrame/viewportFrameStore';
import { ColorbarFit } from '../viewportFrame/colorbarPlacement';
import { beginRenderInteraction, endRenderInteraction, resetRenderInteraction, RATIO_RESTORE_MS } from '@/utils/renderPixelRatio';

interface ViewportProps {
  onCanvasReady?: (canvas: unknown) => void;
  onPlacementChange?: (placement: Record<string, number | boolean>) => void;
}
const viewport = vi.hoisted(() => ({ props: null as null | ViewportProps }));
vi.mock('../SliceViewport', () => ({
  SliceViewport: (props: ViewportProps) => {
    viewport.props = props;
    return <div />;
  },
}));
vi.mock('../viewportFrame', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../viewportFrame')>()),
  useOverlayColorbar: () => ({ layerId: 'z', name: 'z', colormap: 'fmri', intensity: [-6, 6], threshold: [-3, 3] }),
}));
// The host samples a long caret value; every view must still measure alike.
vi.mock('@/hooks/useLayerValueAtWorld', () => ({ useLayerValueAtWorld: () => ({ value: -1.2345e-3 }) }));
const measure = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('../viewportFrame/colorbarMeasure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../viewportFrame/colorbarMeasure')>();
  return {
    ...actual,
    measureColorbar: (...args: Parameters<typeof actual.measureColorbar>) => {
      measure.calls.push(args);
      return actual.measureColorbar(...args);
    },
  };
});
vi.mock('@/hooks/useSliceViewModel', () => ({
  __esModule: true,
  useSliceViewModel: (viewId: string, dims: { width: number; height: number }) => ({
    // 1 mm/px, origin at the top-left: a 100 x 100 mm volume box drawn at
    // (100..200, 50..150) in a 300 x 276 canvas, wide margins either side.
    viewPlane: { origin_mm: [-150, 138, 0], u_mm: [1, 0, 0], v_mm: [0, -1, 0], dim_px: [300, 276] },
    crosshair: { world_mm: [0, 0, 0], visible: true },
    layers: [{ id: 'z', visible: true }],
    loadingLayers: new Set<string>(),
    hasLayers: true,
    isLoadingAnyLayer: false,
    canvasHeight: dims.height - SLIDER_HEIGHT,
    renderContext: { id: viewId, type: 'slice', dimensions: dims, metadata: { viewType: viewId } },
    primaryLayer: { id: 'z', visible: true },
    primaryOptions: { showBorder: false, borderThicknessPx: 1, showOrientationMarkers: false, showValueOnHover: false },
    crosshairSettings: { visible: true, activeColor: '#fff', activeThickness: 1, activeStyle: 'solid' },
  }),
}));

const drawn = () => {
  // The canvas the viewport hands back, and its placement (the bitmap fills the pane).
  act(() => {
    viewport.props!.onCanvasReady?.({ width: 300, height: 276, getBoundingClientRect: () => ({ width: 300, height: 276 }) });
    viewport.props!.onPlacementChange?.({ x: 0, y: 0, width: 300, height: 276, imageWidth: 300, imageHeight: 276 });
  });
};

describe('SliceViewCanvas colorbar slot', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
    useViewportFrameStore.setState({ slots: {}, hosts: {} });
    resetRenderInteraction();
    measure.calls = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    resetRenderInteraction();
  });

  it('measures the host fit without the caret value, so the host cannot flip on a long value (review P2)', async () => {
    const { SliceViewCanvas } = await import('../SliceViewCanvas');
    const { unmount } = render(<SliceViewCanvas viewId="axial" width={300} height={300} />);
    drawn();
    // The fit is measured with the layer alone; only the drawn bar (the
    // host's ViewportColorbar) measures with its caret value.
    const fitCalls = measure.calls.filter((args) => args[1] === undefined);
    const barCalls = measure.calls.filter((args) => args[1] !== undefined);
    expect(fitCalls.length).toBeGreaterThan(0);
    expect(barCalls.every((args) => (args[1] as { value?: number }).value === -1.2345e-3)).toBe(true);
    unmount();
  });

  it('holds its published slot while a resize runs and publishes once quiet', async () => {
    vi.useFakeTimers();
    const { SliceViewCanvas } = await import('../SliceViewCanvas');
    const { rerender, unmount } = render(<SliceViewCanvas viewId="axial" width={300} height={300} />);
    drawn();
    const before = useViewportFrameStore.getState().slots.main?.axial;
    expect(before?.area).toBe(300 * 276);
    act(() => beginRenderInteraction('layout-resize'));
    rerender(<SliceViewCanvas viewId="axial" width={300} height={200} />);
    expect(useViewportFrameStore.getState().slots.main?.axial).toEqual(before);
    act(() => {
      endRenderInteraction('layout-resize');
      vi.advanceTimersByTime(RATIO_RESTORE_MS + 10);
    });
    expect(useViewportFrameStore.getState().slots.main?.axial?.area).toBe(300 * 176);
    unmount();
  });

  it('publishes its fit to the main group once drawn and withdraws it on unmount', async () => {
    const { SliceViewCanvas } = await import('../SliceViewCanvas');
    const { unmount } = render(<SliceViewCanvas viewId="axial" width={300} height={300} />);
    drawn();
    const slot = useViewportFrameStore.getState().slots.main?.axial;
    expect(slot).toBeDefined();
    expect(slot!.area).toBe(300 * 276);
    expect(slot!.fit).not.toBe(ColorbarFit.None);
    expect(useViewportFrameStore.getState().hosts.main?.plane).toBe('axial');
    unmount();
    expect(useViewportFrameStore.getState().slots.main).toBeUndefined();
    expect(useViewportFrameStore.getState().hosts.main).toBeUndefined();
  });

  it('publishes to its own group inside a colorbar group provider', async () => {
    const { SliceViewCanvas } = await import('../SliceViewCanvas');
    const { unmount } = render(
      <ColorbarGroupContext.Provider value={{ group: 'studio-test', describeLayerId: null }}>
        <SliceViewCanvas viewId="coronal" width={300} height={300} />
      </ColorbarGroupContext.Provider>,
    );
    drawn();
    expect(useViewportFrameStore.getState().slots['studio-test']?.coronal).toBeDefined();
    expect(useViewportFrameStore.getState().slots.main).toBeUndefined();
    unmount();
    expect(useViewportFrameStore.getState().slots['studio-test']).toBeUndefined();
  });
});
