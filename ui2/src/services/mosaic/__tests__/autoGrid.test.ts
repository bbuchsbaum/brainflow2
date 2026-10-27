import { describe, expect, it } from 'vitest';
import { autoMosaicGrid, fitMosaicGrid } from '../sliceGeometry';

describe('mosaic Auto grid (user feedback: cramped tiles)', () => {
  it('keeps tiles within 80% of the largest possible and fills best among those', () => {
    // A wide pane and a portrait brain: more columns than rows.
    const fit = autoMosaicGrid(1100, 640, 0.84, 78);
    expect(fit.cols).toBeGreaterThan(fit.rows);
    expect(fit.rows * fit.cols).toBeGreaterThanOrEqual(12);
    let largest = 0;
    for (let r = 1; r <= 8; r += 1) {
      for (let c = 1; c <= 8; c += 1) {
        if (r * c >= 12) largest = Math.max(largest, fitMosaicGrid(1100, 640, r, c, 0.84).tileWidth);
      }
    }
    expect(fit.tileWidth).toBeGreaterThanOrEqual(0.8 * largest);
    for (let r = 1; r <= 8; r += 1) {
      for (let c = 1; c <= 8; c += 1) {
        if (r * c < 12) continue;
        const other = fitMosaicGrid(1100, 640, r, c, 0.84);
        if (other.tileWidth >= 0.8 * largest) expect(other.fill).toBeLessThanOrEqual(fit.fill + 1e-9);
      }
    }
  });

  it('does not leave a short, wide pane a third empty (1280 window, header row)', () => {
    // The mosaic area at 1280×800 with the header in its own row.
    const fit = autoMosaicGrid(622, 404, 0.84, 78);
    expect(fit.rows).toBeGreaterThanOrEqual(3);
    expect(fit.fill).toBeGreaterThanOrEqual(0.8);
  });

  it('fills most of the pane (>= 80%) at 1600 and 1280 window sizes', () => {
    for (const [w, h] of [
      [810, 600],
      [600, 420],
      [622, 404],
    ]) {
      const fit = autoMosaicGrid(w, h, 0.84, 78);
      expect(fit.fill).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('never shows more tiles than a short range holds', () => {
    const fit = autoMosaicGrid(800, 600, 1, 5);
    expect(fit.rows * fit.cols).toBeGreaterThanOrEqual(5);
    expect(fit.rows * fit.cols - Math.max(fit.rows, fit.cols)).toBeLessThan(5);
  });
});
