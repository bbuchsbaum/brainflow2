/**
 * Geometry tests for the cross-set trace visual mode: the categorical (member)
 * x-axis, the CI/error band ribbon, and the carpet/grayplot heatmap mark. These
 * pin the SVG the marks actually emit — coordinates come from the width/height
 * props and the scales, not from layout, so they are deterministic in jsdom.
 */

import { describe, expect, it } from 'vitest';
import { render, within } from '@testing-library/react';

import { PlotEncoder } from '../encoder/PlotEncoder';
import { column, resolveSpec } from '@/plotting';
import type { PlotSpec, SampleFrame } from '@/plotting';

const W = 400;
const H = 300;

/** A cross-set trace frame: members on x, a value + CI band per member. */
function traceFrame(
  rows: { member: string; value: number | null; lower: number | null; upper: number | null }[],
): SampleFrame {
  return {
    columns: [
      column('member', 'nominal'),
      column('value', 'quantitative'),
      column('lower', 'quantitative'),
      column('upper', 'quantitative'),
    ],
    rows,
    meta: {
      suggested: {
        mark: 'line',
        encoding: { x: 'member', y: 'value' },
        band: { lower: 'lower', upper: 'upper' },
      },
    },
  };
}

const SAMPLE = traceFrame([
  { member: 'sub01', value: 2, lower: 1.5, upper: 2.5 },
  { member: 'sub02', value: 4, lower: 3.4, upper: 4.6 },
  { member: 'sub03', value: 3, lower: 2.6, upper: 3.4 },
]);

function renderMark(frame: SampleFrame, override?: Partial<PlotSpec>) {
  const spec = resolveSpec(frame, override);
  return render(<PlotEncoder frame={frame} spec={spec} width={W} height={H} />);
}

/** Numeric values of every AxisLeft tick label in the container. */
function leftAxisTickValues(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll('svg text'))
    .map((t) => Number(t.textContent))
    .filter((n) => Number.isFinite(n));
}

describe('cross-set trace marks', () => {
  it('renders a line over a categorical member axis with member ticks', () => {
    const { getByTestId } = renderMark(SAMPLE);
    const svg = getByTestId('plot-mark-line');
    // scalePoint over members => each member id appears as an x-axis tick.
    const text = svg.textContent ?? '';
    expect(text).toContain('sub01');
    expect(text).toContain('sub02');
    expect(text).toContain('sub03');
    // The line itself renders (a path with a real 'd').
    const paths = Array.from(svg.querySelectorAll('path')).filter(
      (p) => (p.getAttribute('d') ?? '').length > 0,
    );
    expect(paths.length).toBeGreaterThan(0);
  });

  it('draws a CI band ribbon when the spec resolves a band', () => {
    const { getByTestId } = renderMark(SAMPLE);
    const band = getByTestId('plot-band');
    const ribbon = band.querySelector('path');
    expect(ribbon).not.toBeNull();
    expect((ribbon?.getAttribute('d') ?? '').length).toBeGreaterThan(0);
  });

  it('omits the band ribbon when no band is present', () => {
    const plain: SampleFrame = {
      columns: [column('member', 'nominal'), column('value', 'quantitative')],
      rows: [
        { member: 'sub01', value: 2 },
        { member: 'sub02', value: 4 },
      ],
      meta: { suggested: { mark: 'line', encoding: { x: 'member', y: 'value' } } },
    };
    const { queryByTestId } = renderMark(plain);
    expect(queryByTestId('plot-band')).toBeNull();
  });

  it('widens the y-domain to include the band bounds (not just the line)', () => {
    // An upper bound far above the values must pull the y-axis up to ~100,
    // proving the band participates in the domain rather than being clipped.
    const wide = traceFrame([
      { member: 'sub01', value: 2, lower: 1, upper: 100 },
      { member: 'sub02', value: 4, lower: 3, upper: 90 },
    ]);
    const { container } = renderMark(wide);
    const maxTick = Math.max(...leftAxisTickValues(container));
    expect(maxTick).toBeGreaterThanOrEqual(50);
  });

  it('drops the band ribbon when its columns are missing from the frame', () => {
    // Suggested band names columns the frame doesn't carry -> resolveSpec must
    // not resolve a band, so no ribbon is drawn.
    const frame: SampleFrame = {
      columns: [column('member', 'nominal'), column('value', 'quantitative')],
      rows: [
        { member: 'a', value: 1 },
        { member: 'b', value: 2 },
      ],
      meta: {
        suggested: {
          mark: 'line',
          encoding: { x: 'member', y: 'value' },
          band: { lower: 'lower', upper: 'upper' },
        },
      },
    };
    const { queryByTestId } = renderMark(frame);
    expect(queryByTestId('plot-band')).toBeNull();
  });
});

describe('heatmap (carpet/grayplot) mark', () => {
  it('shades one cell per member by value, dark(low) -> light(high)', () => {
    const { getByTestId } = renderMark(SAMPLE, { mark: 'heatmap' });
    const svg = getByTestId('plot-mark-heatmap');
    const cells = Array.from(
      svg.querySelectorAll('[data-testid="plot-heatmap-cell"]'),
    ) as SVGElement[];
    expect(cells).toHaveLength(3);

    const byMember = new Map(cells.map((c) => [c.getAttribute('data-cat'), c]));
    // value range is [2,4]; min(2)->grayRamp(0)=rgb(30,30,30), max(4)->rgb(220,220,220).
    expect(byMember.get('sub01')?.getAttribute('fill')).toBe('rgb(30, 30, 30)');
    expect(byMember.get('sub02')?.getAttribute('fill')).toBe('rgb(220, 220, 220)');

    // Cells are laid out left-to-right in member order.
    const xs = ['sub01', 'sub02', 'sub03'].map((m) => Number(byMember.get(m)?.getAttribute('x')));
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
  });

  it('renders a hollow outline for a member with no value', () => {
    const withGap = traceFrame([
      { member: 'sub01', value: 2, lower: 1.5, upper: 2.5 },
      { member: 'sub02', value: null, lower: null, upper: null },
      { member: 'sub03', value: 3, lower: 2.6, upper: 3.4 },
    ]);
    const { getByTestId } = renderMark(withGap, { mark: 'heatmap' });
    const svg = getByTestId('plot-mark-heatmap');
    const gap = within(svg)
      .getAllByTestId('plot-heatmap-cell')
      .find((c) => c.getAttribute('data-cat') === 'sub02');
    expect(gap?.getAttribute('fill')).toBe('none');
    expect(gap?.getAttribute('stroke')).toBeTruthy();
  });
});
