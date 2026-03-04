import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDisplayOptionsStore } from '../displayOptionsStore';

describe('displayOptionsStore', () => {
  beforeEach(() => {
    useDisplayOptionsStore.setState({ options: new Map() });
  });

  it('returns stable default options for missing layers', () => {
    const state = useDisplayOptionsStore.getState();
    const first = state.getOptions('missing-layer');
    const second = state.getOptions('missing-layer');

    expect(first).toBe(second);
    expect(first).toEqual({
      showBorder: false,
      borderThicknessPx: 1,
      showOrientationMarkers: true,
      showValueOnHover: true,
    });
  });

  it('keeps getOptions selector output stable across rerenders', () => {
    const { result, rerender } = renderHook(() =>
      useDisplayOptionsStore((state) => state.getOptions('missing-layer'))
    );
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });
});
