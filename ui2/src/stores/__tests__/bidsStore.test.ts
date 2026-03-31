// Rust fixture tests deferred — backend scan_bids_dataset requires a real BIDS directory.

import { beforeEach, describe, expect, it } from 'vitest';
import { useBidsStore } from '@/stores/bidsStore';
import { getTransport } from '@/services/transport';
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

  it('transitions idle → scanning → ready and stores summary on scanDataset success', async () => {
    const summary = makeSummary();
    getMockTransport().setMockResponse('scan_bids_dataset', summary);

    const scanPromise = useBidsStore.getState().scanDataset('/data/ds001');

    // Should be scanning immediately after calling
    expect(useBidsStore.getState().scanStatus).toBe('scanning');

    await scanPromise;

    const state = useBidsStore.getState();
    expect(state.scanStatus).toBe('ready');
    expect(state.summary).toEqual(summary);
    expect(state.scanError).toBeNull();
    expect(state.datasetPath).toBe('/data/ds001');
  });

  it('sets scanStatus to error and records scanError when scanDataset throws', async () => {
    getMockTransport().setMockResponse('scan_bids_dataset', () => {
      throw new Error('backend failure');
    });

    await useBidsStore.getState().scanDataset('/data/bad');

    const state = useBidsStore.getState();
    expect(state.scanStatus).toBe('error');
    expect(state.scanError).toBe('backend failure');
    expect(state.summary).toBeNull();
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
