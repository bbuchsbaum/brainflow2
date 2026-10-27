import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PlotEncoder } from '../encoder/PlotEncoder';
import { column, type SampleFrame, type ResolvedPlotSpec } from '@/plotting';
const frame: SampleFrame = {
  columns: [
    column('x', 'nominal'),
    column('value', 'quantitative'),
    column('person', 'nominal'),
    column('site', 'nominal'),
  ],
  rows: [
    { x: 'a', value: 0, person: 'p1', site: 'one' },
    { x: 'b', value: null, person: 'p1', site: 'one' },
    { x: 'c', value: 10, person: 'p1', site: 'one' },
    { x: 'a', value: 5, person: 'p2', site: 'two' },
    { x: 'c', value: 10, person: 'p2', site: 'two' },
  ],
  meta: {},
};
const spec: ResolvedPlotSpec = {
  mark: 'line',
  encoding: { x: 'x', y: 'value', detail: 'person', color: 'person' },
  transforms: [],
  params: {},
};
describe('population plot composition geometry', () => {
  it('keeps trajectories separate and breaks a line at missing samples', () => {
    const { container } = render(
      <PlotEncoder frame={frame} spec={spec} width={600} height={300} />,
    );
    const paths = [...container.querySelectorAll('[data-testid="plot-series"]')];
    expect(paths).toHaveLength(2);
    expect(paths[0].getAttribute('d')?.match(/M/g)).toHaveLength(2);
    expect(paths[1].getAttribute('d')?.match(/M/g)).toHaveLength(1);
    expect(paths[0].getAttribute('stroke')).not.toBe(paths[1].getAttribute('stroke'));
    expect(container.innerHTML).not.toContain('NaN');
  });
  it('shares categorical positions and numerical scales across facets', () => {
    const { container } = render(
      <PlotEncoder
        frame={frame}
        spec={{ ...spec, mark: 'point', encoding: { ...spec.encoding, facet: 'site' } }}
        width={800}
        height={400}
      />,
    );
    const svgs = [...container.querySelectorAll('[data-testid="plot-mark-point"]')];
    expect(svgs).toHaveLength(2);
    for (const svg of svgs) expect(svg.textContent).toContain('b');
    const points = svgs.map((svg) => [...svg.querySelectorAll('circle')]);
    expect(points[0][0].getAttribute('cx')).toBe(points[1][0].getAttribute('cx'));
    expect(points[0][1].getAttribute('cx')).toBe(points[1][1].getAttribute('cx'));
    expect(points[0][1].getAttribute('cy')).toBe(points[1][1].getAttribute('cy'));
  });
});
