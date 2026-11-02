import { describe, expect, it } from 'vitest';
import { apiBridgeCommands } from '@brainflow/api';
import { createBackend } from '../backend';
import type { HarnessFixtures } from '../fixtures';
import {
  BIDS_BROWSER_ROOT,
  bidsStreamPlan,
  createBidsBrowserDataset,
  installHarnessEventBus,
  streamBidsScan,
  type HarnessEventBus,
} from '../bidsBrowserData';
import { noopUnlisten, safeListen, safeUnlisten } from '@/utils/eventUtils';

const fixtures = { mni: null, stats: null, surface: null } as unknown as HarnessFixtures;

describe('harness BIDS browser dataset', () => {
  const index = createBidsBrowserDataset().index('s');

  it('is deterministic', () => {
    expect(JSON.stringify(createBidsBrowserDataset().index('s'))).toBe(JSON.stringify(index));
  });

  it('has the mock participants, cohort and missing cells', () => {
    expect(index.subjects).toHaveLength(40);
    expect(index.participants).toHaveLength(40);
    expect(index.new_subjects).toEqual(['38', '39', '40']);
    const hasRun = (id: string) => index.runs.some((run) => run.id === id);
    for (const n of ['11', '26', '31', '37', '38']) expect(index.runs.some((r) => r.subject === n && r.session === '02')).toBe(false);
    expect(hasRun('sub-22_ses-01_T2w')).toBe(false);
    expect(hasRun('sub-34_ses-02_task-mid_run-2_bold')).toBe(false);
    expect(hasRun('sub-09_ses-01_task-rest_run-2_bold')).toBe(true);
    expect(new Set(index.runs.map((run) => run.id)).size).toBe(index.runs.length);
  });

  it('exercises every finding, variant and derivative state', () => {
    expect(new Set(index.findings.map((f) => f.tag))).toEqual(new Set(['validator', 'content', 'note']));
    expect(new Set(index.findings.map((f) => f.severity))).toEqual(new Set(['error', 'warning', 'info']));
    expect(index.findings.map((f) => f.code)).toEqual(
      expect.arrayContaining(['DWI_MISSING_BVEC', 'INTENDEDFOR_BROKEN', 'TRUNCATED_RUN', 'EVENTS_AFTER_SCAN', 'SLICE_TIMING_MISSING', 'EXTRA_RUN']),
    );
    for (const finding of index.findings) {
      for (const id of finding.run_ids) expect(index.runs.some((run) => run.id === id), id).toBe(true);
    }
    expect(new Set(index.derivative_status.map((s) => s.status))).toEqual(new Set(['current', 'partial', 'missing', 'stale']));
    const upgrade = index.variants.filter((v) => v.keys.includes('RepetitionTime'));
    expect(upgrade.map((v) => v.series)).toEqual(['task-mid_bold', 'task-nback_bold', 'task-rest_bold']);
    expect(index.variants.some((v) => v.keys.includes('PhaseEncodingDirection'))).toBe(true);
    expect(index.variants.some((v) => v.series === 'T1w')).toBe(true);
    for (const group of index.variants) {
      for (const id of group.run_ids) expect(index.runs.find((run) => run.id === id)?.variant_id).toBe(group.id);
    }
    expect(index.exclusions).toHaveLength(1);
  });

  it('keeps the FD mean equal to the mean of the drawn trace', () => {
    const dataset = createBidsBrowserDataset();
    const run = index.runs.find((r) => r.id === 'sub-33_ses-02_task-nback_run-1_bold');
    const detail = dataset.detail(run!.id);
    const drawn = detail.fd_trace.filter((value): value is number => value !== null);
    expect(detail.fd_trace[0]).toBeNull();
    expect(detail.fd_trace).toHaveLength(run!.header!.n_volumes!);
    expect(drawn.reduce((a, b) => a + b, 0) / drawn.length).toBeCloseTo(run!.fd!.mean, 6);
    expect(run!.fd!.mean).toBeGreaterThan(0.25);
    expect(run!.fd!.trace).toHaveLength(28);
  });

  it('flags fd over threshold, low tSNR and ghosting like the mock', () => {
    const iqm = (id: string) => index.runs.find((run) => run.id === id)?.iqms;
    expect(iqm('sub-07_ses-01_task-nback_run-1_bold')!.fd_mean).toBeGreaterThan(0.25);
    expect(iqm('sub-14_ses-01_task-rest_run-1_bold')!.tsnr).toBeLessThan(40);
    expect(iqm('sub-05_ses-01_task-nback_run-1_bold')!.gsr_y).toBe(0.21);
  });
});

describe('harness BIDS commands', () => {
  it('covers the command list', () => {
    const { handlers } = createBackend(fixtures);
    const commands = apiBridgeCommands as readonly string[];
    for (const cmd of [
      'scan_bids_browser',
      'cancel_bids_scan',
      'get_bids_run_detail',
      'get_bids_slice',
      'get_bids_median_slice',
      'get_bids_carpet',
      'write_bids_exclusions',
      'revert_bids_exclusions',
    ]) {
      expect(commands).toContain(cmd);
      expect(handlers[cmd], cmd).toBeTypeOf('function');
    }
  });

  it('writes and reverts exclusions and shows them in the next scan', async () => {
    const { handlers } = createBackend(fixtures);
    const row = {
      entity: 'sub-33_ses-02',
      scope: '',
      reason: 'motion',
      criterion: 'mean FD > 0.25 mm',
      value: '0.5',
      author: 'bb',
      date: '2026-11-01',
      source: 'fmriprep 24.1.1 confounds',
      threshold: '0.25',
      definition: 'Power',
      triggered_by: '',
    };
    const context = { source_version: null };
    const written = handlers.write_bids_exclusions({ datasetPath: BIDS_BROWSER_ROOT, rows: [row], context }) as {
      all: Array<{ scope: string }>;
      added: unknown[];
    };
    expect(written.all).toHaveLength(2);
    expect(written.added).toHaveLength(1);
    expect(written.all[1].scope).toBe('session');
    const index = (await handlers.scan_bids_browser({ datasetPath: BIDS_BROWSER_ROOT, scanId: 'a' })) as { exclusions: unknown[] };
    expect(index.exclusions).toHaveLength(2);
    const left = handlers.revert_bids_exclusions({ datasetPath: BIDS_BROWSER_ROOT, keys: [{ entity: 'sub-33_ses-02', criterion: row.criterion }] });
    expect(left).toHaveLength(1);
    expect(() => handlers.write_bids_exclusions({ datasetPath: '/elsewhere', rows: [], context })).toThrow(/Not a BIDS/);
  });

  it('rejects unknown datasets and runs', () => {
    const { handlers } = createBackend(fixtures);
    expect(() => handlers.get_bids_run_detail({ datasetPath: BIDS_BROWSER_ROOT, runId: 'nope' })).toThrow(/Unknown run/);
  });
});

describe('harness BIDS streaming', () => {
  it('parses the scenario flag', () => {
    expect(bidsStreamPlan('')).toBeNull();
    expect(bidsStreamPlan('?bidsStream=120')).toEqual({ delayMs: 120, holdAfter: null });
    expect(bidsStreamPlan('?bidsStream=hold-12')).toEqual({ delayMs: 0, holdAfter: 12 });
    expect(bidsStreamPlan('?bidsStream=later')).toBeNull();
  });

  it('streams every subject and ends with the full index', async () => {
    const dataset = createBidsBrowserDataset();
    const seen: string[] = [];
    const index = await streamBidsScan(dataset, 's', { delayMs: 0, holdAfter: null }, (p) => seen.push(p.subject!), () => false);
    expect(seen).toHaveLength(40);
    expect(index.complete).toBe(true);
  });

  it('holds a partial state until cancelled', async () => {
    const dataset = createBidsBrowserDataset();
    const seen: string[] = [];
    let cancelled = false;
    const index = await streamBidsScan(
      dataset,
      's',
      { delayMs: 0, holdAfter: 12 },
      (p) => seen.push(p.subject!),
      () => cancelled,
      async () => {
        cancelled = true;
      },
    );
    expect(seen).toHaveLength(12);
    expect(index.complete).toBe(false);
    expect(new Set(index.runs.map((run) => run.subject)).size).toBe(12);
    expect(index.subjects).toHaveLength(40);
    const streamed = dataset.progress('s').flatMap((p) => p.runs);
    expect(streamed.every((run) => run.variant_id === null)).toBe(true);
  });

  it('routes safeListen through the harness bus and tears down', async () => {
    const target = window as unknown as { __harnessEvents?: HarnessEventBus };
    const bus = installHarnessEventBus(target);
    const received: unknown[] = [];
    const stop = await safeListen('bids-scan-progress', (event) => received.push(event.payload));
    bus.emit('bids-scan-progress', 1);
    await safeUnlisten(stop);
    bus.emit('bids-scan-progress', 2);
    expect(received).toEqual([1]);
    delete target.__harnessEvents;
    expect(await safeListen('x', () => undefined)).toBeTypeOf('function');
    expect(noopUnlisten()).toBeTypeOf('function');
  });
});
