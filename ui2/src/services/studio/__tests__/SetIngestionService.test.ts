import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SetIngestionService } from '../SetIngestionService';
import { useSetStudioStore } from '@/stores/setStudioStore';
import type { BackendTransport } from '@/services/transport';
import type { StudioImportCandidate } from '@/types/studio';

describe('SetIngestionService', () => {
  beforeEach(() => {
    useSetStudioStore.setState(useSetStudioStore.getInitialState());
  });

  function makeDiscoveryCandidate(): StudioImportCandidate {
    return {
      id: 'candidate-regex-fixture',
      label: 'Regex discovery preview',
      description: 'Fixture discovery candidate.',
      mode: 'regex',
      sourceHint: 'root=/tmp/study',
      set: {
        id: 'fixture-discovery',
        name: 'Fixture Discovery',
        sourceKind: 'imported',
        memberCount: 1,
        primaryFeatureId: 'tstat',
        supportKind: 'volume',
        supportLabel: 'MNI152 fixture grid',
        alignmentClass: 'same-grid',
        designColumns: ['subject'],
        designTablePreview: {
          columns: ['subject'],
          rows: [{ id: '1001', cells: ['1001'] }],
        },
        memberSummaries: [{ id: '1001', sourcePath: '/tmp/study/1001/maps/tstat.nii.gz' }],
        memberIds: ['1001'],
        savedCohortIds: ['all-members'],
        ingestAudit: {
          sourceLabel: 'Regex discovery',
          join: {
            matchedRows: 1,
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
      features: [{ id: 'tstat', label: 'Tstat', kind: 'volume' }],
      cohorts: [
        {
          id: 'all-members',
          label: 'All members',
          memberCount: 1,
          description: 'All fixture members.',
          memberIds: ['1001'],
          originKind: 'imported',
          originLabel: 'Fixture',
        },
      ],
      expressions: [
        {
          id: 'regex-member',
          label: 'Current member',
          kind: 'member',
          recipe: 'member(1001)',
          cohortId: null,
        },
      ],
      materialization: null,
      discovery: null,
    };
  }

  function withDiscoveryRoot(candidate: StudioImportCandidate, root: string): StudioImportCandidate {
    return {
      ...candidate,
      discovery: {
        root,
        filePattern: '(?P<subject>[^/]+)/maps/(?P<role>tstat)\\.nii(\\.gz)?$',
        includePatterns: [],
        excludePatterns: [],
        rolePatterns: [{ role: 'tstat', patterns: ['tstat'] }],
        maxDepth: 4,
        maxFiles: 100,
        dryRun: true,
        sampleHeaders: false,
        captureNames: ['subject', 'role'],
        inferredDesignColumns: ['subject', 'roles'],
        observedRoles: ['tstat'],
        requiredRoles: ['tstat'],
        matchedFiles: 1,
        unmatchedFiles: 0,
        duplicateKeys: 0,
        truncated: false,
        groups: [],
      },
    };
  }

  it('sends regex discovery controls to the backend preview command', async () => {
    const invoke = vi.fn().mockResolvedValue([makeDiscoveryCandidate()]);
    const service = new SetIngestionService({ invoke } as BackendTransport);
    const store = useSetStudioStore.getState();

    store.openImportDialog('regex');
    store.setDiscoveryRoot('/tmp/study');
    store.setFilePattern(String.raw`(?P<subject>\d+)/maps/(?P<role>tstat|pvalue)\.nii(\.gz)?$`);
    store.setDiscoveryMaxDepth('6');
    store.setDiscoveryMaxFiles('42');
    store.setDiscoverySampleHeaders(false);
    store.setDiscoveryRoleRequired('pvalue', true);
    store.setDiscoveryRolePattern('tstat', ['tstat', 'spmT']);

    await service.openImportPreview('regex');

    expect(invoke).toHaveBeenCalledWith('preview_set_studio_imports', {
      request: expect.objectContaining({
        mode: 'regex',
        discoveryRoot: '/tmp/study',
        filePattern: String.raw`(?P<subject>\d+)/maps/(?P<role>tstat|pvalue)\.nii(\.gz)?$`,
        discoveryMaxDepth: 6,
        discoveryMaxFiles: 42,
        discoveryDryRun: true,
        discoverySampleHeaders: false,
        discoveryRequiredRoles: expect.arrayContaining(['tstat', 'pvalue']),
        discoveryRolePatterns: expect.arrayContaining([
          { role: 'tstat', patterns: ['tstat', 'spmT'] },
        ]),
      }),
    });
  });

  it('does not reuse seeded or stale candidates when backend preview fails', async () => {
    const staleCandidate = makeDiscoveryCandidate();
    useSetStudioStore
      .getState()
      .setImportPreviewResult('regex', [staleCandidate], 'backend');
    expect(useSetStudioStore.getState().importCandidates[staleCandidate.id]).toBeTruthy();

    const invoke = vi.fn().mockRejectedValue(new Error('backend unavailable'));
    const service = new SetIngestionService({ invoke } as BackendTransport);

    await service.openImportPreview('regex');

    const state = useSetStudioStore.getState();
    expect(state.importDialog.source).toBe('fallback');
    expect(state.importDialog.error).toBe('backend unavailable');
    expect(state.importDialog.selectedCandidateId).toBeNull();
    expect(
      Object.values(state.importCandidates).some((candidate) => candidate.mode === 'regex')
    ).toBe(false);
  });

  it('exports local discovery candidates through the promotion command', async () => {
    const candidate = withDiscoveryRoot(makeDiscoveryCandidate(), '/tmp/study');
    const invoke = vi.fn().mockResolvedValue({
      datasetId: 'study_regex_preview',
      manifestPath: '/tmp/study/brainflow_nftab.yaml',
      files: [],
      preview: candidate,
      message: 'Saved NeuroTabs manifest package to /tmp/study.',
    });
    const service = new SetIngestionService({ invoke } as BackendTransport);

    await service.exportDiscoveryNeuroTabs(candidate);

    expect(invoke).toHaveBeenCalledWith('promote_discovery_to_neurotabs', {
      request: {
        candidate,
        outputDir: '/tmp/study',
      },
    });
  });

  it('rejects remote discovery roots before export', async () => {
    const candidate = withDiscoveryRoot(makeDiscoveryCandidate(), 'sftp://example.org/study');
    const invoke = vi.fn();
    const service = new SetIngestionService({ invoke } as unknown as BackendTransport);

    await expect(service.exportDiscoveryNeuroTabs(candidate)).rejects.toThrow(
      'local discovery roots'
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});
