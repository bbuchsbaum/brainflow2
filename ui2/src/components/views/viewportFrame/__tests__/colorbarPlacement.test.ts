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

  it('a centred image goes right, whatever a pixel of rounding says', () => {
    // A centred image whose data rectangle is a pixel off the image's: the
    // left margin is a pixel wider. On load these rectangles settle over a
    // few frames, so the side must not hang on that pixel (the bar showed
    // on the left, then moved right).
    for (const dataLeft of [250, 251, 252, 253]) {
      for (const dataRight of [650, 649, 648]) {
        const p = placeColorbar(
          base({
            imageRect: { left: 250, top: 0, right: 650, bottom: 400 },
            dataRect: { left: dataLeft, top: 0, right: dataRight, bottom: 400 },
          }),
        )!;
        expect(p.slot).toBe('right');
      }
    }
  });

  it('a clearly wider left margin still takes the bar', () => {
    // About 12% more room on the left: beyond MARGIN_TIE.
    const p = placeColorbar(base({ imageRect: { left: 263, top: 0, right: 663, bottom: 400 } }))!;
    expect(p.slot).toBe('left');
  });

  it('a bar already on the left stays there when the margins tie', () => {
    // The tie prefers right only for a first placement; once placed, the
    // previous slot holds (hysteresis), so a tie never moves the bar.
    for (const dataRight of [650, 649, 648]) {
      const p = placeColorbar(
        base({
          imageRect: { left: 250, top: 0, right: 650, bottom: 400 },
          dataRect: { left: 250, top: 0, right: dataRight, bottom: 400 },
          previousSlot: 'left',
        }),
      )!;
      expect(p.slot).toBe('left');
    }
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

  it.each([100, 110])(
    'never vanishes in a %i px tall pane: a short compact bar in a corner',
    (h) => {
      const pane: ColorbarPaneInput = {
        width: 200,
        height: h,
        imageRect: { left: 20, top: 0, right: 180, bottom: h },
      };
      const p = placeColorbarBlock(pane, FORMS)!;
      expect(p).not.toBeNull();
      expect(p.compact).toBe(true);
      expect(p.fit).toBe(ColorbarFit.Corner);
      expect(p.barH).toBeGreaterThanOrEqual(16);
      expect(p.top + tinyCompact(p.barH)).toBeLessThanOrEqual(h);
      // The letters, header and badge stay clear even across the band.
      expectClear(p, pane, COMPACT);
    },
  );
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
    const settled = placeColorbar(
      base({ imageRect: { left: 250, top: 0, right: 650, bottom: 400 } }),
    )!;
    expect(settled.slot).toBe('right');
    // Mid-drag the image reads off-centre to the right: the rule would pick the left margin...
    const midDrag = base({
      height: 300,
      imageRect: { left: 420, top: 0, right: 820, bottom: 300 },
    });
    expect(placeColorbar(midDrag)!.slot).toBe('left');
    // ...the held bar stays right of the image, clamped into the pane.
    const held = holdColorbarSlot(midDrag, settled);
    expect(held.slot).toBe('right');
    expect(held.left).toBe(900 - 8 - 60);
    expect(held.top).toBeGreaterThanOrEqual(8);
    expect(held.top + held.barH + 40).toBeLessThanOrEqual(300 - 8);
  });

  it('keeps a bar the rule nudged off the image middle exactly in place while held', () => {
    // A narrow right margin: the block reaches the "R" letter band at the
    // pane's middle, so the rule pushes it off centre; holding (any view
    // zooming) must not snap it back to centre.
    const input = base({
      width: 740,
      imageRect: { left: 80, top: 0, right: 650, bottom: 400 },
      sideLetterY: 200,
    });
    const settled = placeColorbar(input)!;
    expect(settled.slot).toBe('right');
    const plain = holdColorbarSlot(input, settled);
    const offset = { dx: settled.left - plain.left, dy: settled.top - plain.top };
    expect(offset.dy).not.toBe(0);
    const held = holdColorbarSlot(input, { ...settled, offset });
    expect([held.left, held.top, held.barH]).toEqual([settled.left, settled.top, settled.barH]);
  });

  it('shortens the bar to the pane when it gets shorter', () => {
    const held = holdColorbarSlot(
      base({ height: 150, imageRect: { left: 250, top: 0, right: 650, bottom: 150 } }),
      {
        slot: 'right',
        barH: 160,
      },
    );
    expect(held.barH).toBe(150 - 16 - 40);
    expect(held.left).toBe(662);
  });
});

describe('placeColorbarBlock: a small pane that keeps the full block off the image', () => {
  // A Studio Compare pane in a narrow centre column: about 250 x 320 px,
  // the brain filling it.
  const pane: ColorbarPaneInput = {
    width: 250,
    height: 320,
    imageRect: { left: 0, top: 0, right: 250, bottom: 320 },
    sideLetterY: 160,
  };

  it('by the usual rule the full block lands on the image, on a scrim', () => {
    const p = placeColorbarBlock(pane, FORMS)!;
    expect(p.compact).toBe(false);
    expect(p.scrim).toBe(true);
  });

  it('with `compactOnImageBelow` it is the compact bar, clear of every orientation letter', () => {
    const input = { ...pane, compactOnImageBelow: 360 };
    const p = placeColorbarBlock(input, FORMS)!;
    expect(p.compact).toBe(true);
    expectClear(p, input, COMPACT);
    // A slim bar at the pane's edge: no caption, no name, narrower than the block.
    expect(COMPACT.boxWidth(p.barH)).toBeLessThan(FULL.boxWidth(p.barH));
    const box = boxOf(p, COMPACT);
    expect(Math.min(box.left, input.width - box.right)).toBeLessThanOrEqual(32);
  });

  it('still gives the full block a free margin that holds it', () => {
    // The same small pane with the image to the left and room beside it.
    const input: ColorbarPaneInput = {
      width: 340,
      height: 240,
      imageRect: { left: 0, top: 0, right: 240, bottom: 240 },
      compactOnImageBelow: 360,
    };
    const p = placeColorbarBlock(input, FORMS)!;
    expect(p.compact).toBe(false);
    expect(p.fit).toBe(ColorbarFit.FullMargin);
    expect(p.scrim).toBe(false);
    expect(overlaps(boxOf(p), input.imageRect!)).toBe(false);
  });

  it('leaves a pane at or above the size alone', () => {
    const large: ColorbarPaneInput = {
      width: 600,
      height: 400,
      imageRect: { left: 0, top: 0, right: 600, bottom: 400 },
      compactOnImageBelow: 360,
    };
    expect(placeColorbarBlock(large, FORMS)!.compact).toBe(false);
  });
});

describe('an off-image legend: the Studio Deck and Compare pane A', () => {
  // The Deck's centre column: a 91 x 109 voxel coronal-sized image fit to a
  // 530 x 560 px canvas (5.14 px per voxel), centred. It leaves a margin of
  // about 31 px on the left and on the right, and none above or below.
  const deck = (width: number, height = 560): ColorbarPaneInput => {
    const scale = Math.min(width / 91, height / 109);
    const w = 91 * scale;
    const h = 109 * scale;
    return {
      width,
      height,
      imageRect: {
        left: (width - w) / 2,
        top: (height - h) / 2,
        right: (width + w) / 2,
        bottom: (height + h) / 2,
      },
      avoidPoint: { x: width / 2, y: height / 2 },
      offImage: true,
    };
  };
  const formOf = (p: { compact: boolean }) => (p.compact ? COMPACT : FULL);

  it('by the usual rule this pane puts the block on the image, on a scrim', () => {
    const p = placeColorbarBlock({ ...deck(530), offImage: false }, FORMS)!;
    expect(p.slot).toMatch(/^corner-/);
    expect(p.scrim).toBe(true);
    expect(overlaps(boxOf(p, formOf(p)), deck(530).imageRect!)).toBe(true);
  });

  it('with margins too slim for either block it goes below the canvas, not onto the image', () => {
    const pane = deck(530);
    expect(pane.imageRect!.left).toBeCloseTo(31.3, 0);
    const p = placeColorbarBlock(pane, FORMS)!;
    expect(p.slot).toBe('below');
    expect(p.fit).toBe(ColorbarFit.Below);
    expect(p.fit).not.toBe(ColorbarFit.None);
    expect(p.scrim).toBe(false);
    // Nothing of it is inside the canvas area.
    expect(p.top).toBe(pane.height);
    expect(p.barH).toBe(0);
  });

  it('takes the free margin beside the image as soon as one holds the compact bar, then the full block', () => {
    // 40 px of compact block + 12 px gap + 8 px edge = 60 px of margin.
    const compact = placeColorbarBlock(deck(590), FORMS)!;
    expect(compact.slot).toBe('right');
    expect(compact.compact).toBe(true);
    expect(compact.fit).toBe(ColorbarFit.CompactMargin);
    expect(compact.scrim).toBe(false);
    expect(overlaps(boxOf(compact, COMPACT), deck(590).imageRect!)).toBe(false);
    expectClear(compact, deck(590), COMPACT);

    const full = placeColorbarBlock(deck(640), FORMS)!;
    expect(full.slot).toBe('right');
    expect(full.compact).toBe(false);
    expect(full.fit).toBe(ColorbarFit.FullMargin);
    expect(overlaps(boxOf(full), deck(640).imageRect!)).toBe(false);
    expectClear(full, deck(640));
  });

  it('a margin above or below a wide image counts too', () => {
    // Compare pane A, wider than tall for this image: letterboxed left/right
    // by 90 px, enough for the full block.
    const pane = deck(480, 360);
    const p = placeColorbarBlock(pane, FORMS)!;
    expect(p.slot).not.toBe('below');
    expect(overlaps(boxOf(p, formOf(p)), pane.imageRect!)).toBe(false);
  });

  it('never covers an image pixel, whatever the pane size', () => {
    for (let width = 120; width <= 900; width += 13) {
      for (const height of [140, 240, 360, 560, 700]) {
        const pane = deck(width, height);
        const p = placeColorbarBlock(pane, FORMS);
        expect(p).not.toBeNull();
        if (p!.slot === 'below') continue;
        expect(p!.slot).not.toMatch(/^corner-/);
        expect(p!.scrim).toBe(false);
        expect(overlaps(boxOf(p!, formOf(p!)), pane.imageRect!)).toBe(false);
      }
    }
  });

  it('a zoomed image that fills the pane leaves the strip below, and holding keeps it there', () => {
    const pane: ColorbarPaneInput = {
      width: 530,
      height: 560,
      imageRect: { left: -200, top: -200, right: 730, bottom: 760 },
      offImage: true,
    };
    expect(placeColorbarBlock(pane, FORMS)!.slot).toBe('below');
    const held = holdColorbarSlot({ ...pane, ...COMPACT }, { slot: 'below', barH: 0 });
    expect(held).toMatchObject({ slot: 'below', scrim: false, top: 560 });
  });

  it('other views are unchanged: without `offImage` there is no `below` slot', () => {
    for (let width = 120; width <= 900; width += 13) {
      const pane = { ...deck(width), offImage: false };
      expect(placeColorbarBlock(pane, FORMS)?.slot).not.toBe('below');
    }
  });
});
