import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpatialFieldSetSummary, StudioImportCandidate } from '@/types/studio';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { populationReadinessIssue } from '@/services/studio/populationReadiness';
import { PopulationIssueNotice } from '../PopulationIssueNotice';
import { StudioFolderReview } from '../StudioFolderReview';

const service = vi.hoisted(() => ({
  retainFolderReview: vi.fn(() => () => {}),
  confirmReview: vi.fn(),
  setFolderReviewGridCheck: vi.fn(),
  checkActiveSetGrids: vi.fn(),
  cancelGridCheck: vi.fn(),
  cancelReview: vi.fn(),
  scanFolderReview: vi.fn(),
  chooseFolderReview: vi.fn(),
  editFolderReview: vi.fn(),
  openImportPreview: vi.fn(),
  reviewOrganization: vi.fn(),
}));
vi.mock('@/services/studio/SetIngestionService', () => ({
  getSetIngestionService: () => service,
}));

const ROOT = '/cache/mount-a/study';

function candidate(): StudioImportCandidate {
  return {
    id: 'candidate-regex-b',
    mode: 'regex',
    contract: { readiness: 'review_required', canImport: true, capabilities: ['import', 'deck'], reason: '' },
    set: {
      id: 'study-regex-preview',
      supportKind: 'volume',
      alignmentClass: 'unknown',
      memberIds: ['s1'],
      memberSummaries: [],
      savedCohortIds: [],
      ingestAudit: {
        join: { matchedRows: 1, unmatchedRows: 0, duplicateKeys: 0, severity: 'ok', issueDetails: [] },
        support: { supportLabel: 'headers not sampled', alignmentClass: 'unknown', readyForCompare: false, severity: 'ok' },
        notes: [],
      },
    },
    features: [],
    cohorts: [],
    expressions: [],
    discovery: {
      root: ROOT,
      filePattern: 'x',
      includePatterns: [],
      excludePatterns: [],
      rolePatterns: [],
      requiredRoles: [],
      maxDepth: null,
      maxFiles: 100,
      groups: [],
      observedRoles: [],
    },
  } as unknown as StudioImportCandidate;
}

beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState());
  Object.values(service).forEach((mock) => mock.mockClear());
});
afterEach(cleanup);

describe('StudioFolderReview feedback', () => {
  function openReview(remote: boolean) {
    const store = useSetStudioStore.getState();
    store.dispatchImportEvent({
      type: 'FOLDER_REVIEW_OPENED',
      root: ROOT,
      source: { root: ROOT, displayPath: remote ? '/scratch/study' : ROOT },
    });
    store.setImportPreviewResult('regex', [candidate()], 'backend');
  }

  it('says it is checking files and marks the button busy while the set opens', async () => {
    openReview(false);
    let finish!: () => void;
    service.confirmReview.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    render(<StudioFolderReview />);
    expect(screen.getByText('Open for browsing.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open set' }));
    const button = screen.getByRole('button', { name: 'Opening…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Checking files before opening…')).toBeInTheDocument();
    expect(screen.queryByText('Open for browsing.')).toBeNull();

    await act(async () => finish());
    expect(screen.getByRole('button', { name: 'Open set' })).toBeEnabled();
  });

  it('says why a review nobody asked for is shown, and nothing otherwise', () => {
    openReview(false);
    const view = render(<StudioFolderReview />);
    expect(screen.queryByText(/^Shown for review/)).toBeNull();
    view.unmount();

    useSetStudioStore.getState().setStudioFolderReviewReason({
      root: ROOT,
      reason: 'More than one organisation fits this folder.',
    });
    render(<StudioFolderReview />);
    expect(
      screen.getByText('Shown for review: more than one organisation fits this folder.'),
    ).toBeInTheDocument();
    // A reason recorded for another folder is not this review's.
    act(() =>
      useSetStudioStore
        .getState()
        .setStudioFolderReviewReason({ root: '/elsewhere', reason: 'The scan reported a warning.' }),
    );
    expect(screen.queryByText(/^Shown for review/)).toBeNull();
  });

  it('says it is checking files while a preview is running', () => {
    openReview(false);
    useSetStudioStore.getState().beginImportPreview('regex');
    render(<StudioFolderReview />);
    expect(screen.getByText('Checking files…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open set' })).toBeDisabled();
  });

  it('binds the grid check option through the service and says what it costs', () => {
    openReview(false);
    render(<StudioFolderReview />);
    const option = screen.getByRole('checkbox', { name: 'Check image grids before opening' });
    expect(option).not.toBeChecked();
    expect(screen.getByText(/stay unavailable until the image grids are checked/)).toBeInTheDocument();
    fireEvent.click(option);
    expect(service.setFolderReviewGridCheck).toHaveBeenCalledWith(true);
  });

  it('says a remote folder is checked by header, without downloading images', () => {
    openReview(true);
    render(<StudioFolderReview />);
    expect(
      screen.getByText(/each image is downloaded when its member is opened/),
    ).toBeInTheDocument();
    expect(screen.getByText(/stay unavailable until the image grids are checked/)).toBeInTheDocument();
    expect(screen.queryByText(/only possible for a local folder/)).toBeNull();
  });
});

describe('PopulationIssueNotice', () => {
  function openSet(remote = false): SpatialFieldSetSummary {
    const store = useSetStudioStore.getState();
    store.dispatchImportEvent({
      type: 'FOLDER_REVIEW_OPENED',
      root: ROOT,
      source: { root: ROOT, displayPath: remote ? '/scratch/study' : ROOT },
    });
    store.setImportPreviewResult('regex', [candidate()], 'backend');
    useSetStudioStore.getState().confirmImportCandidate();
    return useSetStudioStore.getState().sets['study-regex-preview'];
  }

  it('offers to check the image grids with the message that asks for it', () => {
    const issue = populationReadinessIssue(openSet())!.message;
    render(<PopulationIssueNotice issue={issue} />);
    // Headers nobody has read are not an error: a status, not an alert.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toHaveAttribute('data-severity', 'neutral');
    expect(screen.getByRole('status')).toHaveTextContent('have not been checked yet');
    fireEvent.click(screen.getByRole('button', { name: 'Check image grids' }));
    expect(service.checkActiveSetGrids).toHaveBeenCalledTimes(1);
  });

  it('shows the check running, then why it failed', () => {
    const issue = populationReadinessIssue(openSet())!.message;
    render(<PopulationIssueNotice issue={issue} />);
    act(() => useSetStudioStore.getState().setGridCheck({ status: 'checking', message: null }));
    // The running check is announced in the notice; its action cancels it.
    expect(screen.getByRole('status')).toHaveTextContent('Checking image grids…');
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveAttribute('data-severity', 'neutral');
    expect(screen.queryByRole('button', { name: 'Check image grids' })).toBeNull();
    act(() =>
      useSetStudioStore.getState().setGridCheck({
        status: 'failed',
        message: 'The image grids could not be checked: Mount trillium is disconnected',
      }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Mount trillium is disconnected');
    // A check that could not read the headers: caution, and a way to try again.
    expect(screen.getByRole('status')).toHaveAttribute('data-severity', 'warning');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  it('offers Reconnect for a check that failed on a dropped connection, and checks again once it is back', async () => {
    const { useFileBrowserStore } = await import('@/stores/fileBrowserStore');
    const { markRemoteMountActive, resetRemoteConnectionStore } = await import(
      '@/stores/remoteConnectionStore'
    );
    resetRemoteConnectionStore();
    useFileBrowserStore.setState({
      entries: [
        {
          id: '/cache/mount-a',
          name: 'trillium',
          path: '/cache/mount-a',
          type: 'directory',
          depth: 0,
          children: [],
          mountSource: { kind: 'remote', mountId: 'm1', host: 'trillium.alliancecan.ca' },
        } as never,
      ],
      recents: [],
      pinned: [],
    });
    const issue = populationReadinessIssue(openSet(true))!.message;
    render(<PopulationIssueNotice issue={issue} />);
    act(() =>
      useSetStudioStore.getState().setGridCheck({
        status: 'failed',
        message: 'The connection to the remote folder was lost before the image headers were read.',
        connectionLostPath: ROOT,
      }),
    );
    const labels = screen.getAllByRole('button').map((button) => button.textContent);
    expect(labels).toEqual(['Reconnect', 'Retry']);
    expect(service.checkActiveSetGrids).not.toHaveBeenCalled();
    act(() => markRemoteMountActive('/cache/mount-a'));
    expect(service.checkActiveSetGrids).toHaveBeenCalledTimes(1);
    useFileBrowserStore.setState({ entries: [] });
  });

  it('cancels a running check from the same place it was started', () => {
    const issue = populationReadinessIssue(openSet())!.message;
    render(<PopulationIssueNotice issue={issue} />);
    act(() => useSetStudioStore.getState().setGridCheck({ status: 'checking', message: null }));
    const cancel = screen.getByRole('button', { name: 'Cancel image grid check' });
    expect(cancel).toBeEnabled();
    expect(cancel).toHaveTextContent('Cancel');
    fireEvent.click(cancel);
    expect(service.cancelGridCheck).toHaveBeenCalledTimes(1);
    expect(service.checkActiveSetGrids).not.toHaveBeenCalled();
    // The service returns the check to idle when it is aborted.
    act(() => useSetStudioStore.getState().setGridCheck({ status: 'idle', message: null }));
    expect(screen.getByRole('status')).not.toHaveTextContent('Checking image grids…');
    expect(screen.getByRole('status')).not.toHaveAttribute('aria-busy');
    fireEvent.click(screen.getByRole('button', { name: 'Check image grids' }));
    expect(service.checkActiveSetGrids).toHaveBeenCalledTimes(1);
  });

  it('offers the check for a remote set, and none for an unrelated issue', () => {
    const remote = populationReadinessIssue(openSet(true))!;
    expect(remote.canCheckGrids).toBe(true);
    const view = render(<PopulationIssueNotice issue={remote.message} />);
    expect(screen.getByRole('button', { name: 'Check image grids' })).toBeInTheDocument();
    view.unmount();
    openSet();
    render(<PopulationIssueNotice issue="No eligible observations." />);
    expect(screen.getByRole('alert')).toHaveTextContent('No eligible observations.');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
