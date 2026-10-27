import { describe, expect, it } from 'vitest';
import { column } from '@/plotting';
import type { SampleFrame } from '@/plotting';
import { regionCountsFromFrame } from '../regionCounts';

function frame(bins: Array<[number, number, number]>): SampleFrame {
  return {
    columns: [
      column('binStart', 'quantitative'),
      column('binEnd', 'quantitative'),
      column('binCenter', 'quantitative'),
      column('count', 'quantitative'),
    ],
    rows: bins.map(([x0, x1, count]) => ({ binStart: x0, binEnd: x1, binCenter: (x0 + x1) / 2, count })),
    meta: { locus: 'wholeVolume' },
  } as SampleFrame;
}

describe('label-map region counts (P3.12)', () => {
  const legend = [
    { label_id: 1, roi: 'L_sensorimotor', color: [31, 119, 180] as [number, number, number] },
    { label_id: 3, roi: 'Medial_prefrontal', color: [214, 39, 40] as [number, number, number] },
  ];

  it('maps one-id bins to regions with their LUT colours, background excluded', () => {
    // Range 1..3 in 3 bins of width 2/3: ids 1, 2, 3.
    const out = regionCountsFromFrame(
      frame([
        [1, 1.667, 120],
        [1.667, 2.333, 40],
        [2.333, 3, 7],
      ]),
      legend,
    );
    expect(out.map((r) => [r.id, r.count])).toEqual([
      [1, 120],
      [2, 40],
      [3, 7],
    ]);
    expect(out[0].color).toEqual([31, 119, 180]);
    expect(out[1].name).toBe('label 2');
    expect(out[1].color).toBeNull();
  });

  it('skips empty bins, bins without an integer and label 0', () => {
    const out = regionCountsFromFrame(
      frame([
        [0, 0.5, 999],
        [1, 1.5, 3],
        [1.5, 1.9, 5],
        [2, 2.5, 0],
      ]),
      legend,
    );
    expect(out.map((r) => r.id)).toEqual([1]);
  });
});
