import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioImportDialog } from '../StudioImportDialog';
import { useSetStudioStore } from '@/stores/setStudioStore';
import type { StudioImportCandidate } from '@/types/studio';

const ingestionServiceMock = vi.hoisted(() => ({
  openImportPreview: vi.fn(),
  validateTablePreview: vi.fn(),
  exportDiscoveryNeuroTabs: vi.fn(),
}));

// Mock the ingestion service so Refresh doesn't hit the backend
vi.mock('@/services/studio/SetIngestionService', () => ({
  getSetIngestionService: () => ingestionServiceMock,
}));

describe('StudioImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSetStudioStore.setState(useSetStudioStore.getInitialState());
  });

  function openDialog(mode: 'manifest' | 'regex' | 'table' = 'regex') {
    useSetStudioStore.getState().openImportDialog(mode);
    // force isOpen since openImportDialog only switches mode when already open
    useSetStudioStore.setState({ importDialog: { ...useSetStudioStore.getState().importDialog, isOpen: true } });
  }

  function makeManifestCandidate(
    audit: {
      unmatchedRows?: number;
      duplicateKeys?: number;
      joinSeverity?: 'ok' | 'warning' | 'error';
      supportReady?: boolean;
      supportSeverity?: 'ok' | 'warning' | 'error';
    } = {}
  ): StudioImportCandidate {
    const joinSeverity = audit.joinSeverity ?? 'ok';
    const supportReady = audit.supportReady ?? true;
    const supportSeverity = audit.supportSeverity ?? (supportReady ? 'ok' : 'warning');
    const readiness =
      joinSeverity === 'error' || supportSeverity === 'error'
        ? 'inspect_only'
        : supportReady && (audit.unmatchedRows ?? 0) === 0 && (audit.duplicateKeys ?? 0) === 0
          ? 'compare_ready'
          : 'review_required';

    return {
      id: `candidate-${joinSeverity}-${supportSeverity}`,
      label: 'NeuroTabs manifest preview',
      description: 'Backend NeuroTabs preview candidate.',
      mode: 'manifest',
      sourceHint: '/tmp/study.neurotabs.yaml',
      contract: {
        readiness,
        provenanceKind: 'manifest',
        provenanceLabel: '/tmp/study.neurotabs.yaml',
        canImport: true,
        capabilities:
          readiness === 'compare_ready'
            ? ['import', 'deck', 'compare', 'materialize_compare']
            : ['import', 'deck'],
        reason: `Fixture contract: ${readiness}.`,
      },
      set: {
        id: 'fixture-study',
        name: 'Fixture Study',
        sourceKind: 'imported',
        memberCount: 2,
        primaryFeatureId: 'statmap',
        supportKind: 'volume',
        supportLabel: 'MNI152 fixture grid',
        alignmentClass: 'same-grid',
        designColumns: ['subject', 'group'],
        designTablePreview: {
          columns: ['subject', 'group'],
          rows: [{ id: 'sub-01', cells: ['sub-01', 'control'] }],
        },
        memberSummaries: [
          { id: 'sub-01', sourcePath: '/tmp/sub-01.nii.gz' },
          { id: 'sub-02', sourcePath: '/tmp/sub-02.nii.gz' },
        ],
        memberIds: ['sub-01', 'sub-02'],
        savedCohortIds: ['all-members'],
        ingestAudit: {
          sourceLabel: 'NeuroTabs manifest',
          join: {
            matchedRows: 2,
            unmatchedRows: audit.unmatchedRows ?? 0,
            duplicateKeys: audit.duplicateKeys ?? 0,
            severity: joinSeverity,
            issueDetails:
              joinSeverity === 'ok'
                ? []
                : [{ message: 'Fixture audit issue.', memberIds: ['sub-02'] }],
          },
          support: {
            supportLabel: 'MNI152 fixture grid',
            alignmentClass: 'same-grid',
            readyForCompare: supportReady,
            severity: supportSeverity,
          },
          notes: ['Fixture import candidate.'],
        },
      },
      features: [{ id: 'statmap', label: 'Stat Map', kind: 'volume' }],
      cohorts: [
        {
          id: 'all-members',
          label: 'All members',
          memberCount: 2,
          description: 'All fixture members.',
          memberIds: ['sub-01', 'sub-02'],
          originKind: 'imported',
          originLabel: 'Fixture',
        },
      ],
      expressions: [
        { id: 'member', label: 'Current member', kind: 'member', recipe: 'member(sub-01)', cohortId: null },
        {
          id: 'zscore',
          label: 'Z-score',
          kind: 'comparison',
          recipe: 'zscore(current, cohort:all-members)',
          cohortId: 'all-members',
        },
      ],
      materialization: null,
    };
  }

  function makeDiscoveryCandidate(): StudioImportCandidate {
    return {
      id: 'candidate-discovery-clean',
      label: 'Folder discovery preview',
      description: 'Backend folder discovery preview candidate.',
      mode: 'regex',
      sourceHint: 'root=/tmp/study pattern=subject/maps/role',
      contract: {
        readiness: 'compare_ready',
        provenanceKind: 'regex_discovery',
        provenanceLabel: 'root=/tmp/study pattern=subject/maps/role',
        canImport: true,
        capabilities: ['import', 'deck', 'compare', 'materialize_compare', 'export_neurotabs'],
        reason: 'Fixture discovery is compare-ready.',
      },
      set: {
        id: 'folder-study',
        name: 'Folder Study',
        sourceKind: 'imported',
        memberCount: 2,
        primaryFeatureId: 'tstat',
        supportKind: 'volume',
        supportLabel: '1x1x1 voxels',
        alignmentClass: 'same-grid',
        designColumns: ['subject', 'roles'],
        designTablePreview: {
          columns: ['subject', 'roles'],
          rows: [
            { id: '1001', cells: ['1001', 'beta,tstat,se,pvalue'] },
            { id: '1002', cells: ['1002', 'beta,tstat,se,pvalue'] },
          ],
        },
        memberSummaries: [
          {
            id: '1001',
            sourcePath: '/tmp/study/1001/maps/tstat.nii.gz',
            bindings: [
              {
                role: 'tstat',
                featureId: 'tstat',
                sourceLocator: '1001/maps/tstat.nii.gz',
                sourcePath: '/tmp/study/1001/maps/tstat.nii.gz',
                relativePath: '1001/maps/tstat.nii.gz',
                selector: null,
                supportKind: 'volume',
                supportLabel: '1x1x1 voxels',
                availability: 'available',
                isPrimary: true,
              },
            ],
          },
          {
            id: '1002',
            sourcePath: '/tmp/study/1002/maps/tstat.nii.gz',
            bindings: [
              {
                role: 'tstat',
                featureId: 'tstat',
                sourceLocator: '1002/maps/tstat.nii.gz',
                sourcePath: '/tmp/study/1002/maps/tstat.nii.gz',
                relativePath: '1002/maps/tstat.nii.gz',
                selector: null,
                supportKind: 'volume',
                supportLabel: '1x1x1 voxels',
                availability: 'available',
                isPrimary: true,
              },
            ],
          },
        ],
        memberIds: ['1001', '1002'],
        savedCohortIds: ['folder-all-members'],
        ingestAudit: {
          sourceLabel: 'Regex discovery',
          join: {
            matchedRows: 2,
            unmatchedRows: 0,
            duplicateKeys: 0,
            severity: 'ok',
            issueDetails: [],
          },
          support: {
            supportLabel: '1x1x1 voxels',
            alignmentClass: 'same-grid',
            readyForCompare: true,
            severity: 'ok',
          },
          notes: ['Grouped 8 matched files into 2 member sets.'],
        },
      },
      features: [{ id: 'tstat', label: 'tstat', kind: 'volume' }],
      cohorts: [
        {
          id: 'folder-all-members',
          label: 'All members',
          memberCount: 2,
          description: 'All discovered members.',
          memberIds: ['1001', '1002'],
          originKind: 'imported',
          originLabel: 'Folder discovery',
        },
      ],
      expressions: [
        { id: 'folder-member', label: 'Current member', kind: 'member', recipe: 'member(current)', cohortId: null },
        {
          id: 'folder-zscore',
          label: 'Z-score',
          kind: 'comparison',
          recipe: 'zscore(current, cohort:folder-all-members)',
          cohortId: 'folder-all-members',
        },
      ],
      materialization: { warm: 0, preview: 2, pending: 0, failed: 0 },
      discovery: {
        root: '/tmp/study',
        filePattern: '(?P<subject>[^/]+)/maps/(?P<role>beta|tstat|se|pvalue)\\.nii(\\.gz)?$',
        includePatterns: [],
        excludePatterns: [],
        rolePatterns: [
          { role: 'beta', patterns: ['beta'] },
          { role: 'tstat', patterns: ['tstat'] },
          { role: 'se', patterns: ['se'] },
          { role: 'pvalue', patterns: ['pvalue'] },
        ],
        maxDepth: 4,
        maxFiles: 500,
        dryRun: true,
        sampleHeaders: true,
        captureNames: ['subject', 'role'],
        inferredDesignColumns: ['subject', 'roles'],
        observedRoles: ['beta', 'pvalue', 'se', 'tstat'],
        requiredRoles: ['beta', 'tstat', 'se', 'pvalue'],
        matchedFiles: 8,
        unmatchedFiles: 0,
        duplicateKeys: 0,
        truncated: false,
        groups: [
          {
            memberId: '1001',
            designValues: [{ column: 'subject', value: '1001' }],
            missingRoles: [],
            duplicateRoles: [],
            confidence: 1,
            bindings: ['beta', 'tstat', 'se', 'pvalue'].map((role) => ({
              role,
              sourcePath: `/tmp/study/1001/maps/${role}.nii.gz`,
              relativePath: `1001/maps/${role}.nii.gz`,
              confidence: 1,
            })),
          },
          {
            memberId: '1002',
            designValues: [{ column: 'subject', value: '1002' }],
            missingRoles: ['se'],
            duplicateRoles: ['beta'],
            confidence: 0.75,
            bindings: ['beta', 'beta', 'tstat', 'pvalue'].map((role, index) => ({
              role,
              sourcePath: `/tmp/study/1002/maps/${role}${index === 1 ? '_repeat' : ''}.nii.gz`,
              relativePath: `1002/maps/${role}${index === 1 ? '_repeat' : ''}.nii.gz`,
              confidence: 1,
            })),
          },
        ],
      },
    };
  }

  function makeCleanDiscoveryCandidate(): StudioImportCandidate {
    const candidate = makeDiscoveryCandidate();
    const discovery = candidate.discovery!;
    return {
      ...candidate,
      discovery: {
        ...discovery,
        groups: discovery.groups.map((group) => ({
          ...group,
          missingRoles: [],
          duplicateRoles: [],
          bindings: ['beta', 'tstat', 'se', 'pvalue'].map((role) => ({
            role,
            sourcePath: `/tmp/study/${group.memberId}/maps/${role}.nii.gz`,
            relativePath: `${group.memberId}/maps/${role}.nii.gz`,
            confidence: 1,
          })),
        })),
      },
    };
  }

  function renderManifestCandidate(
    candidate: StudioImportCandidate,
    source: 'backend' | 'fallback' = 'backend'
  ) {
    openDialog('manifest');
    useSetStudioStore.getState().setImportPreviewResult('manifest', [candidate], source);
    render(<StudioImportDialog />);
  }

  it('renders nothing when closed', () => {
    const { container } = render(<StudioImportDialog />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders dialog title based on mode', () => {
    openDialog('regex');
    render(<StudioImportDialog />);
    expect(screen.getByText('Discover Files By Regex')).toBeInTheDocument();
  });

  it('shows all three tab labels', () => {
    openDialog('manifest');
    render(<StudioImportDialog />);
    expect(screen.getByText('From Table')).toBeInTheDocument();
    expect(screen.getByText('NeuroTabs Manifest')).toBeInTheDocument();
    expect(screen.getByText('Discover Files')).toBeInTheDocument();
  });

  it('switches mode when clicking a tab', () => {
    openDialog('manifest');
    render(<StudioImportDialog />);
    fireEvent.click(screen.getByText('Discover Files'));
    expect(useSetStudioStore.getState().importDialog.mode).toBe('regex');
  });

  it('starts regex import without seeded preview data', () => {
    openDialog('regex');
    render(<StudioImportDialog />);

    expect(screen.getByText('No preview candidate available.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import Into Studio' })).toBeDisabled();
  });

  it('starts manifest import without seeded preview data', () => {
    openDialog('manifest');
    render(<StudioImportDialog />);

    expect(screen.getByText('No preview candidate available.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import Into Studio' })).toBeDisabled();
  });

  it('renders the footer buttons (Cancel + Import)', () => {
    openDialog('regex');
    useSetStudioStore.getState().setImportPreviewResult('regex', [makeDiscoveryCandidate()], 'backend');
    render(<StudioImportDialog />);

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import For Compare' })).toBeInTheDocument();
  });

  it('renders "Import For Compare" for a clean manifest candidate', () => {
    renderManifestCandidate(makeManifestCandidate(), 'backend');

    expect(screen.getByRole('button', { name: 'Import For Compare' })).toBeInTheDocument();
  });

  it('shows readiness banner for clean manifest candidate', () => {
    renderManifestCandidate(makeManifestCandidate(), 'backend');

    expect(screen.getByText('Studio Ready')).toBeInTheDocument();
    expect(screen.getByText('Ready for compare-centered reading')).toBeInTheDocument();
  });

  it('maps a backend compare-ready candidate to the ready import state', () => {
    renderManifestCandidate(makeManifestCandidate(), 'backend');

    expect(screen.getByText('Preview source: backend')).toBeInTheDocument();
    expect(screen.getByText('Studio Ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import For Compare' })).toBeInTheDocument();
  });

  it('maps a backend warning candidate to the review import state', () => {
    renderManifestCandidate(
      makeManifestCandidate({
        unmatchedRows: 1,
        joinSeverity: 'warning',
        supportReady: false,
        supportSeverity: 'warning',
      }),
      'backend'
    );

    expect(screen.getByText('Preview source: backend')).toBeInTheDocument();
    expect(screen.getByText('Deck First')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import For Review' })).toBeInTheDocument();
  });

  it('maps a fallback error candidate to the blocked import state', () => {
    renderManifestCandidate(
      makeManifestCandidate({
        unmatchedRows: 1,
        joinSeverity: 'error',
        supportReady: false,
        supportSeverity: 'error',
      }),
      'fallback'
    );

    expect(screen.getByText('Preview source: fallback')).toBeInTheDocument();
    expect(screen.getByText('Audit Attention')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import For Inspection' })).toBeInTheDocument();
  });

  it('blocks importing an empty backend error candidate', () => {
    const blockedBase = makeManifestCandidate({
      joinSeverity: 'error',
      supportReady: false,
      supportSeverity: 'error',
    });
    const emptyErrorCandidate: StudioImportCandidate = {
      ...blockedBase,
      id: 'candidate-empty-error',
      description: 'Manifest preview failed; no fallback data was generated.',
      contract: {
        readiness: 'blocked',
        provenanceKind: 'backend_error',
        provenanceLabel: '/tmp/study.neurotabs.yaml',
        canImport: false,
        capabilities: [],
        reason: 'Fixture manifest parse failed.',
      },
      set: {
        ...blockedBase.set,
        memberCount: 0,
        primaryFeatureId: null,
        designColumns: [],
        designTablePreview: null,
        memberSummaries: [],
        memberIds: [],
        savedCohortIds: [],
        ingestAudit: {
          ...blockedBase.set.ingestAudit,
          join: {
            matchedRows: 0,
            unmatchedRows: 0,
            duplicateKeys: 0,
            severity: 'error',
            issueDetails: [{ message: 'Manifest parse failed.', memberIds: [] }],
          },
        },
      },
      features: [],
      cohorts: [],
      expressions: [],
    };
    renderManifestCandidate(emptyErrorCandidate, 'backend');

    expect(screen.getByText('Fix the preview errors before importing this set.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import Blocked' })).toBeDisabled();
  });

  it('shows review banner for regex candidate with warnings', () => {
    const discoveryBase = makeDiscoveryCandidate();
    const warningCandidate = {
      ...discoveryBase,
      contract: {
        ...discoveryBase.contract,
        readiness: 'review_required' as const,
        capabilities: ['import', 'deck'] as StudioImportCandidate['contract']['capabilities'],
        reason: 'Fixture discovery has warnings.',
      },
      set: {
        ...discoveryBase.set,
        ingestAudit: {
          ...discoveryBase.set.ingestAudit,
          join: {
            ...discoveryBase.set.ingestAudit.join,
            unmatchedRows: 1,
            severity: 'warning' as const,
          },
          support: {
            ...discoveryBase.set.ingestAudit.support,
            readyForCompare: false,
            severity: 'warning' as const,
          },
        },
      },
    };
    openDialog('regex');
    useSetStudioStore.getState().setImportPreviewResult('regex', [warningCandidate], 'backend');
    render(<StudioImportDialog />);

    expect(screen.getByText('Deck First')).toBeInTheDocument();
    expect(screen.getByText('Import for review before compare')).toBeInTheDocument();
  });

  it('shows match summary cards', () => {
    openDialog('regex');
    useSetStudioStore.getState().setImportPreviewResult('regex', [makeDiscoveryCandidate()], 'backend');
    render(<StudioImportDialog />);

    expect(screen.getByText('Match Summary')).toBeInTheDocument();
    expect(screen.getByText('Template Check')).toBeInTheDocument();
  });

  it('shows import notes when present', () => {
    openDialog('regex');
    useSetStudioStore.getState().setImportPreviewResult('regex', [makeDiscoveryCandidate()], 'backend');
    render(<StudioImportDialog />);

    expect(screen.getByText('Import notes')).toBeInTheDocument();
  });

  it('shows discovery root and file pattern inputs in regex mode', () => {
    openDialog('regex');
    render(<StudioImportDialog />);

    expect(screen.getByText('Discovery Root')).toBeInTheDocument();
    expect(screen.getByText('File Pattern')).toBeInTheDocument();
    expect(screen.getByText('Capture Preview')).toBeInTheDocument();
    expect(screen.getByText('Role Mapping')).toBeInTheDocument();
    // The store seeds the discoveryRoot value as "."
    expect(screen.getByDisplayValue('.')).toBeInTheDocument();
    expect(screen.getAllByText('subject').length).toBeGreaterThan(0);
    expect(screen.getAllByText('role').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('tstat required')).toBeChecked();
  });

  it('updates regex discovery controls in store state', () => {
    openDialog('regex');
    render(<StudioImportDialog />);

    fireEvent.change(screen.getByDisplayValue('4'), { target: { value: '6' } });
    fireEvent.click(screen.getByLabelText('pvalue required'));
    fireEvent.change(screen.getByPlaceholderText('custom_role'), {
      target: { value: 'zstat' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Role' }));

    const dialog = useSetStudioStore.getState().importDialog;
    expect(dialog.discoveryMaxDepth).toBe('6');
    expect(dialog.discoveryRequiredRoles).toContain('pvalue');
    expect(dialog.discoveryRolePatterns.some((entry) => entry.role === 'zstat')).toBe(true);
  });

  it('renders discovery completeness matrix from backend preview', () => {
    openDialog('regex');
    useSetStudioStore.getState().setImportPreviewResult('regex', [makeDiscoveryCandidate()], 'backend');
    render(<StudioImportDialog />);

    expect(screen.getByText('Discovery Matrix')).toBeInTheDocument();
    expect(screen.getByText('8 matched / 0 unmatched / 0 duplicates')).toBeInTheDocument();
    expect(screen.getAllByText('1001').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1002').length).toBeGreaterThan(0);
    expect(screen.getAllByText('OK').length).toBeGreaterThan(0);
    expect(screen.getByText('Missing')).toBeInTheDocument();
    expect(screen.getByText('Dup')).toBeInTheDocument();
  });

  it('confirms a clean discovery candidate into the Set Studio store', () => {
    const candidate = makeDiscoveryCandidate();
    openDialog('regex');
    useSetStudioStore.getState().setImportPreviewResult('regex', [candidate], 'backend');
    render(<StudioImportDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Import For Compare' }));

    const state = useSetStudioStore.getState();
    expect(state.importDialog.isOpen).toBe(false);
    expect(state.sets['folder-study']?.memberSummaries[0]?.bindings?.[0]?.role).toBe('tstat');
    expect(state.selection.activeSetId).toBe('folder-study');
    expect(state.selection.activeLens).toBe('compare');
  });

  it('exports a clean local discovery candidate as a NeuroTabs manifest', async () => {
    const candidate = makeCleanDiscoveryCandidate();
    ingestionServiceMock.exportDiscoveryNeuroTabs.mockResolvedValue({
      datasetId: 'folder-study',
      manifestPath: '/tmp/study/brainflow_nftab.yaml',
      files: [],
      preview: candidate,
      message: 'Saved NeuroTabs manifest package to /tmp/study.',
    });
    openDialog('regex');
    useSetStudioStore.getState().setImportPreviewResult('regex', [candidate], 'backend');
    render(<StudioImportDialog />);

    const exportButton = screen.getByRole('button', { name: 'Save NeuroTabs Manifest' });
    expect(exportButton).not.toBeDisabled();
    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(ingestionServiceMock.exportDiscoveryNeuroTabs).toHaveBeenCalledWith(candidate);
    });
    expect(await screen.findByText('/tmp/study/brainflow_nftab.yaml')).toBeInTheDocument();
  });

  it('reports that remote discovery roots cannot be exported directly', () => {
    const candidate = {
      ...makeCleanDiscoveryCandidate(),
      discovery: {
        ...makeCleanDiscoveryCandidate().discovery!,
        root: 'sftp://example.org/study',
      },
    };
    openDialog('regex');
    useSetStudioStore.getState().setImportPreviewResult('regex', [candidate], 'backend');
    render(<StudioImportDialog />);

    expect(
      screen.getByText('Remote discovery roots must be materialized locally before NeuroTabs export.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save NeuroTabs Manifest' })).toBeDisabled();
  });

  it('shows manifest path input in manifest mode', () => {
    openDialog('manifest');
    render(<StudioImportDialog />);

    expect(screen.getByPlaceholderText('/path/to/study.neurotabs.yaml')).toBeInTheDocument();
  });

  it('calls closeImportDialog when Cancel is clicked', () => {
    openDialog('regex');
    render(<StudioImportDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useSetStudioStore.getState().importDialog.isOpen).toBe(false);
  });

  it('closes dialog when Import button is clicked', () => {
    renderManifestCandidate(makeManifestCandidate(), 'backend');

    expect(useSetStudioStore.getState().importDialog.selectedCandidateId).toBeTruthy();
    expect(useSetStudioStore.getState().importDialog.isOpen).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Import For Compare' }));
    // Dialog should close after confirm
    expect(useSetStudioStore.getState().importDialog.isOpen).toBe(false);
  });
});
