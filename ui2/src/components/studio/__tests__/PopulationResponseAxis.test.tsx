import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PlotEncoder } from '@/components/plots/encoder/PlotEncoder';
import { yTickLabelRoom } from '@/components/plots/encoder/cartesianMarks';
import { column } from '@/plotting';
import type { ResolvedPlotSpec, SampleFrame } from '@/plotting';

// The Values tab's response strip: members on x, small signed responses on y.
const spec: ResolvedPlotSpec = {
  mark: 'point',
  encoding: { x: 'member', y: 'value' },
  transforms: [],
  params: {},
};
const frame: SampleFrame = {
  columns: [column('member', 'nominal'), column('value', 'quantitative')],
  rows: [
    { member: 'a', value: -0.011 },
    { member: 'b', value: -0.004 },
    { member: 'c', value: 0.002 },
    { member: 'd', value: 0.006 },
  ],
};

describe('Values response strip y axis', () => {
  it('reserves room for the widest signed tick label, so "−0.010" is never clipped', () => {
    render(<PlotEncoder frame={frame} spec={spec} width={480} height={72} />);
    const svg = screen.getByTestId('plot-mark-point');
    const labels = [...svg.querySelectorAll('text')].map((t) => t.textContent ?? '');
    // The axis keeps the sign and the leading digit.
    expect(labels).toContain('−0.010');
    expect(labels).toContain('0.005');
    const longest = Math.max(...labels.filter((l) => /\d/.test(l)).map((l) => l.length));
    const group = svg.querySelector('g[transform^="translate("]');
    const left = Number(/translate\(([-\d.]+)/.exec(group?.getAttribute('transform') ?? '')?.[1]);
    // 6px per 10px mono numeral, plus the 8px tick and the label offset.
    expect(left).toBeGreaterThanOrEqual(longest * 6 + 8 + 2.5);
  });

  it('keeps the default margin for short labels', () => {
    expect(yTickLabelRoom([0, 10])).toBeLessThanOrEqual(36);
    expect(yTickLabelRoom([-0.0115, 0.0065])).toBeGreaterThan(36);
    expect(yTickLabelRoom([Number.NaN, 1])).toBe(0);
  });
});
