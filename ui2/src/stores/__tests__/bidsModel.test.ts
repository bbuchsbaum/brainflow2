import { describe, expect, it } from 'vitest';
import type { BidsBrowserIndex, BidsExclusion, BidsRunRecord } from '@brainflow/api';
import { createBidsBrowserDataset } from '@/devHarness/app/bidsBrowserData';
import {
  buildCubidsTable,
  buildDataDescriptor,
  buildLensExport,
  deriveBidsModel,
  lensExportLabel,
  nextRunId,
  tsnrCut,
  runLabel,
  type BidsLens,
  type BidsModel,
} from '../bidsModel';

import { exclusionCriteria as criteriaOf } from '../bidsExclusions';

const index = () => createBidsBrowserDataset().index('scan');
const SELECTED = 'sub-33_ses-02_task-nback_run-1_bold';

const group = (model: BidsModel, id: string) =>
  model.findings.groups.find((entry) => entry.id === id)!;
const claimText = (model: BidsModel) =>
  model.summary.segments
    .map((s) => (s.kind === 'threshold' ? '[thr]' : 'text' in s ? s.text : ''))
    .join('');
const cellOf = (model: BidsModel, runId: string) => {
  const at = model.runPosition.get(runId)!;
  return model.cells[at.row * model.columns.length + at.col];
};
const exclusion = (entity: string): BidsExclusion => ({
  entity,
  scope: '',
  reason: 'test',
  criterion: 'manual',
  value: '',
  author: 'bb',
  date: '2026-11-01',
  source: '',
});

describe('deriveBidsModel', () => {
  it('counts participants by group and places every present run in one cell', () => {
    const source = index();
    const model = deriveBidsModel(source);
    expect(model.participants.read).toBe(40);
    expect(model.participants.byGroup.reduce((sum, g) => sum + g.count, 0)).toBe(40);
    expect(model.groups.map((g) => g.label)).toEqual(['control', 'patient']);
    expect(model.rows.map((r) => r.group)).toEqual(
      [...model.rows].map((r) => r.group).sort(),
    );
    expect(model.sessions).toEqual(['01', '02']);
    expect(model.runPosition.size).toBe(source.runs.length);
    expect(model.columnTotalOf).toBe(40);
  });

  it('orders columns by session, series and run, naturally', () => {
    const source = index();
    const base = source.runs.find((run) => run.id === SELECTED)!;
    const extra = ['2', '10'].map(
      (run): BidsRunRecord => ({ ...base, id: `sub-33_ses-02_task-zz_run-${run}_bold`, run, series: 'task-zz_bold' }),
    );
    const model = deriveBidsModel({ ...source, runs: [...source.runs, ...extra.reverse()] });
    const own = model.columns.filter((column) => column.series === 'task-zz_bold');
    expect(own.map((column) => column.runLabel)).toEqual(['2', '10']);
    const sessions = model.columns.map((column) => column.session);
    expect(sessions).toEqual([...sessions].sort());
  });

  it('gives each design meaning exactly one mark', () => {
    const model = deriveBidsModel(index());
    expect(cellOf(model, 'sub-35_ses-01_dwi').mark).toBe('error');
    expect(cellOf(model, 'sub-07_ses-02_task-nback_run-2_bold').mark).toBe('content');
    expect(cellOf(model, 'sub-01_ses-01_T1w').mark).toBe('hairline');
    expect(cellOf(model, 'sub-01_ses-01_task-nback_run-1_bold').mark).toBe('spark');
    expect(cellOf(model, 'sub-01_ses-01_task-nback_run-1_bold').hot).toBe(false);
    expect(cellOf(model, SELECTED).hot).toBe(true);
    expect(cellOf(model, SELECTED).variant).toBe(true);
    const row22 = model.rows.find((row) => row.subject === '22')!;
    const t2 = model.columns.find((column) => column.series === 'T2w')!;
    expect(model.cells[row22.index * model.columns.length + t2.index].mark).toBe('missing');
    expect(model.rows.find((row) => row.subject === '39')!.isNew).toBe(true);
  });

  it('draws a bold run with no trace as a hairline', () => {
    const source = index();
    const runs = source.runs.map((run) => (run.id === SELECTED ? { ...run, fd: null } : run));
    const cell = cellOf(deriveBidsModel({ ...source, runs }), SELECTED);
    expect(cell.mark).toBe('hairline');
    expect(cell.hot).toBe(true); // iqms still gives a mean over threshold
  });

  it('merges variant groups across task series and keeps run denominators', () => {
    const model = deriveBidsModel(index());
    expect(model.variants).toHaveLength(3);
    const upgrade = model.variants[0];
    expect(upgrade.series.length).toBe(3);
    expect(upgrade.participants).toBe(9);
    expect(upgrade.subjectSessions).toBe(9);
    expect(group(model, 'variants').items[0].entity).toBe(
      `9 participants · ${upgrade.runIds.length} runs`,
    );
  });

  it('builds the seven finding groups in order with one total', () => {
    const model = deriveBidsModel(index());
    expect(model.findings.groups.map((g) => g.label)).toEqual([
      'Saved lenses',
      'Errors',
      'Content problems',
      'Acquisition variants',
      'Quality',
      'Notes',
      'Excluded',
    ]);
    expect(group(model, 'errors').items).toHaveLength(2);
    // The harness seeds one exclusion, of a run with a content problem.
    expect(group(model, 'content').items).toHaveLength(2);
    expect(group(model, 'excluded').items).toHaveLength(1);
    const counted = ['errors', 'content', 'variants', 'quality', 'notes'];
    expect(model.findings.total).toBe(
      counted.reduce((sum, id) => sum + group(model, id).items.length, 0),
    );
    expect(model.status.findings).toBe(model.findings.total);
  });

  it('keeps validator and Brainflow tags apart (rule 7)', () => {
    const source = index();
    source.findings[1] = { ...source.findings[1], tag: 'content' };
    const tags = group(deriveBidsModel(source), 'errors').items.map((item) => item.tag);
    expect(tags).toEqual(['validator', 'content']);
  });

  it('reports quality per run with denominators and sources (rules 2 and 5)', () => {
    const model = deriveBidsModel(index());
    const items = group(model, 'quality').items;
    const fd = items.find((item) => item.kind === 'fd' && item.entity === 'sub-33 ses-02')!;
    expect(fd.title).toMatch(/^Mean FD over 0.25 mm in \d of \d runs, max \d\.\d\d$/);
    expect(fd.n).toBe(fd.of);
    expect(fd.source).toBe('FD (Power) · fmriprep 24.1.1 confounds');
    const tsnr = items.find((item) => item.kind === 'tsnr' && item.entity === 'sub-14 ses-01')!;
    expect(tsnr.title).toMatch(/^tSNR outlier in \d of \d runs, min \d+$/);
    expect(tsnr.source).toBe('mriqc 24.0.2 · below series median − 2.5 robust SD (MAD × 1.4826)');
    expect(items.some((item) => item.kind === 'ghost' && item.entity === 'sub-05 ses-01')).toBe(true);
  });

  it('follows the FD threshold everywhere', () => {
    const low = deriveBidsModel(index(), { fdThreshold: 0.25 });
    const high = deriveBidsModel(index(), { fdThreshold: 0.45 });
    const count = (model: BidsModel) =>
      group(model, 'quality').items.filter((item) => item.kind === 'fd').length;
    expect(count(high)).toBeLessThan(count(low));
    expect(claimText(high)).not.toEqual(claimText(low));
    expect(group(high, 'quality').items.find((i) => i.kind === 'fd')!.title).toContain('0.45 mm');
  });

  it('offers a censoring-fraction criterion and adds it to quality only when chosen', () => {
    const offered = deriveBidsModel(index());
    expect(offered.censorOffers.map((o) => o.lineMm)).toEqual([0.2, 0.5]);
    expect(offered.censorOffers[0].runsOver).toBeGreaterThan(0);
    expect(group(offered, 'quality').items.some((i) => i.kind === 'censor')).toBe(false);
    const chosen = deriveBidsModel(index(), { censor: { lineMm: 0.2, maxFraction: 0.2 } });
    const item = group(chosen, 'quality').items.find((i) => i.kind === 'censor')!;
    expect(item.title).toMatch(/^Over 20% of frames above 0.2 mm in \d+ of \d+ runs$/);
    expect(chosen.findings.total).toBeGreaterThan(offered.findings.total);
  });

  it('flags FD groups that are not comparable, unless filtered (rule 4)', () => {
    const source = index();
    const model = deriveBidsModel(source);
    expect(model.fdGroups.filter((g) => !g.modal).map((g) => g.tr)).toEqual([1]);
    const row = model.rows.find((r) => r.subject === '33')!;
    expect(row.sessionFd.map((s) => s.hollow)).toEqual([false, true]);
    const filtered = source.runs.map((run) =>
      run.fd ? { ...run, fd: { ...run.fd, filtered: true } } : run,
    );
    const after = deriveBidsModel({ ...source, runs: filtered });
    expect(after.rows.find((r) => r.subject === '33')!.sessionFd[1].hollow).toBe(false);
  });

  it('EVERY count updates together after an exclusion and after its revert', () => {
    const source = index();
    const noExclusions = { exclusions: [] as BidsExclusion[] };
    const before = deriveBidsModel(source, noExclusions);
    const runId = 'sub-07_ses-02_task-nback_run-2_bold'; // content problem and FD over threshold
    const column = before.runPosition.get(runId)!.col;
    const row = before.runPosition.get(runId)!.row;
    const sessionIndex = before.sessions.indexOf('02');
    const fdItem = group(before, 'quality').items.find(
      (item) => item.kind === 'fd' && item.entity === 'sub-07 ses-02',
    )!;

    const during = deriveBidsModel(source, { exclusions: [exclusion(runId)] });

    // Matrix.
    expect(during.columns[column].total).toBe(before.columns[column].total - 1);
    expect(cellOf(during, runId).excluded).toBe(true);
    expect(cellOf(during, runId).hot).toBe(false);
    // Session mean over the remaining runs.
    const kept = source.runs.filter(
      (run) => run.subject === '07' && run.session === '02' && run.suffix === 'bold' && run.id !== runId,
    );
    const mean = kept.reduce((sum, run) => sum + run.fd!.mean, 0) / kept.length;
    expect(during.rows[row].sessionFd[sessionIndex].mean).toBeCloseTo(mean, 6);
    expect(during.rows[row].sessionFd[sessionIndex].nRuns).toBe(
      before.rows[row].sessionFd[sessionIndex].nRuns - 1,
    );
    // Findings: the run's content problem leaves its group, quality loses a run.
    expect(group(during, 'content').items).toHaveLength(group(before, 'content').items.length - 1);
    const fdAfter = group(during, 'quality').items.find((item) => item.id === fdItem.id)!;
    expect(fdAfter.n).toBe(fdItem.n! - 1);
    expect(fdAfter.of).toBe(fdItem.of! - 1);
    expect(group(during, 'excluded').items).toHaveLength(1);
    expect(during.findings.total).toBe(before.findings.total - 1);
    // Summary, status and lens denominators.
    expect(claimText(during)).toContain('2 runs have content problems');
    expect(claimText(before)).toContain('3 runs have content problems');
    expect(during.status.findings).toBe(during.findings.total);
    expect(during.status.excludedRuns).toBe(1);
    expect(during.excluded).toEqual({ rows: 1, runs: 1 });
    expect(during.lens.ofRuns).toBe(before.lens.ofRuns - 1);
    expect(during.lens.runs).toHaveLength(before.lens.runs.length - 1);

    // Revert: every number is back.
    const after = deriveBidsModel(source, noExclusions);
    expect(after.columns.map((c) => c.total)).toEqual(before.columns.map((c) => c.total));
    expect(after.rows.map((r) => r.sessionFd)).toEqual(before.rows.map((r) => r.sessionFd));
    expect(after.findings.total).toBe(before.findings.total);
    expect(after.status).toEqual(before.status);
    expect(claimText(after)).toEqual(claimText(before));
  });

  it('applies session and participant exclusions to their runs', () => {
    const source = index();
    const session = deriveBidsModel(source, { exclusions: [exclusion('sub-33_ses-02')] });
    expect(cellOf(session, SELECTED).excluded).toBe(true);
    expect(cellOf(session, 'sub-33_ses-01_task-nback_run-1_bold').excluded).toBe(false);
    const participant = deriveBidsModel(source, { exclusions: [exclusion('sub-33')] });
    expect(cellOf(participant, 'sub-33_ses-01_task-nback_run-1_bold').excluded).toBe(true);
    expect(participant.excluded).toMatchObject({ rows: 1 });
    expect(participant.excluded.runs).toBeGreaterThan(session.excluded.runs);
  });

  it('removes a variant group once all its runs are excluded', () => {
    const source = index();
    const model = deriveBidsModel(source);
    const t1 = model.variants.find((variant) => variant.series[0] === 'T1w')!;
    const after = deriveBidsModel(source, { exclusions: t1.runIds.map(exclusion) });
    expect(after.variants.some((variant) => variant.key === t1.key)).toBe(false);
    expect(group(after, 'variants').items).toHaveLength(group(model, 'variants').items.length - 1);
  });
});

describe('lens', () => {
  const variantLens = (model: BidsModel): BidsLens =>
    group(model, 'variants').items[0].lens as BidsLens;

  it('is a serializable predicate that survives a round trip', () => {
    const source = index();
    const lens: BidsLens = {
      id: 'ready',
      label: 'Ready for group analysis',
      predicate: {
        op: 'and',
        terms: [
          { op: 'not', term: { op: 'excluded' } },
          { op: 'not', term: { op: 'fdOver', mm: 0.25 } },
          { op: 'derivative', name: 'fmriprep', statuses: ['current'] },
        ],
      },
    };
    const direct = deriveBidsModel(source, { lens });
    const stored = deriveBidsModel(source, { lens: JSON.parse(JSON.stringify(lens)) });
    expect(stored.lens.runs.length).toBe(direct.lens.runs.length);
    expect(direct.lens.runs.length).toBeGreaterThan(0);
    expect(direct.lens.runs.every((facts) => facts.meanFd === null || facts.meanFd <= 0.25)).toBe(true);
  });

  it('marks cells in highlight mode and hides other rows in only mode', () => {
    const source = index();
    const lens = variantLens(deriveBidsModel(source));
    const highlight = deriveBidsModel(source, { lens });
    expect(highlight.rows).toHaveLength(40);
    expect(cellOf(highlight, SELECTED).inLens).toBe(true);
    expect(highlight.lens.participants).toBe(9);
    const only = deriveBidsModel(source, { lens, lensMode: 'only' });
    expect(only.rows).toHaveLength(9);
    expect(only.lens.runs).toHaveLength(highlight.lens.runs.length);
    expect(only.columnTotalOf).toBe(9);
  });

  it('counts lens runs per task for the dock', () => {
    const model = deriveBidsModel(index());
    const withLens = deriveBidsModel(index(), { lens: variantLens(model) });
    expect(withLens.lens.tasks.map((t) => t.task)).toEqual(['mid', 'nback', 'rest']);
    expect(withLens.lens.tasks.reduce((sum, t) => sum + t.runs, 0)).toBe(withLens.lens.runs.length);
  });

  it('leaves excluded runs out of the lens unless it asks for them', () => {
    const source = index();
    const lens: BidsLens = { id: 'x', label: 'Run', predicate: { op: 'runs', ids: [SELECTED] } };
    const asked: BidsLens = { id: 'y', label: 'Excluded', predicate: { op: 'excluded' } };
    const exclusions = [exclusion(SELECTED)];
    expect(deriveBidsModel(source, { lens, exclusions }).lens.runs).toHaveLength(0);
    expect(deriveBidsModel(source, { lens: asked, exclusions }).lens.runs).toHaveLength(1);
  });

  it('every summary claim is a lens that selects runs', () => {
    const source = index();
    const model = deriveBidsModel(source);
    const claims = model.summary.segments.flatMap((s) => (s.kind === 'claim' ? [s] : []));
    expect(claims.map((c) => c.id.split(':')[0])).toEqual([
      'all',
      'no-session',
      'variant',
      'errors',
      'content',
      'fd',
      'tsnr',
      'new',
    ]);
    for (const claim of claims) {
      const lens = JSON.parse(JSON.stringify(claim.lens)) as BidsLens;
      expect(deriveBidsModel(source, { lens }).lens.runs.length).toBeGreaterThan(0);
    }
  });
});

describe('summary', () => {
  it('says when other variants sit behind the largest claim', () => {
    const base = index();
    const wide = deriveBidsModel(base, { exclusions: [] }).variants[0];
    const rest = { ...base, runs: base.runs.filter((run) => !wide.runIds.includes(run.id)) };
    const text = claimText(deriveBidsModel(rest, { exclusions: [] }));
    expect(text).toContain('from the series modal, and 2 other acquisition variants.');
  });

  it('generates the sentence from the data', () => {
    const text = claimText(deriveBidsModel(index(), { exclusions: [] }));
    expect(text).toContain('Working memory and reward.');
    expect(text).toMatch(/40 participants \(\d+ control, \d+ patient; age \d+–\d+, median [\d.]+\) scanned in 2 sessions on a Siemens Prisma 3T\./);
    expect(text).toContain('5 have no second session.');
    expect(text).toContain('9 second sessions used a different protocol.');
    expect(text).toContain('2 errors and 3 runs have content problems.');
    expect(text).toMatch(/\d+ participants have runs over mean FD \[thr\] \(\d+ acquisition groups; FD is not directly comparable across them\)\./);
    expect(text).toContain('Since 28 Oct: 3 new participants, not yet processed by fMRIPrep.');
  });

  it('omits a claim when its data is absent and writes no fake text', () => {
    const source: BidsBrowserIndex = {
      ...index(),
      name: '',
      scanner: null,
      participants: [],
      participant_columns: [],
      new_subjects: [],
      variants: [],
      findings: [],
      derivative_status: [],
      derivatives: [],
      runs: index().runs.map((run) => ({ ...run, fd: null, iqms: null })),
    };
    const model = deriveBidsModel(source);
    const text = claimText(model);
    expect(text).not.toContain('scanner');
    expect(text).not.toContain('protocol');
    expect(text).not.toContain('FD');
    expect(text).not.toContain('age');
    expect(text).not.toContain('Since');
    expect(model.summary.segments.some((s) => s.kind === 'threshold')).toBe(false);
    expect(model.groups).toHaveLength(0);
  });

  it('says so far while reading, and leaves unread rows empty', () => {
    const dataset = createBidsBrowserDataset();
    const partial = dataset.partial('scan', 12);
    const streaming = deriveBidsModel(
      { ...partial, subjects: partial.subjects.slice(0, 12) },
      { progress: dataset.progress('scan')[11] },
    );
    expect(streaming.partial).toBe(true);
    expect(streaming.pendingRows).toBe(28);
    expect(streaming.participants).toMatchObject({ read: 12, expected: 40 });
    expect(streaming.columnTotalOf).toBe(12);
    expect(streaming.status.soFar).toBe(true);
    const text = claimText(streaming);
    expect(text).toContain('Reading… 12 of 40 participants so far');
    expect(text).toContain('nothing is final until the scan completes');

    const paused = deriveBidsModel(partial);
    expect(paused.pendingRows).toBe(0);
    expect(paused.rows).toHaveLength(40);
    expect(paused.participants).toMatchObject({ read: 12, expected: 40 });
    const unread = paused.rows.filter((row) => row.unread);
    expect(unread).toHaveLength(28);
    const cells = paused.cells.slice(
      unread[0].index * paused.columns.length,
      (unread[0].index + 1) * paused.columns.length,
    );
    expect(cells.every((cell) => cell.mark === 'unread')).toBe(true);
    expect(claimText(paused)).toContain('Scan paused at 12 of 40 participants so far');
  });
});

describe('exports', () => {
  it('writes a data-descriptor paragraph from the model', () => {
    const paragraph = buildDataDescriptor(deriveBidsModel(index(), { exclusions: [exclusion(SELECTED)] }));
    expect(paragraph).toMatch(/^The dataset comprises 40 participants/);
    expect(paragraph).toContain('BIDS 1.9.0 (dataset version 1.2.0)');
    expect(paragraph).toContain('Parkes et al. 2018, stringent');
    expect(paragraph).toContain('1 run was excluded and does not count toward session means.');
    expect(paragraph).not.toContain('undefined');
  });

  it('writes a CuBIDS-style table with modal and variant groups', () => {
    const lines = buildCubidsTable(deriveBidsModel(index())).split('\n');
    expect(lines[0]).toBe('series\tgroup\tname\tdifference\tparticipants\truns\tnote');
    expect(lines.some((line) => line.startsWith('task-nback_bold\tmodal\t'))).toBe(true);
    expect(lines.some((line) => line.startsWith('task-nback_bold\tA\t'))).toBe(true);
    expect(lines.some((line) => line.startsWith('T1w\tA\t'))).toBe(true);
  });
});

describe('nextRunId', () => {
  it('moves by rows and columns and skips missing cells', () => {
    const model = deriveBidsModel(index());
    expect(nextRunId(model, null, 'down')).toBe(model.cells.find((c) => c.runId)!.runId);
    const row = model.runPosition.get(SELECTED)!;
    const right = nextRunId(model, SELECTED, 'right')!;
    expect(model.runPosition.get(right)!.row).toBe(row.row);
    expect(model.runPosition.get(right)!.col).toBeGreaterThan(row.col);
    const down = nextRunId(model, SELECTED, 'down')!;
    expect(model.runPosition.get(down)!.col).toBe(row.col);
    expect(model.runPosition.get(down)!.row).toBeGreaterThan(row.row);
    expect(nextRunId(model, down, 'up')).toBe(SELECTED);
  });

  it('stays put at the edge', () => {
    const model = deriveBidsModel(index());
    const first = model.cells.find((c) => c.runId)!.runId!;
    expect(nextRunId(model, first, 'up')).toBe(first);
    expect(nextRunId(model, first, 'left')).toBe(first);
  });

  it('names runs with the entities people read', () => {
    const model = deriveBidsModel(index());
    expect(runLabel(model.runsById.get(SELECTED)!.run)).toBe('sub-33 ses-02 nback run-1');
  });
});

describe('real datasets', () => {
  const bold = (run: BidsRunRecord, tr: number): BidsRunRecord => ({
    ...run,
    sidecar: [
      ...run.sidecar.filter((entry) => entry.key !== 'RepetitionTime' && entry.key !== 'MultibandAccelerationFactor'),
      { key: 'RepetitionTime', value: String(tr), source: 'x', source_kind: 'dataset' },
    ],
  });
  const text = (model: BidsModel) =>
    model.summary.segments
      .map((segment) => ('text' in segment ? segment.text : ''))
      .join('');

  it('does not double the period of a name that ends in one', () => {
    const model = deriveBidsModel({ ...index(), name: 'A test-retest dataset.' });
    expect(text(model)).toContain('A test-retest dataset. ');
    expect(text(model)).not.toContain('. .');
  });

  it('keeps dots solid when every session mixes the same TRs', () => {
    const data = index();
    const runs = data.runs.map((run) =>
      run.suffix === 'bold' ? bold({ ...run, session: 'test' }, run.task === 'rest' ? 5 : 2.5) : run,
    );
    const model = deriveBidsModel({ ...data, runs, variants: [] });
    const dots = model.rows.flatMap((row) => row.sessionFd);
    expect(model.fdGroups.length).toBe(2);
    expect(dots.filter((dot) => dot.mean !== null && dot.hollow)).toEqual([]);
    expect(model.fdHollow).toBeNull();
  });

  it('marks only the session built from other acquisitions', () => {
    const model = deriveBidsModel(index());
    const dots = model.rows.flatMap((row) => row.sessionFd).filter((dot) => dot.mean !== null);
    expect(dots.some((dot) => dot.hollow)).toBe(true);
    expect(dots.filter((dot) => dot.hollow).length).toBeLessThan(dots.length / 2);
    expect(model.fdHollow?.others).toEqual(['TR 1.0 s / MB 4']);
  });

  it('does not call a named session second, and says what differs', () => {
    const data = index();
    const name = (session: string | null) => (session === '01' ? 'test' : 'retest');
    const runs = data.runs.map((run) => ({ ...run, session: name(run.session) }));
    const model = deriveBidsModel({ ...data, runs });
    expect(model.sessionsOrdered).toBe(false);
    expect(text(model)).not.toContain('second session');
    expect(text(model)).toMatch(/\d+ runs in \d+ participants differ from the series modal/);
    expect(text(model)).toMatch(/have no ses-/);
  });

  it('orders sessions as the dataset says', () => {
    const data = index();
    const runs = data.runs.map((run) => ({ ...run, session: run.session === '01' ? 'test' : 'retest' }));
    const model = deriveBidsModel({ ...data, runs, session_order: ['test', 'retest'] });
    expect(model.sessions).toEqual(['test', 'retest']);
    expect(model.sessionsOrdered).toBe(true);
    expect(model.columns[0].session).toBe('test');
    expect(text(model)).toContain('have no second session');
  });

  describe('session ordinals', () => {
    const withSessions = (rename: (session: string | null) => string | null, order: string[] = []) => {
      const data = index();
      return deriveBidsModel({
        ...data,
        runs: data.runs.map((run) => ({ ...run, session: rename(run.session) })),
        session_order: order,
      });
    };
    /** Half the subjects lose their first session, half their second. */
    const absent = (model: BidsModel) => text(model).match(/have no [^.]+\./g) ?? [];

    it('does not count a run with no session among the ranks', () => {
      const data = index();
      const runs = data.runs.map((run, position) =>
        position === 0 ? { ...run, session: null } : { ...run, session: run.session === '01' ? '1' : '2' },
      );
      const model = deriveBidsModel({ ...data, runs });
      expect(model.sessions[0]).toBeNull();
      expect(text(model)).toContain('have no second session');
      expect(text(model)).not.toContain('third session');
    });

    it('gives numbers an ordinal only when they run from 1 without a gap', () => {
      const gapped = withSessions((session) => (session === '01' ? '2' : '5'));
      expect(gapped.sessionsOrdered).toBe(true);
      expect(absent(gapped).join()).toContain('have no ses-5');
      expect(text(gapped)).not.toContain('second session');
    });

    it('gives an undated session after the dated ones no ordinal', () => {
      const model = withSessions((session) => (session === '01' ? 'base' : 'late'), ['base']);
      expect(model.sessions).toEqual(['base', 'late']);
      expect(text(model)).toContain('have no ses-late');
      expect(text(model)).not.toContain('second session');
    });
  });

  describe('TR', () => {
    const withTr = (values: number[]) => {
      const data = index();
      let next = 0;
      return {
        ...data,
        runs: data.runs.map((run) =>
          run.suffix === 'bold'
            ? {
                ...run,
                sidecar: [
                  ...run.sidecar.filter((entry) => entry.key !== 'RepetitionTime'),
                  {
                    key: 'RepetitionTime',
                    value: String(values[next++ % values.length]),
                    source: 'x.json',
                    source_kind: 'dataset',
                  },
                ],
              }
            : run,
        ),
      };
    };

    it('keeps noise in a TR out of the FD groups and prints 0.72 as 0.72', () => {
      const model = deriveBidsModel(withTr([0.72, 0.72000002, 0.7200001]));
      expect(model.fdGroups.filter((group) => group.tr === 0.72)).toHaveLength(
        new Set(model.fdGroups.filter((group) => group.tr === 0.72).map((group) => group.multiband)).size,
      );
      expect(model.runs.find((item) => item.tr !== null)?.tr).toBe(0.72);
      const paragraph = buildDataDescriptor(deriveBidsModel(withTr([0.72, 1.5])));
      expect(paragraph).toContain('TR 0.72 s');
      expect(paragraph).toContain('TR 1.5 s');
    });

    it('counts the echoes of a run once in the modal group', () => {
      const data = index();
      const bold = data.runs.filter((run) => run.suffix === 'bold' && run.fd);
      const fast = bold[0];
      const trOf = (run: (typeof bold)[number], tr: number) => ({
        ...run,
        sidecar: [
          ...run.sidecar.filter((entry) => entry.key !== 'RepetitionTime'),
          { key: 'RepetitionTime', value: String(tr), source: 'x', source_kind: 'dataset' },
        ],
      });
      // One multi-echo run at TR 3 against two single-echo runs at TR 2.
      const echoes = [1, 2, 3, 4, 5].map((echo) => ({
        ...trOf(fast, 3),
        id: fast.id.replace(/_bold$/, `_echo-${echo}_bold`),
      }));
      const singles = [trOf(bold[1], 2), trOf(bold[2], 2)];
      const model = deriveBidsModel({ ...data, runs: [...echoes, ...singles], variants: [] });
      expect(model.fdGroups[0]).toMatchObject({ tr: 2, runs: 2, modal: true });
      expect(model.fdGroups[1]).toMatchObject({ tr: 3, runs: 1 });
    });
  });

  describe('the data descriptor', () => {
    it('says 1 participant', () => {
      const data = index();
      const runs = data.runs.filter((run) => run.subject === data.runs[0].subject);
      const paragraph = buildDataDescriptor(
        deriveBidsModel({ ...data, runs, subjects: [runs[0].subject], variants: [] }),
      );
      expect(paragraph).toMatch(/^The dataset comprises 1 participant[ ,(]/);
    });

    it('names both denominators, so the image count and the FD count do not conflict', () => {
      const model = deriveBidsModel(index());
      const paragraph = buildDataDescriptor(model);
      const live = model.runs.filter((item) => !item.excluded);
      const bold = live.filter((item) => item.run.suffix === 'bold').length;
      expect(paragraph).toContain(`It holds ${live.length} image files across`);
      expect(paragraph).toContain(`including ${bold} functional runs`);
      expect(paragraph).toMatch(/of \d+ functional runs( with FD)?/);
      expect(paragraph).not.toMatch(/\d+ runs exceeded/);
    });
  });

  it('does not call a participant with no images here new', () => {
    const data = index();
    const real = data.subjects[0];
    const listed = { ...data, subjects: [...data.subjects, '99'], previous_scan_at: '2026-01-02T00:00:00Z' };
    const only = deriveBidsModel({ ...listed, new_subjects: ['99'] });
    expect(text(only)).not.toMatch(/new participant/);
    const both = deriveBidsModel({ ...listed, new_subjects: ['99', real] }, {
      lens: { id: 'new', label: 'new', predicate: { op: 'new' } },
    });
    expect(text(both)).toContain('1 new participant');
    expect(both.lens.participants).toBe(1);
  });

  it('states listed participants without images once and does not count them', () => {
    const data = index();
    const model = deriveBidsModel({ ...data, subjects: [...data.subjects, '98', '99'] });
    expect(model.participants).toMatchObject({ noLocalData: 2, read: 40 });
    expect(model.rows.some((row) => row.subject === '99')).toBe(false);
    expect(model.columnTotalOf).toBe(40);
    expect(text(model)).toContain('2 more are listed in participants.tsv with no images here.');
  });

  it('never reports content as missing from an incomplete remote listing', () => {
    const data = index();
    const kept = data.runs.filter((run) => Number(run.subject) % 2 === 0);
    const model = deriveBidsModel({ ...data, is_remote: true, listing_complete: false, runs: kept });
    expect(model.absenceKnown).toBe(false);
    expect(model.cells.some((cell) => cell.mark === 'missing')).toBe(false);
    expect(model.cells.some((cell) => cell.mark === 'unknown')).toBe(true);
    expect(text(model)).not.toContain('have no second session');
    expect(text(model)).toContain('nothing here says a file is missing');
    expect(model.rows.every((row) => Object.keys(row.derivatives).length === 0)).toBe(true);
  });

  it('treats absence as real once the server walk finished', () => {
    const data = index();
    const kept = data.runs.filter((run) => Number(run.subject) % 2 === 0);
    const remote = deriveBidsModel({ ...data, is_remote: true, listing_complete: true, runs: kept });
    const local = deriveBidsModel({ ...data, is_remote: false, listing_complete: true, runs: kept });
    expect(remote.absenceKnown).toBe(true);
    expect(remote.cells.some((cell) => cell.mark === 'unknown')).toBe(false);
    expect(remote.cells.map((cell) => cell.mark)).toEqual(local.cells.map((cell) => cell.mark));
    expect(remote.rows.some((row) => Object.keys(row.derivatives).length > 0)).toBe(true);
    expect(text(remote)).not.toContain('nothing here says a file is missing');
  });

  it('counts validator errors by file, on their runs', () => {
    const data = index();
    const run = data.runs[0];
    const finding = (id: string, file: string) => ({
      id,
      tag: 'validator',
      severity: 'error',
      code: 'x',
      title: 'Bad',
      detail: '',
      subject: run.subject,
      session: null,
      run_ids: [run.id],
      file,
    });
    const model = deriveBidsModel({ ...data, findings: [finding('a', 'f.nii'), finding('b', 'f.nii')] });
    expect(text(model)).toContain('1 file fails validation');
    expect(cellOf(model, run.id).mark).toBe('error');
    const claim = model.summary.segments.find((segment) => segment.kind === 'claim' && segment.id === 'errors');
    const lensed = deriveBidsModel(
      { ...data, findings: [finding('a', 'f.nii'), finding('b', 'f.nii')] },
      { lens: (claim as { lens: BidsLens }).lens },
    );
    expect(lensed.lens.runs.map((item) => item.run.id)).toEqual([run.id]);
  });

  it('counts the echoes of one run once', () => {
    const data = index();
    const base = data.runs.find((run) => run.suffix === 'bold' && (run.fd?.mean ?? 0) > 0.25)!;
    const echoes = [1, 2, 3].map((echo) => ({
      ...base,
      id: base.id.replace('_bold', `_echo-${echo}_bold`),
      series: `${base.series}_echo-${echo}`,
    }));
    const model = deriveBidsModel({
      ...data,
      runs: [...data.runs.filter((run) => run.id !== base.id), ...echoes],
    });
    const items = model.findings.groups.find((item) => item.id === 'quality')!.items;
    const own = items.find(
      (item) => item.kind === 'fd' && item.runIds.some((id) => id.startsWith(base.id.split('_bold')[0])),
    )!;
    expect(own.runIds.filter((id) => id.includes('_echo-'))).toHaveLength(1);
  });

  it('cites Parkes only at the default and reports FD by group', () => {
    const data = index();
    expect(buildDataDescriptor(deriveBidsModel(data))).toContain('Parkes et al. 2018');
    const edited = buildDataDescriptor(deriveBidsModel(data, { fdThreshold: 0.4 }));
    expect(edited).not.toContain('Parkes');
    expect(edited).toMatch(/runs at TR 1\.0 s \/ MB 4/);
    expect(edited).toContain('not directly comparable');
    expect(edited).not.toContain('reads lower');
  });

  it('names a mixed FD source on a quality item and caveats pooled groups', () => {
    const model = deriveBidsModel(index());
    const quality = model.findings.groups.find((item) => item.id === 'quality')!.items;
    expect(quality.filter((item) => item.kind === 'fd').every((item) => item.source)).toBe(true);
  });

  it('leaves excluded runs out of the content-problem claim', () => {
    const data = index();
    const finding = data.findings.find((item) => item.tag === 'content' && item.severity === 'warning' && item.run_ids.length === 1)!;
    const before = text(deriveBidsModel(data, { exclusions: [] }));
    const after = text(deriveBidsModel(data, { exclusions: [exclusion(finding.run_ids[0])] }));
    expect(after).not.toBe(before);
  });

  it('reads as complete on a finished scan', () => {
    const data = { ...index(), files_read: 679, total_file_count: 679 };
    expect(deriveBidsModel(data).status).toMatchObject({ filesRead: 679, filesTotal: 679 });
  });
});

describe('tSNR outliers (relative rule)', () => {
  const series = (values: number[]) => {
    const source = index();
    const series = source.runs.find((run) => run.suffix === 'bold')!.series;
    const bold = source.runs.filter((run) => run.series === series).slice(0, values.length);
    expect(bold).toHaveLength(values.length);
    for (const run of source.runs) if (run.iqms) run.iqms = { ...run.iqms, tsnr: null };
    bold.forEach((run, i) => {
      run.iqms = { source: 'mriqc 24.0.2', tsnr: values[i], fd_mean: null, gsr_y: null } as never;
    });
    return { source, ids: bold.map((run) => run.id) };
  };
  const tsnrItems = (model: ReturnType<typeof deriveBidsModel>) =>
    group(model, 'quality').items.filter((item) => item.kind === 'tsnr');

  it('computes median minus 2.5 robust SD, with MAD × 1.4826', () => {
    // Median 50; deviations 0..3 and 30: MAD 2, robust SD 2.9652, cut 42.587.
    expect(tsnrCut([47, 48, 49, 50, 50, 51, 52, 53, 20])!.median).toBe(50);
    expect(tsnrCut([47, 48, 49, 50, 50, 51, 52, 53, 20])!.cut).toBeCloseTo(50 - 2.5 * 2 * 1.4826, 6);
  });

  it('takes no view below 8 runs or without spread', () => {
    expect(tsnrCut([50, 50, 51, 52, 53, 49, 3])).toBeNull();
    expect(tsnrCut(new Array(9).fill(50))).toBeNull();
  });

  it('flags only the run below the cut, whatever the absolute level', () => {
    // A TR 1 s sequence: every run under 40, one truly apart from its series.
    const { source, ids } = series([30, 31, 32, 33, 33, 34, 35, 36, 12]);
    const model = deriveBidsModel(source);
    const outliers = model.runs.filter((item) => item.tsnrOutlier).map((item) => item.run.id);
    expect(outliers).toEqual([ids[8]]);
    const [item] = tsnrItems(model);
    expect(item.lens && model.findings.total).toBeGreaterThan(0);
    expect(item.source).toContain('series median − 2.5 robust SD');
    expect(item.detail).toContain('median 33 over 9 runs');
  });

  it('gives no finding at all under 8 runs, however low', () => {
    const { source } = series([3, 4, 5, 6, 7, 8, 9]);
    const model = deriveBidsModel(source);
    expect(tsnrItems(model)).toEqual([]);
    expect(model.summary.segments.some((s) => s.kind === 'claim' && s.id.startsWith('tsnr'))).toBe(false);
  });

  it('the summary claim, the lens and the exclusion criterion agree', () => {
    const { source, ids } = series([30, 31, 32, 33, 33, 34, 35, 36, 12]);
    const model = deriveBidsModel(source);
    const claim = model.summary.segments.find((s) => s.kind === 'claim' && s.id.startsWith('tsnr'));
    expect(claim).toMatchObject({ text: '1 run is a tSNR outlier for its series' });
    const lensed = deriveBidsModel(source, { lens: claim && 'lens' in claim ? claim.lens : null });
    expect(lensed.lens.runs.map((item) => item.run.id)).toEqual([ids[8]]);
    const facts = model.runsById.get(ids[8])!;
    const criterion = criteriaOf(facts, model, null).find((c) => c.id === 'tsnr')!;
    expect(criterion.criterion).toBe('tsnr<series_median-2.5rsd');
    expect(criterion.definition).toBe('series median − 2.5 robust SD (MAD × 1.4826)');
    expect(criterion.triggered).toBe(true);
    expect(criteriaOf(model.runsById.get(ids[0])!, model, null).some((c) => c.id === 'tsnr')).toBe(false);
  });
});

describe('tSNR groups: a change of protocol within a series', () => {
  const setProtocol = (run: BidsRunRecord, tr: number, multiband: number, tsnr: number) => {
    run.sidecar = [
      ...run.sidecar.filter((entry) => !['RepetitionTime', 'MultibandAccelerationFactor'].includes(entry.key)),
      { key: 'RepetitionTime', value: String(tr) },
      { key: 'MultibandAccelerationFactor', value: String(multiband) },
    ] as never;
    run.iqms = { source: 'mriqc 24.0.2', tsnr, fd_mean: null, gsr_y: null } as never;
  };
  const protocols = (groups: { tr: number; multiband: number; values: number[] }[]) => {
    const source = index();
    const name = source.runs.find((run) => run.suffix === 'bold')!.series;
    const bold = source.runs.filter((run) => run.series === name);
    for (const run of source.runs) if (run.iqms) run.iqms = { ...run.iqms, tsnr: null };
    let next = 0;
    const ids = groups.map(({ tr, multiband, values }) =>
      values.map((value) => {
        const run = bold[next++];
        setProtocol(run, tr, multiband, value);
        return run.id;
      }),
    );
    source.variants = [];
    return { source, ids };
  };
  const outliers = (model: BidsModel) => model.runs.filter((item) => item.tsnrOutlier).map((item) => item.run.id);
  const modal = [60, 61, 62, 63, 63, 64, 65, 66, 60, 61, 62, 63];

  it('does not flag a minority protocol wholesale for its lower tSNR', () => {
    const { source } = protocols([
      { tr: 2, multiband: 1, values: modal },
      { tr: 0.8, multiband: 6, values: [30, 31, 32, 33] },
    ]);
    expect(outliers(deriveBidsModel(source))).toEqual([]);
  });

  it('does not hide a true outlier behind the spread of two protocols', () => {
    const { source, ids } = protocols([
      { tr: 2, multiband: 1, values: [60, 61, 62, 63, 63, 64, 65, 66, 61] },
      { tr: 2, multiband: 4, values: [30, 31, 32, 33, 33, 34, 35, 36, 12] },
    ]);
    const model = deriveBidsModel(source);
    expect(outliers(model)).toEqual([ids[1][8]]);
    const item = group(model, 'quality').items.find((entry) => entry.kind === 'tsnr')!;
    expect(item.detail).toContain('TR 2.0 s / MB 4: median 33 over 9 runs');
  });

  it('keeps the minimum of 8 runs per group, not per series', () => {
    const { source } = protocols([
      { tr: 2, multiband: 1, values: [60, 61, 62, 63, 64, 65, 66] },
      { tr: 0.8, multiband: 6, values: [30, 31, 32, 33, 34, 35, 3] },
    ]);
    expect(outliers(deriveBidsModel(source))).toEqual([]);
  });

  it('names a declared variant, and keeps its runs out of the modal group', () => {
    const { source, ids } = protocols([
      { tr: 2, multiband: 1, values: modal },
      { tr: 2, multiband: 1, values: [30, 31, 32, 33, 33, 34, 35, 36, 12] },
    ]);
    const name = source.runs.find((run) => run.id === ids[1][0])!.series;
    source.variants = [
      { id: 'v', series: name, name: 'Long TE', diff: 'TE 45 ms', note: '', run_ids: ids[1] } as never,
    ];
    const model = deriveBidsModel(source);
    expect(outliers(model)).toEqual([ids[1][8]]);
    expect(group(model, 'quality').items.find((entry) => entry.kind === 'tsnr')!.detail).toContain('Long TE: median 33');
  });
});

describe('an echoed run is one run', () => {
  /** Nine runs of three echoes, each echo at its own level. */
  const echoed = (low: { run: number; echo: number } | null) => {
    const source = index();
    const base = source.runs.find((run) => run.suffix === 'bold')!;
    const runs: BidsRunRecord[] = [];
    for (let run = 1; run <= 9; run += 1) {
      for (let echo = 1; echo <= 3; echo += 1) {
        const level = 80 - 20 * echo + [0, 1, 2, 3, 3, 4, 5, 6, 7][run - 1];
        const hit = low?.run === run && low.echo === echo;
        runs.push({
          ...base,
          id: `sub-01_task-me_run-${run}_echo-${echo}_bold`,
          subject: '01',
          session: null,
          task: 'me',
          run: String(run),
          echo: String(echo),
          series: 'task-me_bold',
          iqms: { source: 'mriqc', tsnr: hit ? level - 25 : level, fd_mean: null, gsr_y: null },
        } as never);
      }
    }
    for (const run of source.runs) if (run.iqms) run.iqms = { ...run.iqms, tsnr: null };
    source.runs.push(...runs);
    return source;
  };
  const items = (model: BidsModel) => group(model, 'quality').items.filter((item) => item.kind === 'tsnr');
  const claim = (model: BidsModel) =>
    model.summary.segments.find((s) => s.kind === 'claim' && s.id.startsWith('tsnr'));

  it('flags no echo for being a later echo', () => {
    const model = deriveBidsModel(echoed(null));
    expect(model.runs.filter((item) => item.tsnrOutlier)).toEqual([]);
    expect(claim(model)).toBeUndefined();
  });

  it('Findings and the summary count a run low in its second echo alike', () => {
    const model = deriveBidsModel(echoed({ run: 4, echo: 2 }));
    expect(model.runs.filter((item) => item.tsnrOutlier).map((item) => item.run.id)).toEqual([
      'sub-01_task-me_run-4_echo-2_bold',
    ]);
    const [item] = items(model);
    expect(item.n).toBe(1);
    expect(item.of).toBe(9);
    expect(item.runIds).toEqual(['sub-01_task-me_run-4_echo-2_bold']);
    expect(item.detail).toContain('echo-2');
    expect(claim(model)).toMatchObject({ text: '1 run is a tSNR outlier for its series' });
  });

  it('counts one run however many echoes are low, and names each', () => {
    const source = echoed({ run: 4, echo: 2 });
    const third = source.runs.find((run) => run.id === 'sub-01_task-me_run-4_echo-3_bold')!;
    third.iqms = { ...third.iqms!, tsnr: 5 };
    const model = deriveBidsModel(source);
    const [item] = items(model);
    expect(item.n).toBe(1);
    expect(item.runIds).toHaveLength(2);
    expect(item.detail).toContain('echo-2');
    expect(item.detail).toContain('echo-3');
    expect(claim(model)).toMatchObject({ text: '1 run is a tSNR outlier for its series' });
  });

  it('the dock counts and the descriptor agree', () => {
    const model = deriveBidsModel(echoed(null));
    const added = model.runs.filter((item) => item.run.task === 'me');
    expect(added).toHaveLength(27);
    expect(model.lens.bold.filter((item) => item.run.task === 'me')).toHaveLength(9);
    expect(model.lens.tasks.find((entry) => entry.task === 'me')?.runs).toBe(9);
    expect(buildDataDescriptor(model)).toContain(`including ${model.lens.ofBold} functional runs (echoes of a run counted once)`);
  });

  it('the lens export says it holds every file, which the dock does not list', () => {
    const model = deriveBidsModel(echoed(null));
    expect(buildLensExport(model).split('\n')).toHaveLength(model.lens.runs.length + 1);
    expect(lensExportLabel(model)).toBe(`Lens list: ${model.lens.runs.length} files, ${model.lens.bold.length} BOLD runs`);
  });
});

describe('findings by rule', () => {
  it('holds every item once, one line per rule, with a lens over all its runs', () => {
    const model = deriveBidsModel(index());
    const quality = group(model, 'quality');
    expect(quality.rules.flatMap((rule) => rule.items)).toHaveLength(quality.items.length);
    const fd = quality.rules.find((rule) => rule.items[0].kind === 'fd')!;
    expect(fd.title).toBe('Mean FD over 0.25 mm');
    expect(fd.items.length).toBeGreaterThan(1);
    const lensed = deriveBidsModel(index(), { lens: fd.lens });
    const expected = new Set(fd.items.flatMap((item) => deriveBidsModel(index(), { lens: item.lens }).lens.runs.map((run) => run.run.id)));
    expect(new Set(lensed.lens.runs.map((run) => run.run.id))).toEqual(expected);
    expect(fd.items[0].value).toMatch(/^\d\.\d\d$/);
  });

  it('does not change the one count', () => {
    const model = deriveBidsModel(index());
    expect(model.status.findings).toBe(model.findings.total);
    expect(model.findings.groups.flatMap((g) => (g.id === 'saved' || g.id === 'excluded' ? [] : g.items))).toHaveLength(model.findings.total);
  });
});
