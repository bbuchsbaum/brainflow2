/**
 * Hover, click and the drawn overlay share one placement (v2 fidelity
 * critique): in a letterboxed pane (the axial view of the P3 fixture: a
 * 282×335 image in a 948×311 canvas), the world under a client pixel is the
 * same for the hover readout and a click, and projecting that world back
 * lands on the same pixel the overlay draws at.
 */
import { describe, expect, it } from 'vitest';
import {
  calculateImagePlacement,
  clientPointToWorld,
  projectWorldToCanvas,
} from '@brainflow/visualization/slice';

const plane = {
  origin_mm: [-95.5, 94.5, 50.5] as [number, number, number],
  u_mm: [0.674626886844635, 0, 0] as [number, number, number],
  v_mm: [0, -0.674626886844635, 0] as [number, number, number],
  dim_px: [282, 335] as [number, number],
};

function canvasAt(left: number, top: number, width: number, height: number): HTMLCanvasElement {
  return {
    width,
    height,
    getBoundingClientRect: () => ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    }),
  } as unknown as HTMLCanvasElement;
}

describe('slice placement agreement (letterboxed pane)', () => {
  const canvas = canvasAt(281, 69, 948, 311);
  const placement = calculateImagePlacement(282, 335, 948, 311);

  it('letterboxes in x only', () => {
    expect(placement).toMatchObject({ x: 343, y: 0, width: 262, height: 311 });
  });

  it('hover world == click world, and the overlay draws it back at the same pixel', () => {
    for (const [cx, cy] of [
      [703, 223],
      [624, 69],
      [860, 300],
    ]) {
      // Hover (SliceViewCanvas.canvasToWorld) and click (the viewer
      // controller's handleMouseDown) both call clientPointToWorld with the
      // render's placement and the store plane.
      const hover = clientPointToWorld(cx, cy, canvas, placement, plane)!;
      const click = clientPointToWorld(cx, cy, canvas, placement, plane)!;
      expect(hover).toEqual(click);
      const drawn = projectWorldToCanvas(hover, plane, placement)!;
      expect(drawn.canvasX + 281).toBeCloseTo(cx, 6);
      expect(drawn.canvasY + 69).toBeCloseTo(cy, 6);
    }
  });

  it('reads whole client pixels: the fixture point (−37.5, −17.5) is at x 703.9, read at 703', () => {
    const exact = projectWorldToCanvas([-37.5, -17.5, 50.5], plane, placement)!;
    expect(exact.canvasX + 281).toBeCloseTo(703.88, 1);
    // A mouse event reports 703: 0.88 px × 282/262 image px × 0.6746 mm.
    const read = clientPointToWorld(703, 223, canvas, placement, plane)!;
    expect(read[0]).toBeCloseTo(-38.14, 2);
    const rounded = clientPointToWorld(
      Math.round(exact.canvasX + 281),
      223,
      canvas,
      placement,
      plane,
    )!;
    expect(Math.abs(rounded[0] - -37.5)).toBeLessThan(0.4);
  });
});
