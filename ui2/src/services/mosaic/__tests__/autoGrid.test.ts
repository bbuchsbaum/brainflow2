import { describe, expect, it } from 'vitest';
import { autoMosaicGrid, fitMosaicGrid } from '../sliceGeometry';

describe('mosaic Auto grid (user feedback: cramped tiles)', () => {
  it('picks the grid with the largest tiles for the pane and the brain aspect', () => {
    // A wide pane and a portrait brain: more columns than rows.
    const fit = autoMosaicGrid(1100, 640, 0.84, 78);
    expect(fit.cols).toBeGreaterThan(fit.rows);
    expect(fit.rows * fit.cols).toBeGreaterThanOrEqual(12);
    // No other grid with >= 12 tiles has larger tiles.
    for (let r = 1; r <= 8; r += 1) {
      for (let c = 1; c <= 8; c += 1) {
        if (r * c < 12) continue;
        expect(fitMosaicGrid(1100, 640, r, c, 0.84).tileWidth).toBeLessThanOrEqual(fit.tileWidth);
      }
    }
  });

  it('fills most of the pane (>= 80%) at 1600 and 1280 window sizes', () => {
    for (const [w, h] of [
      [810, 600],
      [600, 420],
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
