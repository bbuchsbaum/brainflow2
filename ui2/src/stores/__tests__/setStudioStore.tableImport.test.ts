import { beforeEach, describe, expect, it } from 'vitest';
import { useSetStudioStore } from '@/stores/setStudioStore';

describe('SetStudioStore table import wizard', () => {
  beforeEach(() => {
    useSetStudioStore.setState(useSetStudioStore.getInitialState());
  });

  it('parses quoted CSV content and builds a usable preview candidate', () => {
    const store = useSetStudioStore.getState();
    store.openImportDialog('table');
    store.setTsvPath('subjects.csv');
    store.parseTsvContent(
      [
        'subject,filepath,diagnosis,notes',
        'sub001,"/tmp/sub001.nii.gz","control, baseline","said ""hello"""',
        'sub002,"/tmp/sub002.nii.gz",case,"second row"',
      ].join('\n')
    );

    let state = useSetStudioStore.getState();
    expect(state.importDialog.tsvWizard.step).toBe('map');
    expect(state.importDialog.tsvWizard.headers).toEqual([
      'subject',
      'filepath',
      'diagnosis',
      'notes',
    ]);
    expect(state.importDialog.tsvWizard.rows[0]).toEqual([
      'sub001',
      '/tmp/sub001.nii.gz',
      'control, baseline',
      'said "hello"',
    ]);

    store.buildTsvImportCandidate();

    state = useSetStudioStore.getState();
    const candidateId = state.importDialog.selectedCandidateId;
    expect(candidateId).toBeTruthy();
    const candidate = candidateId ? state.importCandidates[candidateId] : null;
    expect(candidate?.mode).toBe('table');
    expect(candidate?.set.memberSummaries).toEqual([
      { id: 'sub001', sourcePath: '/tmp/sub001.nii.gz' },
      { id: 'sub002', sourcePath: '/tmp/sub002.nii.gz' },
    ]);
    expect(candidate?.set.designColumns).toEqual(['diagnosis', 'notes']);
    expect(candidate?.set.designTablePreview?.rows[0].cells).toEqual([
      'sub001',
      'control, baseline',
      'said "hello"',
    ]);
  });

  it('builds a truthful audit for duplicates, missing ids, and missing file paths', () => {
    const store = useSetStudioStore.getState();
    store.openImportDialog('table');
    store.setTsvPath('bad.csv');
    store.parseTsvContent(
      [
        'subject,filepath,diagnosis',
        'sub001,/tmp/sub001_a.nii.gz,control',
        'sub001,/tmp/sub001_b.nii.gz,control',
        'sub002,,case',
        ',/tmp/sub003.nii.gz,control',
        'sub004,/tmp/sub004.nii.gz,case',
      ].join('\n')
    );
    store.buildTsvImportCandidate();

    const state = useSetStudioStore.getState();
    const candidateId = state.importDialog.selectedCandidateId;
    const candidate = candidateId ? state.importCandidates[candidateId] : null;
    expect(candidate).toBeTruthy();
    expect(candidate?.set.memberIds).toEqual(['sub004']);
    expect(candidate?.set.ingestAudit.join.matchedRows).toBe(1);
    expect(candidate?.set.ingestAudit.join.unmatchedRows).toBe(4);
    expect(candidate?.set.ingestAudit.join.duplicateKeys).toBe(2);
    expect(candidate?.set.ingestAudit.join.severity).toBe('warning');
    expect(candidate?.set.ingestAudit.join.issueDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('missing subject IDs'),
        }),
        expect.objectContaining({
          message: expect.stringContaining('missing file paths'),
          memberIds: ['sub002'],
        }),
        expect.objectContaining({
          message: expect.stringContaining('Duplicate subject IDs'),
          memberIds: ['sub001'],
        }),
      ])
    );
  });

  it('preserves table wizard state when switching tabs', () => {
    const store = useSetStudioStore.getState();
    store.openImportDialog('table');
    store.parseTsvContent(
      [
        'subject,filepath,diagnosis',
        'sub001,/tmp/sub001.nii.gz,control',
      ].join('\n')
    );

    let state = useSetStudioStore.getState();
    expect(state.importDialog.tsvWizard.step).toBe('map');

    store.openImportDialog('manifest');
    store.openImportDialog('table');

    state = useSetStudioStore.getState();
    expect(state.importDialog.mode).toBe('table');
    expect(state.importDialog.tsvWizard.step).toBe('map');
    expect(state.importDialog.tsvWizard.headers).toEqual([
      'subject',
      'filepath',
      'diagnosis',
    ]);
    expect(state.importDialog.tsvWizard.rows).toHaveLength(1);
  });

  it('clears loading state when a preview returns zero candidates', () => {
    const store = useSetStudioStore.getState();
    store.beginImportPreview('manifest');
    expect(useSetStudioStore.getState().importDialog.isLoading).toBe(true);

    store.setImportPreviewResult('manifest', [], 'backend', 'No preview candidates were found.');

    const state = useSetStudioStore.getState();
    expect(state.importDialog.isLoading).toBe(false);
    expect(state.importDialog.error).toBe('No preview candidates were found.');
    expect(state.importDialog.selectedCandidateId).toBeNull();
  });
});
