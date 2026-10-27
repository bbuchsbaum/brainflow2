import { describe, expect, it } from 'vitest';
import type { SeriesAxis, StudioMemberSummary } from '@brainflow/api';
import { seriesAxisLabel } from '../seriesAxisLabel';

const featureAxis = (patch: Partial<SeriesAxis> = {}): SeriesAxis => ({
  kind: 'lag',
  source: { type: 'feature_axis', feature: 'fir', axis: 'lag', position: 3 },
  unit: 'TR',
  start: 0,
  step: 1,
  count: 6,
  alignment: 'declared_common_axis',
  ...patch,
});

const member = (id: string, values: Record<string, string> | null): StudioMemberSummary => ({
  id,
  designValues: values,
  sourcePath: null,
});

describe('seriesAxisLabel', () => {
  it('states kind, unit and positions of a feature axis', () => {
    expect(seriesAxisLabel(featureAxis())).toBe('lag (TR), 6 positions');
    expect(seriesAxisLabel(featureAxis({ count: 1 }))).toBe('lag (TR), 1 position');
    expect(seriesAxisLabel(featureAxis({ unit: null, kind: 'index', count: null }))).toBe('index');
  });

  it('names an observation column and counts its distinct values', () => {
    const axis = featureAxis({
      kind: 'time',
      unit: 's',
      source: { type: 'observation_column', column: 'onset' },
      alignment: 'observation_values',
      count: null,
    });
    const members = [member('a', { onset: '0' }), member('b', { onset: '2' }), member('c', { onset: '2' })];
    expect(seriesAxisLabel(axis, members)).toBe('time (s) from column onset, 2 distinct values');
  });

  it('falls back to the declared count when metadata is incomplete', () => {
    const axis = featureAxis({ source: { type: 'observation_column', column: 'lag' }, count: 4 });
    expect(seriesAxisLabel(axis, [member('a', { lag: '1' }), member('b', null)])).toBe(
      'lag (TR) from column lag, 4 distinct values',
    );
    expect(seriesAxisLabel({ ...axis, count: null }, [])).toBe('lag (TR) from column lag');
  });
});
