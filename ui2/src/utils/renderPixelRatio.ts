/**
 * Device-pixel rendering of slice views (docs/plans/hidpi-slice-rendering-2026-10-31.md).
 *
 * Geometry stays in CSS pixels: a view plane's `dim_px` counts CSS pixels.
 * Only the render request gets a finer grid ({@link hidpiPlane}): the same
 * origin, `u/r` and `v/r`, `ceil(dim_px · r)` pixels. The bitmap that comes
 * back is tagged with its ratio ({@link tagBitmapRatio}), so drawing it
 * reports the placement in plane (CSS) pixels. During an interaction the
 * ratio drops to 1 and comes back when it ends.
 */
import type { ViewPlane, ViewType } from '@/types/coordinates';
import type { ViewState } from '@/types/viewState';

/** Highest ratio rendered (a 3× display renders at 2×). */
export const MAX_RENDER_PIXEL_RATIO = 2;
/** Quiet time after an interaction before the full ratio returns. */
export const RATIO_RESTORE_MS = 200;

/**
 * The render ratio for this display: 2 from a devicePixelRatio of 1.5 up,
 * else 1. Integer ratios keep the grid exact (bitmap pixel = plane pixel /
 * r, integer canvas sizes); a 125 % display renders at 1×, a 150 % one at 2×.
 */
export function deviceRenderRatio(): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  return Number.isFinite(dpr) && dpr >= 1.5 ? MAX_RENDER_PIXEL_RATIO : 1;
}

// ── interaction: 1× while dragging, zooming or panning ──
const active = new Set<string>();
let restoreTimer: ReturnType<typeof setTimeout> | null = null;
let reduced = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/** The ratio slice views render at now. */
export function effectiveRenderRatio(): number {
  return reduced ? 1 : deviceRenderRatio();
}

/** An interaction started (`source` names it, so overlapping ones nest). */
export function beginRenderInteraction(source: string): void {
  active.add(source);
  if (restoreTimer) {
    clearTimeout(restoreTimer);
    restoreTimer = null;
  }
  if (!reduced) {
    reduced = true;
    notify();
  }
}

/** It ended; the full ratio returns after {@link RATIO_RESTORE_MS} of quiet. */
export function endRenderInteraction(source: string): void {
  active.delete(source);
  if (active.size > 0 || !reduced) return;
  if (restoreTimer) clearTimeout(restoreTimer);
  restoreTimer = setTimeout(() => {
    restoreTimer = null;
    if (active.size > 0) return;
    reduced = false;
    notify();
  }, RATIO_RESTORE_MS);
}

/** A momentary interaction (a wheel or pinch step): reduced, then restored when quiet. */
export function pulseRenderInteraction(source: string): void {
  beginRenderInteraction(source);
  endRenderInteraction(source);
}

/** Called when the effective ratio changes (re-render the views). */
export function subscribeRenderRatio(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test hook. */
export function resetRenderInteraction(): void {
  active.clear();
  if (restoreTimer) clearTimeout(restoreTimer);
  restoreTimer = null;
  reduced = false;
}

/**
 * Safety net: the window lost focus mid-interaction (⌘-Tab during a drag),
 * so some end events will never come. Every interaction is ended and the
 * full ratio returns after the usual quiet time.
 */
export function clearRenderInteractions(): void {
  for (const source of [...active]) endRenderInteraction(source);
}

if (typeof window !== 'undefined') {
  window.addEventListener('blur', clearRenderInteractions);
}

// ── device ratio changes (a window moved to another display) ──
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  let last = deviceRenderRatio();
  const watch = () => {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onChange = () => {
      query.removeEventListener?.('change', onChange);
      const now = deviceRenderRatio();
      if (now !== last) {
        last = now;
        notify();
      }
      watch();
    };
    query.addEventListener?.('change', onChange);
  };
  watch();
}

// ── render planes ──

/**
 * The plane to render at ratio `r`: the same origin and world extent, a
 * grid `r` times finer. Square pixels stay square (u and v scale together).
 * Bitmap pixel (bx, by) is plane pixel (bx / r, by / r).
 */
export function hidpiPlane(plane: ViewPlane, r: number): ViewPlane {
  if (!(r > 0) || r === 1) return plane;
  return {
    origin_mm: plane.origin_mm,
    u_mm: plane.u_mm.map((c) => c / r) as ViewPlane['u_mm'],
    v_mm: plane.v_mm.map((c) => c / r) as ViewPlane['v_mm'],
    dim_px: [
      Math.max(1, Math.ceil(plane.dim_px[0] * r - 1e-6)),
      Math.max(1, Math.ceil(plane.dim_px[1] * r - 1e-6)),
    ],
  };
}

/** The view state to send for rendering `viewTypes` at ratio `r`. */
export function hidpiViewState(
  viewState: ViewState,
  viewTypes: readonly ViewType[],
  r: number,
): ViewState {
  if (!(r > 0) || r === 1) return viewState;
  const views = { ...viewState.views };
  for (const viewType of viewTypes) {
    if (views[viewType]) views[viewType] = hidpiPlane(views[viewType], r);
  }
  return { ...viewState, views };
}

// ── bitmaps carry their ratio ──
const bitmapRatios = new WeakMap<object, number>();

export function tagBitmapRatio<T extends object | null | undefined>(bitmap: T, r: number): T {
  if (bitmap && r > 0 && r !== 1) bitmapRatios.set(bitmap, r);
  return bitmap;
}

/** The ratio a bitmap was rendered at (1 when untagged). */
export function bitmapPixelRatio(bitmap: object | null | undefined): number {
  return (bitmap && bitmapRatios.get(bitmap)) || 1;
}

// ── canvases ──

/** The ratio a slice canvas's backing store was sized with (data-pixel-ratio). */
export function canvasPixelRatio(canvas: HTMLCanvasElement | null | undefined): number {
  const value = Number(canvas?.dataset?.pixelRatio);
  return Number.isFinite(value) && value > 0 ? value : 1;
}
