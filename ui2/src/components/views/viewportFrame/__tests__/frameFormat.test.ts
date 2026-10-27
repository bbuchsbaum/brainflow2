import { describe, expect, it } from 'vitest';
import {
  colorbarTicks,
  colormapVerticalGradient,
  formatMm,
  formatSlicePosition,
  formatSlicePositionCompact,
  asciiMinus,
  headerDensity,
  headerMaxWidth,
  headerParts,
  middleTruncate,
  reservedPositionChars,
  shortLayerLabel,
  hiddenBand,
  isThresholdActive,
  thresholdExpression,
  thresholdWording,
} from '../frameFormat';
import { colormaps } from '@/components/ui/colormapOptions';
import { formatWorldMmAscii } from '@/utils/valueFormat';
import { chooseColorbarHost } from '../viewportFrameStore';

// Header copy changed in p2 v2 (critic finding: the compact form rounded to
// whole mm and disagreed with the status bar): two forms only, "=" dropped,
// U+2212 minus, compact keeps 0.1 mm, density chosen by width.
const M = '−';

describe('header text', () => {
  it('names the world axis of each plane with signed mm at 0.1 mm and a true minus', () => {
    expect(formatSlicePosition('axial', 17.5)).toBe('z 17.5 mm');
    expect(formatSlicePosition('sagittal', -0.5)).toBe(`x ${M}0.5 mm`);
    expect(formatSlicePosition('coronal', -18.5)).toBe(`y ${M}18.5 mm`);
    expect(formatSlicePosition('axial', 52)).toBe('z 52.0 mm');
  });

  it('never shows a negative zero', () => {
    expect(formatMm(-0)).toBe('0.0');
    expect(formatMm(-0.04)).toBe('0.0');
    expect(formatSlicePositionCompact('axial', -0.04)).toBe('z 0.0');
  });

  it('keeps 0.1 mm in the compact form and parses back to the status-bar value', () => {
    for (const mm of [-0.5, -18.5, 17.5, 52.4, -126.5, 0]) {
      for (const plane of ['axial', 'sagittal', 'coronal'] as const) {
        const compact = formatSlicePositionCompact(plane, mm);
        const full = formatSlicePosition(plane, mm);
        const number = (s: string) => asciiMinus(s).split(' ')[1];
        expect(number(compact)).toBe(formatWorldMmAscii(mm));
        expect(number(full)).toBe(formatWorldMmAscii(mm));
      }
    }
    expect(formatSlicePositionCompact('sagittal', -0.5)).toBe(`x ${M}0.5`);
    expect(formatSlicePositionCompact('coronal', -18.5)).toBe(`y ${M}18.5`);
  });

  it('chooses density by width; height only hides', () => {
    expect(headerDensity(915, 140)).toBe('full'); // Studio's wide, short lens pane
    expect(headerDensity(915, 100)).toBe('full');
    expect(headerDensity(320, 400)).toBe('full');
    expect(headerDensity(157, 400)).toBe('compact');
    expect(headerDensity(136, 111)).toBe('compact');
    expect(headerDensity(400, 89)).toBe('hidden');
    expect(headerDensity(89, 400)).toBe('hidden');
    expect(headerDensity(NaN, 400)).toBe('hidden');
  });
});

describe('header fit', () => {
  it('keeps everything in a wide view', () => {
    expect(headerParts('axial', 17.5, 'Motor zstat1', 460)).toEqual({
      plane: 'Axial',
      position: 'z 17.5 mm',
      name: 'Motor zstat1',
      fullName: 'Motor zstat1',
      density: 'full',
    });
  });

  it('has exactly two forms: full, then compact; never truncates the position', () => {
    const full = headerParts('sagittal', -0.5, 'MNI152', 140)!;
    expect(full.plane).toBe('Sagittal');
    expect(full.position).toBe(`x ${M}0.5 mm`);
    expect(full.name).toBeNull();
    // Width pressure drops the name, then the plane word, then the axis
    // letter; never the unit (user critique v2: "x −0.5" with no mm).
    expect(headerParts('sagittal', -0.5, 'MNI152', headerMaxWidth(200))).toMatchObject({
      plane: null,
      position: `x ${M}0.5 mm`,
      name: null,
      density: 'compact',
    });
    // 157 / 136 px panes → 64 / 54 px budgets: the axis letter goes, "mm" stays.
    expect(headerParts('sagittal', -0.5, 'MNI152', headerMaxWidth(157))).toMatchObject({
      plane: null,
      position: `${M}0.5mm`,
      name: null,
      density: 'compact',
    });
    const xRange = [-95.5, 94.5] as const;
    const zRange = [-77.5, 102.5] as const;
    expect(headerParts('axial', 17.5, null, headerMaxWidth(136), { rangeMm: zRange })?.position).toBe('17.5mm');
    expect(headerParts('sagittal', -0.5, null, headerMaxWidth(136), { rangeMm: xRange })?.position).toBe(`${M}0.5mm`);
    for (const w of [122, 137, 157, 200, 240, 473]) {
      const p = headerParts('coronal', -131.5, 'MNI152_T1_2mm_brain.nii.gz', headerMaxWidth(w), { rangeMm: [-131.5, 94.5] });
      if (p) expect(p.position, String(w)).toMatch(/mm$/);
    }
    expect(headerParts('coronal', -18.5, null, 30)).toBeNull();
  });

  // v2 critic: the header appeared / disappeared with the coordinate's digit
  // count in 120–140 px panes. Layout now follows the axis's widest value.
  it('decides presence, form and name budget from the reserved width, not the current digits', () => {
    expect(reservedPositionChars(-0.5, [-95.5, 94.5])).toBe(5);
    expect(reservedPositionChars(-0.5, [-131.5, 94.5])).toBe(6);
    expect(reservedPositionChars(-0.5, null)).toBe(6); // "−000.0"
    expect(reservedPositionChars(-140.2, [-131.5, 94.5])).toBe(6);
    const scrub = (plane: 'sagittal' | 'coronal', range: readonly [number, number], width: number) => {
      const seen = new Set<string>();
      for (let mm = range[0]; mm <= range[1]; mm += 0.5) {
        const p = headerParts(plane, mm, 'MNI152_T1_2mm_brain.nii.gz', headerMaxWidth(width), { rangeMm: range });
        seen.add(p ? `${p.density}|${p.name}` : 'hidden');
      }
      return seen;
    };
    for (const width of [122, 137, 157, 240, 473]) {
      expect(scrub('sagittal', [-95.5, 94.5], width).size).toBe(1);
      expect(scrub('coronal', [-131.5, 94.5], width).size).toBe(1);
    }
    // 137 px sagittal pane: visible for every x in the volume (critic acceptance).
    expect(scrub('sagittal', [-95.5, 94.5], 137).has('hidden')).toBe(false);
    expect(scrub('coronal', [-131.5, 94.5], 137).has('hidden')).toBe(false);
  });

  it('applies hysteresis before switching back to the roomier form', () => {
    const range = [-95.5, 94.5] as const;
    // Find the exact full-form boundary, then check the 4 px dead band.
    let edge = 60;
    while (headerParts('sagittal', 1, null, edge, { rangeMm: range })?.density !== 'full') edge += 1;
    expect(headerParts('sagittal', 1, null, edge, { rangeMm: range, previous: 'compact' })?.density).toBe('compact');
    expect(headerParts('sagittal', 1, null, edge + 4, { rangeMm: range, previous: 'compact' })?.density).toBe('full');
  });

  it('keeps a required name (Compare panel identity) without the plane word', () => {
    const p = headerParts('sagittal', -37.5, 'MNI152_T1_2mm_brain.nii.gz', headerMaxWidth(473), {
      rangeMm: [-95.5, 94.5],
      showPlane: false,
      requireName: true,
    })!;
    expect(p.plane).toBeNull();
    expect(p.name).toBe('MNI152_T1_2mm_brain');
    // Too narrow for the full form with a name: compact position + short name.
    const narrow = headerParts('sagittal', -37.5, 'MNI152_T1_2mm_brain.nii.gz', 110, {
      rangeMm: [-95.5, 94.5],
      showPlane: false,
      requireName: true,
    })!;
    expect(narrow.density).toBe('compact');
    expect(narrow.name).toMatch(/^MNI.*….*ain$/);
  });

  it('middle-truncates the layer name, keeping its distinctive end', () => {
    expect(middleTruncate('MNI152_T1_2mm_brain.nii.gz', 19)).toBe('MNI152…brain.nii.gz');
    const t = middleTruncate('MNI152_T1_2mm_brain.nii.gz', 20)!;
    expect(t.startsWith('MNI152')).toBe(true);
    expect(t.endsWith('brain.nii.gz')).toBe(true);
    expect(Array.from(t).length).toBe(20);
    expect(middleTruncate('short.nii', 20)).toBe('short.nii');
    expect(middleTruncate('MNI152_T1_2mm_brain.nii.gz', 14)).toBeNull();
    // Header names drop the image extension before truncating.
    expect(shortLayerLabel('MNI152_T1_2mm_brain.nii.gz')).toBe('MNI152_T1_2mm_brain');
    expect(shortLayerLabel('lh.inflated.gii')).toBe('lh.inflated');
    const parts = headerParts('axial', 17.5, 'MNI152_T1_2mm_brain.nii.gz', 260)!;
    expect(parts.name).toBe('MNI152_T1_2mm_brain');
    const tight = headerParts('axial', 17.5, 'MNI152_T1_2mm_brain.nii.gz', 225)!;
    expect(tight.name).toMatch(/^MNI152.*….*brain$/);
    expect(parts.fullName).toBe('MNI152_T1_2mm_brain.nii.gz');
  });
});

describe('threshold wording', () => {
  it('treats the backend no-threshold sentinels as inactive', () => {
    expect(isThresholdActive([0, 0])).toBe(false);
    expect(isThresholdActive([0, 100])).toBe(false);
    expect(isThresholdActive([2, 2])).toBe(false);
    expect(isThresholdActive([3, 1])).toBe(false);
    expect(thresholdWording([0, 0])).toBeNull();
  });

  it('reads a symmetric range as an inclusive magnitude cut', () => {
    expect(thresholdWording([-2.3, 2.3], 'z')).toBe('|z| ≤ 2.3 hidden');
    expect(thresholdExpression([-3.1, 3.1])).toBe('|value| ≤ 3.1');
  });

  it('reads an asymmetric range as an explicit interval', () => {
    expect(thresholdWording([-1, 2.3], 'v')).toBe(`${M}1 ≤ v ≤ 2.3 hidden`);
    expect(thresholdWording([0, 0.5], 'v')).toBe('0 ≤ v ≤ 0.5 hidden');
  });

  it('never guesses a z/t symbol from the layer name', () => {
    expect(thresholdWording([-2.3, 2.3])).toBe('|value| ≤ 2.3 hidden');
  });
});

describe('colorbar ticks', () => {
  it('marks window ends, threshold edges and zero, top to bottom', () => {
    const ticks = colorbarTicks([-6, 6], [-2.3, 2.3], 160);
    expect(ticks.map((t) => [t.label, t.kind])).toEqual([
      ['6', 'window'],
      ['2.3', 'threshold'],
      ['0', 'zero'],
      [`${M}2.3`, 'threshold'],
      [`${M}6`, 'window'],
    ]);
    expect(ticks[0].fraction).toBe(1);
    expect(ticks[4].fraction).toBe(0);
    expect(ticks[2].fraction).toBeCloseTo(0.5);
  });

  it('drops lower-priority ticks that would collide', () => {
    // 0 and ±0.2 are 2.7px apart on a 80px bar: only one survives (threshold first).
    const ticks = colorbarTicks([-6, 6], [-0.2, 0.2], 80);
    expect(ticks.map((t) => t.label)).toEqual(['6', '0.2', `${M}6`]);
  });

  it('has no zero tick for an unsigned window and no threshold ticks when inactive', () => {
    expect(colorbarTicks([0, 600], [0, 0], 120).map((t) => t.label)).toEqual(['600', '0']);
  });

  it('marks a clipped window end with ≥ / ≤', () => {
    const ticks = colorbarTicks([-6, 6], [-2.3, 2.3], 160, 12, { min: -4.58, max: 6.15 });
    expect(ticks[0].label).toBe('≥ 6');
    expect(ticks[ticks.length - 1].label).toBe(`${M}6`);
    const both = colorbarTicks([0, 5], null, 160, 12, { min: -1, max: 9 });
    expect(both.map((t) => t.label)).toEqual(['≥ 5', '≤ 0']);
  });

  it('ignores threshold edges outside the window', () => {
    expect(colorbarTicks([0, 5], [-10, 1], 120).map((t) => t.label)).toEqual(['5', '1', '0']);
  });

  it('computes the hidden band clipped to the window', () => {
    expect(hiddenBand([-6, 6], [-2.3, 2.3])).toEqual([(6 - 2.3) / 12, (6 + 2.3) / 12]);
    expect(hiddenBand([0, 5], [-10, 1])).toEqual([0, 0.2]);
    expect(hiddenBand([0, 5], [0, 0])).toBeNull();
    expect(hiddenBand([0, 5], [6, 9])).toBeNull();
  });
});

describe('colormap source', () => {
  it('uses the Inspector strip gradient turned upright', () => {
    const fmri = colormaps.find((c) => c.name === 'fmri')!;
    const g = colormapVerticalGradient('fmri')!;
    expect(g.label).toBe(fmri.label);
    expect(g.gradient).toBe(fmri.gradient.replace('to right', 'to top'));
    expect(colormapVerticalGradient('custom-atlas-palette')).toBeNull();
  });
});

describe('colorbar host', () => {
  it('prefers the largest view that has room beside the image', () => {
    expect(
      chooseColorbarHost({
        axial: { area: 948 * 311, room: 300 },
        sagittal: { area: 469 * 311, room: 20 },
        coronal: { area: 469 * 311, room: 40 },
      }),
    ).toBe('axial');
    expect(
      chooseColorbarHost({
        axial: { area: 948 * 311, room: 10 },
        sagittal: { area: 469 * 311, room: 200 },
        coronal: { area: 469 * 311, room: 40 },
      }),
    ).toBe('sagittal');
  });

  it('falls back to the largest view, axial on ties', () => {
    expect(
      chooseColorbarHost({ axial: { area: 100, room: 0 }, coronal: { area: 100, room: 0 } }),
    ).toBe('axial');
    expect(chooseColorbarHost({})).toBeNull();
  });
});
