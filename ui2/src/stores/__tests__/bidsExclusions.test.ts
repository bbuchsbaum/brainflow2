import { describe, expect, it } from 'vitest';
import { createBidsBrowserDataset } from '@/devHarness/app/bidsBrowserData';
import {
  buildExclusionRow,
  exclusionContext,
  exclusionCriteria,
  exclusionDescriptionPreview,
  exclusionEntity,
  exclusionScopes,
  exclusionTsvLine,
  isFirstExclusionWrite,
  localDate,
} from '../bidsExclusions';
import { compareRunMetadata, fdTraceStats } from '../bidsInspect';
import { buildLensExport, deriveBidsModel, entityRunIds, exclusionLens } from '../bidsModel';

const dataset = createBidsBrowserDataset();
const index = dataset.index('s');
const model = deriveBidsModel(index);
const OVER = 'sub-07_ses-01_task-mid_run-2_bold';
const facts = model.runsById.get(OVER)!;

describe('exclusion criteria', () => {
  it('leads with what the run is over', () => {
    const [first] = exclusionCriteria(facts, model, null);
    expect(first.id).toBe('fd');
    expect(first.criterion).toBe('fd_mean>0.25');
    expect(first.source).toBe('fmriprep 24.1.1 confounds');
  });

  it('leaves a clean run to the hand', () => {
    const clean = model.runsById.get('sub-01_ses-01_T1w')!;
    const list = exclusionCriteria(clean, model, null);
    expect(list.some((item) => item.triggered)).toBe(false);
    expect(list[list.length - 1].id).toBe('manual');
  });

  it('honours the active censoring criterion', () => {
    const list = exclusionCriteria(facts, model, { lineMm: 0.5, maxFraction: 0.1 });
    const item = list.find((entry) => entry.id === 'censor:0.5')!;
    expect(item.criterion).toBe('fd_frames_over_0.5>0.1');
    expect(item.reason).toContain('above the 10% limit');
  });
});

describe('exclusion entities', () => {
  it('names run, session and participant', () => {
    expect(exclusionEntity(facts, 'run')).toBe(OVER);
    expect(exclusionEntity(facts, 'session')).toBe('sub-07_ses-01');
    expect(exclusionEntity(facts, 'participant')).toBe('sub-07');
  });

  it('counts runs from the model', () => {
    const scopes = exclusionScopes(facts, model);
    expect(scopes.map((s) => s.scope)).toEqual(['run', 'session', 'participant']);
    expect(scopes[1].runs).toBe(entityRunIds(model, 'sub-07_ses-01').length);
    expect(scopes[2].label).toBe('sub-07, both sessions');
  });

  it('does not take sub-1 for sub-10', () => {
    expect(entityRunIds(model, 'sub-1')).toEqual([]);
  });

  it('an exclusion lens holds only excluded runs', () => {
    const seeded = deriveBidsModel(index, { lens: exclusionLens(model, 'sub-07_ses-02_task-nback_run-2_bold') });
    expect(seeded.lens.runs.map((item) => item.run.id)).toEqual(['sub-07_ses-02_task-nback_run-2_bold']);
  });
});

describe('what is written', () => {
  const criterion = exclusionCriteria(facts, model, null)[0];
  const row = buildExclusionRow({
    facts,
    scope: 'run',
    reason: `  ${criterion.reason} `,
    criterion,
    author: ' bb ',
    date: '2026-11-01',
  });

  it('trims the free text', () => {
    expect(row.reason).toBe(criterion.reason);
    expect(row.author).toBe('bb');
  });

  it('writes n/a for an empty cell and escapes separators', () => {
    const line = exclusionTsvLine({ ...row, value: '', reason: 'a\tb\\c\nd' });
    expect(line.split('\t')).toEqual([
      OVER,
      'a\\tb\\\\c\\nd',
      'fd_mean>0.25',
      'n/a',
      'bb',
      '2026-11-01',
      'fmriprep 24.1.1 confounds',
      '0.25',
      'Power',
      'n/a',
    ]);
  });

  it('previews the description the first write creates', () => {
    const context = exclusionContext(model);
    expect(isFirstExclusionWrite({ ...index, exclusions_described: false }, [], false)).toBe(true);
    expect(isFirstExclusionWrite({ ...index, exclusions_described: false }, [], true)).toBe(false);
    expect(isFirstExclusionWrite(index, index.exclusions, false)).toBe(false);
    // Every row reverted: the description is still there and is left alone.
    expect(isFirstExclusionWrite({ ...index, exclusions_described: true }, [], false)).toBe(false);
    const withDoi = exclusionDescriptionPreview(index, context, '0.1.0');
    expect(withDoi).toContain('"DOI":"doi:10.18112/example.v1.2.0"');
    expect(withDoi).toContain('"Version":"0.1.0"');
    const noDoi = exclusionDescriptionPreview({ ...index, doi: null }, context, null);
    expect(noDoi).toContain('"URL":"../.."');
    expect(noDoi).toContain('[{"Name":"Brainflow"}]');
  });
});

describe('a row states its own criteria', () => {
  const criterion = exclusionCriteria(facts, model, null)[0];
  const draft = { facts, reason: 'r', criterion, author: 'bb', date: '2026-11-01' };

  it('records threshold, definition and source', () => {
    const row = buildExclusionRow({ ...draft, scope: 'run' });
    expect(row).toMatchObject({ threshold: '0.25', definition: 'Power', triggered_by: '' });
  });

  it('names the run a wider scope quotes its value from', () => {
    const row = buildExclusionRow({ ...draft, scope: 'session' });
    expect(row.triggered_by).toBe(OVER);
  });

  it('uses the run\'s own MRIQC source, never another run\'s', () => {
    const noFd = { ...facts, run: { ...facts.run, fd: null } };
    const [fd] = exclusionCriteria(noFd, model, null).filter((item) => item.id === 'fd');
    expect(fd.source).toBe(facts.run.iqms?.source);
    expect(fd.definition).toBe('Power');
  });

  it('dates a row by the local calendar', () => {
    expect(localDate(new Date(2026, 10, 1, 23, 30))).toBe('2026-11-01');
  });
});

describe('metadata comparison', () => {
  const run = index.runs.find((item) => item.id === 'sub-33_ses-02_task-nback_run-1_bold')!;
  const modal = index.series_modal.find((item) => item.series === run.series);

  it('compares effective values, changed first, and counts the rest', () => {
    const { rows, identicalHidden, inherited } = compareRunMetadata(run, modal);
    const tr = rows.find((row) => row.key === 'RepetitionTime')!;
    expect(tr.changed).toBe(true);
    expect(tr.modal).toBe('0.8');
    expect(rows[0].changed).toBe(true);
    expect(rows.find((row) => row.key === 'B0FieldSource')).toBeUndefined();
    expect(identicalHidden).toBeGreaterThan(0);
    expect(inherited.length).toBeGreaterThan(0);
  });

  it('compares SliceTiming as vectors, not by count of unique times', () => {
    const entry = (value: number[]) => ({
      key: 'SliceTiming',
      value: JSON.stringify(value),
      source: 'x',
      source_kind: 'run',
    });
    const base = { ...run, sidecar: [entry([0, 0.5, 1])] };
    const reference = { series: run.series, n_runs: 1, values: [entry([0, 1, 0.5])] };
    const [row] = compareRunMetadata(base, reference).rows;
    expect(row.changed).toBe(true);
    expect(row.value).toBe('3');
    expect(row.modal).toBe('3');
    const same = compareRunMetadata(base, { ...reference, values: [entry([0, 0.50001, 1])] });
    expect(same.rows).toEqual([]);
  });

  it('checks pixdim[4] against the TR', () => {
    const entry = (key: string, value: string, source_kind: string) => ({ key, value, source: 'f', source_kind });
    const bad = compareRunMetadata(
      { ...run, sidecar: [entry('RepetitionTime', '2', 'run'), entry('pixdim[4]', '1', 'nifti')] },
      undefined,
    );
    expect(bad.rows[0]).toMatchObject({ label: 'pixdim[4] vs TR', modal: 'TR 2', changed: true, sourceLabel: 'NIfTI' });
  });
});

describe('the trace numbers', () => {
  it('takes the mean of drawn values and skips n/a', () => {
    expect(fdTraceStats([null, 0.2, 0.8, 0.5], 0.5)).toEqual({
      frames: 3,
      mean: 0.5,
      over: 1,
      max: 0.8,
    });
    expect(fdTraceStats([null], 0.5).mean).toBeNull();
  });
});

describe('lens export', () => {
  it('lists the runs in lens', () => {
    const lensed = deriveBidsModel(index, {
      lens: { id: 'l', label: 'l', predicate: { op: 'subjects', ids: ['33'] } },
    });
    const lines = buildLensExport(lensed).split('\n');
    expect(lines).toHaveLength(lensed.lens.runs.length + 1);
    expect(lines[1].split('\t').slice(0, 2)).toEqual(['sub-33', 'ses-01']);
  });
});
