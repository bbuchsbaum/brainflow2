import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SetIngestionService } from '../SetIngestionService';
import { useSetStudioStore } from '@/stores/setStudioStore';
import type { BackendTransport } from '@/services/transport';
import type { StudioImportCandidate } from '@/types/studio';

describe('SetIngestionService', () => {
  beforeEach(() => {
    useSetStudioStore.setState(useSetStudioStore.getInitialState());
  });

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
    const fallbackCandidate = useSetStudioStore.getState().importCandidates['candidate-regex-b'];
    const invoke = vi.fn().mockResolvedValue([fallbackCandidate]);
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

  it('exports local discovery candidates through the promotion command', async () => {
    const fallbackCandidate = useSetStudioStore.getState().importCandidates[
      'candidate-regex-b'
    ] as StudioImportCandidate;
    const candidate = withDiscoveryRoot(fallbackCandidate, '/tmp/study');
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
    const fallbackCandidate = useSetStudioStore.getState().importCandidates[
      'candidate-regex-b'
    ] as StudioImportCandidate;
    const candidate = withDiscoveryRoot(fallbackCandidate, 'sftp://example.org/study');
    const invoke = vi.fn();
    const service = new SetIngestionService({ invoke } as unknown as BackendTransport);

    await expect(service.exportDiscoveryNeuroTabs(candidate)).rejects.toThrow(
      'local discovery roots'
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});
