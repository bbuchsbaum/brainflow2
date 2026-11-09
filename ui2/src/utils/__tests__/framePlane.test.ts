import { describe, expect, it } from 'vitest';
import { projectWorldToCanvas } from '@brainflow/visualization/slice';
import type { ViewPlane } from '@/types/coordinates';
import { bitmapPlane, displayPlane, tagBitmapPlane } from '../framePlane';

// An axial plane: X right, Y (anterior) up, `px` mm per pixel, `size` pixels.
function axial(px: number, size: [number, number], z = 0): ViewPlane {
  return {
    origin_mm: [-50, 50, z],
    u_mm: [px, 0, 0],
    v_mm: [0, -px, 0],
    dim_px: size,
  } as ViewPlane;
}

// The bitmap rendered for `plane`, drawn 1:1 at the canvas origin.
function placementFor(plane: ViewPlane) {
  const [w, h] = plane.dim_px;
  return { x: 0, y: 0, width: w, height: h, imageWidth: w, imageHeight: h, mirrorX: false };
}

describe('framePlane', () => {
  it('records the plane a bitmap was rendered for', () => {
    const bitmap = {};
    const plane = axial(0.5, [200, 200]);
    expect(tagBitmapPlane(bitmap, plane)).toBe(bitmap);
    expect(bitmapPlane(bitmap)).toBe(plane);
    expect(bitmapPlane({})).toBeUndefined();
    expect(bitmapPlane(null)).toBeUndefined();
  });

  it('draws the crosshair where the shown frame has it while a resize frame is pending', () => {
    // A splitter step refits the plane (finer pixels) before its frame lands.
    const shown = axial(0.5, [200, 200]);
    const requested = axial(0.4, [250, 250]);
    const crosshair: [number, number, number] = [0, 0, 0];
    const placement = placementFor(shown);

    const truth = projectWorldToCanvas(crosshair, shown, placement)!;
    expect(truth.canvasX).toBeCloseTo(100);

    // The requested plane on the old frame misplaces it (the bounce).
    const wrong = projectWorldToCanvas(crosshair, requested, placement)!;
    expect(Math.abs(wrong.canvasX - truth.canvasX)).toBeGreaterThan(10);

    const point = projectWorldToCanvas(crosshair, displayPlane(requested, shown), placement)!;
    expect(point.canvasX).toBeCloseTo(truth.canvasX);
    expect(point.canvasY).toBeCloseTo(truth.canvasY);
  });

  it('follows a slice step at once so the crosshair stays on its slice', () => {
    const shown = axial(0.5, [200, 200], 0);
    const requested = axial(0.5, [200, 200], 12);
    const plane = displayPlane(requested, shown);
    expect(plane.origin_mm[2]).toBeCloseTo(12);
    expect(plane.u_mm).toEqual(shown.u_mm);
    expect(projectWorldToCanvas([0, 0, 12], plane, placementFor(shown))).not.toBeNull();
  });

  it('keeps the requested plane when the frame has none, matches, or faces another way', () => {
    const requested = axial(0.4, [250, 250]);
    expect(displayPlane(requested, undefined)).toBe(requested);
    expect(displayPlane(requested, axial(0.4, [250, 250]))).toBe(requested);
    const sagittal = {
      origin_mm: [0, -50, 50],
      u_mm: [0, 0.5, 0],
      v_mm: [0, 0, -0.5],
      dim_px: [200, 200],
    } as ViewPlane;
    expect(displayPlane(requested, sagittal)).toBe(requested);
  });
});
