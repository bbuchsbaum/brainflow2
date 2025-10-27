/**
 * Resource lifecycle and memory tracking tests
 *
 * The rendering stack now centralises ImageBitmap ownership inside
 * RenderStateStore. These tests exercise that store directly to make
 * sure it replaces images deterministically and drops references when
 * asked, which is how we avoid retaining GPU-side bitmaps after views
 * are torn down.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from '@testing-library/react';

import { useRenderStateStore } from '@/stores/renderStateStore';
import { MemoryTracker } from '../helpers/performanceUtils';

const createMockBitmap = (label: string) =>
  ({
    width: 256,
    height: 256,
    close: vi.fn(),
    label,
  } as unknown as ImageBitmap);

describe('RenderStateStore resource lifecycle', () => {
  beforeEach(() => {
    const { clearAllStates } = useRenderStateStore.getState();
    act(() => clearAllStates());
  });

  it('stores only the most recent ImageBitmap per view', () => {
    const store = useRenderStateStore.getState();
    const first = createMockBitmap('first');
    const second = createMockBitmap('second');

    act(() => store.setImage('axial', first));
    expect(useRenderStateStore.getState().getState('axial').lastImage).toBe(first);

    act(() => store.setImage('axial', second));
    const current = useRenderStateStore.getState().getState('axial').lastImage;
    expect(current).toBe(second);
  });

  it('clears ImageBitmap references when a view state is removed', () => {
    const store = useRenderStateStore.getState();
    const bitmap = createMockBitmap('orphan');

    act(() => store.setImage('coronal', bitmap));
    expect(useRenderStateStore.getState().getState('coronal').lastImage).toBe(bitmap);

    act(() => store.clearState('coronal'));

    const cleared = useRenderStateStore.getState().getState('coronal');
    expect(cleared.lastImage).toBeNull();
    expect(cleared.isRendering).toBe(false);
    expect(cleared.renderCount).toBe(0);
  });

  it('drops every tracked ImageBitmap when clearing all render states', () => {
    const store = useRenderStateStore.getState();
    const ids = ['axial', 'sagittal', 'coronal'];

    act(() => {
      ids.forEach(id => {
        store.setImage(id, createMockBitmap(id));
      });
    });

    ids.forEach(id => {
      expect(useRenderStateStore.getState().getState(id).lastImage).not.toBeNull();
    });

    act(() => store.clearAllStates());

    ids.forEach(id => {
      const state = useRenderStateStore.getState().getState(id);
      expect(state.lastImage).toBeNull();
    });
  });
});

describe('MemoryTracker helper', () => {
  it('captures growth rate and peak usage', () => {
    const tracker = new MemoryTracker();

    const original = (performance as any).memory;
    (performance as any).memory = { usedJSHeapSize: 10 * 1024 * 1024 };
    tracker.measure();

    (performance as any).memory = { usedJSHeapSize: 12 * 1024 * 1024 };
    tracker.measure();

    expect(tracker.getPeakUsage()).toBe(12 * 1024 * 1024);
    expect(tracker.getGrowthRate()).toBeGreaterThanOrEqual(0);

    // Restore original performance.memory if it existed
    if (original) {
      (performance as any).memory = original;
    } else {
      delete (performance as any).memory;
    }
  });
});
