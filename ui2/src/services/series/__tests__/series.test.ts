import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));

import type { SampleFrame, SampleRequest } from '@/plotting';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { DEFAULT_SERIES_SETTINGS } from '@/stores/seriesStore';
import { composePopulationPlot } from '@/services/studio/populationPlot';
import { tQuantile } from '@/utils/distributions';
import { activeSetSeriesBinding, sampleSetSeries } from '../sampleSetSeries';
import { SERIES_X, expandSeriesMembers, resolveSetSeriesBinding } from '../seriesBinding';
import { seriesRecipe } from '../seriesRecipe';
import mni from '@/devHarness/fixtures/app/mni_2mm.json';
import {
  FIR_AMPLITUDE,
  FIR_CENTRE,
  FIR_GAIN,
  FIR_RESPONSE,
  firOffset,
  firSet,
  locusVoxels,
  sampleFirMember,
} from '@/devHarness/app/firStudy';

const grid = { dims: mni.dims, affine: mni.affine };

/** The harness backend's sample_set_at_world, as a SampleProvider stand-in. */
async function fakeSample(request: SampleRequest): Promise<SampleFrame> {
  const locus = request.locus;
  if (locus.kind !== 'set') throw new Error('set locus expected');
  return {
    columns: [
      { name: 'member', role: 'nominal' },
      { name: 'value', role: 'quantitative' },
      ...(locus.members[0]?.designValues ?? []).map((d) => ({ name: d.column, role: 'nominal' as const })),
    ],
    rows: locus.members.map((m) => ({
      member: m.memberId,
      value: sampleFirMember(grid, m.sourcePath, m.stackIndex, locus.worldMm, locus.radiusMm)!.value,
      ...Object.fromEntries((m.designValues ?? []).map((d) => [d.column, d.value])),
    })),
  };
}

function open(variant: '3d' | '4d') {
  useSetStudioStore.getState().bootstrapStudio({
    set: firSet(variant),
    features: [{ id: 'fir', label: 'FIR beta', kind: 'volume' }],
    cohorts: [],
    expressions: [],
  } as never);
}

describe('series bindings (E5)', () => {
  beforeEach(() => open('3d'));

  it('a NeuroTabs lag column, a feature axis, or a numeric lag design column', () => {
    const set3 = firSet('3d');
    const meta3 = { columns: ['condition', 'lag', 'subject'], rows: new Map(set3.memberSummaries.map((m) => [m.id, m.designValues as Record<string, string>])) };
    expect(resolveSetSeriesBinding(set3, meta3)).toMatchObject({ kind: 'lag', unit: 'TR', column: 'lag', frames: null, subjectColumn: 'subject', conditionColumn: 'condition', origin: 'manifest' });
    const set4 = firSet('4d');
    const meta4 = { columns: ['condition', 'subject'], rows: new Map(set4.memberSummaries.map((m) => [m.id, m.designValues as Record<string, string>])) };
    expect(resolveSetSeriesBinding(set4, meta4)).toMatchObject({ column: null, frames: { start: 0, step: 1, count: 8 } });
    // No manifest axis: a numeric `lag` design column (folder discovery); no unit.
    expect(resolveSetSeriesBinding({ ...set3, seriesAxes: undefined }, meta3)).toMatchObject({ column: 'lag', unit: null, origin: 'design column' });
    expect(resolveSetSeriesBinding({ ...set4, seriesAxes: undefined }, meta4)).toBeNull();
  });

  it('a run column is the segment factor; Faceted puts one run per panel (E5b)', () => {
    const set4 = firSet('4d');
    const rows = new Map(set4.memberSummaries.map((m, i) => [m.id, { ...(m.designValues as Record<string, string>), run: String((i % 2) + 1) }]));
    const binding = resolveSetSeriesBinding(set4, { columns: ['condition', 'run', 'subject'], rows })!;
    expect(binding.segmentColumn).toBe('run');
    expect(seriesRecipe(binding, DEFAULT_SERIES_SETTINGS).facet).toBeNull();
    expect(seriesRecipe(binding, { ...DEFAULT_SERIES_SETTINGS, datasetRunsFaceted: true }).facet).toBe('run');
    // One value only: not a factor.
    const single = new Map([...rows].map(([id, r]) => [id, { ...r, run: '1' }]));
    expect(resolveSetSeriesBinding(set4, { columns: ['condition', 'run', 'subject'], rows: single })!.segmentColumn).toBeNull();
  });

  it('4D members expand to one sample per frame', () => {
    const binding = activeSetSeriesBinding({ ...useSetStudioStore.getState(), sets: { 'fir-4d': firSet('4d') }, selection: { ...useSetStudioStore.getState().selection, activeSetId: 'fir-4d' } })!;
    const { members, positions } = expandSeriesMembers(binding, [{ memberId: 'a', sourcePath: '/a.nii.gz' }]);
    expect(members.map((m) => m.stackIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(positions.get(JSON.stringify(['a', 3]))).toEqual({ observation: 'a', x: 3 });
  });
});

describe('FIR series known answers (E5/E6)', () => {
  const locus = { worldMm: FIR_CENTRE, radiusMm: 0, reduce: 'mean' as const };
  const centreVoxel = locusVoxels(grid, FIR_CENTRE, 0)[0];
  const d2 = centreVoxel.reduce((s, v, i) => s + (v - FIR_CENTRE[i]) ** 2, 0);
  const expected = (condition: 'faces' | 'houses', lag: number) =>
    FIR_GAIN.map((g, s) =>
      Math.fround(FIR_AMPLITUDE[condition] * g * FIR_RESPONSE[condition][lag] * Math.exp(-d2 / 72) + firOffset(s, condition, lag)),
    );

  it('3D lag maps and 4D lag series give the same population series', async () => {
    const composed = [];
    for (const variant of ['3d', '4d'] as const) {
      open(variant);
      const { frame, binding } = await sampleSetSeries(useSetStudioStore.getState(), 'ws', locus, new AbortController().signal, fakeSample);
      expect(frame.rows).toHaveLength(96);
      composed.push(composePopulationPlot(frame, seriesRecipe(binding, DEFAULT_SERIES_SETTINGS)).frame.rows);
    }
    expect(composed[0]).toHaveLength(16);
    // The 3D variant also carries its `lag` design column (null in summary rows).
    const strip = (rows: typeof composed[0]) =>
      rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== '__contributors' && k !== 'lag')));
    expect(strip(composed[1])).toEqual(strip(composed[0]));
  });

  it('faces peak at lag 2, houses at lag 4; mean ± t·SD/√n across the 6 subjects', async () => {
    open('3d');
    const { frame, binding } = await sampleSetSeries(useSetStudioStore.getState(), 'ws', locus, new AbortController().signal, fakeSample);
    const rows = composePopulationPlot(frame, seriesRecipe(binding, DEFAULT_SERIES_SETTINGS)).frame.rows;
    const at = (c: string, lag: number) => rows.find((r) => r.condition === c && r[SERIES_X] === lag)!;
    const values = expected('faces', 2);
    const mean = values.reduce((a, b) => a + b) / 6;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / 5);
    expect(at('faces', 2).value).toBeCloseTo(mean, 10);
    expect(at('faces', 2).upper).toBeCloseTo(mean + (tQuantile(0.975, 5) * sd) / Math.sqrt(6), 10);
    const peak = (c: string) =>
      [0, 1, 2, 3, 4, 5, 6, 7].reduce((best, lag) => (Number(at(c, lag).value) > Number(at(c, best).value) ? lag : best), 0);
    expect([peak('faces'), peak('houses')]).toEqual([2, 4]);
  });

  it('faces − houses, paired, then the 1–3 TR window mean', async () => {
    open('4d');
    const { frame, binding } = await sampleSetSeries(useSetStudioStore.getState(), 'ws', locus, new AbortController().signal, fakeSample);
    const rows = composePopulationPlot(
      frame,
      seriesRecipe(binding, {
        ...DEFAULT_SERIES_SETTINGS,
        transforms: [
          { kind: 'conditionDifference', column: 'condition', a: 'faces', b: 'houses' },
          { kind: 'windowMean', from: 1, to: 3 },
        ],
      }),
    ).frame.rows;
    expect(rows).toHaveLength(1);
    const perSubject = FIR_GAIN.map((_, s) =>
      [1, 2, 3].reduce((sum, lag) => sum + (expected('faces', lag)[s] - expected('houses', lag)[s]), 0) / 3,
    );
    expect(rows[0].value).toBeCloseTo(perSubject.reduce((a, b) => a + b) / 6, 10);
    expect(rows[0].count).toBe(6);
  });
});

describe('generated fixture truth (p4_fixtures.json) agrees with the app path', () => {
  it('sphere series: faces lag 2 mean and t CI; the baseline-0 difference', async () => {
    const truth = (await import('@/devHarness/fixtures/app/p4_fixtures.json')).default;
    open('3d');
    const { frame, binding } = await sampleSetSeries(
      useSetStudioStore.getState(),
      'ws',
      { worldMm: [-39.5, -19.5, 50.5], radiusMm: 6, reduce: 'mean' },
      new AbortController().signal,
      fakeSample,
    );
    const rows = composePopulationPlot(frame, seriesRecipe(binding, DEFAULT_SERIES_SETTINGS)).frame.rows;
    const faces2 = rows.find((r) => r.condition === 'faces' && r[SERIES_X] === 2)!;
    const t = truth.loci.sphere6mm.series.byCondition.faces[2];
    expect(faces2.value).toBeCloseTo(t.mean, 10);
    expect([faces2.lower, faces2.upper]).toEqual([expect.closeTo(t.ci95[0], 9), expect.closeTo(t.ci95[1], 9)]);
    const diff = composePopulationPlot(
      frame,
      seriesRecipe(binding, {
        ...DEFAULT_SERIES_SETTINGS,
        band: 'sem95',
        transforms: [
          { kind: 'baseline', from: 0, to: 0 },
          { kind: 'conditionDifference', column: 'condition', a: 'faces', b: 'houses' },
        ],
      }),
    ).frame.rows.find((r) => r[SERIES_X] === 2)!;
    expect(diff.value).toBeCloseTo(truth.loci.sphere6mm.series.facesMinusHousesBaseline0[2].mean, 10);
  });
});

describe('native fir4d shape (backend summary after 05857c47)', () => {
  it('12 4D members bound to feature `fir` with a declared 6-lag axis sample as 72 frames', async () => {
    const subjects = ['s01', 's02', 's03', 's04', 's05', 's06'];
    const members = subjects.flatMap((s) =>
      ['faces', 'houses'].map((c) => ({
        id: `${s}_${c}`,
        sourcePath: null,
        designValues: { subject: s, condition: c, fir_res: `${s}_${c}` },
        bindings: [
          {
            role: 'feature',
            featureId: 'fir',
            sourceLocator: `maps/sub-${s.slice(1)}_task-${c}_fir.nii.gz`,
            sourcePath: `/fixtures/fir4d/maps/sub-${s.slice(1)}_task-${c}_fir.nii.gz`,
            relativePath: null,
            selector: null,
            supportKind: 'volume',
            supportLabel: 'mni152-4mm-p4',
            availability: 'available',
            isPrimary: true,
          },
        ],
      })),
    );
    const set = {
      ...firSet('4d'),
      id: 'p4-fir-4d',
      designColumns: ['subject', 'condition', 'fir_res'],
      memberSummaries: members,
      memberIds: members.map((m) => m.id),
      memberCount: members.length,
      seriesAxes: [
        {
          kind: 'lag',
          source: { type: 'feature_axis', feature: 'fir', axis: 'lag', position: 3 },
          unit: 'TR',
          start: 0,
          step: 1,
          count: 6,
          alignment: 'declared_common_axis',
        },
      ],
    };
    useSetStudioStore.getState().bootstrapStudio({ set, features: [{ id: 'fir', label: 'fir', kind: 'volume' }], cohorts: [], expressions: [] } as never);
    const seen: SampleRequest[] = [];
    const { frame } = await sampleSetSeries(
      useSetStudioStore.getState(),
      'ws',
      { worldMm: [0, 0, 0], radiusMm: 0, reduce: 'mean' },
      new AbortController().signal,
      async (request) => {
        seen.push(request);
        const locus = request.locus as Extract<SampleRequest['locus'], { kind: 'set' }>;
        return {
          columns: [{ name: 'member', role: 'nominal' }, { name: 'value', role: 'quantitative' }],
          rows: locus.members.map((m) => ({ member: m.memberId, value: m.stackIndex ?? null })),
        };
      },
    );
    const locus = seen[0].locus as Extract<SampleRequest['locus'], { kind: 'set' }>;
    expect(locus.members).toHaveLength(72);
    expect(new Set(locus.members.map((m) => m.sourcePath)).size).toBe(12);
    expect(locus.members.filter((m) => m.memberId.startsWith('["s01_faces"')).map((m) => m.stackIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(frame.rows.map((r) => r[SERIES_X])).toEqual(frame.rows.map((r) => r.value));
  });
});
