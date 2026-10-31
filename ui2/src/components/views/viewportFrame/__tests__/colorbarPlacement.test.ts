import { describe, expect, it } from 'vitest';
import { placeColorbar, SIDE_LETTER_BAND, type ColorbarPlacementInput } from '../colorbarPlacement';

// A block 60 px wide plus 40 px of captions; bars 48–160 px.
const base = (over: Partial<ColorbarPlacementInput>): ColorbarPlacementInput => ({
  width: 900,
  height: 400,
  chromeH: 40,
  boxWidth: () => 60,
  minBarH: 48,
  maxBarH: 160,
  topReserve: 30,
  ...over,
});
const inside = (p: { left: number; top: number; barH: number }, x: number, y: number) =>
  x >= p.left && x <= p.left + 60 && y >= p.top && y <= p.top + p.barH + 40;

describe('placeColorbar (QA 2026-10-31 N16)', () => {
  it('margin available: beside the image in the right margin, off the data, no scrim', () => {
    const p = placeColorbar(base({ imageRect: { left: 250, top: 0, right: 650, bottom: 400 } }))!;
    expect(p.slot).toBe('right');
    expect(p.left).toBe(662);
    expect(p.scrim).toBe(false);
    // Vertically centred on the image.
    expect(p.top + (p.barH + 40) / 2).toBeCloseTo(200, 0);
  });

  it('takes the larger margin: left when the image sits right', () => {
    const p = placeColorbar(base({ imageRect: { left: 400, top: 0, right: 820, bottom: 400 } }))!;
    expect(p.slot).toBe('left');
    expect(p.left + 60).toBeLessThanOrEqual(400 - 12);
  });

  it('then the bottom margin under a wide, short image', () => {
    const p = placeColorbar(base({ width: 400, height: 500, imageRect: { left: 0, top: 0, right: 400, bottom: 260 } }))!;
    expect(p.slot).toBe('bottom');
    expect(p.top).toBeGreaterThanOrEqual(260);
  });

  it('no margin (full-bleed / zoomed): the corner with the least data, on a scrim', () => {
    // The data fills the left two thirds and the top: bottom-right is clear.
    const p = placeColorbar(
      base({
        width: 600,
        height: 400,
        imageRect: { left: 0, top: 0, right: 600, bottom: 400 },
        dataRect: { left: 0, top: 0, right: 420, bottom: 400 },
      }),
    )!;
    expect(p.slot).toBe('corner-br');
    expect(p.scrim).toBe(true);
    // Data on the right instead: a left corner.
    const q = placeColorbar(
      base({
        width: 600,
        height: 400,
        imageRect: { left: 0, top: 0, right: 600, bottom: 400 },
        dataRect: { left: 180, top: 0, right: 600, bottom: 400 },
      }),
    )!;
    expect(q.slot.endsWith('l')).toBe(true);
  });

  it('never under the crosshair: another corner when it enters the block', () => {
    const input = base({ width: 600, height: 400, imageRect: { left: 0, top: 0, right: 600, bottom: 400 } });
    const first = placeColorbar(input)!;
    expect(first.slot).toBe('corner-br');
    const crosshair = { x: first.left + 30, y: first.top + 20 };
    const moved = placeColorbar({ ...input, avoidPoint: crosshair })!;
    expect(moved.slot).not.toBe('corner-br');
    expect(inside(moved, crosshair.x, crosshair.y)).toBe(false);
    // A margin the crosshair is in is skipped too.
    const margin = placeColorbar(
      base({ imageRect: { left: 250, top: 0, right: 650, bottom: 400 }, avoidPoint: { x: 690, y: 200 } }),
    )!;
    expect(margin.slot).toBe('left');
  });

  it('mirrored (radiological): follows the data where the mirrored placement draws it', () => {
    const imageRect = { left: 0, top: 0, right: 600, bottom: 400 };
    // A right-hemisphere blob: neurological on the screen's right, mirrored on its left.
    const neuro = placeColorbar(base({ width: 600, height: 400, imageRect, dataRect: { left: 330, top: 0, right: 600, bottom: 400 } }))!;
    const radio = placeColorbar(base({ width: 600, height: 400, imageRect, dataRect: { left: 0, top: 0, right: 270, bottom: 400 } }))!;
    expect(neuro.slot.endsWith('l')).toBe(true);
    expect(radio.slot.endsWith('r')).toBe(true);
  });

  it('narrow or short pane: null when even the bar does not fit (the caller goes compact)', () => {
    expect(placeColorbar(base({ width: 120, height: 90, imageRect: { left: 0, top: 0, right: 120, bottom: 90 } }))).toBeNull();
    const compact = placeColorbar(
      base({ width: 120, height: 200, chromeH: 8, minBarH: 24, boxWidth: () => 40, imageRect: { left: 0, top: 0, right: 120, bottom: 200 } }),
    );
    expect(compact).not.toBeNull();
    expect(compact!.barH).toBeGreaterThanOrEqual(24);
  });

  it('top corners stay below the header and layout button', () => {
    const p = placeColorbar(
      base({
        width: 600,
        height: 400,
        imageRect: { left: 0, top: 0, right: 600, bottom: 400 },
        dataRect: { left: 0, top: 200, right: 600, bottom: 400 },
        topReserve: 48,
      }),
    )!;
    expect(p.slot.startsWith('corner-t')).toBe(true);
    expect(p.top).toBeGreaterThanOrEqual(48);
  });

  it('corner blocks keep clear of the side orientation letters at mid-height (review L4b)', () => {
    const input = base({ width: 600, height: 400, imageRect: { left: 0, top: 0, right: 600, bottom: 400 } });
    const band = [400 / 2 - SIDE_LETTER_BAND, 400 / 2 + SIDE_LETTER_BAND];
    const bottom = placeColorbar(input)!;
    expect(bottom.slot).toBe('corner-br');
    expect(bottom.top).toBeGreaterThanOrEqual(band[1]);
    const top = placeColorbar({ ...input, avoidPoint: { x: bottom.left + 10, y: bottom.top + 10 } })!;
    expect(top.top + top.barH + 40).toBeLessThanOrEqual(band[0]);
  });

  it('a side block stays below the top reserve (review L4c)', () => {
    // A short image high in the pane: centring would put the block at the top.
    const p = placeColorbar(
      base({ height: 400, topReserve: 48, imageRect: { left: 250, top: 0, right: 650, bottom: 160 }, minBarH: 48 }),
    )!;
    expect(p.slot).toBe('right');
    expect(p.top).toBeGreaterThanOrEqual(48);
  });
});
