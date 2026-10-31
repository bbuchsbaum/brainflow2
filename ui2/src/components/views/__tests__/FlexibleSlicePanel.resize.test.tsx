/**
 * A pane resize (splitter, GoldenLayout, the window) renders at 1× until it
 * settles, then at the full ratio (HiDPI review: the layout-drag store was
 * never set, so resizes rendered at 2× every frame).
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../SliceView', () => ({ SliceView: () => null }));
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
});
