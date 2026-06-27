import { describe, it, expect } from 'vitest';
import { colormapNameToId, colormaps } from '../colormapOptions';

// These ids must match core/colormap COLORMAP_NAMES / BuiltinColormap enum
// discriminants. A drift here renders the wrong colormap (the mosaic-path bug
// this test was written to prevent: viridis previously resolved to id 4 = Plasma).
const EXPECTED: Record<string, number> = {
  grayscale: 0,
  grey: 0,
  gray: 0,
  viridis: 1,
  hot: 2,
  cool: 3,
  plasma: 4,
  inferno: 5,
  magma: 6,
  turbo: 7,
  pet: 8,
  pet_hot_metal: 8,
  fmri: 9,
  activation: 9,
  jet: 10,
  parula: 11,
  hsv: 12,
  phase: 13,
};

describe('colormapNameToId', () => {
  it('maps every backend colormap name to the correct BuiltinColormap id', () => {
    for (const [name, id] of Object.entries(EXPECTED)) {
      expect(colormapNameToId(name)).toBe(id);
    }
  });

  it('is case-insensitive', () => {
    expect(colormapNameToId('Viridis')).toBe(1);
    expect(colormapNameToId('JET')).toBe(10);
  });

  it('falls back to grayscale (0) for unknown or empty names', () => {
    expect(colormapNameToId('rainbow')).toBe(0);
    expect(colormapNameToId('')).toBe(0);
    expect(colormapNameToId(undefined)).toBe(0);
    expect(colormapNameToId(null)).toBe(0);
  });

  it('covers all 14 enum slots across the UI-offered names', () => {
    for (const c of colormaps) {
      const id = colormapNameToId(c.name);
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThanOrEqual(13);
    }
    const ids = new Set(colormaps.map((c) => colormapNameToId(c.name)));
    expect(ids.size).toBe(14);
  });
});
