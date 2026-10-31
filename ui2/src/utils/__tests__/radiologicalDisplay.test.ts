/**
 * The radiological convention is a display transform (QA features
 * 2026-10-31 §2): the placement carries the mirror and every mapping goes
 * through it, so clicks, the crosshair and hover read the same world point
 * as the neurological display. The plane never changes.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  canvasPointToImagePoint,
  clientPointToWorld,
  imagePointToCanvasPoint,
  projectWorldToCanvas,
} from '@brainflow/visualization/slice';
import { drawScaledImage } from '@/utils/canvasUtils';
import { mirrorsView } from '@/stores/viewDisplaySettingsStore';
import { displayedLabels } from '@/utils/anatomicalLabels';
import type { ViewPlane } from '@/types/coordinates';

// Axial, neurological: +x (patient right) to screen right, +y up.
const axial: ViewPlane = { origin_mm: [-90, 90, 10], u_mm: [1, 0, 0], v_mm: [0, -1, 0], dim_px: [180, 180] };
const placement = { x: 10, y: 0, width: 360, height: 360, imageWidth: 180, imageHeight: 180 };
const mirrored = { ...placement, mirrorX: true };

function canvasAt(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) });
  return canvas;
}

describe('radiological display (mirrored placement)', () => {
  it('only axial and coronal panes mirror', () => {
    expect(mirrorsView('axial', true)).toBe(true);
    expect(mirrorsView('coronal', true)).toBe(true);
    expect(mirrorsView('sagittal', true)).toBe(false);
    expect(mirrorsView('axial', false)).toBe(false);
  });

  it('puts the patient right on the screen left and maps clicks back to the same world point', () => {
    const canvas = canvasAt(380, 360);
    // Left edge of the image (canvas x 20):
    const neuro = clientPointToWorld(20, 180, canvas, placement, axial)!;
    const radio = clientPointToWorld(20, 180, canvas, mirrored, axial)!;
    expect(neuro[0]).toBeLessThan(0); // patient left
    expect(radio[0]).toBeGreaterThan(0); // patient right
    // The plane is untouched: same y and slice.
    expect(radio[1]).toBeCloseTo(neuro[1], 9);
    expect(radio[2]).toBe(10);
    expect(radio[0]).toBeCloseTo(-neuro[0], 9);
  });

  it('the crosshair is drawn where a click there would put it', () => {
    const canvas = canvasAt(380, 360);
    const world: [number, number, number] = [42, -17, 10];
    const point = projectWorldToCanvas(world, axial, mirrored)!;
    // Mirrored: right of the patient (+42) is left of centre.
    expect(point.canvasX).toBeLessThan(placement.x + placement.width / 2);
    const clicked = clientPointToWorld(point.canvasX, point.canvasY, canvas, mirrored, axial)!;
    expect(clicked[0]).toBeCloseTo(42, 9);
    expect(clicked[1]).toBeCloseTo(-17, 9);
  });

  it('image <-> canvas round trips under the mirror', () => {
    const c = imagePointToCanvasPoint([30, 50], mirrored);
    expect(c.canvasX).toBeCloseTo(placement.x + (180 - 30) * 2, 9);
    expect(canvasPointToImagePoint(c, mirrored)).toEqual([30, 50]);
  });

  it('drawScaledImage draws mirrored in the same rectangle and says so', () => {
    const calls: string[] = [];
    const ctx = {
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      translate: (x: number, y: number) => calls.push(`translate ${x} ${y}`),
      scale: (x: number, y: number) => calls.push(`scale ${x} ${y}`),
      drawImage: vi.fn((..._args: unknown[]) => calls.push('draw')),
    } as unknown as CanvasRenderingContext2D;
    const image = { width: 180, height: 180 } as ImageBitmap;
    const plain = drawScaledImage(ctx, image, 380, 360);
    expect(plain.mirrorX).toBeUndefined();
    calls.length = 0;
    const flipped = drawScaledImage(ctx, image, 380, 360, true);
    expect(flipped).toEqual({ ...plain, mirrorX: true });
    expect(calls).toEqual(['save', `translate ${plain.x + plain.width} ${plain.y}`, 'scale -1 1', 'draw', 'restore']);
  });

  it('orientation letters swap left and right', () => {
    const neuro = displayedLabels(axial, false)!;
    const radio = displayedLabels(axial, true)!;
    expect(neuro.left).toBe('L');
    expect(neuro.right).toBe('R');
    expect(radio.left).toBe('R');
    expect(radio.right).toBe('L');
    expect(radio.top).toBe(neuro.top);
  });
});
