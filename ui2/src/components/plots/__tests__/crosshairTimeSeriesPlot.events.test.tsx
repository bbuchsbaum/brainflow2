import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlotEncoder } from '../encoder/PlotEncoder';
import { eventBands, eventLegend, nonSteadyBands, steadyValues } from '../crosshairTimeSeriesPlot.helpers';

const events = [
  { onset: 2, duration: 2, trial_type: 'go' },
  { onset: 6, duration: 0, trial_type: 'fixation' },
];

describe('event bands', () => {
  it('turns events into labelled bands in seconds', () => {
    const bands = eventBands(events);
    expect(bands[0]).toMatchObject({ x0: 2, x1: 4, label: 'go, 2 s' });
    // A zero-length event keeps a visible width.
    expect(bands[1].x1).toBeGreaterThan(bands[1].x0);
    expect(eventLegend(events).map((entry) => entry.label)).toEqual(['go', 'fixation']);
    expect(eventLegend(events)[1].color).toBe('var(--bf-text-faint)');
  });

  it('marks non-steady-state volumes one step wide, on the plotted axis', () => {
    const bands = nonSteadyBands([0, 1], (i) => i * 2, 2);
    expect(bands.map((b) => [b.x0, b.x1])).toEqual([[-1, 1], [1, 3]]);
    expect(bands[0].label).toContain('not in the y scale');
  });

  it('takes flagged volumes out of a segment, counted from the file, not the slice', () => {
    const values = [900, 100, 101, 102];
    const series = steadyValues(values, [0]);
    expect(series.slice(0, 2)).toEqual([Number.NaN, 100]);
    expect(steadyValues(values)).toBe(values);
  });

  it('names an unlabelled event type plainly', () => {
    expect(eventLegend([{ onset: 0, duration: 1, trial_type: '' }])[0].label).toBe('Events');
  });

  it('draws them behind the line', () => {
    render(
      <PlotEncoder
        width={400}
        height={200}
        frame={{
          columns: [
            { name: 't', role: 'temporal' },
            { name: 'value', role: 'quantitative' },
          ],
          rows: [0, 2, 4, 6, 8].map((t) => ({ t, value: t })),
        }}
        spec={{
          mark: 'line',
          encoding: { x: 't', y: 'value' },
          transforms: [],
          params: { xBands: eventBands(events) },
        }}
      />,
    );
    const bands = screen.getAllByTestId('plot-x-band');
    expect(bands).toHaveLength(2);
    expect(bands[0].textContent).toBe('go, 2 s');
  });
});
