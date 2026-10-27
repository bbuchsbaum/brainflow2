import { describe, expect, it } from 'vitest';
import {
  SEGMENT_FRAME_ID,
  SERIES_SEGMENT,
  SERIES_T,
  manualSegmentGroup,
  parseRunsSidecar,
  rawSeriesCsv,
  runGroupFor,
  runsSidecarPath,
  segmentAt,
  segmentedSeriesFrame,
  type SegmentLayer,
} from '../seriesSegments';

// The native multirun fixture (.hillclimb/native-check/p4/truth.json d2_multirun).
const run = (n: number, frames: number, extra = ''): SegmentLayer => ({
  id: `run${n}${extra}`,
  name: `Faces BOLD (sub-01, run-${n})`,
  sourcePath: `/data/multirun/sub-01${extra}_task-faces_run-${n}_bold.nii`,
  volumeType: 'TimeSeries4D',
  timeSeriesInfo: { num_timepoints: frames, tr: 2 },
});
const grid = () => ({ dimensions: [41, 49, 40], voxelToWorld: [4, 0, 0, -80] });

describe('run groups (E5b)', () => {
  const layers = [run(2, 24), run(1, 20), run(3, 18)];

  it('groups BIDS runs of one subject and task, in run order', () => {
    const group = runGroupFor('run2', layers, grid)!;
    expect(group.title).toBe('Runs of sub-01 task-faces');
    expect(group.factor).toBe('run');
    expect(group.segments.map((s) => [s.id, s.label, s.frames])).toEqual([
      ['run-1', 'run 1', 20],
      ['run-2', 'run 2', 24],
      ['run-3', 'run 3', 18],
    ]);
    // The same group from any member.
    expect(runGroupFor('run3', layers, grid)!.key).toBe(group.key);
  });

  it('does not group another subject, another grid or a lone run', () => {
    const other = {
      ...run(1, 20),
      id: 'other',
      sourcePath: '/data/multirun/sub-02_task-faces_run-1_bold.nii',
    };
    expect(runGroupFor('other', [...layers, other], grid)).toBeNull();
    const elsewhere = (id: string) => (id === 'run3' ? { dimensions: [64, 64, 32] } : grid());
    expect(runGroupFor('run1', layers, elsewhere)!.segments.map((s) => s.id)).toEqual([
      'run-1',
      'run-2',
    ]);
    expect(runGroupFor('run1', [run(1, 20)], grid)).toBeNull();
  });

  it('groups by hand in the order given', () => {
    const group = manualSegmentGroup(['run3', 'run1'], layers)!;
    expect(group.segments.map((s) => s.id)).toEqual(['run-3', 'run-1']);
    expect(manualSegmentGroup(['run1'], layers)).toBeNull();
  });
});

describe('runs sidecar (E5b)', () => {
  const concat: SegmentLayer = {
    id: 'cat',
    name: 'Faces BOLD (sub-01)',
    sourcePath: '/d/sub-01_task-faces_bold.nii.gz',
    timeSeriesInfo: { num_timepoints: 62, tr: 2 },
  };

  it('names the sidecar after the image stem', () => {
    expect(runsSidecarPath('/d/sub-01_task-faces_bold.nii.gz')).toBe(
      '/d/sub-01_task-faces_bold_runs.json',
    );
    expect(runsSidecarPath('/d/lh.func.gii')).toBeNull();
  });

  it('splits one volume into its runs', () => {
    const group = parseRunsSidecar(
      JSON.stringify({
        factor: 'run',
        segments: [
          { label: 'run-1', frames: 20 },
          { label: 'run-2', frames: 24 },
          { label: 'run-3', frames: 18, tr: 2 },
        ],
      }),
      concat,
    );
    expect(group.segments.map((s) => [s.id, s.frameStart, s.frames, s.tr])).toEqual([
      ['run-1', 0, 20, 2],
      ['run-2', 20, 24, 2],
      ['run-3', 44, 18, 2],
    ]);
  });

  it('says what is wrong with a sidecar that does not fit', () => {
    expect(() => parseRunsSidecar('{', concat)).toThrow('not valid JSON');
    expect(() => parseRunsSidecar(JSON.stringify({ segments: [{ frames: 20 }] }), concat)).toThrow(
      'lists 20 frames; the image has 62',
    );
    expect(() => parseRunsSidecar(JSON.stringify({ segments: [{ frames: 0 }] }), concat)).toThrow(
      'positive whole',
    );
  });
});

describe('segmented frames (E5b)', () => {
  const group = runGroupFor('run1', [run(1, 20), run(2, 24), run(3, 18)], grid)!;
  const samples = group.segments.map((segment) => ({
    segment,
    values: Array.from({ length: segment.frames }, (_, i) => 100 + i),
  }));

  it('concatenates in seconds with labelled boundaries (truth: run 2 starts at 40 s, run 3 at 88 s)', () => {
    const s = segmentedSeriesFrame(samples, 'concatenated');
    expect(s.xTitle).toBe('Concatenated time (s)');
    // Boundaries at the next run's onset; the first run is labelled, not ruled (round 3 T1).
    expect(s.rules.map((r) => [r.x, r.label, r.line])).toEqual([
      [0, 'run 1', false],
      [40, 'run 2', true],
      [88, 'run 3', true],
    ]);
    const run2peak = s.frame.rows.find((r) => r[SERIES_SEGMENT] === 'run 2' && r[SERIES_T] === 24)!;
    expect(run2peak.t).toBe(64);
    expect(run2peak[SEGMENT_FRAME_ID]).toBe('1:12');
    expect(s.frame.rows.find((r) => r[SERIES_SEGMENT] === 'run 3')!.t).toBe(88);
    expect(s.note).toBeNull();
  });

  it('faceted and overlaid layouts share within-run time', () => {
    for (const layout of ['faceted', 'overlaid'] as const) {
      const s = segmentedSeriesFrame(samples, layout);
      expect(s.xTitle).toBe('Time in run (s)');
      expect(s.rules).toEqual([]);
      expect(s.frame.rows.find((r) => r[SEGMENT_FRAME_ID] === '1:12')!.t).toBe(24);
    }
  });

  it('keeps each run at its own TR and says so', () => {
    const mixed = samples.map((s, i) => ({
      ...s,
      segment: { ...s.segment, tr: i === 2 ? 2.5 : 2 },
    }));
    const s = segmentedSeriesFrame(mixed, 'concatenated');
    expect(s.note).toBe('concatenated in seconds, each segment at its own TR (2 s, 2.5 s)');
    expect(s.frame.rows.find((r) => r[SERIES_SEGMENT] === 'run 3' && r[SERIES_T] === 2.5)!.t).toBe(
      90.5,
    );
  });

  it('finds the run and frame under a timepoint', () => {
    expect(segmentAt(group, group.segments[1].layerId, 12)).toMatchObject({ index: 1, frame: 13 });
    expect(segmentAt(group, 'nope', 0)).toBeNull();
  });
});

describe('raw series CSV (X2)', () => {
  it('has one header row with segment and within-run columns, then the locus', () => {
    const csv = rawSeriesCsv({
      rows: [{ segment: 'run 2', volumeIndex: 12, frame: 13, tWithin: 24, t: 64, tr: 2, value: 122, layer: 'Faces BOLD (sub-01, run-2)' }],
      axis: { name: 't', unit: 's' },
      locus: { kind: 'voxel', label: 'voxel ijk 10 23 30 on Faces BOLD (sub-01, run-2) grid (centre −40, −20, 48 mm)', voxels: 1 },
    });
    expect(csv).toBe(
      'segment,volume_index0,frame,t_within_s,t_s,tr_s,value,locus_kind,locus_label,n_voxels,layer\n' +
        'run 2,12,13,24,64,2,122,voxel,"voxel ijk 10 23 30 on Faces BOLD (sub-01, run-2) grid (centre -40, -20, 48 mm)",1,"Faces BOLD (sub-01, run-2)"\n',
    );
  });
});
