import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';

const { panView, zoomView, emit } = vi.hoisted(() => ({ panView: vi.fn(), zoomView: vi.fn(), emit: vi.fn() }));
vi.mock('@/services/ViewZoomService', () => ({
  panView,
  zoomView,
  registerZoomPane: () => () => {},
  syncZoomedViewSize: vi.fn(),
}));
vi.mock('@/events/EventBus', () => ({ getEventBus: () => ({ emit, on: vi.fn(() => () => {}) }) }));

import { useViewPanZoom, wheelZoomFactor } from '../useViewPanZoom';

describe('wheelZoomFactor (QA features 2026-10-31 §1)', () => {
  it('plain and ⌘-scroll step slices; ⌥-scroll and a pinch zoom', () => {
    expect(wheelZoomFactor({ altKey: false, ctrlKey: false, deltaY: 10, deltaMode: 0 })).toBeNull();
    expect(wheelZoomFactor({ altKey: true, ctrlKey: false, deltaY: -100, deltaMode: 0 })!).toBeGreaterThan(1);
    expect(wheelZoomFactor({ altKey: true, ctrlKey: false, deltaY: 100, deltaMode: 0 })!).toBeLessThan(1);
    // A pinch (ctrl-wheel) zooms more per pixel.
    expect(wheelZoomFactor({ altKey: false, ctrlKey: true, deltaY: -10, deltaMode: 0 })!).toBeGreaterThan(
      wheelZoomFactor({ altKey: true, ctrlKey: false, deltaY: -10, deltaMode: 0 })!,
    );
  });
});

describe('useViewPanZoom', () => {
  let area: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers();
    panView.mockClear();
    zoomView.mockClear();
    emit.mockClear();
    area = document.createElement('div');
    area.setAttribute('data-view-id', 'axial');
    document.body.appendChild(area);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  });
  afterEach(() => {
    area.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const mount = () => {
    const areaRef = { current: area };
    return renderHook(() =>
      useViewPanZoom({
        viewType: 'axial',
        areaRef,
        canvas: () => null,
        size: [400, 300],
      }),
    );
  };

  it('a middle drag pans and never reaches the click-to-crosshair', () => {
    mount();
    const down = new MouseEvent('mousedown', { button: 1, clientX: 10, clientY: 10, bubbles: true, cancelable: true });
    area.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    fireEvent.mouseMove(window, { clientX: 30, clientY: 5 });
    act(() => vi.runAllTimers());
    fireEvent.mouseUp(window);
    expect(panView).toHaveBeenCalledWith('axial', 20, -5, null);
  });

  it('a plain left press is left to the viewer', () => {
    mount();
    const down = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true });
    area.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
  });

  it('Space over the view: tapped it is Play/pause, held for a drag it pans', () => {
    const { result } = mount();
    fireEvent.mouseEnter(area);
    // Tap.
    const tap = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(tap);
    });
    expect(tap.defaultPrevented).toBe(true);
    expect(result.current.panReady).toBe(true);
    fireEvent.keyUp(document.body, { key: ' ', code: 'Space' });
    expect(emit).toHaveBeenCalledWith('playback.toggle', {});
    emit.mockClear();
    // Hold and drag.
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    const down = new MouseEvent('mousedown', { button: 0, clientX: 0, clientY: 0, bubbles: true, cancelable: true });
    area.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    fireEvent.mouseMove(window, { clientX: 12, clientY: 8 });
    act(() => vi.runAllTimers());
    fireEvent.mouseUp(window);
    fireEvent.keyUp(document.body, { key: ' ', code: 'Space' });
    expect(panView).toHaveBeenCalledWith('axial', 12, 8, null);
    expect(emit).not.toHaveBeenCalled();
  });

  it('Space is not taken from a focused button or field, or when the pointer is elsewhere', () => {
    mount();
    const button = document.createElement('button');
    document.body.appendChild(button);
    fireEvent.mouseEnter(area);
    const onButton = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    button.dispatchEvent(onButton);
    expect(onButton.defaultPrevented).toBe(false);
    fireEvent.mouseLeave(area);
    const away = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    document.body.dispatchEvent(away);
    expect(away.defaultPrevented).toBe(false);
    button.remove();
  });

  it('losing the window with Space down forgets it and never toggles Play (review M3a)', () => {
    const { result } = mount();
    fireEvent.mouseEnter(area);
    act(() => {
      fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    });
    expect(result.current.panReady).toBe(true);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(result.current.panReady).toBe(false);
    fireEvent.keyUp(document.body, { key: ' ', code: 'Space' });
    expect(emit).not.toHaveBeenCalled();
  });

  it('Space-drag works after clicking a layer row (pointer focus, review M3b)', () => {
    mount();
    const row = document.createElement('div');
    row.tabIndex = 0;
    document.body.appendChild(row);
    // Focused by a click: not :focus-visible.
    const matches = row.matches.bind(row);
    row.matches = (selector: string) => (selector === ':focus-visible' ? false : matches(selector));
    row.focus();
    fireEvent.mouseMove(area); // hovered without an enter (remounted under the pointer, L7)
    const down = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    act(() => {
      row.dispatchEvent(down);
    });
    expect(down.defaultPrevented).toBe(true);
    row.remove();
  });

  it('one wheel event zooms by at most a quarter (review L6)', () => {
    expect(wheelZoomFactor({ altKey: false, ctrlKey: true, deltaY: 100, deltaMode: 0 })).toBeCloseTo(0.8, 9);
    expect(wheelZoomFactor({ altKey: false, ctrlKey: true, deltaY: -100, deltaMode: 0 })).toBeCloseTo(1.25, 9);
    // A pinch's small delta is not clamped.
    expect(wheelZoomFactor({ altKey: false, ctrlKey: true, deltaY: -3, deltaMode: 0 })).toBeCloseTo(Math.exp(0.03), 9);
  });

  it('a WebKit pinch zooms by the change in scale', () => {
    mount();
    const start = new Event('gesturestart', { cancelable: true });
    area.dispatchEvent(start);
    expect(start.defaultPrevented).toBe(true);
    const change = Object.assign(new Event('gesturechange', { cancelable: true }), { scale: 1.5, clientX: 40, clientY: 50 });
    area.dispatchEvent(change);
    expect(zoomView).toHaveBeenCalledWith('axial', 1.5, { x: 40, y: 50 }, null);
  });
});
