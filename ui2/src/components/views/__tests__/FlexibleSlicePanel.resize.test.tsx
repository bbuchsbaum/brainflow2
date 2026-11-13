/**
 * A pane resize (splitter, GoldenLayout, the window) renders at 1× until it
 * settles, then at the full ratio (HiDPI review: the layout-drag store was
 * never set, so resizes rendered at 2× every frame).
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sliceViewSizes = vi.hoisted(() => [] as Array<[number, number]>);
vi.mock('../SliceView', () => ({
  SliceView: ({ width, height }: { width: number; height: number }) => {
    sliceViewSizes.push([width, height]);
    return null;
  },
}));
vi.mock('@/stores/viewStateStore', () => ({
  useViewStateStore: {
    getState: () => ({
      viewState: { views: { axial: { dim_px: [10, 10] } } },
      updateDimensionsAndPreserveScale: vi.fn(async () => {}),
    }),
  },
}));

import { FlexibleSlicePanel } from '../FlexibleSlicePanel';
import { effectiveRenderRatio, RATIO_RESTORE_MS, resetRenderInteraction } from '@/utils/renderPixelRatio';

let observe: ((entries: Array<{ contentRect: { width: number; height: number } }>) => void) | null = null;

describe('FlexibleSlicePanel resize → render ratio', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    resetRenderInteraction();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: typeof observe) {
          observe = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRenderInteraction();
    vi.useRealTimers();
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
  });

  it('the first size is not a resize; a burst drops to 1× and restores when it settles', () => {
    render(<FlexibleSlicePanel viewId="axial" />);
    act(() => observe!([{ contentRect: { width: 400, height: 300 } }]));
    expect(effectiveRenderRatio()).toBe(2);
    for (let w = 401; w < 420; w += 1) {
      act(() => observe!([{ contentRect: { width: w, height: 300 } }]));
      act(() => {
        vi.advanceTimersByTime(16);
      });
      expect(effectiveRenderRatio()).toBe(1);
    }
    act(() => {
      vi.advanceTimersByTime(RATIO_RESTORE_MS);
    });
    expect(effectiveRenderRatio()).toBe(2);
  });

  // The canvas is centred in its pane: sized a frame late, it sat shifted by
  // half the difference, and the crosshair wobbled through a splitter drag.
  it('a resize reaches the view inside the observer callback, before the frame is painted', () => {
    render(<FlexibleSlicePanel viewId="axial" />);
    act(() => {
      vi.advanceTimersByTime(16);
    });
    // Asserted inside the callback's own turn: no timer or animation frame
    // runs between the observer callback and the view getting its size.
    act(() => {
      observe!([{ contentRect: { width: 400, height: 300 } }]);
      expect(sliceViewSizes.at(-1)).toEqual([400, 300]);
      observe!([{ contentRect: { width: 380, height: 300 } }]);
      expect(sliceViewSizes.at(-1)).toEqual([380, 300]);
    });
  });
});
