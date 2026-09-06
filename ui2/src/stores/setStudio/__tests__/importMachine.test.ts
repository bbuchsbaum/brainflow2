import { describe, expect, it } from 'vitest';
import {
  buildTsvCandidate,
  createInitialImportContext,
  importReducer,
  toDialogState,
  toRequestState,
} from '../importMachine';
import type { ImportContext, ImportEffect, ImportEvent } from '../importMachine';
import type { StudioFolderOntologySummary, StudioImportCandidate } from '@/types/studio';

/** Fold a sequence of events over an initial context, collecting all effects. */
function run(
  context: ImportContext,
  ...events: ImportEvent[]
): { context: ImportContext; effects: ImportEffect[] } {
  return events.reduce<{ context: ImportContext; effects: ImportEffect[] }>(
    (acc, event) => {
      const next = importReducer(acc.context, event);
      return { context: next.context, effects: [...acc.effects, ...next.effects] };
    },
    { context, effects: [] },
  );
}

function makeCompareReadyCandidate(
  overrides: Partial<StudioImportCandidate> = {},
): StudioImportCandidate {
  return {
    id: 'candidate-compare',
    label: 'Compare-ready preview',
    description: 'Fixture compare-ready candidate.',
    mode: 'manifest',
    sourceHint: '/tmp/study.neurotabs.yaml',
    contract: {
      readiness: 'compare_ready',
      provenanceKind: 'manifest',
      provenanceLabel: '/tmp/study.neurotabs.yaml',
      canImport: true,
      capabilities: ['import', 'deck', 'compare', 'materialize_compare'],
      reason: 'Fixture is compare-ready.',
    },
    set: {
      id: 'fixture-set',
      name: 'Fixture Set',
      sourceKind: 'imported',
      memberCount: 3,
      primaryFeatureId: 'statmap',
      supportKind: 'volume',
      supportLabel: 'MNI152 fixture grid',
      alignmentClass: 'same-grid',
      designColumns: [],
      designTablePreview: null,
      memberSummaries: [
        { id: 'sub001', sourcePath: '/tmp/sub001.nii.gz' },
        { id: 'sub002', sourcePath: '/tmp/sub002.nii.gz' },
        { id: 'sub003', sourcePath: '/tmp/sub003.nii.gz' },
      ],
      memberIds: ['sub001', 'sub002', 'sub003'],
      savedCohortIds: ['all-members'],
      ingestAudit: {
        sourceLabel: 'NeuroTabs manifest',
        join: {
          matchedRows: 3,
          unmatchedRows: 0,
          duplicateKeys: 0,
          severity: 'ok',
          issueDetails: [],
        },
        support: {
          supportLabel: 'MNI152 fixture grid',
          alignmentClass: 'same-grid',
          readyForCompare: true,
          severity: 'ok',
        },
        notes: [],
      },
    },
    features: [{ id: 'statmap', label: 'Stat Map', kind: 'volume' }],
    cohorts: [
      {
        id: 'all-members',
        label: 'All members',
        memberCount: 3,
        description: 'All fixture members.',
        memberIds: ['sub001', 'sub002', 'sub003'],
        originKind: 'imported',
        originLabel: 'Fixture',
      },
    ],
    expressions: [
      {
        id: 'member',
        label: 'Current member',
        kind: 'member',
        recipe: 'member(sub001)',
        cohortId: null,
      },
      {
        id: 'zscore',
        label: 'Z-score',
        kind: 'comparison',
        recipe: 'zscore(current, cohort:all-members)',
        cohortId: 'all-members',
      },
    ],
    materialization: null,
    ...overrides,
  };
}

function makeBlockedCandidate(): StudioImportCandidate {
  const base = makeCompareReadyCandidate();
  return {
    ...base,
    id: 'candidate-blocked',
    contract: {
      readiness: 'blocked',
      provenanceKind: 'backend_error',
      provenanceLabel: '/tmp/study.neurotabs.yaml',
      canImport: false,
      capabilities: [],
      reason: 'Preview failed.',
    },
  };
}

function makeOntologySummary(): StudioFolderOntologySummary {
  return {
    root: '/tmp/study',
    rootExists: true,
    sourceLabel: null,
    scannedFiles: 4,
    neuroimagingFiles: 4,
    truncated: false,
    warnings: [],
    candidates: [
      {
        id: 'maps-role-condition',
        label: 'Subject maps with condition factor',
        description: 'Treat basename modifiers as a condition factor.',
        strategy: 'path_subject_maps_role_condition',
        score: 0.92,
        coverage: 1,
        completeness: 1,
        matchedFiles: 4,
        unmatchedFiles: 0,
        duplicateKeys: 0,
        missingRoleBindings: 0,
        filePattern: String.raw`(?P<subject>[^/]+)/maps/(?P<role>[A-Za-z0-9]+)(?:_(?P<condition>[^/]+))?\.nii(\.gz)?$`,
        designColumns: ['subject', 'condition'],
        observedRoles: ['auc'],
        requiredRoles: ['auc'],
        rolePatterns: [{ role: 'auc', patterns: ['auc'] }],
        factors: [],
        roles: [],
        groups: [],
        reasons: [],
        warnings: [],
      },
    ],
  };
}

const TABLE_CSV = ['subject,filepath,diagnosis', 'sub001,/tmp/sub001.nii.gz,control'].join('\n');

describe('importReducer — dialog & tabs', () => {
  it('OPEN_DIALOG opens the dialog, sets the mode, and resets the preview phase', () => {
    const { context } = run(createInitialImportContext(), { type: 'OPEN_DIALOG', mode: 'regex' });
    const dialog = toDialogState(context);
    expect(dialog.isOpen).toBe(true);
    expect(dialog.mode).toBe('regex');
    expect(dialog.isLoading).toBe(false);
    expect(dialog.source).toBeNull();
    expect(dialog.error).toBeNull();
    expect(dialog.selectedCandidateId).toBeNull();
  });

  it('OPEN_DIALOG selects an existing candidate for the target mode', () => {
    const candidate = makeCompareReadyCandidate();
    const seeded = run(createInitialImportContext(), {
      type: 'PREVIEW_RESULT_APPLIED',
      mode: 'manifest',
      candidates: [candidate],
      source: 'backend',
      error: null,
    });
    // Switch away and back; the manifest candidate is re-selected.
    const { context } = run(
      seeded.context,
      { type: 'OPEN_DIALOG', mode: 'regex' },
      { type: 'OPEN_DIALOG', mode: 'manifest' },
    );
    expect(toDialogState(context).selectedCandidateId).toBe(candidate.id);
  });

  it('CLOSE_DIALOG only flips isOpen and no-ops when already closed', () => {
    const opened = run(createInitialImportContext(), { type: 'OPEN_DIALOG', mode: 'table' });
    const closed = importReducer(opened.context, { type: 'CLOSE_DIALOG' });
    expect(toDialogState(closed.context).isOpen).toBe(false);
    expect(toDialogState(closed.context).mode).toBe('table');

    // Closing an already-closed dialog is a referential no-op.
    const again = importReducer(closed.context, { type: 'CLOSE_DIALOG' });
    expect(again.context).toBe(closed.context);
  });

  it('switching tabs preserves the form fields and the TSV wizard', () => {
    const withTable = run(
      createInitialImportContext(),
      { type: 'OPEN_DIALOG', mode: 'table' },
      { type: 'TSV_PATH_SET', path: 'subjects.csv' },
      { type: 'TSV_PARSED', content: TABLE_CSV },
      { type: 'MANIFEST_PATH_SET', path: '/tmp/custom.neurotabs.yaml' },
    );
    const { context } = run(
      withTable.context,
      { type: 'OPEN_DIALOG', mode: 'manifest' },
      { type: 'OPEN_DIALOG', mode: 'table' },
    );
    const dialog = toDialogState(context);
    expect(dialog.mode).toBe('table');
    expect(dialog.tsvWizard.step).toBe('map');
    expect(dialog.tsvWizard.headers).toEqual(['subject', 'filepath', 'diagnosis']);
    expect(dialog.manifestPath).toBe('/tmp/custom.neurotabs.yaml');
  });
});

describe('importReducer — preview lifecycle', () => {
  it('drives the happy path from requested to loaded and emits RUN_PREVIEW', () => {
    const candidate = makeCompareReadyCandidate();
    const requested = importReducer(createInitialImportContext(), {
      type: 'PREVIEW_REQUESTED',
      mode: 'manifest',
      requestId: 1,
    });
    expect(requested.effects).toContainEqual({
      type: 'RUN_PREVIEW',
      mode: 'manifest',
      requestId: 1,
    });
    expect(toDialogState(requested.context).isLoading).toBe(true);
    expect(toRequestState(requested.context).preview).toEqual({ requestId: 1, mode: 'manifest' });

    const succeeded = importReducer(requested.context, {
      type: 'PREVIEW_SUCCEEDED',
      mode: 'manifest',
      requestId: 1,
      candidates: [candidate],
      source: 'backend',
    });
    const dialog = toDialogState(succeeded.context);
    expect(dialog.isLoading).toBe(false);
    expect(dialog.source).toBe('backend');
    expect(dialog.error).toBeNull();
    expect(dialog.selectedCandidateId).toBe(candidate.id);
    expect(succeeded.context.candidates[candidate.id]).toBe(candidate);
    expect(toRequestState(succeeded.context).preview).toBeNull();
  });

  it('applies the empty-candidates branch with a default message and no selection', () => {
    const { context } = run(
      createInitialImportContext(),
      { type: 'PREVIEW_REQUESTED', mode: 'manifest', requestId: 1 },
      {
        type: 'PREVIEW_RESULT_APPLIED',
        mode: 'manifest',
        candidates: [],
        source: 'backend',
        error: null,
      },
    );
    const dialog = toDialogState(context);
    expect(dialog.isLoading).toBe(false);
    expect(dialog.source).toBe('backend');
    expect(dialog.error).toBe('No preview candidates were found.');
    expect(dialog.selectedCandidateId).toBeNull();
  });

  it('drops candidates of the requested mode when a new preview begins', () => {
    const manifest = makeCompareReadyCandidate();
    const regex = makeCompareReadyCandidate({ id: 'candidate-regex', mode: 'regex' });
    const seeded = run(
      createInitialImportContext(),
      {
        type: 'PREVIEW_RESULT_APPLIED',
        mode: 'manifest',
        candidates: [manifest],
        source: 'backend',
        error: null,
      },
      {
        type: 'PREVIEW_RESULT_APPLIED',
        mode: 'regex',
        candidates: [regex],
        source: 'backend',
        error: null,
      },
    );
    const requested = importReducer(seeded.context, {
      type: 'PREVIEW_REQUESTED',
      mode: 'regex',
      requestId: 5,
    });
    // The regex candidate is cleared; the manifest candidate survives.
    expect(requested.context.candidates['candidate-regex']).toBeUndefined();
    expect(requested.context.candidates['candidate-compare']).toBe(manifest);
  });
});

describe('importReducer — staleness', () => {
  it('ignores a success whose request id has been superseded', () => {
    const first = makeCompareReadyCandidate({ id: 'first' });
    const second = makeCompareReadyCandidate({ id: 'second' });
    const requestedTwice = run(
      createInitialImportContext(),
      { type: 'PREVIEW_REQUESTED', mode: 'manifest', requestId: 1 },
      { type: 'PREVIEW_REQUESTED', mode: 'manifest', requestId: 2 },
    );

    const stale = importReducer(requestedTwice.context, {
      type: 'PREVIEW_SUCCEEDED',
      mode: 'manifest',
      requestId: 1,
      candidates: [first],
      source: 'backend',
    });
    // Stale result is ignored: still loading, no candidate selected.
    expect(stale.context).toBe(requestedTwice.context);
    expect(toDialogState(stale.context).isLoading).toBe(true);

    const fresh = importReducer(stale.context, {
      type: 'PREVIEW_SUCCEEDED',
      mode: 'manifest',
      requestId: 2,
      candidates: [second],
      source: 'backend',
    });
    expect(toDialogState(fresh.context).selectedCandidateId).toBe('second');
  });

  it('invalidates an in-flight result after a mode switch', () => {
    const manifestCandidate = makeCompareReadyCandidate({ id: 'manifest-result' });
    const regexCandidate = makeCompareReadyCandidate({ id: 'regex-result', mode: 'regex' });
    const switched = run(
      createInitialImportContext(),
      { type: 'PREVIEW_REQUESTED', mode: 'manifest', requestId: 1 },
      // Simulate the user switching tabs, which starts a new request for regex.
      { type: 'PREVIEW_REQUESTED', mode: 'regex', requestId: 2 },
    );

    const staleManifest = importReducer(switched.context, {
      type: 'PREVIEW_SUCCEEDED',
      mode: 'manifest',
      requestId: 1,
      candidates: [manifestCandidate],
      source: 'backend',
    });
    expect(staleManifest.context).toBe(switched.context);

    const freshRegex = importReducer(switched.context, {
      type: 'PREVIEW_SUCCEEDED',
      mode: 'regex',
      requestId: 2,
      candidates: [regexCandidate],
      source: 'backend',
    });
    expect(toDialogState(freshRegex.context).mode).toBe('regex');
    expect(toDialogState(freshRegex.context).selectedCandidateId).toBe('regex-result');
  });

  it('invalidates an in-flight ontology scan after the discovery root changes', () => {
    const requested = run(
      createInitialImportContext(),
      { type: 'ONTOLOGY_REQUESTED', root: '/tmp/study', requestId: 1 },
      // Root changes while the scan is in flight.
      { type: 'DISCOVERY_ROOT_SET', root: '/tmp/other' },
    );
    // The scan stays in flight but its root no longer matches.
    expect(toDialogState(requested.context).isOntologyLoading).toBe(true);

    const stale = importReducer(requested.context, {
      type: 'ONTOLOGY_SUCCEEDED',
      requestId: 1,
      summary: makeOntologySummary(),
    });
    expect(stale.context).toBe(requested.context);
    expect(toDialogState(stale.context).ontologyPreview).toBeNull();
  });
});

describe('importReducer — error & fallback', () => {
  it('retains complete local table metadata and refuses ambiguous headers or ragged rows', () => {
    const context = createInitialImportContext();
    context.tsvWizard = {
      ...context.tsvWizard,
      headers: ['observation', 'path', 'participant', 'site', 'private'],
      rows: Array.from({ length: 100 }, (_, i) => [
        `obs-${i}`, `/synthetic/${i}.nii`, `person-${Math.floor(i / 2)}`, i < 80 ? 'A' : 'B', 'excluded',
      ]),
      columnMapping: { filePathColumn: 'path', subjectIdColumn: 'observation', excludedColumns: ['private'] },
    };
    const candidate = buildTsvCandidate(context, { now: 1 })!;
    expect(candidate.set.designTablePreview?.rows).toHaveLength(5);
    expect(candidate.set.memberSummaries[99].designValues).toEqual({
      observation: 'obs-99', participant: 'person-49', site: 'B',
    });
    context.tsvWizard.headers[4] = 'site';
    expect(buildTsvCandidate(context, { now: 2 })).toBeNull();
    context.tsvWizard.headers[4] = 'private';
    context.tsvWizard.rows[99].pop();
    expect(buildTsvCandidate(context, { now: 3 })).toBeNull();
  });

  it('PREVIEW_FAILED for a manifest yields an empty fallback with the error message', () => {
    const { context } = run(
      createInitialImportContext(),
      { type: 'PREVIEW_REQUESTED', mode: 'manifest', requestId: 1 },
      { type: 'PREVIEW_FAILED', mode: 'manifest', requestId: 1, message: 'backend down', now: 42 },
    );
    const dialog = toDialogState(context);
    expect(dialog.isLoading).toBe(false);
    expect(dialog.source).toBe('fallback');
    expect(dialog.error).toBe('backend down');
    expect(dialog.selectedCandidateId).toBeNull();
  });

  it('PREVIEW_FAILED for a table builds a local TSV candidate at wizard step preview', () => {
    const { context } = run(
      createInitialImportContext(),
      { type: 'OPEN_DIALOG', mode: 'table' },
      { type: 'TSV_PATH_SET', path: 'subjects.csv' },
      { type: 'TSV_PARSED', content: TABLE_CSV },
      { type: 'PREVIEW_REQUESTED', mode: 'table', requestId: 1 },
      { type: 'PREVIEW_FAILED', mode: 'table', requestId: 1, message: 'backend down', now: 1234 },
    );
    const dialog = toDialogState(context);
    expect(dialog.source).toBe('fallback');
    expect(dialog.error).toBe('backend down');
    expect(dialog.tsvWizard.step).toBe('preview');
    const candidateId = dialog.selectedCandidateId;
    expect(candidateId).toBe('candidate-table-1234');
    const candidate = candidateId ? context.candidates[candidateId] : null;
    expect(candidate?.mode).toBe('table');
    expect(candidate?.set.memberIds).toEqual(['sub001']);
  });

  it('injecting `now` makes the built TSV candidate id deterministic', () => {
    const build = (now: number) =>
      run(
        createInitialImportContext(),
        { type: 'TSV_PATH_SET', path: 'subjects.csv' },
        { type: 'TSV_PARSED', content: TABLE_CSV },
        { type: 'TSV_CANDIDATE_BUILT', now },
      ).context;
    expect(toDialogState(build(999)).selectedCandidateId).toBe('candidate-table-999');
    expect(toDialogState(build(7)).selectedCandidateId).toBe('candidate-table-7');
  });
});

describe('importReducer — ontology lifecycle', () => {
  it('drives requested -> ready and emits RUN_ONTOLOGY_SCAN', () => {
    const requested = importReducer(createInitialImportContext(), {
      type: 'ONTOLOGY_REQUESTED',
      root: '/tmp/study',
      requestId: 1,
    });
    expect(requested.effects).toContainEqual({
      type: 'RUN_ONTOLOGY_SCAN',
      root: '/tmp/study',
      requestId: 1,
    });
    expect(toDialogState(requested.context).isOntologyLoading).toBe(true);
    expect(toDialogState(requested.context).mode).toBe('regex');
    expect(toDialogState(requested.context).discoveryRoot).toBe('/tmp/study');

    const ready = importReducer(requested.context, {
      type: 'ONTOLOGY_SUCCEEDED',
      requestId: 1,
      summary: makeOntologySummary(),
    });
    const dialog = toDialogState(ready.context);
    expect(dialog.isOntologyLoading).toBe(false);
    expect(dialog.ontologyPreview?.root).toBe('/tmp/study');
    expect(dialog.ontologyError).toBeNull();
  });

  it('ONTOLOGY_FAILED records the error message', () => {
    const { context } = run(
      createInitialImportContext(),
      { type: 'ONTOLOGY_REQUESTED', root: '/tmp/study', requestId: 1 },
      { type: 'ONTOLOGY_FAILED', requestId: 1, message: 'scan failed' },
    );
    const dialog = toDialogState(context);
    expect(dialog.isOntologyLoading).toBe(false);
    expect(dialog.ontologyError).toBe('scan failed');
    expect(dialog.ontologyPreview).toBeNull();
  });

  it('ONTOLOGY_CANDIDATE_APPLIED copies the proposal into discovery controls and clears the error', () => {
    const { context } = run(
      createInitialImportContext(),
      { type: 'OPEN_DIALOG', mode: 'regex' },
      { type: 'PREVIEW_ERROR_SET', message: 'stale preview error' },
      { type: 'ONTOLOGY_RESULT_SET', summary: makeOntologySummary() },
      { type: 'ONTOLOGY_CANDIDATE_APPLIED', candidateId: 'maps-role-condition' },
    );
    const dialog = toDialogState(context);
    expect(dialog.filePattern).toContain('(?P<condition>');
    expect(dialog.discoveryRolePatterns).toEqual([{ role: 'auc', patterns: ['auc'] }]);
    expect(dialog.discoveryRequiredRoles).toEqual(['auc']);
    expect(dialog.error).toBeNull();
  });

  it('ONTOLOGY_CANDIDATE_APPLIED no-ops when the candidate id is unknown', () => {
    const ready = run(createInitialImportContext(), {
      type: 'ONTOLOGY_RESULT_SET',
      summary: makeOntologySummary(),
    });
    const result = importReducer(ready.context, {
      type: 'ONTOLOGY_CANDIDATE_APPLIED',
      candidateId: 'does-not-exist',
    });
    expect(result.context).toBe(ready.context);
  });
});

describe('importReducer — confirm', () => {
  it('emits BOOTSTRAP_STUDIO and closes the dialog for an importable candidate', () => {
    const candidate = makeCompareReadyCandidate();
    const seeded = run(
      createInitialImportContext(),
      { type: 'OPEN_DIALOG', mode: 'manifest' },
      {
        type: 'PREVIEW_RESULT_APPLIED',
        mode: 'manifest',
        candidates: [candidate],
        source: 'backend',
        error: null,
      },
    );
    const confirmed = importReducer(seeded.context, { type: 'CONFIRM_REQUESTED' });
    expect(toDialogState(confirmed.context).isOpen).toBe(false);
    const bootstrap = confirmed.effects.find((effect) => effect.type === 'BOOTSTRAP_STUDIO');
    expect(bootstrap).toBeTruthy();
    if (bootstrap?.type === 'BOOTSTRAP_STUDIO') {
      // An audited volume set opens the live population experience.
      expect(bootstrap.payload.selection?.activeLens).toBe('population');
      expect(bootstrap.payload.set.id).toBe('fixture-set');
      expect(bootstrap.payload.set.importContract).toBe(candidate.contract);
    }
  });

  it('does not confirm a non-importable candidate and keeps the dialog open', () => {
    const blocked = makeBlockedCandidate();
    const seeded = run(
      createInitialImportContext(),
      { type: 'OPEN_DIALOG', mode: 'manifest' },
      {
        type: 'PREVIEW_RESULT_APPLIED',
        mode: 'manifest',
        candidates: [blocked],
        source: 'backend',
        error: null,
      },
    );
    const confirmed = importReducer(seeded.context, { type: 'CONFIRM_REQUESTED' });
    expect(confirmed.context).toBe(seeded.context);
    expect(confirmed.effects).toHaveLength(0);
    expect(toDialogState(confirmed.context).isOpen).toBe(true);
  });
});

describe('importReducer — role editing & TSV parsing', () => {
  it('normalizes role names when adding a discovery role', () => {
    const { context } = importReducer(createInitialImportContext(), {
      type: 'DISCOVERY_ROLE_ADDED',
      role: '  Z Stat!! ',
    });
    const dialog = toDialogState(context);
    expect(dialog.discoveryRolePatterns.some((entry) => entry.role === 'z_stat')).toBe(true);
    expect(dialog.discoveryRequiredRoles).toContain('z_stat');
    expect(dialog.discoveryCustomRole).toBe('');
  });

  it('ignores an empty role after normalization (referential no-op)', () => {
    const initial = createInitialImportContext();
    const result = importReducer(initial, { type: 'DISCOVERY_ROLE_ADDED', role: '   ' });
    expect(result.context).toBe(initial);
    expect(result.effects).toHaveLength(0);
  });

  it('TSV_PARSED on valid content advances to the map step with auto-detected columns', () => {
    const { context } = run(
      createInitialImportContext(),
      { type: 'TSV_PATH_SET', path: 'subjects.csv' },
      { type: 'TSV_PARSED', content: TABLE_CSV },
    );
    const dialog = toDialogState(context);
    expect(dialog.tsvWizard.step).toBe('map');
    expect(dialog.tsvWizard.headers).toEqual(['subject', 'filepath', 'diagnosis']);
    expect(dialog.tsvWizard.columnMapping.filePathColumn).toBe('filepath');
    expect(dialog.tsvWizard.columnMapping.subjectIdColumn).toBe('subject');
    expect(dialog.tsvWizard.parseError).toBeNull();
  });

  it('TSV_PARSED on invalid content records the parse error and resets the wizard', () => {
    const { context } = run(
      createInitialImportContext(),
      { type: 'TSV_PATH_SET', path: 'broken.csv' },
      { type: 'TSV_PARSED', content: '' },
    );
    const dialog = toDialogState(context);
    expect(dialog.tsvWizard.step).toBe('load');
    expect(dialog.tsvWizard.headers).toEqual([]);
    expect(dialog.tsvWizard.parseError).toBe('File is empty.');
    // The path is preserved across the reset.
    expect(dialog.tsvWizard.tsvPath).toBe('broken.csv');
  });
});
