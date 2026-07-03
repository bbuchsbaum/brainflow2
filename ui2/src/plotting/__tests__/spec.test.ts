import { describe, expect, it } from 'vitest';

import { column, inferDefaultSpec, pickGroupingColumn, resolveSpec } from '@/plotting';
import type { SampleFrame } from '@/plotting';

const temporalFrame: SampleFrame = {
  columns: [column('t', 'temporal'), column('value', 'quantitative')],
  rows: [
    { t: 0, value: 1 },
    { t: 1, value: 2 },
  ],
};

const histFrame: SampleFrame = {
  columns: [
    column('binStart', 'quantitative'),
    column('binEnd', 'quantitative'),
    column('binCenter', 'quantitative'),
    column('count', 'quantitative'),
  ],
  rows: [{ binStart: 0, binEnd: 1, binCenter: 0.5, count: 3 }],
  meta: {
    suggested: { mark: 'hist', encoding: { x: 'binCenter', y: 'count' } },
  },
};

const groupFrame: SampleFrame = {
  columns: [column('group', 'nominal'), column('value', 'quantitative')],
  rows: [{ group: 'a', value: 1 }],
};

const scatterFrame: SampleFrame = {
  columns: [column('age', 'quantitative'), column('value', 'quantitative')],
  rows: [{ age: 20, value: 1 }],
};

describe('inferDefaultSpec', () => {
  it('prefers an explicit meta.suggested hint', () => {
    expect(inferDefaultSpec(histFrame)).toEqual({
      mark: 'hist',
      encoding: { x: 'binCenter', y: 'count' },
    });
  });

  it('temporal × quantitative -> line', () => {
    expect(inferDefaultSpec(temporalFrame)).toEqual({
      mark: 'line',
      encoding: { x: 't', y: 'value' },
    });
  });

  it('nominal × quantitative -> bar', () => {
    expect(inferDefaultSpec(groupFrame)).toEqual({
      mark: 'bar',
      encoding: { x: 'group', y: 'value' },
    });
  });

  it('quantitative × quantitative -> point', () => {
    expect(inferDefaultSpec(scatterFrame)).toEqual({
      mark: 'point',
      encoding: { x: 'age', y: 'value' },
    });
  });
});

describe('resolveSpec', () => {
  it('uses the inferred default when there is no override', () => {
    const r = resolveSpec(temporalFrame);
    expect(r.mark).toBe('line');
    expect(r.encoding).toEqual({ x: 't', y: 'value' });
    expect(r.transforms).toEqual([]);
    expect(r.params).toEqual({});
  });

  it('applies a mark override while retaining the inferred encoding', () => {
    const r = resolveSpec(temporalFrame, { mark: 'point' });
    expect(r.mark).toBe('point');
    expect(r.encoding).toEqual({ x: 't', y: 'value' });
  });

  it('rebinds a channel to an existing column', () => {
    const r = resolveSpec(temporalFrame, { encoding: { y: 't' } });
    expect(r.encoding.y).toBe('t');
  });

  it('drops an override channel bound to a missing column (keeps the default)', () => {
    const r = resolveSpec(temporalFrame, { encoding: { x: 'nonexistent' } });
    expect(r.encoding.x).toBe('t');
  });

  it('clears a channel when the override binds the empty string', () => {
    const r = resolveSpec(temporalFrame, { encoding: { y: '' } });
    expect(r.encoding.y).toBeUndefined();
  });
});

describe('inferDefaultSpec — nominal × quantitative cardinality', () => {
  it('one value per level -> bar', () => {
    const f: SampleFrame = {
      columns: [column('region', 'nominal'), column('value', 'quantitative')],
      rows: [
        { region: 'A', value: 1 },
        { region: 'B', value: 2 },
      ],
    };
    expect(inferDefaultSpec(f)).toEqual({
      mark: 'bar',
      encoding: { x: 'region', y: 'value' },
    });
  });

  it('multiple values per level (a distribution) -> box', () => {
    const f: SampleFrame = {
      columns: [column('group', 'nominal'), column('value', 'quantitative')],
      rows: [
        { group: 'ctrl', value: 1 },
        { group: 'ctrl', value: 2 },
        { group: 'pt', value: 3 },
      ],
    };
    expect(inferDefaultSpec(f)).toEqual({
      mark: 'box',
      encoding: { x: 'group', y: 'value' },
    });
  });
});

describe('pickGroupingColumn', () => {
  const frame: SampleFrame = {
    columns: [
      column('member', 'nominal'),
      column('subject', 'nominal'),
      column('diagnosis', 'nominal'),
      column('groupCode', 'quantitative'),
    ],
    rows: [
      { member: 's1', subject: 's1', diagnosis: 'ctrl', groupCode: 1 },
      { member: 's2', subject: 's2', diagnosis: 'ctrl', groupCode: 1 },
      { member: 's3', subject: 's3', diagnosis: 'pt', groupCode: 2 },
      { member: 's4', subject: 's4', diagnosis: 'pt', groupCode: 2 },
    ],
  };

  it('skips per-row identifier columns (distinct == row count)', () => {
    expect(pickGroupingColumn(frame, ['subject'])).toBeUndefined();
  });

  it('picks a real grouping factor (role-agnostic — numeric-coded counts)', () => {
    expect(pickGroupingColumn(frame, ['subject', 'groupCode'])).toBe('groupCode');
    expect(pickGroupingColumn(frame, ['subject', 'diagnosis'])).toBe('diagnosis');
  });

  it('prefers the lowest-cardinality factor and returns undefined when none group', () => {
    const f: SampleFrame = {
      columns: [column('a', 'nominal'), column('b', 'nominal')],
      rows: [
        { a: 'x', b: 'p' },
        { a: 'x', b: 'q' },
        { a: 'y', b: 'r' },
      ],
    };
    expect(pickGroupingColumn(f, ['b', 'a'])).toBe('a'); // a: 2 distinct < 3; b: 3 distinct == 3
    expect(pickGroupingColumn(f, ['b'])).toBeUndefined();
  });
});

describe('resolveSpec — dispersion band', () => {
  const bandFrame: SampleFrame = {
    columns: [
      column('member', 'nominal'),
      column('value', 'quantitative'),
      column('lower', 'quantitative'),
      column('upper', 'quantitative'),
    ],
    rows: [
      { member: 's1', value: 2, lower: 1, upper: 3 },
      { member: 's2', value: 4, lower: 3, upper: 5 },
    ],
    meta: {
      suggested: {
        mark: 'line',
        encoding: { x: 'member', y: 'value' },
        band: { lower: 'lower', upper: 'upper' },
      },
    },
  };

  it('resolves the suggested band when both bound columns exist', () => {
    expect(resolveSpec(bandFrame).band).toEqual({
      lower: 'lower',
      upper: 'upper',
    });
  });

  it('drops the band when a bound column is absent from the frame', () => {
    const frame: SampleFrame = {
      columns: [column('member', 'nominal'), column('value', 'quantitative')],
      rows: [{ member: 's1', value: 2 }],
      meta: {
        suggested: {
          mark: 'line',
          encoding: { x: 'member', y: 'value' },
          band: { lower: 'lower', upper: 'upper' },
        },
      },
    };
    expect(resolveSpec(frame).band).toBeUndefined();
  });

  it('has no band when the frame suggests none', () => {
    expect(resolveSpec(temporalFrame).band).toBeUndefined();
  });

  it('keeps the resolved band even when the user overrides the mark', () => {
    // The band is a property of the frame, not the mark; switching to a heatmap
    // must still carry it (marks that ignore it simply don't draw it).
    expect(resolveSpec(bandFrame, { mark: 'heatmap' }).band).toEqual({
      lower: 'lower',
      upper: 'upper',
    });
  });
});
