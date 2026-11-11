import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REVIEW_PREVIEW_REUSE_MS, SetIngestionService } from '../SetIngestionService';
import { useAppModeStore } from '@/stores/appModeStore';
import { useSetStudioStore } from '@/stores/setStudioStore';
import type { BackendTransport } from '@/services/transport';
import type { StudioFolderOntologySummary, StudioImportCandidate } from '@/types/studio';
import { studioReadiness } from '../studioReadiness';

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
      contract: {
        readiness: 'compare_ready',
        provenanceKind: 'regex_discovery',
        provenanceLabel: 'root=/tmp/study',
        canImport: true,
        capabilities: ['import', 'deck', 'compare', 'materialize_compare', 'export_neurotabs'],
        reason: 'Fixture discovery is compare-ready.',
      },
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

  function withDiscoveryRoot(
    candidate: StudioImportCandidate,
    root: string,
  ): StudioImportCandidate {
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

  function makeOntologySummary(): StudioFolderOntologySummary {
    return {
      root: '/tmp/study',
      rootExists: true,
      sourceLabel: null,
      scannedFiles: 4,
      neuroimagingFiles: 4,
      truncated: false,
      candidates: [
        {
          id: 'maps-basename-roles',
          label: 'Subject maps with basename roles',
          description: 'Treat basenames as roles.',
          strategy: 'path_subject_maps_basename_role',
          score: 0.95,
          coverage: 1,
          completeness: 1,
          matchedFiles: 4,
          unmatchedFiles: 0,
          duplicateKeys: 0,
          missingRoleBindings: 0,
          filePattern: String.raw`(?P<subject>[^/]+)/maps/(?P<role>[^/]+)\.nii(\.gz)?$`,
          designColumns: ['subject'],
          observedRoles: ['auc', 'tstat'],
          requiredRoles: ['auc', 'tstat'],
          rolePatterns: [
            { role: 'auc', patterns: ['auc'] },
            { role: 'tstat', patterns: ['tstat'] },
          ],
          factors: [
            { name: 'subject', source: 'path_entity', values: ['sub-01'], confidence: 0.95 },
          ],
          roles: [],
          groups: [],
          reasons: ['Found image files beneath maps folders.'],
          warnings: [],
        },
      ],
      warnings: [],
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
        discoveryRequiredRoles: ['pvalue'],
        discoveryRolePatterns: expect.arrayContaining([
          { role: 'tstat', patterns: ['tstat', 'spmT'] },
        ]),
      }),
    });
  });

  it('sends folder ontology controls to the backend preview command', async () => {
    const summary = makeOntologySummary();
    const invoke = vi.fn().mockResolvedValue(summary);
    const service = new SetIngestionService({ invoke } as BackendTransport);
    const store = useSetStudioStore.getState();

    store.setDiscoveryRoot('/tmp/study');
    store.setDiscoveryMaxDepth('5');
    store.setDiscoveryMaxFiles('80');

    await service.openFolderOntologyPreview();

    expect(invoke).toHaveBeenCalledWith('preview_folder_ontology', {
      request: {
        root: '/tmp/study',
        maxDepth: 5,
        maxFiles: 80,
        includePatterns: [],
        excludePatterns: [],
      },
    });
    expect(useSetStudioStore.getState().importDialog.ontologyPreview).toEqual(summary);
  });

  it('does not reuse seeded or stale candidates when backend preview fails', async () => {
    const staleCandidate = makeDiscoveryCandidate();
    useSetStudioStore.getState().setImportPreviewResult('regex', [staleCandidate], 'backend');
    expect(useSetStudioStore.getState().importCandidates[staleCandidate.id]).toBeTruthy();

    const invoke = vi.fn().mockRejectedValue(new Error('backend unavailable'));
    const service = new SetIngestionService({ invoke } as BackendTransport);

    await service.openImportPreview('regex');

    const state = useSetStudioStore.getState();
    expect(state.importDialog.source).toBe('fallback');
    expect(state.importDialog.error).toBe('backend unavailable');
    expect(state.importDialog.selectedCandidateId).toBeNull();
    expect(
      Object.values(state.importCandidates).some((candidate) => candidate.mode === 'regex'),
    ).toBe(false);
  });

  it('opens a manifest chooser and previews exactly the chosen file', async () => {
    const candidate = { ...makeDiscoveryCandidate(), id: 'candidate-manifest', mode: 'manifest' as const };
    const invoke = vi.fn(async (command: string) =>
      command === 'plugin:dialog|open' ? '/tmp/study/chosen.neurotabs.yaml' : [candidate],
    );
    const service = new SetIngestionService({ invoke } as unknown as BackendTransport);

    await service.chooseManifestPreview();

    expect(invoke.mock.calls[0][0]).toBe('plugin:dialog|open');
    expect(invoke.mock.calls[0][1]).toMatchObject({
      options: { directory: false, multiple: false, filters: [{ extensions: ['yaml', 'yml', 'json'] }] },
    });
    expect(invoke).toHaveBeenCalledWith('preview_set_studio_imports', {
      request: expect.objectContaining({ mode: 'manifest', manifestPath: '/tmp/study/chosen.neurotabs.yaml' }),
    });
    const dialog = useSetStudioStore.getState().importDialog;
    expect(dialog.isOpen).toBe(true);
    expect(dialog.manifestPath).toBe('/tmp/study/chosen.neurotabs.yaml');
  });

  it('does nothing when the manifest chooser is cancelled', async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    const service = new SetIngestionService({ invoke } as unknown as BackendTransport);

    await service.chooseManifestPreview();

    expect(invoke).toHaveBeenCalledTimes(1);
    const dialog = useSetStudioStore.getState().importDialog;
    expect(dialog.isOpen).toBe(false);
    expect(dialog.manifestPath).toBe('');
  });

  it('reports a failed manifest chooser in the import dialog', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('dialog unavailable'));
    const service = new SetIngestionService({ invoke } as unknown as BackendTransport);

    await service.chooseManifestPreview();

    const dialog = useSetStudioStore.getState().importDialog;
    expect(dialog.isOpen).toBe(true);
    expect(dialog.mode).toBe('manifest');
    expect(dialog.error).toContain('dialog unavailable');
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
      'local discovery roots',
    );
    expect(invoke).not.toHaveBeenCalled();
  });
  it('carries the exact selected source through folder review and leaves the study until confirm', async () => {
    const ontology = makeOntologySummary();
    ontology.root = '/cache/mount-a/high/full';
    ontology.sourceLabel = 'trillium · /scratch/brad/high/full';
    ontology.candidates[0].requiredRoles = [];
    const candidate = makeDiscoveryCandidate();
    const invoke = vi.fn(async (command: string) =>
      command === 'preview_folder_ontology' ? ontology : [candidate],
    );
    const service = new SetIngestionService({ invoke } as BackendTransport);
    useSetStudioStore.getState().loadDemoSession();
    const previous = useSetStudioStore.getState().selection.activeSetId;
    await service.openFolderReview(ontology.root);
    expect(invoke).toHaveBeenCalledWith(
      'preview_folder_ontology',
      expect.objectContaining({
        request: expect.objectContaining({ root: ontology.root }),
        ticket: expect.any(Object),
      }),
    );
    expect(invoke).toHaveBeenCalledWith(
      'preview_set_studio_imports',
      expect.objectContaining({
        request: expect.objectContaining({
          discoveryRoot: ontology.root,
          discoveryRequiredRoles: [],
          discoverySampleHeaders: false,
        }),
      }),
    );
    expect(useSetStudioStore.getState().selection.activeSetId).toBe(previous);
    await service.confirmReview();
    expect(useSetStudioStore.getState().selection.activeSetId).toBe(candidate.set.id);
    expect(
      invoke.mock.calls.filter(([command]) => command === 'preview_set_studio_imports'),
    ).toHaveLength(2);
  });

  it('cancels an owned scan and ignores its late result', async () => {
    let finish!: (value: StudioFolderOntologySummary) => void;
    const invoke = vi.fn((command: string) =>
      command === 'preview_folder_ontology'
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(null),
    );
    const service = new SetIngestionService({ invoke } as BackendTransport);
    useSetStudioStore.getState().loadDemoSession();
    const previous = useSetStudioStore.getState().selection;
    const pending = service.openFolderReview('/tmp/study');
    service.cancelReview();
    finish(makeOntologySummary());
    await pending;
    expect(invoke).toHaveBeenCalledWith('cancel_population_sample', { ticket: expect.any(Object) });
    expect(invoke.mock.calls.some(([command]) => command === 'preview_set_studio_imports')).toBe(
      false,
    );
    expect(useSetStudioStore.getState().selection).toEqual(previous);
    expect(useSetStudioStore.getState().importDialog.isOpen).toBe(false);
  });

  it('cancels a running preview in the backend when a field is edited', async () => {
    let finish!: (value: StudioFolderOntologySummary) => void;
    const invoke = vi.fn<(command: string, args?: { ticket?: unknown }) => Promise<unknown>>((command) =>
      command === 'preview_folder_ontology'
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(null),
    );
    const service = new SetIngestionService({ invoke } as unknown as BackendTransport);
    const pending = service.openFolderReview('/tmp/study');
    const ticket = invoke.mock.calls.find(([command]) => command === 'preview_folder_ontology')?.[1]
      ?.ticket as { id: string; expiresAtMs: number };
    // The longest lifetime the backend admits; it ends the command itself then.
    expect(ticket.expiresAtMs - Date.now()).toBeLessThanOrEqual(120_000);
    expect(ticket.expiresAtMs - Date.now()).toBeGreaterThan(119_000);
    service.editFolderReview('pattern', 'different');
    expect(invoke).toHaveBeenCalledWith('cancel_population_sample', { ticket });
    finish(makeOntologySummary());
    await pending;
  });

  it('says a folder preview was stopped at its two-minute deadline, not that it was cancelled', async () => {
    vi.useFakeTimers();
    try {
      let fail!: (error: unknown) => void;
      const invoke = vi.fn((command: string) =>
        command === 'preview_folder_ontology'
          ? new Promise((_resolve, reject) => {
              fail = reject;
            })
          : Promise.resolve(null),
      );
      const service = new SetIngestionService({ invoke } as unknown as BackendTransport);
      const pending = service.openFolderReview('/tmp/study');
      vi.advanceTimersByTime(120_000);
      fail({ Input: { code: 2026, details: 'Population sampling canceled or expired.' } });
      await pending;
      expect(useSetStudioStore.getState().importDialog.ontologyError).toBe(
        'Reading this folder took longer than two minutes and was stopped. Narrow the folder or the filename rule and try again.',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not validate or open a truncated proposal', async () => {
    const ontology = { ...makeOntologySummary(), truncated: true };
    const invoke = vi.fn().mockResolvedValue(ontology);
    const service = new SetIngestionService({ invoke } as BackendTransport);
    await service.openFolderReview('/tmp/study');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(useSetStudioStore.getState().importDialog.selectedCandidateId).toBeNull();
  });

  it('invalidates a ready candidate when its filename rule changes', async () => {
    const invoke = vi.fn(async (command: string) =>
      command === 'preview_folder_ontology' ? makeOntologySummary() : [makeDiscoveryCandidate()],
    );
    const service = new SetIngestionService({ invoke } as BackendTransport);
    await service.openFolderReview('/tmp/study');
    service.editFolderReview('pattern', 'different');
    expect(useSetStudioStore.getState().importDialog.selectedCandidateId).toBeNull();
    await service.confirmReview();
    expect(useSetStudioStore.getState().selection.activeSetId).toBeNull();
  });
  it('retains a review through StrictMode remount and cancels it on final panel teardown', async () => {
    const service = new SetIngestionService({ invoke: vi.fn() } as BackendTransport);
    useSetStudioStore
      .getState()
      .dispatchImportEvent({ type: 'FOLDER_REVIEW_OPENED', root: '/tmp/study' });
    const first = service.retainFolderReview();
    first();
    const second = service.retainFolderReview();
    await Promise.resolve();
    expect(useSetStudioStore.getState().importDialog.isOpen).toBe(true);
    second();
    await Promise.resolve();
    expect(useSetStudioStore.getState().importDialog.isOpen).toBe(false);
  });
  it('preserves structured remote error details for reconnect and retry', async () => {
    const service = new SetIngestionService({
      invoke: vi.fn().mockRejectedValue({
        Input: {
          code: 9001,
          details: 'Mount trillium is disconnected; reconnect it.',
        },
      }),
    } as BackendTransport);
    await service.openFolderReview('/cache/mount/full');
    expect(useSetStudioStore.getState().importDialog.ontologyError).toBe(
      'Mount trillium is disconnected; reconnect it.',
    );
    expect(useSetStudioStore.getState().importDialog.discoveryRoot).toBe('/cache/mount/full');
  });
  it('does not revive an old scan when the root changes away and back', async () => {
    let finish!: (value: StudioFolderOntologySummary) => void;
    const invoke = vi.fn((command: string) =>
      command === 'preview_folder_ontology'
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(null),
    );
    const service = new SetIngestionService({ invoke } as BackendTransport);
    const pending = service.openFolderReview('/tmp/study');
    service.editFolderReview('root', '/tmp/other');
    service.editFolderReview('root', '/tmp/study');
    finish(makeOntologySummary());
    await pending;
    expect(useSetStudioStore.getState().importDialog.ontologyPreview).toBeNull();
    expect(useSetStudioStore.getState().importDialog.selectedCandidateId).toBeNull();
  });
  describe('image grid checks', () => {
    const ROOT = '/tmp/study';

    function uncheckedCandidate(): StudioImportCandidate {
      const candidate = withDiscoveryRoot(makeDiscoveryCandidate(), ROOT);
      return {
        ...candidate,
        contract: {
          ...candidate.contract,
          readiness: 'review_required',
          capabilities: ['import', 'deck'],
          reason: 'Backend audit found warnings; import for review before compare.',
        },
        set: {
          ...candidate.set,
          supportLabel: 'headers not sampled',
          alignmentClass: 'unknown',
          ingestAudit: {
            ...candidate.set.ingestAudit,
            support: {
              supportLabel: 'headers not sampled',
              alignmentClass: 'unknown',
              readyForCompare: false,
              severity: 'ok',
            },
          },
        },
      };
    }

    /** Open the unchecked candidate as the active set, the way folder review does. */
    function openUnchecked() {
      const store = useSetStudioStore.getState();
      store.dispatchImportEvent({ type: 'FOLDER_REVIEW_OPENED', root: ROOT });
      store.setImportPreviewResult('regex', [uncheckedCandidate()], 'backend');
      useSetStudioStore.getState().confirmImportCandidate();
      const state = useSetStudioStore.getState();
      expect(state.selection.activeSetId).toBe('fixture-discovery');
      return state.sets['fixture-discovery'];
    }

    it('sends the header check with the folder review preview and runs it again', async () => {
      const invoke = vi.fn().mockResolvedValue([uncheckedCandidate()]);
      const service = new SetIngestionService({ invoke } as BackendTransport);
      const store = useSetStudioStore.getState();
      store.dispatchImportEvent({ type: 'FOLDER_REVIEW_OPENED', root: ROOT });
      store.setFilePattern('(?P<subject>[^/]+)/maps/(?P<role>tstat)');

      await service.setFolderReviewGridCheck(true);

      expect(invoke).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledWith(
        'preview_set_studio_imports',
        expect.objectContaining({
          request: expect.objectContaining({ discoveryRoot: ROOT, discoverySampleHeaders: true }),
        }),
      );
      expect(useSetStudioStore.getState().importDialog.selectedCandidateId).toBe(
        'candidate-regex-fixture',
      );
      await service.setFolderReviewGridCheck(true);
      expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('keeps how a folder-opened set was found', () => {
      expect(openUnchecked().discoveryRequest).toEqual({
        root: ROOT,
        filePattern: '(?P<subject>[^/]+)/maps/(?P<role>tstat)\\.nii(\\.gz)?$',
        includePatterns: [],
        excludePatterns: [],
        rolePatterns: [{ role: 'tstat', patterns: ['tstat'] }],
        requiredRoles: ['tstat'],
        maxDepth: 4,
        maxFiles: 100,
      });
    });

    it('checks the open set in place and keeps the lens, member and selection', async () => {
      openUnchecked();
      const checked = makeDiscoveryCandidate();
      checked.set.supportLabel = '2 mm grid (sampled)';
      const invoke = vi.fn().mockResolvedValue([withDiscoveryRoot(checked, ROOT)]);
      const service = new SetIngestionService({ invoke } as BackendTransport);
      const before = useSetStudioStore.getState();
      const dialog = before.importDialog;

      const pending = service.checkActiveSetGrids();
      expect(useSetStudioStore.getState().gridCheck.status).toBe('checking');
      await pending;

      expect(invoke).toHaveBeenCalledWith('preview_set_studio_imports', {
        request: expect.objectContaining({
          mode: 'regex',
          discoveryRoot: ROOT,
          filePattern: '(?P<subject>[^/]+)/maps/(?P<role>tstat)\\.nii(\\.gz)?$',
          discoveryMaxDepth: 4,
          discoveryMaxFiles: 100,
          discoveryRequiredRoles: ['tstat'],
          discoveryRolePatterns: [{ role: 'tstat', patterns: ['tstat'] }],
          discoverySampleHeaders: true,
        }),
        // Cancellable: the check runs under a ticket (review item 3).
        ticket: { id: expect.any(String), expiresAtMs: expect.any(Number) },
      });
      expect(invoke.mock.calls.some(([command]) => command === 'cancel_population_sample')).toBe(
        false,
      );
      const after = useSetStudioStore.getState();
      const set = after.sets['fixture-discovery'];
      expect(set.importContract?.readiness).toBe('compare_ready');
      expect(set.importContract?.capabilities).toContain('compare');
      expect(set.supportLabel).toBe('2 mm grid (sampled)');
      expect(set.alignmentClass).toBe('same-grid');
      expect(set.ingestAudit.support.readyForCompare).toBe(true);
      expect(set.discoveryRequest).toBe(before.sets['fixture-discovery'].discoveryRequest);
      expect(after.gridCheck).toEqual({ status: 'idle', message: null });
      expect(after.selection).toBe(before.selection);
      expect(after.population.sessionRevision).toBe(before.population.sessionRevision);
      expect(after.importDialog).toBe(dialog);
    });

    it('drops the result when another set was opened while the check ran', async () => {
      openUnchecked();
      const check = gatedCheck();
      const service = new SetIngestionService({ invoke: check.invoke } as unknown as BackendTransport);
      const pending = service.checkActiveSetGrids();
      const reopened = openUnchecked();
      // The backend is told to stop reading headers, not only ignored.
      expect(check.cancelledTickets()).toEqual([check.ticket()]);
      check.finish([withDiscoveryRoot(makeDiscoveryCandidate(), ROOT)]);
      await pending;
      const state = useSetStudioStore.getState();
      expect(state.sets['fixture-discovery']).toBe(reopened);
      expect(state.sets['fixture-discovery'].importContract?.readiness).toBe('review_required');
      expect(state.gridCheck).toEqual({ status: 'idle', message: null });
    });

    /** A grid check whose preview command finishes only when told to. */
    function gatedCheck() {
      let finish!: (value: StudioImportCandidate[]) => void;
      let fail!: (error: unknown) => void;
      const invoke = vi.fn<(command: string, args?: { ticket?: unknown }) => Promise<unknown>>((command) =>
        command === 'preview_set_studio_imports'
          ? new Promise<StudioImportCandidate[]>((resolve, reject) => {
              finish = resolve;
              fail = reject;
            })
          : Promise.resolve(null),
      );
      const ticketsOf = (command: string) =>
        invoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args?.ticket);
      return {
        invoke,
        finish: (value: StudioImportCandidate[]) => finish(value),
        fail: (error: unknown) => fail(error),
        ticket: () => ticketsOf('preview_set_studio_imports')[0],
        previews: () => ticketsOf('preview_set_studio_imports').length,
        cancelledTickets: () => ticketsOf('cancel_population_sample'),
      };
    }

    it('cancels the check in the backend when the Studio is left, and offers it again', async () => {
      useAppModeStore.setState({ mode: 'studio' });
      const opened = openUnchecked();
      const check = gatedCheck();
      const service = new SetIngestionService({ invoke: check.invoke } as unknown as BackendTransport);
      const pending = service.checkActiveSetGrids();
      expect(check.cancelledTickets()).toEqual([]);

      useAppModeStore.setState({ mode: 'imaging' });

      expect(check.cancelledTickets()).toEqual([check.ticket()]);
      expect(useSetStudioStore.getState().gridCheck).toEqual({ status: 'idle', message: null });
      // What the cancelled command answers is dropped, an error included.
      check.fail({ Input: { code: 2026, details: 'Population sampling canceled or expired.' } });
      await pending;
      expect(useSetStudioStore.getState().sets['fixture-discovery']).toBe(opened);
      expect(useSetStudioStore.getState().gridCheck).toEqual({ status: 'idle', message: null });
    });

    it('cancels the check when another set becomes the active one', async () => {
      openUnchecked();
      const check = gatedCheck();
      const service = new SetIngestionService({ invoke: check.invoke } as unknown as BackendTransport);
      const pending = service.checkActiveSetGrids();
      useSetStudioStore.setState((state) => ({
        selection: { ...state.selection, activeSetId: 'another-set' },
      }));
      expect(check.cancelledTickets()).toEqual([check.ticket()]);
      // The new active set is not shown as being checked.
      expect(useSetStudioStore.getState().gridCheck.status).toBe('idle');
      check.finish([withDiscoveryRoot(makeDiscoveryCandidate(), ROOT)]);
      await pending;
      expect(
        useSetStudioStore.getState().sets['fixture-discovery'].importContract?.readiness,
      ).toBe('review_required');
    });

    it('does not start a second check while one runs, and cancels on request', async () => {
      openUnchecked();
      const check = gatedCheck();
      const service = new SetIngestionService({ invoke: check.invoke } as unknown as BackendTransport);
      const pending = service.checkActiveSetGrids();
      await service.checkActiveSetGrids();
      expect(check.previews()).toBe(1);
      service.cancelGridCheck();
      expect(check.cancelledTickets()).toEqual([check.ticket()]);
      check.finish([]);
      await pending;
      expect(useSetStudioStore.getState().gridCheck).toEqual({ status: 'idle', message: null });
    });

    it('says so when the backend stopped the check at its two-minute ticket deadline', async () => {
      vi.useFakeTimers();
      try {
        openUnchecked();
        const check = gatedCheck();
        const service = new SetIngestionService({ invoke: check.invoke } as unknown as BackendTransport);
        const pending = service.checkActiveSetGrids();
        vi.advanceTimersByTime(120_000);
        check.fail({ Input: { code: 2026, details: 'Population sampling canceled or expired.' } });
        await pending;
        expect(useSetStudioStore.getState().gridCheck).toEqual({
          status: 'failed',
          message:
            'The image grids could not be checked: reading the image headers took longer than two minutes and was stopped.',
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not start the check again by itself after its ticket expired', async () => {
      vi.useFakeTimers();
      try {
        useAppModeStore.setState({ mode: 'studio' });
        openUnchecked();
        const check = gatedCheck();
        const service = new SetIngestionService({ invoke: check.invoke } as unknown as BackendTransport);
        service.autoCheckActiveSetGrids();
        expect(check.previews()).toBe(1);
        vi.advanceTimersByTime(120_000);
        check.fail({ Input: { code: 2026, details: 'Population sampling canceled or expired.' } });
        await vi.advanceTimersByTimeAsync(0);

        const failed = useSetStudioStore.getState().gridCheck;
        expect(failed.status).toBe('failed');
        expect(failed.message).toContain('took longer than two minutes');
        // A local folder's check starts over: it is a retry, not a continuation.
        expect(failed.resumable).toBeFalsy();
        // The expiry was not a user's cancel, so nothing was sent to stop it.
        expect(check.cancelledTickets()).toEqual([]);
        // Failed, and left for the user: neither the automatic check nor a
        // store change starts another.
        service.autoCheckActiveSetGrids();
        useSetStudioStore.getState().setStudioPlane('coronal');
        service.autoCheckActiveSetGrids();
        expect(check.previews()).toBe(1);
        expect(useSetStudioStore.getState().gridCheck.status).toBe('failed');
      } finally {
        vi.useRealTimers();
      }
    });

    it('offers to continue a check that timed out on a remote mount, where the headers read are kept', async () => {
      vi.useFakeTimers();
      try {
        // Opened from a remote mount: the set says which connection it lives on.
        const store = useSetStudioStore.getState();
        store.dispatchImportEvent({
          type: 'FOLDER_REVIEW_OPENED',
          root: ROOT,
          source: { root: ROOT, displayPath: '/scratch/study', label: 'brad@cluster' },
        });
        store.setImportPreviewResult('regex', [uncheckedCandidate()], 'backend');
        useSetStudioStore.getState().confirmImportCandidate();
        const check = gatedCheck();
        const service = new SetIngestionService({ invoke: check.invoke } as unknown as BackendTransport);

        const pending = service.checkActiveSetGrids();
        vi.advanceTimersByTime(120_000);
        check.fail({ Input: { code: 2026, details: 'Population sampling canceled or expired.' } });
        expect(await pending).toBe('failed');
        expect(useSetStudioStore.getState().gridCheck).toEqual({
          status: 'failed',
          message:
            'Reading the image headers took longer than two minutes and was stopped. The headers already read are kept: continue to read the rest.',
          resumable: true,
        });
        const set = useSetStudioStore.getState().sets['fixture-discovery'];
        expect(
          studioReadiness(set, useSetStudioStore.getState().gridCheck, 'population'),
        ).toMatchObject({ phase: 'check-failed', action: 'continue' });

        // Any other failure there is a plain retry: nothing says headers were kept.
        const again = service.checkActiveSetGrids();
        check.fail(new Error('Mount is disconnected'));
        expect(await again).toBe('failed');
        expect(useSetStudioStore.getState().gridCheck.resumable).toBeFalsy();
        expect(
          studioReadiness(set, useSetStudioStore.getState().gridCheck, 'population'),
        ).toMatchObject({ phase: 'check-failed', action: 'retry' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('says a check ran when its audit still does not answer, instead of offering it again', async () => {
      const opened = openUnchecked();
      // The audit comes back as it went in: grid unknown, nothing wrong reported.
      const unanswered = uncheckedCandidate();
      unanswered.set.ingestAudit = {
        ...unanswered.set.ingestAudit,
        notes: ['Read 0 image header(s); the folder holds no readable volume.'],
      };
      const invoke = vi.fn(async (command: string) =>
        command === 'preview_set_studio_imports' ? [unanswered] : null,
      );
      const service = new SetIngestionService({ invoke } as unknown as BackendTransport);
      expect(studioReadiness(opened, useSetStudioStore.getState().gridCheck, 'population')).toMatchObject(
        { phase: 'needs-check', action: 'check' },
      );

      expect(await service.checkActiveSetGrids()).toBe('failed');

      const state = useSetStudioStore.getState();
      expect(state.gridCheck.status).toBe('failed');
      expect(state.gridCheck.message).toBe(
        'The image headers were read, but the check did not say whether the images share one grid: Read 0 image header(s); the folder holds no readable volume.',
      );
      const readiness = studioReadiness(state.sets['fixture-discovery'], state.gridCheck, 'population');
      expect(readiness.phase).toBe('check-failed');
      expect(readiness.action).toBe('retry');
      expect(readiness.detail).toContain('the folder holds no readable volume');
      // Not started again by itself.
      service.autoCheckActiveSetGrids();
      expect(
        invoke.mock.calls.filter(([command]) => command === 'preview_set_studio_imports'),
      ).toHaveLength(1);
    });

    describe('Open set after a header-checking preview', () => {
      const previews = (invoke: ReturnType<typeof vi.fn>) =>
        invoke.mock.calls.filter(([command]) => command === 'preview_set_studio_imports').length;

      async function reviewWithGridCheck(candidates: () => StudioImportCandidate[]) {
        const invoke = vi.fn(async (command: string) =>
          command === 'preview_set_studio_imports' ? candidates() : null,
        );
        const service = new SetIngestionService({ invoke } as unknown as BackendTransport);
        const store = useSetStudioStore.getState();
        store.dispatchImportEvent({ type: 'FOLDER_REVIEW_OPENED', root: ROOT });
        store.setFilePattern('(?P<subject>[^/]+)/maps/(?P<role>tstat)');
        await service.setFolderReviewGridCheck(true);
        expect(previews(invoke)).toBe(1);
        return { invoke, service };
      }

      it('opens the draft the check just produced without reading every header again', async () => {
        const { invoke, service } = await reviewWithGridCheck(() => [
          withDiscoveryRoot(makeDiscoveryCandidate(), ROOT),
        ]);
        await service.confirmReview();
        expect(previews(invoke)).toBe(1);
        expect(useSetStudioStore.getState().selection.activeSetId).toBe('fixture-discovery');
      });

      it('scans again, and refuses changed files, once the check is no longer fresh', async () => {
        vi.useFakeTimers();
        try {
          let moved = false;
          const { invoke, service } = await reviewWithGridCheck(() => {
            const candidate = withDiscoveryRoot(makeDiscoveryCandidate(), ROOT);
            if (moved)
              candidate.discovery = {
                ...candidate.discovery!,
                groups: [...(candidate.discovery?.groups ?? []), { subject: 'new' } as never],
              };
            return [candidate];
          });
          moved = true;
          vi.advanceTimersByTime(REVIEW_PREVIEW_REUSE_MS + 1);
          await service.confirmReview();
          expect(previews(invoke)).toBe(2);
          expect(useSetStudioStore.getState().selection.activeSetId).toBeNull();
          expect(useSetStudioStore.getState().importDialog.error).toBe(
            'The files changed since the preview. Scan again and review the new assignments.',
          );
        } finally {
          vi.useRealTimers();
        }
      });

      it('does not open a draft from a check made before a field was edited', async () => {
        const { invoke, service } = await reviewWithGridCheck(() => [
          withDiscoveryRoot(makeDiscoveryCandidate(), ROOT),
        ]);
        const depth = useSetStudioStore.getState().importDialog.discoveryMaxDepth;
        service.editFolderReview('depth', '9');
        // Back to the very request the check was made for.
        service.editFolderReview('depth', depth);
        await service.confirmReview();
        expect(useSetStudioStore.getState().selection.activeSetId).toBeNull();
        // A new check of that request is the one "Open set" may use.
        await service.openImportPreview('regex');
        expect(previews(invoke)).toBe(2);
        await service.confirmReview();
        expect(previews(invoke)).toBe(2);
        expect(useSetStudioStore.getState().selection.activeSetId).toBe('fixture-discovery');
      });

      it('still scans again before opening a draft whose headers were not read', async () => {
        const invoke = vi.fn(async (command: string) =>
          command === 'preview_set_studio_imports'
            ? [withDiscoveryRoot(makeDiscoveryCandidate(), ROOT)]
            : null,
        );
        const service = new SetIngestionService({ invoke } as unknown as BackendTransport);
        const store = useSetStudioStore.getState();
        store.dispatchImportEvent({ type: 'FOLDER_REVIEW_OPENED', root: ROOT });
        store.setFilePattern('(?P<subject>[^/]+)/maps/(?P<role>tstat)');
        await service.openImportPreview('regex');
        await service.confirmReview();
        expect(previews(invoke)).toBe(2);
        expect(useSetStudioStore.getState().selection.activeSetId).toBe('fixture-discovery');
      });
    });

    it('refuses a result whose files differ from the open set', async () => {
      const opened = openUnchecked();
      const moved = withDiscoveryRoot(makeDiscoveryCandidate(), ROOT);
      moved.set.memberSummaries = [{ id: '1001', sourcePath: '/tmp/study/1001/maps/other.nii.gz' }];
      const service = new SetIngestionService({
        invoke: vi.fn().mockResolvedValue([moved]),
      } as BackendTransport);
      await service.checkActiveSetGrids();
      const state = useSetStudioStore.getState();
      expect(state.sets['fixture-discovery']).toBe(opened);
      expect(state.gridCheck).toEqual({
        status: 'failed',
        message:
          'The files in this folder changed since the set was opened. Open the folder again to check its image grids.',
      });
    });

    it('reports a failed check and leaves the set as it was', async () => {
      const opened = openUnchecked();
      const service = new SetIngestionService({
        invoke: vi.fn().mockRejectedValue(new Error('Mount trillium is disconnected')),
      } as BackendTransport);
      await service.checkActiveSetGrids();
      const state = useSetStudioStore.getState();
      expect(state.sets['fixture-discovery']).toBe(opened);
      expect(state.gridCheck.status).toBe('failed');
      expect(state.gridCheck.message).toBe(
        'The image grids could not be checked: Mount trillium is disconnected',
      );
    });

    it('does nothing for a set that was not opened from a folder', async () => {
      useSetStudioStore.getState().loadDemoSession();
      const invoke = vi.fn();
      await new SetIngestionService({ invoke } as BackendTransport).checkActiveSetGrids();
      expect(invoke).not.toHaveBeenCalled();
      expect(useSetStudioStore.getState().gridCheck.status).toBe('idle');
    });
  });
});
