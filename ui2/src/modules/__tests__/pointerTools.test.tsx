import React, { useLayoutEffect, useRef } from 'react';
import { act, render } from '@testing-library/react';
import { ReusableSliceViewport, type SliceViewerSurfaceProps } from '@brainflow/visualization/slice';
import { describe, expect, it, vi } from 'vitest';
import { ViewportPointerController, type ViewportPointerSample, type ViewportTool } from '@brainflow/visualization/slice';

const sample = (pointerId: number, x = 1): ViewportPointerSample => ({
  pointerId, world: [x, 2, 3], pointerType: 'pen', pressure: 0.75, timeStamp: x,
  button: 0, buttons: 1, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
});
const tool = (): ViewportTool => ({ pointerDown: vi.fn(() => true), pointerMove: vi.fn(), pointerUp: vi.fn(), cancel: vi.fn() });

describe('shared viewport pointer ownership', () => {
  it('leaves navigation to the default crosshair if no tool accepts the input', () => {
    const c = new ViewportPointerController();
    expect(c.down([sample(1)])).toBe(false);
    c.select({ ...tool(), pointerDown: () => false });
    expect(c.down([sample(1)])).toBe(false);
    expect(c.move([sample(1)])).toBe(false);
    expect(c.up([sample(1)])).toBe(false);
  });

  it('delivers every sample in order to one pointer, without accepting a second contact', () => {
    const c = new ViewportPointerController();
    const t = tool();
    c.select(t);
    expect(c.down([sample(3)])).toBe(true);
    expect(c.down([sample(4)])).toBe(true);
    expect(t.pointerDown).toHaveBeenCalledTimes(1);
    expect(c.owns(4)).toBe(false);
    expect(c.move([sample(4)])).toBe(false);
    const samples = [sample(3, 2), sample(3, 3), sample(3, 4)];
    expect(c.move(samples)).toBe(true);
    expect(t.pointerMove).toHaveBeenCalledWith(samples);
    expect(c.up([sample(4)])).toBe(false);
    expect(c.up([sample(3, 5)])).toBe(true);
    expect(t.pointerUp).toHaveBeenCalledTimes(1);
    expect(c.owns(3)).toBe(false);
  });

  it.each(['cancelled', 'capture-lost', 'disposed'] as const)('cancels exactly once on %s', (reason) => {
    const c = new ViewportPointerController();
    const t = tool();
    c.select(t);
    c.down([sample(1)]);
    c.cancel(reason);
    c.cancel(reason);
    expect(t.cancel).toHaveBeenCalledExactlyOnceWith(reason);
    expect(c.up([sample(1)])).toBe(false);
  });

  it('cancels the previous stroke on tool change, before the new tool receives input', () => {
    const c = new ViewportPointerController();
    const a = tool();
    const b = tool();
    c.select(a);
    c.down([sample(1)]);
    c.select(a);
    expect(a.cancel).not.toHaveBeenCalled();
    c.select(b);
    expect(a.cancel).toHaveBeenCalledExactlyOnceWith('tool-changed');
    expect(c.up([sample(1)])).toBe(false);
    c.down([sample(2)]);
    expect(b.pointerDown).toHaveBeenCalledTimes(1);
  });
});

function TestSurface({ onCanvasReady, customRender }: SliceViewerSurfaceProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current!;
    canvas.getBoundingClientRect = () => ({ x: 5, y: 10, left: 5, top: 10, width: 100, height: 50, right: 105, bottom: 60, toJSON() {} });
    onCanvasReady(canvas);
    customRender({} as CanvasRenderingContext2D, { x: 0, y: 0, width: 100, height: 50, imageWidth: 100, imageHeight: 50 });
  }, [onCanvasReady, customRender]);
  return <canvas ref={ref} width={100} height={50} />;
}

function pen(type: string, x: number, coalesced?: MouseEvent[]) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: x, clientY: 20 });
  Object.defineProperties(event, {
    pointerId: { value: 9 }, pointerType: { value: 'pen' }, pressure: { value: 0.6 },
    getCoalescedEvents: { value: () => coalesced ?? [] },
  });
  return event;
}

it('maps real coalesced pointer events through the shared slice geometry and releases capture', () => {
  const t = tool();
  const crosshair = vi.fn();
  const { container, unmount } = render(<ReusableSliceViewport
    width={100} height={50} tool={t} onWorldClick={crosshair}
    viewPlane={{ origin_mm: [10, 20, 30], u_mm: [0.5, 0, 0], v_mm: [0, 2, 0] }}
    renderSurface={(props) => <TestSurface {...props} />}
  />);
  const viewport = container.firstElementChild as HTMLDivElement;
  const capture = vi.fn();
  const release = vi.fn();
  viewport.setPointerCapture = capture;
  viewport.hasPointerCapture = () => true;
  viewport.releasePointerCapture = release;
  const down = pen('pointerdown', 15);
  act(() => { viewport.dispatchEvent(down); });
  expect(down.defaultPrevented).toBe(true);
  expect(capture).toHaveBeenCalledWith(9);
  expect(t.pointerDown).toHaveBeenCalledWith([expect.objectContaining({ world: [15, 40, 30], pressure: 0.6, pointerType: 'pen' })]);
  act(() => { viewport.dispatchEvent(pen('pointermove', 35, [pen('pointermove', 25), pen('pointermove', 35)])); });
  expect(t.pointerMove).toHaveBeenCalledWith([
    expect.objectContaining({ world: [20, 40, 30] }),
    expect.objectContaining({ world: [25, 40, 30] }),
  ]);
  expect(crosshair).not.toHaveBeenCalled();
  act(() => { viewport.dispatchEvent(pen('pointerup', 35)); });
  expect(release).toHaveBeenCalledExactlyOnceWith(9);
  unmount();
  expect(t.cancel).not.toHaveBeenCalled();
});
