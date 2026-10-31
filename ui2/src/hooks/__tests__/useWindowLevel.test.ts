import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWindowLevel } from '../useWindowLevel';

function setup(currentWindow: [number, number] | null) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 500 });
  document.body.appendChild(el);
  const onUpdate = vi.fn();
  const canvasRef = { current: el };
  const hook = renderHook(() =>
    useWindowLevel({
      canvasRef,
      layerId: 'z',
      dataRange: { min: -5, max: 6 },
      currentWindow,
      onUpdate,
    }),
  );
  const down = () => el.dispatchEvent(new MouseEvent('mousedown', { button: 2, clientX: 100, clientY: 100, bubbles: true }));
  const move = (x: number, y: number) => window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }));
  const up = () => window.dispatchEvent(new MouseEvent('mouseup', { button: 2 }));
  const menu = () => el.dispatchEvent(new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true }));
  return { onUpdate, down, move, up, menu, hook };
}

describe('useWindowLevel (native v6: the window changed by itself)', () => {
  it('a right press that opens the context menu is not a window/level drag', () => {
    const { onUpdate, down, move, up, menu } = setup([-6, 6]);
    down();
    menu(); // macOS opens the menu on mouse-down
    move(160, 140); // to "Export View as Image…", button still held
    up();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('a real drag starts from the current window, not the data range', () => {
    const { onUpdate, down, move } = setup([-6, 6]);
    down();
    move(105, 100); // +5 px wider, same level
    const [lo, hi] = onUpdate.mock.calls.at(-1)![0];
    expect((lo + hi) / 2).toBeCloseTo(0, 6);
    expect(hi - lo).toBeCloseTo(12 + 5 * (11 / 500), 6);
  });

  it.each([
    ['a window blur', () => window.dispatchEvent(new Event('blur'))],
    ['a pointercancel', () => window.dispatchEvent(new Event('pointercancel'))],
    [
      'the tab going hidden',
      () => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      },
    ],
  ])('a drag ends on %s without a mouseup (HiDPI review M3)', (_name, lose) => {
    const { down, move, hook } = setup([-6, 6]);
    down();
    act(() => move(140, 100));
    expect(hook.result.current.isDragging).toBe(true);
    act(() => lose());
    expect(hook.result.current.isDragging).toBe(false);
  });
});
