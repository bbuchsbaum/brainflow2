// Rust fixture tests deferred — backend scan_bids_dataset requires a real BIDS directory.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BIDS_PROGRESS_FLUSH_MS, lastBidsDataset, selectBidsModel, useBidsStore } from '@/stores/bidsStore';
import { getTransport } from '@/services/transport';
import * as eventUtils from '@/utils/eventUtils';
import {
  createBidsBrowserDataset,
  installHarnessEventBus,
  type HarnessEventBus,
} from '@/devHarness/app/bidsBrowserData';
import type {
  BidsBrowserIndex,
  BidsExclusion,
  BidsExclusionKey,
  BidsExclusionWrite,
  BidsRunDetail,
} from '@brainflow/api';
import type { MockTransport } from '@/services/transport';
import type { BidsDatasetSummary } from '@/stores/bidsStore';

// The global test-setup (test-setup.ts) installs a fresh MockTransport before each test
// via setTransport(new MockTransport()). We retrieve it through getTransport() and cast.

function getMockTransport(): MockTransport {
  return getTransport() as MockTransport;
}

function makeSummary(overrides?: Partial<BidsDatasetSummary>): BidsDatasetSummary {
  return {
    path: '/data/ds001',
    name: 'ds001',
    bids_version: '1.7.0',
    license: null,
    authors: ['Alice'],
    subject_count: 2,
    session_ids: [],
    task_ids: ['rest'],
    modalities: ['func'],
    total_file_count: 10,
    total_size_bytes: 1024,
    coverage: {
      subjects: ['01', '02'],
      columns: [{ session: null, modality: 'bold', suffix: 'bold', task: 'rest', label: 'rest/bold' }],
      cells: [
        [{ present: true, run_count: 1, size_bytes: 512, file_paths: ['/data/ds001/sub-01/func/sub-01_task-rest_bold.nii.gz'] }],
        [{ present: false, run_count: 0, size_bytes: 0, file_paths: [] }],
      ],
    },
    participants: [],
    participant_columns: [],
    task_designs: [],
    validation: { passed: true, critical_count: 0, warning_count: 0, issues: [] },
    storage_by_modality: {},
    ...overrides,
  };
}

describe('bidsStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useBidsStore.getState().reset();
    getMockTransport().clearCallLog();
  });

  it('starts with idle scanStatus, null summary, and empty selection', () => {
    const state = useBidsStore.getState();
    expect(state.scanStatus).toBe('idle');
    expect(state.summary).toBeNull();
    expect(state.scanError).toBeNull();
    expect(state.selection).toEqual({ subjectId: null, sessionId: null, modality: null });
  });

  it('transitions idle → scanning → ready and stores the index on scanDataset success', async () => {
    const index = createBidsBrowserDataset().index('ignored');
    getMockTransport().setMockResponse('scan_bids_browser', index);

    const scanPromise = useBidsStore.getState().scanDataset('/data/ds001');

    // Should be scanning immediately after calling
    expect(useBidsStore.getState().scanStatus).toBe('scanning');

    await scanPromise;

    const state = useBidsStore.getState();
    expect(state.scanStatus).toBe('ready');
    expect(state.index).toBe(index);
    expect(state.exclusions).toEqual(index.exclusions);
    expect(state.scanError).toBeNull();
    expect(state.datasetPath).toBe('/data/ds001');
  });

  it('sets scanStatus to error and records scanError when scanDataset throws', async () => {
    getMockTransport().setMockResponse('scan_bids_browser', () => {
      throw new Error('backend failure');
    });

    await useBidsStore.getState().scanDataset('/data/bad');

    const state = useBidsStore.getState();
    expect(state.scanStatus).toBe('error');
    expect(state.scanError).toBe('backend failure');
    expect(state.index).toBeNull();
  });

  it('updates selection when selectCell is called', () => {
    useBidsStore.getState().selectCell('01', 'ses-01', 'bold');

    const { selection } = useBidsStore.getState();
    expect(selection.subjectId).toBe('01');
    expect(selection.sessionId).toBe('ses-01');
    expect(selection.modality).toBe('bold');
  });

  it('updates activeDetailTab when setDetailTab is called', () => {
    expect(useBidsStore.getState().activeDetailTab).toBe('validation');

    useBidsStore.getState().setDetailTab('events');

    expect(useBidsStore.getState().activeDetailTab).toBe('events');
  });

  it('caches loadEvents results and only calls transport once for the same args', async () => {
    const events = [{ onset: 0, duration: 2, trial_type: 'cond_a', additional: {} }];
    getMockTransport().setMockResponse('get_bids_events', events);

    // Seed dataset path so the store can pass it to the backend
    useBidsStore.setState({ datasetPath: '/data/ds001' });

    await useBidsStore.getState().loadEvents('01', 'rest');
    const logAfterFirst = getMockTransport().getCallLog().filter(c => c.cmd === 'get_bids_events');
    expect(logAfterFirst).toHaveLength(1);

    await useBidsStore.getState().loadEvents('01', 'rest');
    const logAfterSecond = getMockTransport().getCallLog().filter(c => c.cmd === 'get_bids_events');
    // Second call must use the cache — no additional transport invocation
    expect(logAfterSecond).toHaveLength(1);
  });

  it('returns to initial state after reset', () => {
    // Mutate the store
    useBidsStore.getState().selectCell('42', null, 'T1w');
    useBidsStore.getState().setDetailTab('events');
    useBidsStore.setState({ scanStatus: 'ready', summary: makeSummary() });

    useBidsStore.getState().reset();

    const state = useBidsStore.getState();
    expect(state.scanStatus).toBe('idle');
    expect(state.summary).toBeNull();
    expect(state.scanError).toBeNull();
    expect(state.selection).toEqual({ subjectId: null, sessionId: null, modality: null });
    expect(state.activeDetailTab).toBe('validation');
    expect(state.eventsCache.size).toBe(0);
  });
});

describe('browser scan', () => {
  let bus: HarnessEventBus;
  const dataset = createBidsBrowserDataset();
  const PATH = '/data/ds001';

  /** A scan the test finishes by hand. */
  function holdScan() {
    const scans: Array<{ scanId: string; finish: (index: BidsBrowserIndex) => void; fail: (e: Error) => void }> = [];
    getMockTransport().setMockResponse('scan_bids_browser', (args: { scanId: string }) =>
      new Promise<BidsBrowserIndex>((resolve, reject) => {
        scans.push({ scanId: args.scanId, finish: resolve, fail: reject });
      }),
    );
    getMockTransport().setMockResponse('cancel_bids_scan', () => true);
    return scans;
  }
  const progressOf = (scanId: string, step: number) => ({
    ...dataset.progress(scanId)[step],
    scan_id: scanId,
  });
  const running = async (scans: ReturnType<typeof holdScan>, n: number) =>
    vi.waitFor(() => expect(scans).toHaveLength(n));
  const flush = async () => {
    await vi.advanceTimersByTimeAsync(BIDS_PROGRESS_FLUSH_MS + 1);
  };

  beforeEach(() => {
    bus = installHarnessEventBus(window as unknown as { __harnessEvents?: HarnessEventBus });
    useBidsStore.getState().reset();
    getMockTransport().clearCallLog();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { __harnessEvents?: HarnessEventBus }).__harnessEvents;
  });

  it('streams rows as they arrive and says so far until the index lands', async () => {
    const scans = holdScan();
    const scan = useBidsStore.getState().scanDataset(PATH);
    await running(scans, 1);
    vi.useFakeTimers();
    const scanId = scans[0].scanId;

    bus.emit('bids-scan-progress', progressOf(scanId, 0));
    bus.emit('bids-scan-progress', progressOf(scanId, 1));
    await flush();

    let state = useBidsStore.getState();
    expect(state.scanStatus).toBe('scanning');
    expect(state.index?.complete).toBe(false);
    expect(state.index?.subjects).toEqual(['01', '02']);
    let model = selectBidsModel(state);
    expect(model.partial).toBe(true);
    expect(model.participants).toMatchObject({ read: 2, expected: 40 });
    expect(model.pendingRows).toBe(38);
    expect(model.status.soFar).toBe(true);
    expect(
      model.summary.segments.some((s) => s.kind === 'claim' && s.text === '2 of 40 participants'),
    ).toBe(true);

    bus.emit('bids-scan-progress', progressOf(scanId, 2));
    await flush();
    expect(selectBidsModel(useBidsStore.getState()).participants.read).toBe(3);

    vi.useRealTimers();
    scans[0].finish(dataset.index(scanId));
    await scan;
    state = useBidsStore.getState();
    expect(state.scanStatus).toBe('ready');
    expect(state.scanProgress).toBeNull();
    model = selectBidsModel(state);
    expect(model.partial).toBe(false);
    expect(model.pendingRows).toBe(0);
    expect(model.participants.read).toBe(40);
  });

  it('coalesces a burst of progress events into one update', async () => {
    const scans = holdScan();
    void useBidsStore.getState().scanDataset(PATH);
    await running(scans, 1);
    vi.useFakeTimers();
    const updates = vi.fn();
    const stop = useBidsStore.subscribe((state) => state.index, updates);
    for (let step = 0; step < 10; step++) {
      bus.emit('bids-scan-progress', progressOf(scans[0].scanId, step));
    }
    await flush();
    stop();
    expect(updates).toHaveBeenCalledTimes(1);
    expect(useBidsStore.getState().index?.subjects).toHaveLength(10);
  });

  it('ignores progress from another scan id', async () => {
    const scans = holdScan();
    void useBidsStore.getState().scanDataset(PATH);
    await running(scans, 1);
    vi.useFakeTimers();
    bus.emit('bids-scan-progress', progressOf('some-other-scan', 0));
    await flush();
    expect(useBidsStore.getState().index).toBeNull();
  });

  it('rejects a stale scan after a dataset switch, and cancels it', async () => {
    const scans = holdScan();
    const first = useBidsStore.getState().scanDataset('/data/a');
    await running(scans, 1);
    const second = useBidsStore.getState().scanDataset('/data/b');
    await running(scans, 2);
    expect(
      getMockTransport().getCallLog().some((call) => call.cmd === 'cancel_bids_scan'),
    ).toBe(true);

    // The late stale result and a stale event change nothing.
    scans[0].finish({ ...dataset.index(scans[0].scanId), name: 'stale' });
    await first;
    bus.emit('bids-scan-progress', progressOf(scans[0].scanId, 0));
    let state = useBidsStore.getState();
    expect(state.datasetPath).toBe('/data/b');
    expect(state.scanStatus).toBe('scanning');
    expect(state.index).toBeNull();

    scans[1].finish({ ...dataset.index(scans[1].scanId), name: 'current' });
    await second;
    state = useBidsStore.getState();
    expect(state.index?.name).toBe('current');
  });

  it('rejects a stale failure and a result arriving after reset', async () => {
    const scans = holdScan();
    const first = useBidsStore.getState().scanDataset('/data/a');
    await running(scans, 1);
    const second = useBidsStore.getState().scanDataset('/data/b');
    await running(scans, 2);
    scans[0].fail(new Error('superseded'));
    await first;
    expect(useBidsStore.getState().scanError).toBeNull();

    useBidsStore.getState().reset();
    scans[1].finish(dataset.index(scans[1].scanId));
    await second;
    const state = useBidsStore.getState();
    expect(state.scanStatus).toBe('idle');
    expect(state.index).toBeNull();
  });

  it('keeps partial results when paused', async () => {
    const scans = holdScan();
    const scan = useBidsStore.getState().scanDataset(PATH);
    await running(scans, 1);
    await useBidsStore.getState().cancelScan();
    expect(getMockTransport().getCallLog().some((call) => call.cmd === 'cancel_bids_scan')).toBe(true);
    scans[0].finish(dataset.partial(scans[0].scanId, 5));
    await scan;
    const state = useBidsStore.getState();
    expect(state.scanStatus).toBe('ready');
    const model = selectBidsModel(state);
    expect(model.partial).toBe(true);
    expect(model.participants).toMatchObject({ read: 5, expected: 40 });
  });

  it('keeps the rows that arrived when a scan fails midway', async () => {
    const scans = holdScan();
    const scan = useBidsStore.getState().scanDataset(PATH);
    await running(scans, 1);
    bus.emit('bids-scan-progress', progressOf(scans[0].scanId, 0));
    scans[0].fail(new Error('disk gone'));
    await scan;
    const state = useBidsStore.getState();
    expect(state.scanStatus).toBe('error');
    expect(state.index?.runs.length).toBeGreaterThan(0);
  });

  it('drops a run detail that returns after a dataset switch, and caches by run id', async () => {
    getMockTransport().setMockResponse('scan_bids_browser', dataset.index('x'));
    await useBidsStore.getState().scanDataset(PATH);
    const detail = { run_id: 'r1' } as BidsRunDetail;
    let answer: ((value: BidsRunDetail) => void) | null = null;
    getMockTransport().setMockResponse(
      'get_bids_run_detail',
      () => new Promise<BidsRunDetail>((resolve) => (answer = resolve)),
    );
    const stale = useBidsStore.getState().loadRunDetail('r1');
    await useBidsStore.getState().scanDataset('/data/other');
    await vi.waitFor(() => expect(answer).not.toBeNull());
    answer!(detail);
    await expect(stale).resolves.toBeNull();
    expect(useBidsStore.getState().runDetails).toEqual({});

    getMockTransport().setMockResponse('get_bids_run_detail', detail);
    await useBidsStore.getState().loadRunDetail('r1');
    await useBidsStore.getState().loadRunDetail('r1');
    expect(useBidsStore.getState().runDetails.r1).toBe(detail);
    const calls = getMockTransport().getCallLog().filter((c) => c.cmd === 'get_bids_run_detail');
    expect(calls).toHaveLength(2); // one stale, one cached after
  });

  it('saves lenses per dataset path', async () => {
    getMockTransport().setMockResponse('scan_bids_browser', dataset.index('x'));
    await useBidsStore.getState().scanDataset('/data/a');
    useBidsStore.getState().setLens({ id: 'l', label: 'Mine', predicate: { op: 'new' } });
    useBidsStore.getState().saveLens();
    useBidsStore.getState().saveLens();
    expect(useBidsStore.getState().savedLenses).toHaveLength(1);

    await useBidsStore.getState().scanDataset('/data/b');
    expect(useBidsStore.getState().savedLenses).toEqual([]);
    expect(useBidsStore.getState().lens).toBeNull();

    await useBidsStore.getState().scanDataset('/data/a');
    expect(useBidsStore.getState().savedLenses.map((lens) => lens.label)).toEqual(['Mine']);
    useBidsStore.getState().deleteSavedLens('l');
    await useBidsStore.getState().scanDataset('/data/b');
    await useBidsStore.getState().scanDataset('/data/a');
    expect(useBidsStore.getState().savedLenses).toEqual([]);
  });

  it('survives unreadable saved lenses', async () => {
    localStorage.setItem('brainflow.bids.lenses:/data/a', 'not json');
    getMockTransport().setMockResponse('scan_bids_browser', dataset.index('x'));
    await useBidsStore.getState().scanDataset('/data/a');
    expect(useBidsStore.getState().savedLenses).toEqual([]);
  });

  describe('exclusions', () => {
    const row = (entity: string, criterion: string): BidsExclusion => ({
      entity,
      scope: 'run',
      reason: 'r',
      criterion,
      value: '',
      author: 'bb',
      date: 'd',
      source: '',
    });
    const context = { source_version: null };

    /** The bridge's two commands, over a list. */
    function fakeBridge(initial: BidsExclusion[]) {
      let rows = [...initial];
      getMockTransport().setMockResponse('scan_bids_browser', {
        ...dataset.index('x'),
        exclusions: rows,
      });
      getMockTransport().setMockResponse('read_bids_exclusions', () => rows);
      getMockTransport().setMockResponse('write_bids_exclusions', (args: { rows: BidsExclusion[] }) => {
        const added = args.rows.filter(
          (item) => !rows.some((old) => old.entity === item.entity && old.criterion === item.criterion),
        );
        rows = [...rows, ...added];
        return { all: rows, added };
      });
      getMockTransport().setMockResponse('revert_bids_exclusions', (args: { keys: BidsExclusionKey[] }) => {
        rows = rows.filter(
          (old) => !args.keys.some((key) => key.entity === old.entity && key.criterion === old.criterion),
        );
        return rows;
      });
    }

    it('refuses a write for another dataset than the one showing, and writes nothing', async () => {
      fakeBridge([]);
      await useBidsStore.getState().scanDataset(PATH);
      const write = vi.fn();
      getMockTransport().setMockResponse('write_bids_exclusions', write);
      await expect(
        useBidsStore.getState().writeExclusions([row('sub-01', 'fd')], context, '/data/other'),
      ).rejects.toThrow(/other/);
      expect(write).not.toHaveBeenCalled();
      expect(useBidsStore.getState().exclusions).toEqual([]);
      expect(useBidsStore.getState().undoStack).toEqual([]);
    });

    it('undo removes what the write added, and the model follows', async () => {
      fakeBridge([]);
      await useBidsStore.getState().scanDataset(PATH);
      const before = selectBidsModel(useBidsStore.getState()).findings.total;
      const id = 'sub-07_ses-02_task-nback_run-2_bold';
      await useBidsStore.getState().writeExclusions([row(id, 'fd')], context, PATH);
      expect(useBidsStore.getState().undoStack).toHaveLength(1);
      expect(selectBidsModel(useBidsStore.getState()).findings.total).toBe(before - 1);
      await useBidsStore.getState().undoExclusion();
      expect(useBidsStore.getState().exclusions).toEqual([]);
      expect(useBidsStore.getState().undoStack).toHaveLength(0);
      expect(selectBidsModel(useBidsStore.getState()).findings.total).toBe(before);
    });

    it('adds no undo entry for a row that was already written', async () => {
      const existing = row('sub-01', 'fd');
      fakeBridge([existing]);
      await useBidsStore.getState().scanDataset(PATH);
      await useBidsStore.getState().writeExclusions([existing], context, PATH);
      expect(useBidsStore.getState().undoStack).toEqual([]);
    });

    it('undo keeps an older row of the same entity', async () => {
      const older = row('sub-01', 'manual');
      fakeBridge([older]);
      await useBidsStore.getState().scanDataset(PATH);
      await useBidsStore.getState().writeExclusions([row('sub-01', 'fd')], context, PATH);
      await useBidsStore.getState().undoExclusion();
      expect(useBidsStore.getState().exclusions).toEqual([older]);
    });

    const deferred = <T,>() => {
      let resolve: (value: T) => void = () => undefined;
      const promise = new Promise<T>((done) => (resolve = done));
      return { promise, resolve };
    };

    it('drops an exclusions read that a write overtook', async () => {
      fakeBridge([]);
      await useBidsStore.getState().scanDataset(PATH);
      const read = deferred<BidsExclusion[]>();
      const scan = deferred<never>();
      getMockTransport().setMockResponse('read_bids_exclusions', () => read.promise);
      getMockTransport().setMockResponse('scan_bids_browser', () => scan.promise);
      void useBidsStore.getState().scanDataset(PATH);
      await useBidsStore.getState().writeExclusions([row('sub-01', 'fd')], context, PATH);
      read.resolve([]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(useBidsStore.getState().exclusions.map((item) => item.entity)).toEqual(['sub-01']);
    });

    it('takes the scan rows at scan end unless a write moved them', async () => {
      const server = row('sub-09', 'manual');
      fakeBridge([]);
      getMockTransport().setMockResponse('read_bids_exclusions', () => []);
      const scanned = { ...dataset.index('x'), exclusions: [server] };
      getMockTransport().setMockResponse('scan_bids_browser', scanned);
      await useBidsStore.getState().scanDataset(PATH);
      expect(useBidsStore.getState().exclusions).toEqual([server]);

      const release = deferred<void>();
      getMockTransport().setMockResponse('scan_bids_browser', async () => {
        await release.promise;
        return scanned;
      });
      const rescan = useBidsStore.getState().scanDataset(PATH);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await useBidsStore.getState().writeExclusions([row('sub-01', 'fd')], context, PATH);
      release.resolve();
      await rescan;
      expect(useBidsStore.getState().exclusions.map((item) => item.entity)).toContain('sub-01');
    });

    it('keeps a write and its undo through a rescan of the same dataset', async () => {
      fakeBridge([]);
      await useBidsStore.getState().scanDataset(PATH);
      const write = deferred<BidsExclusionWrite>();
      getMockTransport().setMockResponse('write_bids_exclusions', () => write.promise);
      const pending = useBidsStore.getState().writeExclusions([row('sub-01', 'fd')], context, PATH);
      await useBidsStore.getState().scanDataset(PATH);
      const added = [row('sub-01', 'fd')];
      write.resolve({ all: added, added });
      await pending;
      expect(useBidsStore.getState().exclusions).toEqual(added);
      expect(useBidsStore.getState().undoStack).toHaveLength(1);
    });

    it('drops a write that lands after the dataset changed', async () => {
      fakeBridge([]);
      await useBidsStore.getState().scanDataset(PATH);
      const write = deferred<BidsExclusionWrite>();
      getMockTransport().setMockResponse('write_bids_exclusions', () => write.promise);
      const pending = useBidsStore.getState().writeExclusions([row('sub-01', 'fd')], context, PATH);
      await useBidsStore.getState().scanDataset('/data/other');
      const added = [row('sub-01', 'fd')];
      write.resolve({ all: added, added });
      await pending;
      expect(useBidsStore.getState().exclusions).toEqual([]);
      expect(useBidsStore.getState().undoStack).toEqual([]);
    });

    it('undoing during a first scan removes only the new row', async () => {
      const older = row('sub-02', 'manual');
      fakeBridge([older]);
      getMockTransport().setMockResponse('scan_bids_browser', () => new Promise(() => undefined));
      void useBidsStore.getState().scanDataset(PATH);
      await vi.waitFor(() => expect(useBidsStore.getState().exclusionsLoaded).toBe(true));
      expect(useBidsStore.getState().exclusions).toEqual([older]);
      await useBidsStore.getState().writeExclusions([row('sub-01', 'fd')], context, PATH);
      expect(useBidsStore.getState().undoStack[0].added.map((item) => item.entity)).toEqual(['sub-01']);
      await useBidsStore.getState().undoExclusion();
      expect(useBidsStore.getState().exclusions).toEqual([older]);
    });

    it('refuses to exclude before the rows on disk are known', async () => {
      useBidsStore.setState({ datasetPath: PATH, exclusionsLoaded: false, selectedRunId: 'r' });
      useBidsStore.getState().requestAction('exclude');
      expect(useBidsStore.getState().actionRequest).toBeNull();
      await expect(useBidsStore.getState().writeExclusions([row('sub-01', 'fd')], context, PATH)).rejects.toThrow();
    });

    it('reverting one criterion keeps the entity\'s other row and its undo', async () => {
      const older = row('sub-01', 'manual');
      fakeBridge([older]);
      await useBidsStore.getState().scanDataset(PATH);
      await useBidsStore.getState().writeExclusions([row('sub-01', 'fd')], context, PATH);
      await useBidsStore.getState().revertExclusions([{ entity: 'sub-01', criterion: 'manual' }]);
      expect(useBidsStore.getState().exclusions.map((item) => item.criterion)).toEqual(['fd']);
      expect(useBidsStore.getState().undoStack).toHaveLength(1);
    });

    it('a revert from Findings drops the undo entries it covers', async () => {
      fakeBridge([]);
      await useBidsStore.getState().scanDataset(PATH);
      await useBidsStore.getState().writeExclusions([row('sub-01', 'fd')], context, PATH);
      await useBidsStore.getState().revertExclusions([{ entity: 'sub-01', criterion: 'fd' }]);
      expect(useBidsStore.getState().undoStack).toEqual([]);
      expect(useBidsStore.getState().exclusions).toEqual([]);
    });
  });

  it('keeps the model reference while only the selection changes', async () => {
    getMockTransport().setMockResponse('scan_bids_browser', dataset.index('x'));
    await useBidsStore.getState().scanDataset(PATH);
    const model = selectBidsModel(useBidsStore.getState());
    useBidsStore.getState().selectRun('sub-01_ses-01_T1w');
    expect(selectBidsModel(useBidsStore.getState())).toBe(model);
    useBidsStore.getState().setFdThreshold(0.3);
    expect(selectBidsModel(useBidsStore.getState())).not.toBe(model);
  });

  it('refuses a threshold that is not a positive number', () => {
    useBidsStore.getState().setFdThreshold(-1);
    useBidsStore.getState().setFdThreshold(Number.NaN);
    expect(useBidsStore.getState().fdThreshold).toBe(0.25);
  });

  it('resets per-dataset settings on a switch and keeps rows through a rescan', async () => {
    getMockTransport().setMockResponse('scan_bids_browser', dataset.index('x'));
    await useBidsStore.getState().scanDataset(PATH);
    useBidsStore.setState({ fdThreshold: 0.4, groupBy: 'sex', compareWithModal: true });
    const rows = useBidsStore.getState().index;
    getMockTransport().setMockResponse('scan_bids_browser', () => new Promise(() => undefined));
    void useBidsStore.getState().scanDataset(PATH);
    expect(useBidsStore.getState().index).toBe(rows);
    expect(useBidsStore.getState().fdThreshold).toBe(0.4);
    void useBidsStore.getState().scanDataset('/other');
    expect(useBidsStore.getState()).toMatchObject({
      index: null,
      fdThreshold: 0.25,
      groupBy: undefined,
      compareWithModal: false,
    });
  });

  it('marks a first remote scan as remote from its first event', async () => {
    const scans = holdScan();
    const scan = useBidsStore.getState().scanDataset(PATH);
    await running(scans, 1);
    vi.useFakeTimers();
    bus.emit('bids-scan-progress', {
      ...progressOf(scans[0].scanId, 0),
      is_remote: true,
      listing_complete: false,
    });
    await flush();
    const state = useBidsStore.getState();
    expect(state.index).toMatchObject({ is_remote: true, listing_complete: false, complete: false });
    expect(selectBidsModel(state).absenceKnown).toBe(false);
    expect(lastBidsDataset()).toBeNull();
    scans[0].finish({ ...dataset.index(scans[0].scanId), is_remote: true });
    vi.useRealTimers();
    await scan;
  });

  describe('the dataset offered for reopening', () => {
    it('remembers a local dataset and keeps it past a remote one', async () => {
      getMockTransport().setMockResponse('scan_bids_browser', dataset.index('x'));
      await useBidsStore.getState().scanDataset('/data/local');
      expect(lastBidsDataset()).toBe('/data/local');
      getMockTransport().setMockResponse('scan_bids_browser', { ...dataset.index('x'), is_remote: true });
      await useBidsStore.getState().scanDataset('/cache/m1/ds');
      expect(lastBidsDataset()).toBe('/data/local');
    });

    it('stops offering a path a scan reported as remote', async () => {
      localStorage.setItem('brainflow.bids.lastDataset', '/cache/m1/ds');
      getMockTransport().setMockResponse('scan_bids_browser', { ...dataset.index('x'), is_remote: true });
      await useBidsStore.getState().scanDataset('/cache/m1/ds');
      expect(lastBidsDataset()).toBeNull();
    });

    it('stops offering a mirror the bridge refused, and keeps a drive that is away', async () => {
      localStorage.setItem('brainflow.bids.lastDataset', '/cache/m1/ds');
      getMockTransport().setMockResponse('scan_bids_browser', () => {
        throw new Error('/cache/m1/ds is a cached copy of a remote dataset whose mount is not active.');
      });
      await useBidsStore.getState().scanDataset('/cache/m1/ds');
      expect(useBidsStore.getState().scanStatus).toBe('error');
      expect(lastBidsDataset()).toBeNull();

      localStorage.setItem('brainflow.bids.lastDataset', '/Volumes/away/ds');
      getMockTransport().setMockResponse('scan_bids_browser', () => {
        throw new Error('Failed to load BIDS dataset');
      });
      await useBidsStore.getState().scanDataset('/Volumes/away/ds');
      expect(lastBidsDataset()).toBe('/Volumes/away/ds');
    });
  });

  it('caches no events from a failed read, and the next read tries again', async () => {
    useBidsStore.setState({ datasetPath: PATH });
    const rows = [{ onset: 1, duration: 2, trial_type: 'go', additional: {} }];
    getMockTransport().setMockResponse('get_bids_run_events', () => {
      throw new Error('The events table is not available for a remote dataset.');
    });
    await expect(useBidsStore.getState().loadRunEvents('r')).rejects.toThrow('not available');
    expect(useBidsStore.getState().eventsCache.has('r')).toBe(false);
    getMockTransport().setMockResponse('get_bids_run_events', () => rows);
    await expect(useBidsStore.getState().loadRunEvents('r')).resolves.toEqual(rows);
  });

  it('keeps the events of runs of one id apart by dataset', async () => {
    useBidsStore.setState({ datasetPath: PATH, eventsCache: new Map() });
    getMockTransport().setMockResponse('get_bids_run_events', (args: { datasetPath: string }) => [
      { onset: 1, duration: 2, trial_type: args.datasetPath, additional: {} },
    ]);
    const store = useBidsStore.getState();
    const own = await store.loadRunEvents('r');
    expect(own[0].trial_type).toBe(PATH);
    // A read pinned to a dataset that is not current leaves no entry behind.
    expect((await store.loadRunEvents('r', '/gone'))[0].trial_type).toBe('/gone');
    expect(useBidsStore.getState().eventsCache.size).toBe(1);
    expect(await useBidsStore.getState().loadRunEvents('r')).toBe(own);
  });

  it('lets no late progress event overwrite the final index', async () => {
    let emit: ((event: { payload: unknown }) => void) | undefined;
    vi.spyOn(eventUtils, 'safeListen').mockImplementation(async (_name, handler) => {
      emit = handler as never;
      return () => undefined;
    });
    getMockTransport().setMockResponse('scan_bids_browser', (args: { scanId: string }) => ({
      ...dataset.index(args.scanId),
    }));
    await useBidsStore.getState().scanDataset(PATH);
    const final = useBidsStore.getState().index;
    emit?.({
      payload: { scan_id: final?.scan_id, runs: [], findings: [], subject: '99', files_done: 0, files_total: 0 },
    });
    await new Promise((resolve) => setTimeout(resolve, BIDS_PROGRESS_FLUSH_MS + 20));
    expect(useBidsStore.getState().index).toBe(final);
  });

  it('records the keyboard action a later step carries out', () => {
    useBidsStore.setState({ exclusionsLoaded: true });
    useBidsStore.getState().selectRun('run-a');
    useBidsStore.getState().requestAction('exclude');
    expect(useBidsStore.getState().actionRequest).toMatchObject({ kind: 'exclude', runId: 'run-a' });
    useBidsStore.getState().clearActionRequest();
    expect(useBidsStore.getState().actionRequest).toBeNull();
  });
});
