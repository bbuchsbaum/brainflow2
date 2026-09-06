import { expect, it } from 'vitest';
import {
  arrangePopulationResponses,
  orderPopulationFrame,
  populationOrderSourceStatus,
} from '../populationWitnesses';
import type { PopulationProbeResult } from '../PopulationProbeController';

function sampled(values: (number | null)[]): PopulationProbeResult {
  const ids = values.map((_, index) => `S${index}`);
  return {
    query: {
      key: 'probe-1',
      datasetKey: 'dataset',
      probe: { supportKey: 'support', worldMm: [1, 2, 3], radiusMm: 4, reduce: 'mean' },
      request: {
        datasetId: 'set',
        locus: {
          kind: 'set',
          worldMm: [1, 2, 3],
          radiusMm: 4,
          members: ids.map((memberId) => ({ memberId, sourcePath: `/${memberId}.nii` })),
        },
      },
    },
    frame: {
      columns: [
        { name: 'member', role: 'nominal' },
        { name: 'value', role: 'quantitative' },
      ],
      rows: ids.map((member, i) => ({ member, value: values[i] })).reverse(),
    },
  };
}

it('samples actual observed ranks across the full response range, never interpolated people', () => {
  const result = sampled(Array.from({ length: 80 }, (_, i) => 79 - i));
  const order = arrangePopulationResponses(result, 'witnesses');
  // Independently enumerated nearest ranks of 0, 1/11, ..., 1.
  expect(order.witnessIds).toEqual(
    [79, 72, 65, 57, 50, 43, 36, 29, 22, 14, 7, 0].map((i) => `S${i}`),
  );
  expect(new Set(order.witnessIds).size).toBe(12);
  const frame = orderPopulationFrame(result.frame, order);
  expect(frame.rows).toHaveLength(80);
  expect(frame.rows.map((row) => row.value)).toEqual(Array.from({ length: 80 }, (_, i) => i));
  expect(result.frame.rows[0].member).toBe('S79');
});

it('keeps zero valid, missing responses last and equal values in declared source order', () => {
  const result = sampled([3, null, 0, 3, NaN, -1, Infinity]);
  const order = arrangePopulationResponses(result, 'witnesses');
  expect(order.orderedIds).toEqual(['S5', 'S2', 'S0', 'S3', 'S1', 'S4', 'S6']);
  expect(order.witnessIds).toEqual(['S5', 'S2', 'S0', 'S3']);
  expect(order.unavailableIds).toEqual(['S1', 'S4', 'S6']);
  expect(orderPopulationFrame(result.frame, order).rows).toHaveLength(7);
});

it('handles one or no finite observation without inventing witnesses', () => {
  expect(arrangePopulationResponses(sampled([null, 0]), 'witnesses').witnessIds).toEqual(['S1']);
  const missing = arrangePopulationResponses(sampled([null, null]), 'all');
  expect(missing.witnessIds).toEqual([]);
  expect(missing.orderedIds).toEqual(['S0', 'S1']);
});

it('rejects invalid identity joins and sampling counts instead of silently duplicating observations', () => {
  const result = sampled([1, 2]);
  expect(() => arrangePopulationResponses(result, 'witnesses', 1)).toThrow(/count/);
  expect(() =>
    arrangePopulationResponses(
      { ...result, frame: { ...result.frame, rows: [result.frame.rows[0], result.frame.rows[0]] } },
      'all',
    ),
  ).toThrow(/exactly one/);
  expect(() =>
    arrangePopulationResponses(
      {
        ...result,
        frame: { ...result.frame, rows: [{ member: 'foreign', value: 1 }, result.frame.rows[0]] },
      },
      'all',
    ),
  ).toThrow(/exactly one/);
});

it('identifies source changes and missing provenance without silently refitting an order', () => {
  const result = sampled([1, 2]);
  const sources = ['S0', 'S1'].map((memberId) => ({
    memberId,
    sourceRevision: { sha256: 'old', sourceBytes: 1 },
    stackIndex: null,
    validCount: 1,
    error: null,
  }));
  const order = arrangePopulationResponses(
    { ...result, frame: { ...result.frame, meta: { sources } } },
    'all',
  );
  expect(
    populationOrderSourceStatus(order, [
      { memberId: 'S1', sha256: 'old' },
      { memberId: 'S0', sha256: 'old' },
    ]),
  ).toBe('same');
  expect(
    populationOrderSourceStatus(order, [
      { memberId: 'S0', sha256: 'new' },
      { memberId: 'S1', sha256: 'old' },
    ]),
  ).toBe('changed');
  expect(populationOrderSourceStatus(order, [])).toBe('unknown');
  expect(order.orderedIds).toEqual(['S0', 'S1']);
});

it('refuses duplicate declared members even when sampled rows contain distinct IDs', () => {
  const result = sampled([1, 2]);
  const locus = result.query.request.locus;
  if (locus.kind !== 'set') throw new Error('fixture requires set');
  expect(() =>
    arrangePopulationResponses(
      {
        ...result,
        query: {
          ...result.query,
          request: {
            ...result.query.request,
            locus: { ...locus, members: [locus.members[0], locus.members[0]] },
          },
        },
      },
      'all',
    ),
  ).toThrow(/exactly one/);
});

it('marks an order changed when its mask changes, even when observations are unchanged', () => {
  const result = sampled([1, 2]);
  if (result.query.request.locus.kind !== 'set') throw Error('set required');
  result.query = {
    ...result.query,
    request: {
      ...result.query.request,
      locus: { ...result.query.request.locus, mask: { sourcePath: '/mask.nii' } },
    },
  };
  result.frame = {
    ...result.frame,
    meta: {
      sources: ['S0', 'S1'].map((memberId) => ({
        memberId,
        sourceRevision: { sha256: 'image', sourceBytes: 100 },
        maskRevision: { sha256: 'mask', sourceBytes: 50 },
        stackIndex: null,
        validCount: 1,
        error: null,
      })),
    },
  };
  const order = arrangePopulationResponses(result, 'all');
  expect(
    populationOrderSourceStatus(
      order,
      ['S0', 'S1'].map((memberId) => ({ memberId, sha256: 'image', maskSha256: 'mask' })),
    ),
  ).toBe('same');
  expect(
    populationOrderSourceStatus(
      order,
      ['S0', 'S1'].map((memberId) => ({ memberId, sha256: 'image', maskSha256: 'changed' })),
    ),
  ).toBe('changed');
  expect(
    populationOrderSourceStatus(
      order,
      ['S0', 'S1'].map((memberId) => ({ memberId, sha256: 'image' })),
    ),
  ).toBe('unknown');
});
