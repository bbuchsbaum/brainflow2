/**
 * Unit tests for the cross-set trace plot mode: ontology label mapping
 * (`buildTraceMembers`) and the mode's `supports` gating.
 */

import { describe, expect, it } from 'vitest';

import { buildTraceMembers } from '../setTracePlot.helpers';
import { setTracePlot } from '../setTracePlot.mode';
import type { ActiveCohort } from '../cohortPlot.helpers';
import type { PlotModeContext } from '../plotHost.types';

const cohort: ActiveCohort = {
  setId: 'set-1',
  setName: 'Cohort',
  members: [
    { memberId: 'sub01', sourcePath: '/a.nii' },
    { memberId: 'sub02', sourcePath: '/b.nii' },
    { memberId: 'sub03', sourcePath: '/c.nii' }, // no design row
  ],
  designTable: {
    columns: ['subject', 'condition'],
    rows: [
      { id: 'sub01', cells: ['sub-01', 'faces'] },
      { id: 'sub02', cells: ['sub-02', 'houses'] },
    ],
  },
  designColumns: ['subject', 'condition'],
};

const ctx = (over: Partial<PlotModeContext>): PlotModeContext => ({
  layerId: undefined,
  layerName: undefined,
  crosshairMm: undefined,
  width: 400,
  height: 300,
  ...over,
});

describe('buildTraceMembers', () => {
  it('attaches ontology design values + a composite label from the design table', () => {
    const members = buildTraceMembers(cohort);
    expect(members[0]).toEqual({
      memberId: 'sub01',
      sourcePath: '/a.nii',
      displayLabel: 'sub-01 · faces',
      designValues: [
        { column: 'subject', value: 'sub-01' },
        { column: 'condition', value: 'faces' },
      ],
    });
    expect(members[1].displayLabel).toBe('sub-02 · houses');
  });

  it('passes a member with no design row through unlabelled', () => {
    const members = buildTraceMembers(cohort);
    expect(members[2]).toEqual({ memberId: 'sub03', sourcePath: '/c.nii' });
    expect(members[2].displayLabel).toBeUndefined();
  });

  it('leaves members plain when the cohort has no design columns', () => {
    const plain = buildTraceMembers({
      ...cohort,
      designTable: { columns: [], rows: [] },
    });
    expect(plain.every((m) => m.displayLabel === undefined)).toBe(true);
    expect(plain[0]).toEqual({ memberId: 'sub01', sourcePath: '/a.nii' });
  });
});

describe('setTracePlot.supports', () => {
  it('is supported with a cohort and a crosshair', () => {
    expect(setTracePlot.supports(ctx({ hasCohort: true, crosshairMm: [0, 0, 0] }))).toEqual({
      supported: true,
    });
  });

  it('is unsupported without a cohort', () => {
    const res = setTracePlot.supports(ctx({ hasCohort: false, crosshairMm: [0, 0, 0] }));
    expect(res.supported).toBe(false);
    if (!res.supported) expect(res.reason).toBe('unsupported-layer');
  });

  it('is unsupported without a crosshair', () => {
    const res = setTracePlot.supports(ctx({ hasCohort: true }));
    expect(res.supported).toBe(false);
    if (!res.supported) expect(res.reason).toBe('no-crosshair');
  });
});
