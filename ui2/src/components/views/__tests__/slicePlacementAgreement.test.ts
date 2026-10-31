/**
 * Hover, click and the drawn crosshair agree on a letterboxed pane (v2/v3
 * fidelity critics), through the real code paths:
 * - hover: SliceViewCanvas's mapping (utils/slicePointer.pointerToWorld);
 * - click: the viewer controller (useSliceViewerController.handleMouseDown);
 * - overlay: ui2's ReusableSliceViewport render callback, which projects the
 *   crosshair and calls drawCrosshair.
 * A fractional-pixel pointer (a trackpad reports sub-pixel positions) must
 * give the same world point for hover and click, and the overlay must draw
 * that point at the pointer's canvas pixel.
 */
import React from 'react';
import { render, renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { calculateImagePlacement, useSliceViewerController } from '@brainflow/visualization/slice';
import { pointerToWorld } from '@/utils/slicePointer';
import type { ViewPlane } from '@/types/coordinates';

const drawn: Array<{ canvasX: number; canvasY: number; lineWidth?: number; knockouts?: unknown[] }> = [];
let customRender: ((ctx: CanvasRenderingContext2D, placement: unknown) => void) | null = null;

vi.mock('@/utils/crosshairUtils', async (orig) => ({
  ...(await orig<typeof import('@/utils/crosshairUtils')>()),
  drawCrosshair: (opts: { canvasX: number; canvasY: number; style?: { lineWidth?: number }; knockouts?: unknown[] }) => {
    drawn.push({ canvasX: opts.canvasX, canvasY: opts.canvasY, lineWidth: opts.style?.lineWidth, knockouts: opts.knockouts });
  },
}));

vi.mock('@brainflow/visualization/slice', async (orig) => {
  const actual = await orig<typeof import('@brainflow/visualization/slice')>();
  return {
    ...actual,
    // Capture the render callback ui2's viewport hands to the shared one.
    ReusableSliceViewport: (props: { customRender?: typeof customRender }) => {
      customRender = props.customRender ?? null;
      return null;
    },
  };
});

const plane: ViewPlane = {
  origin_mm: [-95.5, 94.5, 50.5],
  u_mm: [0.674626886844635, 0, 0],
  v_mm: [0, -0.674626886844635, 0],
  dim_px: [282, 335],
} as ViewPlane;

const RECT = { left: 281, top: 69, width: 948, height: 311 };
const canvas = {
  width: 948,
  height: 311,
  getBoundingClientRect: () => ({
    ...RECT,
    right: RECT.left + RECT.width,
    bottom: RECT.top + RECT.height,
  }),
} as unknown as HTMLCanvasElement;
const placement = calculateImagePlacement(282, 335, 948, 311);
const ctx = { canvas } as unknown as CanvasRenderingContext2D;

describe('hover == click == drawn crosshair (letterboxed pane)', () => {
  beforeEach(() => {
    drawn.length = 0;
    customRender = null;
  });

  it.each([
    [703.9, 223.1],
    [624.37, 69.5],
    [860.25, 300.75],
  ])('pointer at (%f, %f)', async (clientX, clientY) => {
    // Click: the viewer controller with the render's placement.
    const clicks: Array<[number, number, number]> = [];
    const { result } = renderHook(() =>
      useSliceViewerController({ viewPlane: plane, onWorldClick: (w) => clicks.push(w) }),
    );
    act(() => {
      result.current.handleCanvasReady(canvas);
      result.current.handleRender(ctx, placement);
      result.current.handleMouseDown({
        clientX,
        clientY,
        button: 0,
        defaultPrevented: false,
      } as unknown as React.MouseEvent<HTMLDivElement>);
    });
    expect(clicks).toHaveLength(1);
    const click = clicks[0];

    // Hover: SliceViewCanvas's mapping, same placement and plane.
    const hover = pointerToWorld(clientX, clientY, canvas, placement, plane)!;
    for (let a = 0; a < 3; a += 1) expect(hover[a]).toBeCloseTo(click[a], 9);

    // Overlay: ui2's viewport draws the crosshair at that world point.
    const { ReusableSliceViewport } = await import('../sliceViewer/ReusableSliceViewport');
    render(
      React.createElement(ReusableSliceViewport, {
        width: 948,
        height: 311,
        viewPlane: plane,
        crosshair: { visible: true, world_mm: hover },
        crosshairStyle: { color: '#0f0', lineWidth: 1 },
      } as never),
    );
    expect(customRender).not.toBeNull();
    customRender!(ctx, placement);
    expect(drawn).toHaveLength(1);
    expect(drawn[0].canvasX + RECT.left).toBeCloseTo(clientX, 6);
    expect(drawn[0].canvasY + RECT.top).toBeCloseTo(clientY, 6);
  });
});

describe('hover == click == drawn crosshair on a radiological (mirrored) display (QA features 2026-10-31 §2)', () => {
  const mirrored = { ...placement, mirrorX: true };
  beforeEach(() => {
    drawn.length = 0;
    customRender = null;
  });

  it.each([
    [703.9, 223.1],
    [624.37, 69.5],
  ])('pointer at (%f, %f)', async (clientX, clientY) => {
    const clicks: Array<[number, number, number]> = [];
    const { result } = renderHook(() =>
      useSliceViewerController({ viewPlane: plane, onWorldClick: (w) => clicks.push(w) }),
    );
    act(() => {
      result.current.handleCanvasReady(canvas);
      result.current.handleRender(ctx, mirrored);
      result.current.handleMouseDown({
        clientX,
        clientY,
        button: 0,
        defaultPrevented: false,
      } as unknown as React.MouseEvent<HTMLDivElement>);
    });
    const click = clicks[0];
    const hover = pointerToWorld(clientX, clientY, canvas, mirrored, plane)!;
    for (let a = 0; a < 3; a += 1) expect(hover[a]).toBeCloseTo(click[a], 9);
    // Mirrored about the image centre: the neurological reading's x reflected.
    const neuro = pointerToWorld(clientX, clientY, canvas, placement, plane)!;
    const centreX = plane.origin_mm[0] + (plane.dim_px[0] / 2) * plane.u_mm[0];
    expect(hover[0] - centreX).toBeCloseTo(-(neuro[0] - centreX), 6);
    expect(hover[1]).toBeCloseTo(neuro[1], 9);

    const { ReusableSliceViewport } = await import('../sliceViewer/ReusableSliceViewport');
    render(
      React.createElement(ReusableSliceViewport, {
        width: 948,
        height: 311,
        viewPlane: plane,
        crosshair: { visible: true, world_mm: hover },
        crosshairStyle: { color: '#0f0', lineWidth: 1 },
      } as never),
    );
    customRender!(ctx, mirrored);
    expect(drawn).toHaveLength(1);
    expect(drawn[0].canvasX + RECT.left).toBeCloseTo(clientX, 6);
    expect(drawn[0].canvasY + RECT.top).toBeCloseTo(clientY, 6);
  });
});

describe('HiDPI: the crosshair is at the same CSS place and width at ratio 1 and 2', () => {
  beforeEach(() => {
    drawn.length = 0;
    customRender = null;
  });

  it('draws in CSS units under the ratio transform', async () => {
    const { tagBitmapRatio, hidpiPlane } = await import('@/utils/renderPixelRatio');
    const { drawScaledImage } = await import('@/utils/canvasUtils');
    const { ReusableSliceViewport } = await import('../sliceViewer/ReusableSliceViewport');
    const world: [number, number, number] = [10.25, -20.5, 50.5];
    const results = [];
    for (const ratio of [1, 2]) {
      const backing = {
        width: 948 * ratio,
        height: 311 * ratio,
        dataset: { pixelRatio: String(ratio) },
        getBoundingClientRect: canvas.getBoundingClientRect,
      } as unknown as HTMLCanvasElement;
      const transforms: number[][] = [];
      const ctx = {
        canvas: backing,
        save: () => {},
        restore: () => {},
        setTransform: (...m: number[]) => transforms.push(m),
        drawImage: () => {},
        translate: () => {},
        scale: () => {},
      } as unknown as CanvasRenderingContext2D;
      const p = hidpiPlane(plane, ratio);
      const bitmap = tagBitmapRatio({ width: p.dim_px[0], height: p.dim_px[1] } as ImageBitmap, ratio);
      const placementAtRatio = drawScaledImage(ctx, bitmap, backing.width, backing.height);
      render(
        React.createElement(ReusableSliceViewport, {
          width: 948,
          height: 311,
          viewPlane: plane,
          crosshair: { visible: true, world_mm: world },
          crosshairStyle: { color: '#0f0', lineWidth: 1 },
        } as never),
      );
      drawn.length = 0;
      customRender!(ctx, placementAtRatio);
      results.push({ point: drawn[0], transforms });
    }
    // Same CSS position and the same CSS width; at 2× it is drawn under a 2× transform.
    expect(results[1].point.canvasX).toBeCloseTo(results[0].point.canvasX, 6);
    expect(results[1].point.canvasY).toBeCloseTo(results[0].point.canvasY, 6);
    expect(results[1].point.lineWidth).toBe(results[0].point.lineWidth);
    expect(results[0].transforms).toEqual([]);
    expect(results[1].transforms).toEqual([[2, 0, 0, 2, 0, 0]]);
  });
});

describe('HiDPI: mirrored 2× click == crosshair, and knock-outs in CSS units', () => {
  beforeEach(() => {
    drawn.length = 0;
    customRender = null;
  });

  it('a mirrored 2× pane maps the click and draws the crosshair at the pointer; knock-outs are CSS', async () => {
    const { tagBitmapRatio, hidpiPlane } = await import('@/utils/renderPixelRatio');
    const { drawScaledImage } = await import('@/utils/canvasUtils');
    const { ReusableSliceViewport } = await import('../sliceViewer/ReusableSliceViewport');
    const backing = {
      width: 948 * 2,
      height: 311 * 2,
      dataset: { pixelRatio: '2' },
      getBoundingClientRect: canvas.getBoundingClientRect,
    } as unknown as HTMLCanvasElement;
    const ctx = {
      canvas: backing,
      save: () => {},
      restore: () => {},
      setTransform: () => {},
      drawImage: () => {},
      translate: () => {},
      scale: () => {},
    } as unknown as CanvasRenderingContext2D;
    const p = hidpiPlane(plane, 2);
    const bitmap = tagBitmapRatio({ width: p.dim_px[0], height: p.dim_px[1] } as ImageBitmap, 2);
    const mirroredPlacement = drawScaledImage(ctx, bitmap, backing.width, backing.height, true);
    expect(mirroredPlacement.mirrorX).toBe(true);

    // Click through the shared controller at 2×.
    const clientX = 703.9;
    const clientY = 223.1;
    const clicks: Array<[number, number, number]> = [];
    const { result } = renderHook(() =>
      useSliceViewerController({ viewPlane: plane, onWorldClick: (w) => clicks.push(w) }),
    );
    act(() => {
      result.current.handleCanvasReady(backing);
      result.current.handleRender(ctx, mirroredPlacement);
      result.current.handleMouseDown({ clientX, clientY, button: 0, defaultPrevented: false } as unknown as React.MouseEvent<HTMLDivElement>);
    });
    const click = clicks[0];
    // The same world point as the 1× mirrored mapping.
    const oneX = pointerToWorld(clientX, clientY, canvas, { ...placement, mirrorX: true }, plane)!;
    for (let a = 0; a < 3; a += 1) expect(click[a]).toBeCloseTo(oneX[a], 1);

    // The crosshair drawn there lands at the pointer (CSS px), and a client
    // knock-out rectangle arrives in CSS canvas units.
    render(
      React.createElement(ReusableSliceViewport, {
        width: 948,
        height: 311,
        viewPlane: plane,
        crosshair: { visible: true, world_mm: click },
        crosshairStyle: { color: '#0f0', lineWidth: 1 },
        getCrosshairKnockouts: () => [{ x: RECT.left + 100, y: RECT.top + 10, width: 20, height: 8 }],
      } as never),
    );
    drawn.length = 0;
    customRender!(ctx, mirroredPlacement);
    expect(drawn[0].canvasX + RECT.left).toBeCloseTo(clientX, 6);
    expect(drawn[0].canvasY + RECT.top).toBeCloseTo(clientY, 6);
    expect(drawn[0].knockouts).toEqual([{ x: 100, y: 10, width: 20, height: 8 }]);
  });
});

