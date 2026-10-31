import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));

import { MOSAIC_PIXEL_BUDGET, mosaicRenderRatio } from '../MosaicRenderService';

const setDpr = (value: number) => Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true });

describe('mosaicRenderRatio (HiDPI review L7)', () => {
  afterEach(() => setDpr(1));

  it('renders a page at the device ratio while it fits the pixel budget, else at 1×', () => {
    setDpr(2);
    const tile = { width: 200, height: 240 };
    const fits = Math.floor(MOSAIC_PIXEL_BUDGET / (tile.width * tile.height * 4));
    expect(mosaicRenderRatio(Array(fits).fill(tile))).toBe(2);
    expect(mosaicRenderRatio(Array(fits + 1).fill(tile))).toBe(1);
  });

  it('is 1× on a 1× display', () => {
    setDpr(1);
    expect(mosaicRenderRatio([{ width: 100, height: 100 }])).toBe(1);
  });
});
