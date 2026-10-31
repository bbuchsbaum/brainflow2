import { describe, expect, it } from 'vitest';
import {
  canvasToWorldUnclamped,
  displayedPixelMm,
  planeShowsBox,
  resizeZoomedPlane,
  zoomPanPlane,
} from '../viewZoomGeometry';
import type { ViewPlane } from '@/types/coordinates';

// A fitted axial plane: 180×216 px of 1 mm, letterboxed into a 400×300 canvas.
const plane: ViewPlane = { origin_mm: [-90, 90, 12], u_mm: [1, 0, 0], v_mm: [0, -1, 0], dim_px: [180, 216] };
const placement = { x: 75, y: 0, width: 250, height: 300, imageWidth: 180, imageHeight: 216 };
const canvas: [number, number] = [400, 300];

const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

describe('zoom and pan as a view plane (QA features 2026-10-31 §1)', () => {
  it('zooming keeps the world point under the pointer and the slice', () => {
    const anchor = { canvasX: 150, canvasY: 100 };
    const before = canvasToWorldUnclamped(anchor, plane, placement);
    const next = zoomPanPlane({ plane, placement, canvas, anchor, factor: 2 })!;
    const full = { x: 0, y: 0, width: 400, height: 300, imageWidth: 400, imageHeight: 300 };
    close(canvasToWorldUnclamped(anchor, next, full), before);
    expect(displayedPixelMm(next, full)).toBeCloseTo(displayedPixelMm(plane, placement) / 2, 9);
    // The zoomed plane fills the canvas and stays on the slice.
    expect(next.dim_px).toEqual([400, 300]);
    expect(next.origin_mm[2]).toBe(12);
    expect(next.u_mm[1]).toBe(0);
    expect(next.v_mm[1]).toBeLessThan(0);
  });

  it('a pan moves the image with the pointer', () => {
    const anchor = { canvasX: 200, canvasY: 150 };
    const before = canvasToWorldUnclamped(anchor, plane, placement);
    const next = zoomPanPlane({ plane, placement, canvas, anchor, pan: { dx: 30, dy: -10 } })!;
    const full = { x: 0, y: 0, width: 400, height: 300, imageWidth: 400, imageHeight: 300 };
    close(canvasToWorldUnclamped({ canvasX: 230, canvasY: 140 }, next, full), before);
  });

  it('zoom and pan follow a mirrored (radiological) display', () => {
    const mirrored = { ...placement, mirrorX: true };
    const anchor = { canvasX: 120, canvasY: 80 };
    const before = canvasToWorldUnclamped(anchor, plane, mirrored);
    const next = zoomPanPlane({ plane, placement: mirrored, canvas, anchor, factor: 3, pan: { dx: 20, dy: 0 } })!;
    const full = { x: 0, y: 0, width: 400, height: 300, imageWidth: 400, imageHeight: 300, mirrorX: true };
    close(canvasToWorldUnclamped({ canvasX: 140, canvasY: 80 }, next, full), before);
    // The plane itself is never mirrored.
    expect(next.u_mm[0]).toBeGreaterThan(0);
  });

  it('the pixel size is clamped to the limits', () => {
    const next = zoomPanPlane({
      plane,
      placement,
      canvas,
      anchor: { canvasX: 200, canvasY: 150 },
      factor: 1000,
      limits: { min: 0.05, max: 10 },
    })!;
    expect(Math.hypot(...next.u_mm)).toBeCloseTo(0.05, 9);
  });

  it('a resize keeps the pixel size and the world point at the centre', () => {
    const zoomed = zoomPanPlane({ plane, placement, canvas, anchor: { canvasX: 200, canvasY: 150 }, factor: 2 })!;
    const centre = (p: ViewPlane) =>
      [0, 1, 2].map((a) => p.origin_mm[a] + (p.dim_px[0] / 2) * p.u_mm[a] + (p.dim_px[1] / 2) * p.v_mm[a]);
    const resized = resizeZoomedPlane(zoomed, [600, 200]);
    expect(resized.dim_px).toEqual([600, 200]);
    expect(resized.u_mm).toEqual(zoomed.u_mm);
    close(centre(resized), centre(zoomed));
  });

  it('knows whether a box is still in view (in-plane only)', () => {
    const zoomed = zoomPanPlane({ plane, placement, canvas, anchor: { canvasX: 200, canvasY: 150 }, factor: 8 })!;
    expect(planeShowsBox(zoomed, { min: [-90, -126, -72], max: [90, 90, 108] })).toBe(true);
    // Far to the side, any height: out of view.
    expect(planeShowsBox(zoomed, { min: [300, 300, 500], max: [320, 320, 520] })).toBe(false);
    // Off the slice height but in-plane overlapping: still shown (the normal is ignored).
    expect(planeShowsBox(zoomed, { min: [-5, -5, 200], max: [5, 5, 210] })).toBe(true);
  });
});
