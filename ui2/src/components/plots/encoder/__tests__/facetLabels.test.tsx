import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { PlotEncoder } from '../PlotEncoder';
import {
  segmentedSeriesFrame,
  SEGMENT_FRAME_ID,
  runGroupFor,
} from '@/services/series/seriesSegments';

// Round 3 F2: in facets, a datum's accessible name must be its own row's, not
// the row at the same facet-local index of the whole frame.
describe('faceted datum labels', () => {
  const run = (n: number, frames: number) => ({
    id: `run${n}`,
    name: `run ${n}`,
    sourcePath: `/m/sub-01_task-faces_run-${n}_bold.nii`,
    timeSeriesInfo: { num_timepoints: frames, tr: 2 },
  });
  const group = runGroupFor('run1', [run(1, 20), run(2, 24), run(3, 18)], () => ({
    dimensions: [1, 1, 1],
  }))!;
  const courses = [
    { centre: 5, base: 100, amp: 10 },
    { centre: 12, base: 102, amp: 20 },
    { centre: 9, base: 98, amp: 15 },
  ];
  const samples = group.segments.map((segment, si) => ({
    segment,
    values: Array.from({ length: segment.frames }, (_, t) => {
      const c = courses[si];
      return c.base + c.amp * Math.exp(-(((t - c.centre) / 2) ** 2));
    }),
  }));

  it('run 2 peak reads "run 2 · frame 13/24 … 122"', () => {
    const { frame } = segmentedSeriesFrame(samples, 'faceted');
    const label = (i: number) => {
      const row = frame.rows[i];
      const [si, t] = String(row[SEGMENT_FRAME_ID]).split(':').map(Number);
      const segment = group.segments[si];
      return `${segment.label} · frame ${t + 1}/${segment.frames}: ${Number(row.value).toPrecision(4)}`;
    };
    const { container } = render(
      <PlotEncoder
        frame={frame}
        spec={{
          mark: 'line',
          encoding: { x: 't', y: 'value', facet: '__seriesSegment' },
          transforms: [],
          params: { facetColumns: 3 },
        }}
        width={900}
        height={240}
        context={{
          datumLink: {
            idColumn: SEGMENT_FRAME_ID,
            focusedId: null,
            selectedIds: new Set(frame.rows.map((r) => String(r[SEGMENT_FRAME_ID]))),
            onFocus: () => undefined,
            onToggleSelection: () => undefined,
            selectable: false,
            label,
          },
        }}
      />,
    );
    const peak = container.querySelector('[data-datum-id="1:12"]');
    expect(peak?.getAttribute('aria-label')).toBe('run 2 · frame 13/24: 122.0');
    // Every datum's label names its own run and frame.
    for (const el of container.querySelectorAll('[data-datum-id]')) {
      const [si, t] = el.getAttribute('data-datum-id')!.split(':').map(Number);
      expect(el.getAttribute('aria-label')).toMatch(new RegExp(`^run ${si + 1} · frame ${t + 1}/`));
    }
    expect(container.querySelectorAll('[role="heading"]').length).toBe(3);
  });

  it('each facet is entered at the shared frame, clamped to its run (v4 function)', () => {
    const { frame } = segmentedSeriesFrame(samples, 'faceted');
    const { container } = render(
      <PlotEncoder
        frame={frame}
        spec={{ mark: 'line', encoding: { x: 't', y: 'value', facet: '__seriesSegment' }, transforms: [], params: { facetColumns: 3 } }}
        width={900}
        height={240}
        context={{
          datumLink: {
            idColumn: SEGMENT_FRAME_ID,
            focusedId: '1:12',
            selectedIds: new Set(frame.rows.map((r) => String(r[SEGMENT_FRAME_ID]))),
            onFocus: () => undefined,
            onToggleSelection: () => undefined,
            selectable: false,
            entryIds: new Set(['0:12', '1:12', '2:12']),
          },
        }}
      />,
    );
    const stops = [...container.querySelectorAll('[data-datum-id][tabindex="0"]')].map((e) => e.getAttribute('data-datum-id'));
    expect(stops).toEqual(['0:12', '1:12', '2:12']);
  });
});
