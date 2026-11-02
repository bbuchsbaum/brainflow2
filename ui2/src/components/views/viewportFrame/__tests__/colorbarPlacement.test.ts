import { describe, expect, it } from 'vitest';
import {
  ColorbarFit,
  colorbarKeepClear,
  holdColorbarSlot,
  placeColorbar,
  placeColorbarBlock,
  SIDE_LETTER_BAND,
  type ColorbarForm,
  type ColorbarPaneInput,
  type ColorbarPlacement,
  type ColorbarPlacementInput,
  type PaneRect,
} from '../colorbarPlacement';

// The full block: 60 px wide plus 40 px of captions, bars 48–160 px.
// The compact block: 40 px wide plus 8 px of padding, bars 24–160 px.
const FULL: ColorbarForm = { chromeH: 40, boxWidth: () => 60, minBarH: 48, maxBarH: 160 };
const COMPACT: ColorbarForm = { chromeH: 8, boxWidth: () => 40, minBarH: 24, maxBarH: 160 };
const FORMS = { full: FULL, compact: COMPACT };

const base = (over: Partial<ColorbarPlacementInput>): ColorbarPlacementInput => ({
  width: 900,
  height: 400,
  topReserve: 30,
  ...FULL,
  ...over,
});

const boxOf = (p: ColorbarPlacement, form: ColorbarForm = FULL): PaneRect => ({
  left: p.left,
  top: p.top,
  right: p.left + form.boxWidth(p.barH),
  bottom: p.top + p.barH + form.chromeH,
});
const overlaps = (a: PaneRect, b: PaneRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const inside = (box: PaneRect, x: number, y: number) =>
  x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;

/** The block stays inside the pane and off every letter, the header and the badge. */
function expectClear(p: ColorbarPlacement, input: ColorbarPaneInput, form: ColorbarForm = FULL) {
  const box = boxOf(p, form);
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(input.width);
  expect(box.bottom).toBeLessThanOrEqual(input.height);
  for (const r of colorbarKeepClear(input)) expect(overlaps(box, r)).toBe(false);
}

describe('placeColorbar: margins (QA 2026-10-31 N16)', () => {
  it('margin available: beside the volume in the right margin, off the data, no scrim', () => {
    const input = base({ imageRect: { left: 250, top: 0, right: 650, bottom: 400 } });
    const p = placeColorbar(input)!;
    expect(p.slot).toBe('right');
    expect(p.left).toBe(662);
    expect(p.scrim).toBe(false);
    // Vertically centred on the image.
    expect(p.top + (p.barH + 40) / 2).toBeCloseTo(200, -1);
    expectClear(p, input);
  });

  it('takes the largest margin: right, left, then above or below', () => {
    expect(
      placeColorbar(base({ imageRect: { left: 60, top: 0, right: 500, bottom: 400 } }))!.slot,
    ).toBe('right');
    const left = placeColorbar(
      base({ imageRect: { left: 400, top: 0, right: 820, bottom: 400 } }),
    )!;
    expect(left.slot).toBe('left');
    expect(left.left + 60).toBeLessThanOrEqual(400 - 12);
    // A wide, short image high in the pane: below it.
    const below = placeColorbar(
      base({ width: 400, height: 500, imageRect: { left: 0, top: 30, right: 400, bottom: 260 } }),
    )!;
    expect(below.slot).toBe('bottom');
    expect(below.top).toBeGreaterThanOrEqual(260 + 12);
    // The same image low in the pane: above it.
    const above = placeColorbar(
      base({ width: 400, height: 500, imageRect: { left: 0, top: 260, right: 400, bottom: 490 } }),
    )!;
    expect(above.slot).toBe('top');
    expect(above.top + above.barH + 40).toBeLessThanOrEqual(260 - 12);
  });

  it('measures margins from the volume, not the bitmap that fills the pane (the run-5 regression)', () => {
    // Orthogonal axial at run 5: a tall pane, the bitmap the whole pane, the
    // brain's box across its width with ~170 px free above and below.
    const pane: ColorbarPaneInput = {
      width: 554,
      height: 950,
      imageRect: { left: 0, top: 0, right: 554, bottom: 950 },
      dataRect: { left: 20, top: 175, right: 534, bottom: 775 },
      avoidPoint: { x: 275, y: 470 },
    };
    const p = placeColorbarBlock(pane, FORMS)!;
    expect(p.fit).toBe(ColorbarFit.FullMargin);
    expect(p.compact).toBe(false);
    expect(p.scrim).toBe(false);
    expect(['bottom', 'top']).toContain(p.slot);
    expect(overlaps(boxOf(p), pane.dataRect!)).toBe(false);
    // Clear of the centred "P" and the radiological badge.
    expectClear(p, pane);
  });
});

describe('placeColorbar: no margin', () => {
  // Zoomed in: the image runs past the top, bottom and left; 20 px free at the right.
  const zoomed = { left: -100, top: -50, right: 560, bottom: 450 };

  it('takes the corner whose block covers the least of the image, on a scrim', () => {
    const input = base({ width: 600, height: 400, imageRect: zoomed });
    const p = placeColorbar(input)!;
    expect(p.slot).toBe('corner-br');
    expect(p.scrim).toBe(true);
    expectClear(p, input);
    // The image running past the right instead: a left corner.
    const q = placeColorbar(
      base({ width: 600, height: 400, imageRect: { left: 40, top: -50, right: 700, bottom: 450 } }),
    )!;
    expect(q.slot.endsWith('l')).toBe(true);
  });

  it('jumps away from the crosshair when it is under the block', () => {
    const input = base({ width: 600, height: 400, imageRect: zoomed });
    const first = placeColorbar(input)!;
    const crosshair = { x: first.left + 30, y: first.top + 20 };
    const moved = placeColorbar({ ...input, avoidPoint: crosshair })!;
    expect(moved.slot).not.toBe(first.slot);
    expect(inside(boxOf(moved), crosshair.x, crosshair.y)).toBe(false);
    expectClear(moved, input);
  });

  it('corner blocks keep clear of the side orientation letters at mid-height', () => {
    const input = base({ width: 600, height: 400, imageRect: zoomed });
    const band = [200 - SIDE_LETTER_BAND, 200 + SIDE_LETTER_BAND];
    const bottom = placeColorbar(input)!;
    expect(bottom.top).toBeGreaterThanOrEqual(band[1]);
    const top = placeColorbar({
      ...input,
      avoidPoint: { x: bottom.left + 10, y: bottom.top + 10 },
    })!;
    expect(top.top + top.barH + 40).toBeLessThanOrEqual(band[0]);
    // Top corners stay below the header row and the top-right reserve.
    expect(top.top).toBeGreaterThanOrEqual(30);
  });
});

describe('placeColorbarBlock: forms', () => {
  it('a narrow pane gets the compact bar in its own margin, never nothing', () => {
    // 140 px wide, the volume across it, 150 px free above and below.
    const pane: ColorbarPaneInput = {
      width: 140,
      height: 600,
      imageRect: { left: 0, top: 150, right: 140, bottom: 450 },
    };
    const p = placeColorbarBlock(pane, FORMS)!;
    expect(p.compact).toBe(true);
    expect(p.fit).toBe(ColorbarFit.CompactMargin);
    expect(['bottom', 'top']).toContain(p.slot);
    expectClear(p, pane, COMPACT);
    // A short pane too.
    const short = placeColorbarBlock(
      { width: 600, height: 140, imageRect: { left: 220, top: 0, right: 380, bottom: 140 } },
      FORMS,
    )!;
    expect(short.compact).toBe(true);
    expect(['right', 'left']).toContain(short.slot);
  });

  it('prefers the compact bar in a margin to the full block over the image', () => {
    // 60 px margins each side: the compact bar (40) fits, the full block (90) does not.
    const wide: ColorbarForm = { ...FULL, boxWidth: () => 90 };
    const pane: ColorbarPaneInput = {
      width: 600,
      height: 400,
      imageRect: { left: 80, top: 0, right: 520, bottom: 400 },
    };
    const p = placeColorbarBlock(pane, { full: wide, compact: COMPACT })!;
    expect(p.compact).toBe(true);
    expect(p.scrim).toBe(false);
    expect(['right', 'left']).toContain(p.slot);
  });

  it('falls back to a corner, full block, when no margin holds even the compact bar', () => {
    const p = placeColorbarBlock(
      { width: 600, height: 400, imageRect: { left: -10, top: -10, right: 610, bottom: 410 } },
      FORMS,
    )!;
    expect(p.fit).toBe(ColorbarFit.Corner);
    expect(p.compact).toBe(false);
    expect(p.scrim).toBe(true);
  });
});

describe('placeColorbarBlock: very short panes (review W1)', () => {
  // A 16 px compact bar: 8 px padding.
  const tinyCompact = (barH: number) => barH + COMPACT.chromeH;

  it.each([100, 110])('never vanishes in a %i px tall pane: a short compact bar in a corner', (h) => {
    const pane: ColorbarPaneInput = { width: 200, height: h, imageRect: { left: 20, top: 0, right: 180, bottom: h } };
    const p = placeColorbarBlock(pane, FORMS)!;
    expect(p).not.toBeNull();
    expect(p.compact).toBe(true);
    expect(p.fit).toBe(ColorbarFit.Corner);
    expect(p.barH).toBeGreaterThanOrEqual(16);
    expect(p.top + tinyCompact(p.barH)).toBeLessThanOrEqual(h);
    // The letters, header and badge stay clear even across the band.
    expectClear(p, pane, COMPACT);
  });
});

describe('placeColorbarBlock: form hysteresis (review S6)', () => {
  // The volume across the pane; the margin below it holds a bar of
  // (392 - 12 - bottom) - 40 px.
  const pane = (bottom: number): ColorbarPaneInput => ({
    width: 600,
    height: 400,
    topReserve: 0,
    imageRect: { left: 0, top: 0, right: 600, bottom },
  });

  it('returns from compact to full only with room to spare', () => {
    // A 50 px bar below the image: the full block just fits.
    const justFits = placeColorbarBlock(pane(290), FORMS)!;
    expect(justFits.compact).toBe(false);
    expect(justFits.barH).toBe(50);
    // Coming from compact, the same room is not enough...
    expect(placeColorbarBlock({ ...pane(290), previousCompact: true }, FORMS)!.compact).toBe(true);
    // ...a clearly larger one is.
    expect(placeColorbarBlock({ ...pane(250), previousCompact: true }, FORMS)!.compact).toBe(false);
  });
});

describe('placeColorbar: reserved areas', () => {
  it('slides a side block off the side orientation letter', () => {
    // Right margin 60 px: the block reaches the letter column at mid-height.
    const input = base({ imageRect: { left: 40, top: 0, right: 820, bottom: 400 } });
    const p = placeColorbar(input)!;
    expect(p.slot).toBe('right');
    expectClear(p, input);
    const box = boxOf(p);
    expect(box.bottom <= 200 - SIDE_LETTER_BAND || box.top >= 200 + SIDE_LETTER_BAND).toBe(true);
  });

  it('keeps the top letter clear under a header row (topLetterInset)', () => {
    const input = base({
      width: 300,
      height: 500,
      topLetterInset: 18,
      imageRect: { left: 0, top: 240, right: 300, bottom: 492 },
    });
    const p = placeColorbar(input)!;
    expect(p.slot).toBe('top');
    expectClear(p, input);
  });

  it('honours caller-reserved rectangles', () => {
    const reserved = [{ left: 650, top: 0, right: 900, bottom: 400 }];
    const p = placeColorbar(
      base({ imageRect: { left: 250, top: 0, right: 650, bottom: 400 }, reserved }),
    )!;
    expect(p.slot).toBe('left');
  });
});

describe('placeColorbar: hysteresis', () => {
  // A wide pane, the image centred: equal margins above and below.
  const pane = (top: number, bottom: number): ColorbarPlacementInput =>
    base({
      width: 300,
      height: 600,
      topReserve: 0,
      imageRect: { left: 0, top, right: 300, bottom },
    });

  it('keeps the previous margin while no other is clearly larger', () => {
    // Below is 10% larger than above: the previous "top" stays.
    expect(placeColorbar(pane(200, 380))!.slot).toBe('bottom');
    expect(placeColorbar({ ...pane(200, 380), previousSlot: 'top' })!.slot).toBe('top');
    // Below is twice above: it takes over.
    expect(placeColorbar({ ...pane(140, 340), previousSlot: 'top' })!.slot).toBe('bottom');
  });

  it('keeps the previous corner while it is about as clear', () => {
    const input = base({
      width: 600,
      height: 400,
      imageRect: { left: -100, top: -50, right: 700, bottom: 450 },
    });
    expect(placeColorbar(input)!.slot).toBe('corner-br');
    expect(placeColorbar({ ...input, previousSlot: 'corner-tl' })!.slot).toBe('corner-tl');
  });
});

describe('holdColorbarSlot (splitter drag flicker)', () => {
  it('keeps the slot it had, following the image, while the pane is resized', () => {
    // Settled: right margin.
    const settled = placeColorbar(base({ imageRect: { left: 250, top: 0, right: 650, bottom: 400 } }))!;
    expect(settled.slot).toBe('right');
    // Mid-drag the image reads off-centre to the right: the rule would pick the left margin...
    const midDrag = base({ height: 300, imageRect: { left: 420, top: 0, right: 820, bottom: 300 } });
    expect(placeColorbar(midDrag)!.slot).toBe('left');
    // ...the held bar stays right of the image, clamped into the pane.
    const held = holdColorbarSlot(midDrag, settled);
    expect(held.slot).toBe('right');
    expect(held.left).toBe(900 - 8 - 60);
    expect(held.top).toBeGreaterThanOrEqual(8);
    expect(held.top + held.barH + 40).toBeLessThanOrEqual(300 - 8);
  });

  it('shortens the bar to the pane when it gets shorter', () => {
    const held = holdColorbarSlot(base({ height: 150, imageRect: { left: 250, top: 0, right: 650, bottom: 150 } }), {
      slot: 'right',
      barH: 160,
    });
    expect(held.barH).toBe(150 - 16 - 40);
    expect(held.left).toBe(662);
  });
});
