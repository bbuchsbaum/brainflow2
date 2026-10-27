import { describe, expect, it } from 'vitest';
import {
  adaptCrosshairStyleToViewport,
  buildActiveCrosshairStyle,
  CROSSHAIR_HALO,
  crosshairDashSegments,
  DEFAULT_CROSSHAIR_STYLES,
  drawCrosshair,
  getLineDash,
  snapStrokeCoord,
  subtractIntervals,
} from '../crosshairUtils';

function recordingContext() {
  const strokes: Array<{ color: string; width: number; dash: number[]; offset: number; path: number[][] }> = [];
  let path: number[][] = [];
  let dash: number[] = [];
  const ctx = {
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    lineDashOffset: 0,
    save() {},
    restore() {},
    setLineDash(d: number[]) {
      dash = [...d];
    },
    beginPath() {
      path = [];
    },
    moveTo(x: number, y: number) {
      path.push([x, y]);
    },
    lineTo(x: number, y: number) {
      path.push([x, y]);
    },
    stroke() {
      strokes.push({
        color: String(ctx.strokeStyle),
        width: ctx.lineWidth,
        dash,
        offset: ctx.lineDashOffset,
        path: [...path],
      });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes };
}

describe('drawCrosshair halo', () => {
  it('draws a dark, wider halo beneath the coloured line with identical geometry', () => {
    const { ctx, strokes } = recordingContext();
    drawCrosshair({
      ctx,
      canvasX: 40,
      canvasY: 25,
      bounds: { x: 10, y: 5, width: 100, height: 60 },
      style: { color: '#5fe0a0', lineWidth: 1, lineDash: [5, 5] },
    });

    expect(strokes).toHaveLength(4);
    const [haloH, haloV, lineH, lineV] = strokes;
    expect(haloH.color).toBe(CROSSHAIR_HALO.color);
    expect(haloH.width).toBe(1 + CROSSHAIR_HALO.extraWidth);
    expect(lineH.color).toBe('#5fe0a0');
    expect(lineH.width).toBe(1);
    // Same positions and dash pattern: styling only, geometry frozen.
    expect(haloH.path).toEqual(lineH.path);
    expect(haloV.path).toEqual(lineV.path);
    // Dashes are laid out explicitly and stroked solid.
    expect(lineH.dash).toEqual([]);
    expect(haloH.dash).toEqual([]);
    // An odd (1px) core is centred on the pixel centre so it is not blurred
    // across two pixels; the same snapped coordinate is used for the halo.
    expect(lineH.path.every(([, y]) => y === 25.5)).toBe(true);
    expect(lineV.path.every(([x]) => x === 40.5)).toBe(true);
    // No gap: both arms start with a full dash at the crossing.
    expect(lineH.path).toContainEqual([40.5, 25.5]);
    expect(lineH.path).toContainEqual([35.5, 25.5]);
    expect(lineH.path).toContainEqual([45.5, 25.5]);
  });

  it('draws the 2px default core over a 1px-a-side 60% halo on the pixel grid', () => {
    const { ctx, strokes } = recordingContext();
    drawCrosshair({
      ctx,
      canvasX: 40.3,
      canvasY: 24.6,
      bounds: { x: 10, y: 5, width: 100, height: 60 },
      style: { ...DEFAULT_CROSSHAIR_STYLES.active, centerGap: 0 },
    });

    const [haloH, haloV, lineH, lineV] = strokes;
    expect(CROSSHAIR_HALO.color).toBe('rgba(0, 0, 0, 0.6)');
    expect(lineH.width).toBe(2);
    expect(haloH.width).toBe(4);
    // Even width: centred on the nearest pixel edge, so the core covers
    // exactly two whole pixel rows/columns.
    expect(lineH.path.every(([, y]) => y === 25)).toBe(true);
    expect(lineV.path.every(([x]) => x === 40)).toBe(true);
    // 6/6 dashes from the crossing outward, ends on whole pixels.
    expect(crosshairDashSegments('h', 40, 25, { x: 10, y: 5, width: 100, height: 60 }, { ...DEFAULT_CROSSHAIR_STYLES.active, centerGap: 0 }))
      .toEqual([[10, 16], [22, 28], [34, 40], [40, 46], [52, 58], [64, 70], [76, 82], [88, 94], [100, 106]]);
    expect(haloH.path).toEqual(lineH.path);
    expect(haloV.path).toEqual(lineV.path);
  });

  it('draws nothing outside the bounds', () => {
    const { ctx, strokes } = recordingContext();
    drawCrosshair({
      ctx,
      canvasX: 500,
      canvasY: 25,
      bounds: { x: 10, y: 5, width: 100, height: 60 },
      style: { color: '#5fe0a0', lineWidth: 1 },
    });
    expect(strokes).toHaveLength(0);
  });
});

describe('centre gap and knockouts', () => {
  it('keeps a 6px radius clear around the crossing for halo and core, dashes anchored at the gap', () => {
    const { ctx, strokes } = recordingContext();
    drawCrosshair({
      ctx,
      canvasX: 40.3,
      canvasY: 24.6,
      bounds: { x: 10, y: 5, width: 100, height: 60 },
      style: DEFAULT_CROSSHAIR_STYLES.active,
    });
    // halo: h, v; then the same for the core.
    expect(strokes).toHaveLength(4);
    const core = strokes.slice(2);
    const bounds = { x: 10, y: 5, width: 100, height: 60 };
    const h = crosshairDashSegments('h', 40, 25, bounds, DEFAULT_CROSSHAIR_STYLES.active);
    const v = crosshairDashSegments('v', 40, 25, bounds, DEFAULT_CROSSHAIR_STYLES.active);
    // A full dash starts exactly at the gap edge on every arm.
    expect(h).toContainEqual([28, 34]);
    expect(h).toContainEqual([46, 52]);
    expect(v).toContainEqual([13, 19]);
    expect(v).toContainEqual([31, 37]);
    // Arms run to the bounds; a fragment at the edge is kept only if >= 2px.
    expect(h[0]).toEqual([16, 22]);
    expect(v[0]).toEqual([5, 7]);
    expect(core[0].path).toEqual(h.flatMap(([a, b]) => [[a, 25], [b, 25]]));
    expect(core[1].path).toEqual(v.flatMap(([a, b]) => [[40, a], [40, b]]));
    expect(strokes.slice(0, 2).map((s) => s.path)).toEqual(core.map((s) => s.path));
  });

  it('frames a symmetric clear zone for any sub-pixel crossing', () => {
    const bounds = { x: 0, y: 0, width: 300, height: 200 };
    const styles = [
      DEFAULT_CROSSHAIR_STYLES.active,
      adaptCrosshairStyleToViewport(DEFAULT_CROSSHAIR_STYLES.active, 120, 120),
      adaptCrosshairStyleToViewport(DEFAULT_CROSSHAIR_STYLES.active, 90, 90),
    ];
    for (const style of styles) {
      for (let i = 0; i < 50; i++) {
        const cx = 60 + ((i * 37.13) % 180);
        const cy = 50 + ((i * 23.71) % 100);
        const x = snapStrokeCoord(cx, style.lineWidth);
        const y = snapStrokeCoord(cy, style.lineWidth);
        for (const [axis, c] of [['h', x], ['v', y]] as const) {
          const segs = crosshairDashSegments(axis, x, y, bounds, style);
          const left = Math.max(...segs.filter(([, b]) => b <= c).map(([, b]) => b));
          const right = Math.min(...segs.filter(([a]) => a >= c).map(([a]) => a));
          // Clear runs either side of the core centre are equal.
          expect(c - left).toBeCloseTo(right - c, 6);
          expect(right - c).toBeGreaterThanOrEqual(style.centerGap ?? 0);
          // The dashes framing the gap are full dashes.
          const first = segs.find(([a]) => a === right)!;
          expect(first[1] - first[0]).toBe(style.lineDash![0]);
          // No stubs anywhere.
          for (const [a, b] of segs) expect(b - a).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it('clips both strokes around knockout boxes they cross', () => {
    const { ctx, strokes } = recordingContext();
    drawCrosshair({
      ctx,
      canvasX: 40,
      canvasY: 25,
      bounds: { x: 10, y: 5, width: 100, height: 60 },
      style: { color: '#5fe0a0', lineWidth: 2, centerGap: 0 },
      // A letter box over the top of the vertical line; it does not touch the
      // horizontal line.
      knockouts: [{ x: 36, y: 6, width: 8, height: 10 }],
    });
    const core = strokes.slice(strokes.length / 2);
    expect(core.map((s) => s.path)).toEqual([
      [[10, 25], [110, 25]],
      [[40, 19], [40, 65]],
    ]);
  });

  it('subtracts overlapping intervals', () => {
    expect(subtractIntervals(0, 100, [[10, 20], [15, 30], [90, 120]])).toEqual([
      [0, 10],
      [30, 90],
    ]);
  });
});

describe('crosshair style helpers', () => {
  it('uses 6/6 dashes at the 2px default and 4/4 at 1px', () => {
    expect(getLineDash('dashed', 2)).toEqual([6, 6]);
    expect(getLineDash('dashed', 1)).toEqual([4, 4]);
    expect(getLineDash('solid', 2)).toBeUndefined();
  });

  it('builds the active style with the centre gap on unless switched off', () => {
    const base = { activeColor: '#5fe0a0', activeThickness: 2, activeStyle: 'dashed' as const };
    expect(buildActiveCrosshairStyle(base).centerGap).toBe(6);
    expect(buildActiveCrosshairStyle({ ...base, centerGap: true }).centerGap).toBe(6);
    expect(buildActiveCrosshairStyle({ ...base, centerGap: false }).centerGap).toBe(0);
  });

  it('steps small views to 4/4 dashes and a 4px gap, keeping the 2px core above 100px', () => {
    const style = buildActiveCrosshairStyle({
      activeColor: '#5fe0a0',
      activeThickness: 2,
      activeStyle: 'dashed',
    });
    expect(adaptCrosshairStyleToViewport(style, 400, 300)).toBe(style);
    // Main panes at 1280x800 (~205px) and Integrated side panes stay regular.
    expect(adaptCrosshairStyleToViewport(style, 300, 205)).toBe(style);
    expect(adaptCrosshairStyleToViewport(style, 300, 140)).toBe(style);
    const small = adaptCrosshairStyleToViewport(style, 300, 130);
    expect(small.lineWidth).toBe(2);
    expect(small.lineDash).toEqual([4, 4]);
    expect(small.haloAlpha).toBe(0.6);
    expect(small.centerGap).toBe(4);
    const tiny = adaptCrosshairStyleToViewport(style, 300, 90);
    expect(tiny.lineWidth).toBe(1);
    expect(tiny.haloAlpha).toBe(0.6);
    const dotted = adaptCrosshairStyleToViewport({ ...style, lineDash: [2, 4] }, 120, 120);
    expect(dotted.lineDash).toEqual([2, 4]);
    const tinyDotted = adaptCrosshairStyleToViewport({ ...style, lineDash: [2, 4] }, 90, 90);
    expect(tinyDotted.lineDash).toEqual([1, 2]);
  });
});

describe('snapStrokeCoord', () => {
  it('centres odd widths on pixel centres and even widths on pixel edges', () => {
    expect(snapStrokeCoord(12, 1)).toBe(12.5);
    expect(snapStrokeCoord(12.9, 1)).toBe(12.5);
    expect(snapStrokeCoord(12.4, 2)).toBe(12);
    expect(snapStrokeCoord(12.6, 2)).toBe(13);
    expect(snapStrokeCoord(12.2, 3)).toBe(12.5);
  });

  it('moves the line by at most half a pixel and leaves fractional widths alone', () => {
    for (const c of [0, 3.1, 7.5, 9.99, 100.49]) {
      for (const w of [1, 2, 3, 4]) {
        expect(Math.abs(snapStrokeCoord(c, w) - c)).toBeLessThanOrEqual(0.5);
      }
    }
    expect(snapStrokeCoord(12.3, 1.5)).toBe(12.3);
  });
});
