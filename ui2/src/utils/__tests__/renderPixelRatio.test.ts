/**
 * HiDPI slice rendering (docs/plans/hidpi-slice-rendering-2026-10-31.md):
 * geometry stays in CSS pixels; the render grid is finer; every mapping
 * agrees at ratio 1 and 2.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientPointToWorld } from '@brainflow/visualization/slice';
import {
  beginRenderInteraction,
  bitmapPixelRatio,
  deviceRenderRatio,
  effectiveRenderRatio,
  endRenderInteraction,
  hidpiPlane,
  hidpiViewState,
  pulseRenderInteraction,
  resetRenderInteraction,
  RATIO_RESTORE_MS,
  subscribeRenderRatio,
  tagBitmapRatio,
} from '../renderPixelRatio';
import { drawScaledImage } from '../canvasUtils';
import { buildRequestedViewPayload } from '../viewGeometry';
import type { ViewPlane } from '@/types/coordinates';
import type { ViewState } from '@/types/viewState';

const plane: ViewPlane = { origin_mm: [-90, 108, 4], u_mm: [0.8, 0, 0], v_mm: [0, -0.8, 0], dim_px: [225, 271] };

function setDpr(value: number) {
  Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true });
}

function fakeCtx() {
  return { drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn() } as unknown as CanvasRenderingContext2D;
}

/** A canvas of `css` CSS px with a backing store `css × ratio`. */
function canvasOf(css: [number, number], ratio: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(css[0] * ratio);
  canvas.height = Math.round(css[1] * ratio);
  canvas.dataset.pixelRatio = String(ratio);
  canvas.getBoundingClientRect = () =>
    ({ left: 30, top: 20, width: css[0], height: css[1], right: 30 + css[0], bottom: 20 + css[1], x: 30, y: 20, toJSON: () => ({}) }) as DOMRect;
  return canvas;
}

describe('the render plane', () => {
  it('scales dim_px uniformly and keeps the origin, the world extent and square pixels', () => {
    const p = hidpiPlane(plane, 2);
    expect(p.dim_px).toEqual([450, 542]);
    expect(p.origin_mm).toEqual(plane.origin_mm);
    expect(Math.hypot(...p.u_mm)).toBeCloseTo(0.4, 12);
    expect(Math.hypot(...p.v_mm)).toBeCloseTo(Math.hypot(...p.u_mm), 12);
    // Same world extent.
    expect(p.dim_px[0] * p.u_mm[0]).toBeCloseTo(plane.dim_px[0] * plane.u_mm[0], 9);
    // Non-integer ratio: ceil, never a smaller extent, still square.
    const q = hidpiPlane(plane, 1.5);
    expect(q.dim_px).toEqual([338, 407]);
    expect(Math.hypot(...q.u_mm)).toBeCloseTo(Math.hypot(...q.v_mm), 12);
    expect(hidpiPlane(plane, 1)).toBe(plane);
  });

  it('is sent as is: the backend refit is the identity on it', () => {
    const p = hidpiPlane(plane, 2);
    const payload = buildRequestedViewPayload('axial', p, p.dim_px[0], p.dim_px[1]);
    expect(payload.width).toBe(450);
    expect(payload.origin_mm.slice(0, 3)).toEqual(p.origin_mm);
    // Full-frame u span = |u| × width: the same world extent as the CSS plane.
    expect(payload.u_mm[0]).toBeCloseTo(plane.u_mm[0] * plane.dim_px[0], 9);
  });

  it('only the rendered views are scaled; the stored state is untouched', () => {
    const state = { views: { axial: plane, sagittal: plane, coronal: plane } } as unknown as ViewState;
    const sent = hidpiViewState(state, ['axial'], 2);
    expect(sent.views.axial.dim_px).toEqual([450, 542]);
    expect(sent.views.sagittal).toBe(plane);
    expect(state.views.axial).toBe(plane);
  });
});

describe('click to world is the same at ratio 1 and 2', () => {
  it.each([
    [140.3, 155.7],
    [31, 21],
    [400, 300],
  ])('client (%f, %f)', (clientX, clientY) => {
    const css: [number, number] = [430, 330];
    const results = [1, 2].map((ratio) => {
      const canvas = canvasOf(css, ratio);
      const p = hidpiPlane(plane, ratio);
      const bitmap = tagBitmapRatio({ width: p.dim_px[0], height: p.dim_px[1] } as ImageBitmap, ratio);
      const placement = drawScaledImage(fakeCtx(), bitmap, canvas.width, canvas.height);
      // The placement reports the image in plane (CSS) pixels.
      expect([placement.imageWidth, placement.imageHeight]).toEqual([225, 271]);
      return clientPointToWorld(clientX, clientY, canvas, placement, plane);
    });
    if (results[0] === null) {
      expect(results[1]).toBeNull();
      return;
    }
    for (let a = 0; a < 3; a += 1) expect(results[1]![a]).toBeCloseTo(results[0]![a], 6);
  });
});

describe('the interaction ratio', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setDpr(2);
    resetRenderInteraction();
  });
  afterEach(() => {
    resetRenderInteraction();
    vi.useRealTimers();
    setDpr(1);
  });

  it('uses integer ratios only: 2 from a devicePixelRatio of 1.5 up, else 1 (review M4)', () => {
    expect(deviceRenderRatio()).toBe(2);
    setDpr(3);
    expect(deviceRenderRatio()).toBe(2);
    setDpr(1.5);
    expect(deviceRenderRatio()).toBe(2);
    setDpr(1.25);
    expect(deviceRenderRatio()).toBe(1);
    setDpr(0.5);
    expect(deviceRenderRatio()).toBe(1);
  });

  it('at 1.25 and 1.5 the render grid is exact (integer sizes, square pixels)', () => {
    for (const dpr of [1.25, 1.5]) {
      setDpr(dpr);
      const p = hidpiPlane(plane, deviceRenderRatio());
      expect(Number.isInteger(p.dim_px[0]) && Number.isInteger(p.dim_px[1])).toBe(true);
      expect(p.dim_px[0] % plane.dim_px[0]).toBe(0);
      expect(Math.hypot(...p.u_mm)).toBeCloseTo(Math.hypot(...p.v_mm), 12);
    }
  });

  it('a window blur ends every interaction and restores after the quiet time (review M3)', () => {
    beginRenderInteraction('window-level:axial');
    beginRenderInteraction('pan:axial');
    window.dispatchEvent(new Event('blur'));
    expect(effectiveRenderRatio()).toBe(1);
    vi.advanceTimersByTime(RATIO_RESTORE_MS);
    expect(effectiveRenderRatio()).toBe(2);
  });

  it('drops to 1× while dragging and comes back when idle, notifying both times', () => {
    const changes: number[] = [];
    const unsubscribe = subscribeRenderRatio(() => changes.push(effectiveRenderRatio()));
    expect(effectiveRenderRatio()).toBe(2);
    beginRenderInteraction('pan:axial');
    expect(effectiveRenderRatio()).toBe(1);
    // A second, overlapping interaction ends first: still 1×.
    beginRenderInteraction('layout-drag');
    endRenderInteraction('layout-drag');
    vi.advanceTimersByTime(RATIO_RESTORE_MS * 2);
    expect(effectiveRenderRatio()).toBe(1);
    endRenderInteraction('pan:axial');
    vi.advanceTimersByTime(RATIO_RESTORE_MS - 1);
    expect(effectiveRenderRatio()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(effectiveRenderRatio()).toBe(2);
    expect(changes).toEqual([1, 2]);
    unsubscribe();
  });

  it('a burst of zoom steps stays at 1× until the burst ends', () => {
    pulseRenderInteraction('zoom:axial');
    vi.advanceTimersByTime(RATIO_RESTORE_MS / 2);
    pulseRenderInteraction('zoom:axial');
    vi.advanceTimersByTime(RATIO_RESTORE_MS / 2);
    expect(effectiveRenderRatio()).toBe(1);
    vi.advanceTimersByTime(RATIO_RESTORE_MS);
    expect(effectiveRenderRatio()).toBe(2);
  });

  it('bitmaps remember the ratio they were rendered at', () => {
    const bitmap = {};
    expect(bitmapPixelRatio(bitmap)).toBe(1);
    tagBitmapRatio(bitmap, 2);
    expect(bitmapPixelRatio(bitmap)).toBe(2);
  });
});
