import { describe, expect, it, vi, beforeEach } from 'vitest';

const { invokeMock, layerState, histogramMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  layerState: { current: {} as { getLayer: (id: string) => unknown } },
  histogramMock: vi.fn(),
}));

vi.mock('@/services/transport', () => ({
  getTransport: () => ({ invoke: invokeMock }),
}));

vi.mock('@/stores/layerStore', () => {
  const useLayerStore = (() => layerState.current) as unknown as {
    getState: () => typeof layerState.current;
  };
  useLayerStore.getState = () => layerState.current;
  return { useLayerStore };
});

vi.mock('@/services/HistogramService', () => ({
  histogramService: { computeHistogram: histogramMock },
}));

import { sampleProvider } from '@/services/SampleProvider';
import { getColumn, numericColumn } from '@/plotting';

function set4DLayer(numTimepoints = 5, tr: number | null = null) {
  layerState.current = {
    getLayer: (id: string) =>
      id === 'L' ? { id, timeSeriesInfo: { num_timepoints: numTimepoints, tr } } : undefined,
  };
}

function set3DLayer() {
  layerState.current = {
    getLayer: (id: string) => (id === 'L' ? { id, timeSeriesInfo: undefined } : undefined),
  };
}

describe('SampleProvider — point/sphere loci', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    histogramMock.mockReset();
  });

  it('point locus on a 4D layer -> temporal series frame', async () => {
    set4DLayer(4);
    invokeMock.mockResolvedValue([1, 2, 3, 4]);

    const frame = await sampleProvider.sample({
      datasetId: 'L',
      locus: { kind: 'point', worldMm: [1, 2, 3] },
    });

    expect(invokeMock).toHaveBeenCalledWith('sample_stack', {
      layerId: 'L',
      worldMm: [1, 2, 3],
      radiusMm: 0,
      reduce: 'mean',
    });
    expect(frame.columns.map((c) => [c.name, c.role])).toEqual([
      ['t', 'temporal'],
      ['value', 'quantitative'],
    ]);
    expect(numericColumn(frame, 'value')).toEqual([1, 2, 3, 4]);
    // No TR -> the temporal axis is a bare index (no unit).
    expect(getColumn(frame, 't')?.unit).toBeUndefined();
    expect(numericColumn(frame, 't')).toEqual([0, 1, 2, 3]);
  });

  it('temporal axis is in seconds when TR is known', async () => {
    set4DLayer(3, 2);
    invokeMock.mockResolvedValue([1, 2, 3]);

    const frame = await sampleProvider.sample({
      datasetId: 'L',
      locus: { kind: 'point', worldMm: [0, 0, 0] },
    });

    expect(getColumn(frame, 't')?.unit).toBe('s');
    expect(numericColumn(frame, 't')).toEqual([0, 2, 4]);
  });

  it('sphere locus forwards the radius + reduce to the backend', async () => {
    set4DLayer(2);
    invokeMock.mockResolvedValue([5, 6]);

    await sampleProvider.sample({
      datasetId: 'L',
      locus: { kind: 'sphere', worldMm: [1, 1, 1], radiusMm: 6 },
      reduce: 'median',
    });

    expect(invokeMock).toHaveBeenCalledWith('sample_stack', {
      layerId: 'L',
      worldMm: [1, 1, 1],
      radiusMm: 6,
      reduce: 'median',
    });
  });

  it('point locus on a 3D layer -> single scalar frame', async () => {
    set3DLayer();
    invokeMock.mockResolvedValue([7]);

    const frame = await sampleProvider.sample({
      datasetId: 'L',
      locus: { kind: 'point', worldMm: [0, 0, 0] },
    });

    expect(frame.columns).toEqual([{ name: 'value', role: 'quantitative' }]);
    expect(frame.rows).toEqual([{ value: 7 }]);
  });
});

describe('SampleProvider — wholeVolume locus', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    histogramMock.mockReset();
  });

  it('-> binned histogram frame via the histogram service', async () => {
    histogramMock.mockResolvedValue({
      bins: [
        { x0: 0, x1: 1, count: 3 },
        { x0: 1, x1: 2, count: 5 },
      ],
      totalCount: 8,
      minValue: 0,
      maxValue: 2,
      mean: 1,
      std: 0.5,
      binCount: 2,
      layerId: 'L',
    });

    const frame = await sampleProvider.sample({
      datasetId: 'L',
      locus: { kind: 'wholeVolume' },
      binCount: 2,
    });

    expect(histogramMock).toHaveBeenCalledWith({
      layerId: 'L',
      binCount: 2,
      excludeZeros: true,
    });
    expect(frame.columns.map((c) => c.name)).toEqual(['binStart', 'binEnd', 'binCenter', 'count']);
    expect(frame.rows).toEqual([
      { binStart: 0, binEnd: 1, binCenter: 0.5, count: 3 },
      { binStart: 1, binEnd: 2, binCenter: 1.5, count: 5 },
    ]);
    expect(frame.meta).toMatchObject({ min: 0, max: 2, totalCount: 8 });
    // The histogram path must not touch the stack-sampling command.
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('SampleProvider — region loci', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    histogramMock.mockReset();
  });

  function setAtlasLegend() {
    layerState.current = {
      getLayer: (id: string) =>
        id === 'atlas-1'
          ? {
              id,
              atlasPaletteLegend: [
                { label_id: 1, roi: 'Region A' },
                { label_id: 2, roi: 'Region B' },
              ],
            }
          : undefined,
    };
  }

  it('regions locus -> region × value frame with names from the legend', async () => {
    setAtlasLegend();
    invokeMock.mockResolvedValue([
      { labelId: 1, value: 0.5, voxelCount: 10 },
      { labelId: 2, value: 0.8, voxelCount: 20 },
    ]);

    const frame = await sampleProvider.sample({
      datasetId: 'scalar-1',
      locus: { kind: 'regions', atlasLayerId: 'atlas-1' },
      reduce: 'mean',
    });

    expect(invokeMock).toHaveBeenCalledWith('compute_region_stats', {
      scalarLayerId: 'scalar-1',
      atlasLayerId: 'atlas-1',
      reduce: 'mean',
    });
    expect(frame.columns.map((c) => [c.name, c.role])).toEqual([
      ['region', 'nominal'],
      ['value', 'quantitative'],
      ['voxelCount', 'quantitative'],
    ]);
    expect(frame.rows).toEqual([
      { region: 'Region A', value: 0.5, voxelCount: 10 },
      { region: 'Region B', value: 0.8, voxelCount: 20 },
    ]);
    expect(frame.meta?.suggested).toEqual({
      mark: 'bar',
      encoding: { x: 'region', y: 'value' },
    });
  });

  it('falls back to "Region {id}" when the legend lacks the label', async () => {
    layerState.current = { getLayer: () => undefined };
    invokeMock.mockResolvedValue([{ labelId: 7, value: 1, voxelCount: 3 }]);

    const frame = await sampleProvider.sample({
      datasetId: 'scalar-1',
      locus: { kind: 'regions', atlasLayerId: 'atlas-1' },
    });

    expect(frame.rows[0].region).toBe('Region 7');
  });

  it('roi locus -> single-region scalar frame', async () => {
    setAtlasLegend();
    invokeMock.mockResolvedValue([
      { labelId: 1, value: 0.5, voxelCount: 10 },
      { labelId: 2, value: 0.8, voxelCount: 20 },
    ]);

    const frame = await sampleProvider.sample({
      datasetId: 'scalar-1',
      locus: { kind: 'roi', atlasLayerId: 'atlas-1', labelId: 2 },
    });

    expect(frame.columns).toEqual([{ name: 'value', role: 'quantitative' }]);
    expect(frame.rows).toEqual([{ value: 0.8 }]);
  });
});

describe('SampleProvider — set locus', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    histogramMock.mockReset();
  });

  it('-> a (member, value) base frame via sample_set_at_world', async () => {
    invokeMock.mockResolvedValue([
      { memberId: 'sub01', value: 1.5 },
      { memberId: 'sub02', value: 2.5 },
    ]);

    const frame = await sampleProvider.sample({
      datasetId: 'set-1',
      locus: {
        kind: 'set',
        worldMm: [1, 2, 3],
        radiusMm: 4,
        members: [
          { memberId: 'sub01', sourcePath: '/a.nii' },
          { memberId: 'sub02', sourcePath: 'template:X' },
        ],
      },
      reduce: 'mean',
    });

    expect(invokeMock).toHaveBeenCalledWith('sample_set_at_world', {
      members: [
        { memberId: 'sub01', sourcePath: '/a.nii' },
        { memberId: 'sub02', sourcePath: 'template:X' },
      ],
      worldMm: [1, 2, 3],
      radiusMm: 4,
      reduce: 'mean',
    });
    expect(frame.columns.map((c) => [c.name, c.role])).toEqual([
      ['member', 'nominal'],
      ['value', 'quantitative'],
    ]);
    expect(frame.rows).toEqual([
      { member: 'sub01', value: 1.5 },
      { member: 'sub02', value: 2.5 },
    ]);
  });

  it("carries a failed member's null value through (NaN serializes as null over IPC)", async () => {
    invokeMock.mockResolvedValue([
      { memberId: 'sub01', value: 1.5 },
      { memberId: 'sub02', value: null }, // f32::NAN -> JSON null
    ]);

    const frame = await sampleProvider.sample({
      datasetId: 'set-1',
      locus: {
        kind: 'set',
        worldMm: [0, 0, 0],
        radiusMm: 0,
        members: [
          { memberId: 'sub01', sourcePath: '/a.nii' },
          { memberId: 'sub02', sourcePath: '/b.nii' },
        ],
      },
    });

    expect(frame.rows).toEqual([
      { member: 'sub01', value: 1.5 },
      { member: 'sub02', value: null },
    ]);
    // numericColumn coerces the null to NaN so downstream marks drop it.
    expect(Number.isNaN(numericColumn(frame, 'value')[1])).toBe(true);
  });

  it('band -> a trace frame with lower/upper via sample_set_trace_at_world', async () => {
    invokeMock.mockResolvedValue([
      { memberId: 'sub01', value: 2.0, lower: 1.0, upper: 3.0, count: 12 },
      { memberId: 'sub02', value: 4.0, lower: 3.5, upper: 4.5, count: 9 },
    ]);

    const frame = await sampleProvider.sample({
      datasetId: 'set-1',
      locus: {
        kind: 'set',
        worldMm: [1, 2, 3],
        radiusMm: 5,
        members: [
          { memberId: 'sub01', sourcePath: '/a.nii' },
          { memberId: 'sub02', sourcePath: 'template:X' },
        ],
      },
      reduce: 'mean',
      band: 'sem95',
    });

    expect(invokeMock).toHaveBeenCalledWith('sample_set_trace_at_world', {
      members: [
        { memberId: 'sub01', sourcePath: '/a.nii' },
        { memberId: 'sub02', sourcePath: 'template:X' },
      ],
      worldMm: [1, 2, 3],
      radiusMm: 5,
      reduce: 'mean',
      band: 'sem95',
    });
    expect(frame.columns.map((c) => [c.name, c.role])).toEqual([
      ['member', 'nominal'],
      ['value', 'quantitative'],
      ['lower', 'quantitative'],
      ['upper', 'quantitative'],
      ['count', 'quantitative'],
    ]);
    expect(frame.rows).toEqual([
      { member: 'sub01', value: 2.0, lower: 1.0, upper: 3.0, count: 12 },
      { member: 'sub02', value: 4.0, lower: 3.5, upper: 4.5, count: 9 },
    ]);
    expect(frame.meta?.band).toBe('sem95');
    expect(frame.meta?.suggested).toEqual({
      mark: 'line',
      encoding: { x: 'member', y: 'value' },
      band: { lower: 'lower', upper: 'upper' },
    });
  });

  it('band trace carries ontology member labels into frame columns', async () => {
    invokeMock.mockResolvedValue([
      {
        memberId: 'm1',
        displayLabel: 'sub-01 faces',
        designValues: [
          { column: 'subject', value: 'sub-01' },
          { column: 'condition', value: 'faces' },
        ],
        value: 2.0,
        lower: 1.0,
        upper: 3.0,
        count: 12,
      },
      {
        memberId: 'm2',
        displayLabel: 'sub-02 houses',
        designValues: [
          { column: 'subject', value: 'sub-02' },
          { column: 'condition', value: 'houses' },
        ],
        value: 4.0,
        lower: 3.5,
        upper: 4.5,
        count: 9,
      },
    ]);

    const frame = await sampleProvider.sample({
      datasetId: 'set-1',
      locus: {
        kind: 'set',
        worldMm: [1, 2, 3],
        radiusMm: 5,
        members: [
          {
            memberId: 'm1',
            sourcePath: '/a.nii',
            displayLabel: 'sub-01 faces',
            designValues: [
              { column: 'subject', value: 'sub-01' },
              { column: 'condition', value: 'faces' },
            ],
          },
          {
            memberId: 'm2',
            sourcePath: '/b.nii',
            displayLabel: 'sub-02 houses',
            designValues: [
              { column: 'subject', value: 'sub-02' },
              { column: 'condition', value: 'houses' },
            ],
          },
        ],
      },
      reduce: 'mean',
      band: 'sem95',
    });

    expect(invokeMock).toHaveBeenCalledWith('sample_set_trace_at_world', {
      members: [
        {
          memberId: 'm1',
          sourcePath: '/a.nii',
          displayLabel: 'sub-01 faces',
          designValues: [
            { column: 'subject', value: 'sub-01' },
            { column: 'condition', value: 'faces' },
          ],
        },
        {
          memberId: 'm2',
          sourcePath: '/b.nii',
          displayLabel: 'sub-02 houses',
          designValues: [
            { column: 'subject', value: 'sub-02' },
            { column: 'condition', value: 'houses' },
          ],
        },
      ],
      worldMm: [1, 2, 3],
      radiusMm: 5,
      reduce: 'mean',
      band: 'sem95',
    });
    expect(frame.columns.map((c) => [c.name, c.role])).toEqual([
      ['member', 'nominal'],
      ['memberLabel', 'nominal'],
      ['subject', 'nominal'],
      ['condition', 'nominal'],
      ['value', 'quantitative'],
      ['lower', 'quantitative'],
      ['upper', 'quantitative'],
      ['count', 'quantitative'],
    ]);
    expect(frame.rows[0]).toEqual({
      member: 'm1',
      memberLabel: 'sub-01 faces',
      subject: 'sub-01',
      condition: 'faces',
      value: 2.0,
      lower: 1.0,
      upper: 3.0,
      count: 12,
    });
    expect(frame.meta?.designColumns).toEqual(['subject', 'condition']);
    expect(frame.meta?.suggested).toEqual({
      mark: 'line',
      encoding: { x: 'memberLabel', y: 'value' },
      band: { lower: 'lower', upper: 'upper' },
    });
  });

  it("band trace carries a failed member's null value + band through", async () => {
    invokeMock.mockResolvedValue([
      { memberId: 'sub01', value: 2.0, lower: 1.0, upper: 3.0, count: 5 },
      { memberId: 'sub02', value: null, lower: null, upper: null, count: 0 },
    ]);

    const frame = await sampleProvider.sample({
      datasetId: 'set-1',
      locus: {
        kind: 'set',
        worldMm: [0, 0, 0],
        radiusMm: 0,
        members: [
          { memberId: 'sub01', sourcePath: '/a.nii' },
          { memberId: 'sub02', sourcePath: '/b.nii' },
        ],
      },
      band: 'ci95',
    });

    expect(frame.rows[1]).toEqual({
      member: 'sub02',
      value: null,
      lower: null,
      upper: null,
      count: 0,
    });
    expect(Number.isNaN(numericColumn(frame, 'value')[1])).toBe(true);
  });

  it('without band -> still the plain (member, value) frame', async () => {
    invokeMock.mockResolvedValue([{ memberId: 'sub01', value: 1.5 }]);

    await sampleProvider.sample({
      datasetId: 'set-1',
      locus: {
        kind: 'set',
        worldMm: [1, 2, 3],
        radiusMm: 4,
        members: [{ memberId: 'sub01', sourcePath: '/a.nii' }],
      },
    });

    // The plain path must use the scalar command, never the trace command.
    expect(invokeMock).toHaveBeenCalledWith('sample_set_at_world', expect.anything());
  });
});

describe('population source and frame identity', () => {
  it.each([undefined, 'none'] as const)(
    'retains snapshot identity and failure reasons for band %s',
    async (band) => {
      invokeMock.mockResolvedValue([
        {
          memberId: 'S01',
          value: 11,
          count: 1,
          lower: 11,
          upper: 11,
          sourceRevision: { sha256: 'source-hash', sourceBytes: 364 },
          error: null,
        },
        {
          memberId: 'S02',
          value: null,
          count: 0,
          lower: null,
          upper: null,
          sourceRevision: null,
          error: 'Source revision changed.',
        },
      ]);
      const frame = await sampleProvider.sample({
        datasetId: 'population',
        band,
        locus: {
          kind: 'set',
          worldMm: [0, 0, 0],
          radiusMm: 0,
          members: [
            {
              memberId: 'S01',
              sourcePath: '/series.nii',
              stackIndex: 2,
              expectedSha256: 'source-hash',
            },
            {
              memberId: 'S02',
              sourcePath: '/other.nii',
              stackIndex: 1,
              expectedSha256: 'old-hash',
            },
          ],
        },
      });
      expect(invokeMock).toHaveBeenLastCalledWith(
        band === undefined ? 'sample_set_at_world' : 'sample_set_trace_at_world',
        expect.objectContaining({
          members: expect.arrayContaining([
            expect.objectContaining({
              memberId: 'S01',
              stackIndex: 2,
              expectedSha256: 'source-hash',
            }),
          ]),
        }),
      );
      expect(frame.meta?.sources).toEqual([
        expect.objectContaining({
          memberId: 'S01',
          stackIndex: 2,
          sourceRevision: { sha256: 'source-hash', sourceBytes: 364 },
          error: null,
        }),
        expect.objectContaining({
          memberId: 'S02',
          stackIndex: 1,
          sourceRevision: null,
          error: 'Source revision changed.',
        }),
      ]);
      expect(frame.rows[1].value).toBeNull();
      expect(frame.columns.find((column) => column.name === 'member')?.role).toBe('nominal');
    },
  );
});
