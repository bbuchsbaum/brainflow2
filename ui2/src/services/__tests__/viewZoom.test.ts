/**
 * Zoom, pan and Fit of the slice views against the real view-state store
 * (QA features 2026-10-31 §1): zoom about the pointer, survive slice steps,
 * layer changes and resizes, and Fit back to the visible layers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useViewZoomStore } from '@/stores/viewZoomStore';
import { coalesceUtils } from '@/stores/middleware/coalesceUpdatesMiddleware';
import { layerFrameBoxes } from '@/services/layerFrameBoxes';
import { fitView, panView, placementForPlane, registerZoomPane, zoomView } from '@/services/ViewZoomService';
import { calculateImagePlacement } from '@/utils/canvasUtils';
import { fitViewsToWorldBox, type WorldBox } from '@/utils/worldFrame';
import { canvasToWorldUnclamped } from '@/utils/viewZoomGeometry';
import type { ViewLayer, ViewState } from '@/types/viewState';

const api = vi.hoisted(() => ({ recalculateAllViews: vi.fn() }));
vi.mock('@/services/apiService', () => ({ getApiService: () => api }));

const t1: WorldBox = { min: [-90, -126, -72], max: [90, 90, 108] };
const roi: WorldBox = { min: [10, -20, 20], max: [30, 0, 40] };
const far: WorldBox = { min: [400, 400, 400], max: [420, 420, 420] };
const crosshair: [number, number, number] = [0, 0, 0];

const viewLayer = (id: string): ViewLayer =>
  ({ id, name: id, volumeId: id, visible: true, opacity: 1 }) as unknown as ViewLayer;
const state = () => useViewStateStore.getState().viewState;
const key = () => useViewStateStore.getState().activeWorkspaceKey;
const zoomedNow = () => useViewZoomStore.getState().zoomed[key()]?.axial === true;

// A 400×300 axial canvas whose placement is the fitted plane's letterbox.
function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  c.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return c;
}
const canvas = makeCanvas(400, 300);
// The placement the current plane is drawn with on that canvas.
function placementOf() {
  const [w, h] = state().views.axial.dim_px;
  return calculateImagePlacement(w, h, 400, 300);
}

function load(id: string, box: WorldBox, first = false) {
  layerFrameBoxes.record(id, box);
  useViewStateStore.getState().setViewState((draft: ViewState) => {
    if (first) {
      draft.views = fitViewsToWorldBox(draft.views, box, crosshair, [400, 300]);
      draft.crosshair = { world_mm: crosshair, visible: true };
    }
    draft.layers.push(viewLayer(id));
  });
}

describe('view zoom and pan', () => {
  let unregister: () => void;
  beforeEach(() => {
    useViewStateStore.getState().resetToDefaults();
    useViewStateStore.getState().setViewState((draft: ViewState) => {
      draft.layers = [];
    });
    useViewZoomStore.setState({ zoomed: {} });
    coalesceUtils.clearPending();
    coalesceUtils.setBackendCallback(vi.fn());
    layerFrameBoxes.clear();
    unregister = registerZoomPane('axial', () => canvas);
    load('t1', t1, true);
  });
  afterEach(() => {
    unregister();
    coalesceUtils.clearPending();
    layerFrameBoxes.clear();
  });

  it('zooms about the pointer and marks the view', () => {
    const before = canvasToWorldUnclamped({ canvasX: 150, canvasY: 120 }, state().views.axial, placementOf());
    expect(zoomView('axial', 2, { x: 150, y: 120 })).toBe(true);
    const after = canvasToWorldUnclamped({ canvasX: 150, canvasY: 120 }, state().views.axial, placementOf());
    after.forEach((v, i) => expect(v).toBeCloseTo(before[i], 6));
    expect(zoomedNow()).toBe(true);
  });

  it('consecutive steps before a redraw keep the anchor fixed (review M2)', () => {
    const anchor = { canvasX: 130, canvasY: 90 };
    const start = canvasToWorldUnclamped(anchor, state().views.axial, placementOf());
    // No bitmap is redrawn in between: each step derives its placement from
    // the plane it edits.
    zoomView('axial', 1.5, { x: 130, y: 90 });
    zoomView('axial', 1.5, { x: 130, y: 90 });
    zoomView('axial', 0.8, { x: 130, y: 90 });
    const plane = state().views.axial;
    const now = canvasToWorldUnclamped(anchor, plane, placementForPlane('axial', plane, [400, 300]));
    now.forEach((v, i) => expect(v).toBeCloseTo(start[i], 6));
  });

  it('acts on the pane on screen, not a hidden tab mounted later (review H1)', () => {
    // A second workspace tab, hidden (GoldenLayout keeps it mounted): 0 × 0.
    const hidden = makeCanvas(0, 0);
    const unregisterHidden = registerZoomPane('axial', () => hidden);
    try {
      // The gesture's own canvas (the first tab's).
      expect(zoomView('axial', 2, { x: 200, y: 150 }, canvas)).toBe(true);
      // Pointer-less callers (F, ⌘K) find the on-screen pane, not the hidden one.
      expect(zoomView('axial', 1.2)).toBe(true);
      // A gesture on a hidden canvas does nothing.
      expect(zoomView('axial', 2, { x: 0, y: 0 }, hidden)).toBe(false);
      expect(panView('axial', 5, 5, hidden)).toBe(false);
    } finally {
      unregisterHidden();
    }
    // With the visible tab gone, nothing to act on.
    unregister();
    expect(zoomView('axial', 2)).toBe(false);
    unregister = registerZoomPane('axial', () => canvas);
  });

  it("a zoomed view's resize never cancels a fitted view's pending one (review L4)", async () => {
    // No recorded box: the locked layout asks the backend (pending).
    layerFrameBoxes.clear();
    let answer!: (views: unknown) => void;
    api.recalculateAllViews.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    useViewZoomStore.getState().markZoomed(key(), 'axial');
    const coronal = useViewStateStore.getState().updateDimensionsAndPreserveScale('coronal', [640, 480]);
    await useViewStateStore.getState().updateDimensionsAndPreserveScale('axial', [700, 500]);
    const backendCoronal = { origin_mm: [1, 2, 3], u_mm: [0.5, 0, 0], v_mm: [0, 0, -0.5], dim_px: [640, 480] };
    answer({ ...state().views, coronal: backendCoronal });
    await coronal;
    expect(state().views.coronal.u_mm).toEqual(backendCoronal.u_mm);
  });

  it('zoom marks go when nothing is shown any more (review L7)', () => {
    zoomView('axial', 2);
    expect(zoomedNow()).toBe(true);
    useViewStateStore.getState().setViewState((draft: ViewState) => {
      for (const layer of draft.layers) layer.visible = false;
    });
    expect(zoomedNow()).toBe(false);
  });

  it('zooms about the same point on a HiDPI (2×) canvas; the zoomed plane stays in CSS pixels', () => {
    const retina = makeCanvas(800, 600);
    retina.dataset.pixelRatio = '2';
    // CSS rect 400 × 300 (backing store 800 × 600).
    retina.getBoundingClientRect = canvas.getBoundingClientRect;
    const before = canvasToWorldUnclamped({ canvasX: 150, canvasY: 120 }, state().views.axial, placementOf());
    expect(zoomView('axial', 2, { x: 150, y: 120 }, retina)).toBe(true);
    const plane = state().views.axial;
    expect(plane.dim_px).toEqual([400, 300]);
    const after = canvasToWorldUnclamped({ canvasX: 150, canvasY: 120 }, plane, placementForPlane('axial', plane, [400, 300]));
    after.forEach((v, i) => expect(v).toBeCloseTo(before[i], 6));
  });

  it('a fractional CSS size rounds to whole pixels (the backend takes u32; review M4)', () => {
    const odd = makeCanvas(801, 601);
    odd.dataset.pixelRatio = '2';
    odd.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400.5, height: 300.5, right: 400.5, bottom: 300.5, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    expect(zoomView('axial', 2, { x: 100, y: 100 }, odd)).toBe(true);
    const dims = state().views.axial.dim_px;
    expect(dims.every(Number.isInteger)).toBe(true);
    expect(dims).toEqual([401, 301]);
  });

  it('stops at the zoom limits', () => {
    for (let i = 0; i < 30; i += 1) zoomView('axial', 4);
    const fitted = fitViewsToWorldBox(state().views, t1, crosshair, [400, 300]).axial;
    expect(Math.hypot(...state().views.axial.u_mm)).toBeCloseTo(Math.hypot(...fitted.u_mm) / 40, 6);
  });

  it('survives a slice step and a layer added', () => {
    zoomView('axial', 3, { x: 200, y: 150 });
    panView('axial', 25, -10);
    const zoomed = { ...state().views.axial };
    void useViewStateStore.getState().setCrosshair([0, 0, 30], true);
    expect(state().views.axial.u_mm).toEqual(zoomed.u_mm);
    expect(state().views.axial.origin_mm.slice(0, 2)).toEqual(zoomed.origin_mm.slice(0, 2));
    load('roi', roi);
    expect(state().views.axial.u_mm).toEqual(zoomed.u_mm);
    expect(zoomedNow()).toBe(true);
    // The other views still follow the layers.
    expect(useViewZoomStore.getState().zoomed[key()]?.coronal).toBeUndefined();
  });

  it('a removal refits only when the image would leave the view', () => {
    // Zoom into the T1, then open an image elsewhere (the zoom stays).
    zoomView('axial', 6, { x: 200, y: 150 });
    const zoomed = { ...state().views.axial };
    load('far', far);
    expect(state().views.axial.u_mm).toEqual(zoomed.u_mm);
    // Remove the far image: the T1 is still in view, the zoom stays.
    useViewStateStore.getState().setViewState((draft: ViewState) => {
      draft.layers = draft.layers.filter((l) => l.id !== 'far');
    });
    expect(state().views.axial.u_mm).toEqual(zoomed.u_mm);
    expect(zoomedNow()).toBe(true);
    // Remove the T1, leaving only the far image, which is out of this view: refit.
    load('far', far);
    useViewStateStore.getState().setViewState((draft: ViewState) => {
      draft.layers = draft.layers.filter((l) => l.id !== 't1');
    });
    expect(state().views.axial.u_mm).not.toEqual(zoomed.u_mm);
    expect(zoomedNow()).toBe(false);
  });

  it('a resize keeps a zoomed view (its canvas resizes the plane instead)', async () => {
    zoomView('axial', 2, { x: 200, y: 150 });
    const zoomed = { ...state().views.axial };
    await useViewStateStore.getState().updateDimensionsAndPreserveScale('axial', [640, 480]);
    expect(state().views.axial).toEqual(zoomed);
  });

  it('F and ⌘K "Fit View" fit the view under the pointer', async () => {
    const { fitActiveView } = await import('@/services/ViewZoomService');
    const { useMouseCoordinateStore } = await import('@/stores/mouseCoordinateStore');
    zoomView('axial', 3);
    useMouseCoordinateStore.getState().setMousePosition([0, 0, 0], 'axial');
    await fitActiveView();
    expect(zoomedNow()).toBe(false);
    useMouseCoordinateStore.getState().clearMousePosition();
  });

  it('Fit drops the zoom and frames the visible layers', async () => {
    const fitted = { ...state().views.axial };
    zoomView('axial', 5, { x: 100, y: 100 });
    await fitView('axial');
    expect(zoomedNow()).toBe(false);
    expect(Math.hypot(...state().views.axial.u_mm)).toBeCloseTo(Math.hypot(...fitted.u_mm), 6);
    expect(state().views.axial.origin_mm[2]).toBeCloseTo(fitted.origin_mm[2], 6);
  });
});
