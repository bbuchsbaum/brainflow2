import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioComparePaneSpec } from '@/types/studio';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { buildStudioComparePaneSpecs } from '@/services/studio/StudioCompareService';
import { folderCandidate } from '@/services/studio/__tests__/studioFixtures';
import { LensCanvas } from '../LensCanvas';
import { StudioAuditBanner, StudioSetStatusWord } from '../StudioAuditBanner';
import { useStudioSetAudit, type WorkspaceReadiness } from '../useStudioSetAudit';
import { StudioComparePane } from '../StudioComparePane';
import { StudioFolderReview } from '../StudioFolderReview';
import { folderReviewSummary } from '@/services/studio/folderOpenDecision';
import { StudioOpenNotice } from '../StudioOpenNotice';
import { StudioReadinessNotice } from '../StudioReadinessNotice';
import { StudioSetInfo, StudioToolbar } from '../StudioToolbar';
import { StudioLensSwitcher } from '../StudioLensSwitcher';
import { StudioFolderOpening } from '../StudioFolderOpening';
import { deriveWorkspaceReadiness } from '@/hooks/useStudioDerivedState';

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
  reviewOpenedFolder: vi.fn(),
}));
vi.mock('@/services/studio/SetIngestionService', () => ({
  getSetIngestionService: () => service,
}));
vi.mock('../PopulationLens', () => ({
  PopulationLens: () => <div data-testid="population-lens">No population image</div>,
}));
vi.mock('../CompareLens', () => ({ CompareLens: () => <div data-testid="compare-lens" /> }));
vi.mock('../DeckLens', () => ({ DeckLens: () => <div data-testid="deck-lens" /> }));
vi.mock('../PopulationOpenControls', () => ({
  PopulationOpenControls: () => <button type="button">Open saved population…</button>,
}));

const ROOT = '/cache/mount-a/pcmri/derivatives/enc_rep_rsa';

/** Open the folder set as the Studio holds it after "Open as set". */
function openSet(checked = false) {
  const store = useSetStudioStore.getState();
  store.dispatchImportEvent({
    type: 'FOLDER_REVIEW_OPENED',
    root: ROOT,
    source: {
      root: ROOT,
      displayPath: '/scratch/brad/dsets/pcmri/derivatives/enc_rep_rsa',
      label: 'brad@trillium.alliancecan.ca',
    },
  });
  store.setImportPreviewResult('regex', [folderCandidate({ checked })], 'backend');
  useSetStudioStore.getState().confirmImportCandidate();
  return useSetStudioStore.getState().sets['folder-set'];
}

const lensProps = {
  activeFeature: null,
  activeArtifact: null,
  activeMemberId: 'sub-1006',
  activeMember: null,
  compareCohort: null,
  activeExpression: null,
  cohorts: [],
  comparePaneSpecs: [],
  comparePaneLoading: false,
  compareRefreshingPaneIds: [],
  onSelectMember: () => {},
  onSelectCohort: () => {},
  onDrillToCohort: () => {},
  onRecomputeComparePane: () => {},
  onOpenCompareView: () => {},
  onClearScope: () => {},
};

beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState());
  Object.values(service).forEach((mock) => mock.mockClear());
});
afterEach(cleanup);

describe('Population while the set is not ready', () => {
  it('shows one calm state for the whole lens, not an error over empty image wells', () => {
    const set = openSet();
    act(() => useSetStudioStore.getState().setGridCheck({ status: 'checking', message: null }));
    render(<LensCanvas {...lensProps} activeLens="population" activeSet={set} />);

    const state = screen.getByTestId('studio-readiness');
    expect(state).toHaveAttribute('data-phase', 'checking');
    expect(state).toHaveAttribute('aria-busy', 'true');
    expect(state).toHaveTextContent('Checking image grids…');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('population-lens')).toBeNull();
    expect(screen.queryByText('No population image')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(service.cancelGridCheck).toHaveBeenCalledTimes(1);
  });

  it('becomes the lens by itself when the check lands', () => {
    const set = openSet();
    act(() => useSetStudioStore.getState().setGridCheck({ status: 'checking', message: null }));
    render(<LensCanvas {...lensProps} activeLens="population" activeSet={set} />);
    expect(screen.queryByTestId('population-lens')).toBeNull();

    const checked = folderCandidate({ checked: true });
    act(() => {
      const store = useSetStudioStore.getState();
      store.applySetAudit('folder-set', {
        supportLabel: checked.set.supportLabel,
        alignmentClass: checked.set.alignmentClass,
        ingestAudit: checked.set.ingestAudit,
        memberSummaries: checked.set.memberSummaries,
        importContract: checked.contract,
      });
      store.setGridCheck({ status: 'idle', message: null });
    });

    expect(screen.getByTestId('population-lens')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-readiness')).toBeNull();
  });

  it('offers the check after a cancel, and a retry after a failure', () => {
    const set = openSet();
    render(<LensCanvas {...lensProps} activeLens="population" activeSet={set} />);
    expect(screen.getByTestId('studio-readiness')).toHaveAttribute('data-phase', 'needs-check');
    fireEvent.click(screen.getByRole('button', { name: 'Check image grids' }));
    expect(service.checkActiveSetGrids).toHaveBeenCalledTimes(1);

    act(() =>
      useSetStudioStore.getState().setGridCheck({
        status: 'failed',
        message: 'The image grids could not be checked: Mount trillium is disconnected',
      }),
    );
    expect(screen.getByTestId('studio-readiness')).toHaveTextContent('Mount trillium is disconnected');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(service.checkActiveSetGrids).toHaveBeenCalledTimes(2);

    // A check stopped part-way whose headers were kept continues; it is not
    // called a retry.
    act(() =>
      useSetStudioStore.getState().setGridCheck({
        status: 'failed',
        message: 'Reading the image headers took longer than two minutes and was stopped.',
        resumable: true,
      }),
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue checking' }));
    expect(service.checkActiveSetGrids).toHaveBeenCalledTimes(3);
  });

  it('leaves Deck alone', () => {
    const set = openSet();
    render(<LensCanvas {...lensProps} activeLens="deck" activeSet={set} />);
    expect(screen.getByTestId('deck-lens')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-readiness')).toBeNull();
  });
});

describe('Compare while the set is not ready', () => {
  function paneFor(id: string, checkedSet = false): { pane: StudioComparePaneSpec; set: ReturnType<typeof openSet> } {
    const set = openSet(checkedSet);
    const specs = buildStudioComparePaneSpecs({
      activeSet: set,
      activeMember: set.memberSummaries[0],
      compareCohort: useSetStudioStore.getState().cohorts['all-members'],
      activeExpression: null,
    });
    return { pane: specs.find((spec) => spec.id === id)!, set };
  }
  const paneProps = {
    accent: 'emerald' as const,
    fallbackTitle: 'Group mean',
    fallbackSubtitle: 'Mean',
    selected: false,
    isRefreshing: false,
    isAnyLoading: false,
    cohortMemberCount: 3,
    cohortLabel: 'All members',
    cohortId: 'all-members',
    activeMemberId: 'sub-1006',
  };

  it('a pane waiting on the grid check says Waiting, never Failed, and follows the check', () => {
    const { pane, set } = paneFor('cohort-mean');
    render(<StudioComparePane {...paneProps} letter="B" pane={pane} activeSet={set} />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('Waiting');
    expect(badge).toHaveAttribute('data-pane-status', 'waiting');
    expect(badge.className).not.toMatch(/danger|destructive/);
    expect(screen.queryByText('Failed')).toBeNull();
    expect(screen.getByText('Image grids have not been checked yet.')).toBeInTheDocument();

    act(() => useSetStudioStore.getState().setGridCheck({ status: 'checking', message: null }));
    expect(screen.getByText('Image grids are being checked…')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/ingest|compare-safe|cohort|Reducer|Support/);
  });

  it('a pane that was waiting follows a check that lands on different grids: badge and text agree', () => {
    const { pane, set } = paneFor('cohort-mean');
    expect(pane.notReady?.kind).toBe('grid-check');
    render(<StudioComparePane {...paneProps} letter="B" pane={pane} activeSet={set} />);
    expect(screen.getByRole('status')).toHaveTextContent('Waiting');

    // The check lands: the grids differ. The set is still not comparable, so
    // the pane spec is not rebuilt; what it shows must change all the same.
    act(() =>
      useSetStudioStore.getState().applySetAudit(set.id, {
        supportLabel: 'mixed volume grids (sampled)',
        alignmentClass: 'mixed',
        ingestAudit: {
          ...set.ingestAudit,
          support: {
            ...set.ingestAudit.support,
            supportLabel: 'mixed volume grids (sampled)',
            alignmentClass: 'mixed',
            readyForCompare: false,
            severity: 'error',
          },
        },
        memberSummaries: set.memberSummaries,
        importContract: set.importContract,
      }),
    );
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('Unavailable');
    expect(badge).toHaveAttribute('data-pane-status', 'unavailable');
    expect(screen.queryByText('Waiting')).toBeNull();
    expect(
      screen.getByText('These images are on different grids, so they cannot be averaged.'),
    ).toBeInTheDocument();
  });

  it('a computation that failed is Failed, in the error colour', () => {
    const { pane, set } = paneFor('cohort-mean', true);
    const failed: StudioComparePaneSpec = {
      ...pane,
      status: 'blocked',
      notReady: null,
      reason: 'The mean could not be computed: cannot read sub-1007/same_item.nii.gz',
    };
    render(<StudioComparePane {...paneProps} letter="B" pane={failed} activeSet={set} />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('Failed');
    expect(badge.className).toMatch(/danger|destructive/);
    expect(screen.getByText(/could not be computed: cannot read/)).toBeInTheDocument();
  });

  it('different grids are Unavailable, with the reason', () => {
    const { pane, set } = paneFor('cohort-mean');
    const mixed: StudioComparePaneSpec = {
      ...pane,
      notReady: {
        kind: 'different-grids',
        message: 'These images are on different grids, so they cannot be averaged.',
      },
    };
    render(<StudioComparePane {...paneProps} letter="B" pane={mixed} activeSet={set} />);
    expect(screen.getByRole('status')).toHaveTextContent('Unavailable');
    expect(
      screen.getByText('These images are on different grids, so they cannot be averaged.'),
    ).toBeInTheDocument();
  });

  it('pane A names its member once, in the title, which is the last thing to shorten', () => {
    const { pane, set } = paneFor('current');
    render(
      <StudioComparePane
        {...paneProps}
        letter="A"
        cohortMemberCount={null}
        pane={pane}
        activeSet={set}
      >
        <div />
      </StudioComparePane>,
    );
    const article = screen.getByRole('article');
    expect(within(article).getAllByText('sub-1006')).toHaveLength(1);
    const title = within(article).getByText('sub-1006');
    const subtitle = within(article).getByText('Current member');
    // The subtitle gives way a thousand times faster, and leaves when narrow.
    expect(title.className).toContain('[flex:0_1_auto]');
    expect(subtitle.className).toContain('[flex:0_1000_auto]');
    expect(subtitle.className).toContain('studio-pane-secondary');
    const footer = article.querySelector('footer')!;
    expect(footer).toHaveTextContent('Member 1 of 3');
    expect(footer.textContent).not.toMatch(/sub-1006|Support|headers not sampled/);
    expect(article.className).toContain('studio-compare-pane');
  });

  it('the lens carries one line with the action', () => {
    openSet();
    act(() => useSetStudioStore.getState().setGridCheck({ status: 'checking', message: null }));
    render(<StudioReadinessNotice lens="compare" variant="line" />);
    const line = screen.getByTestId('studio-readiness');
    expect(line).toHaveAttribute('data-severity', 'neutral');
    expect(line).toHaveTextContent('Checking image grids…');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel image grid check' }));
    expect(service.cancelGridCheck).toHaveBeenCalledTimes(1);
  });

  it('pane chrome answers to the pane width through container queries', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/components/studio/studio.css'),
      'utf8',
    );
    expect(css).toMatch(/\.studio-compare-pane\s*{\s*container:\s*studio-pane\s*\/\s*inline-size/);
    expect(css).toMatch(
      /@container studio-pane \(max-width: \d+px\)\s*{\s*\.studio-compare-pane \.studio-pane-secondary\s*{\s*display:\s*none/,
    );
  });
});

describe('Set header', () => {
  it('names a folder set after its folder, with where it lives on hover', () => {
    const set = openSet();
    expect(set.name).toBe('enc_rep_rsa');
    render(<StudioToolbar setName={set.name} setLocation={set.sourceLocation} />);
    const name = screen.getByTestId('studio-set-name');
    expect(name).toHaveTextContent('enc_rep_rsa');
    expect(name.title).toContain('brad@trillium.alliancecan.ca');
    expect(name.title).toContain('/scratch/brad/dsets/pcmri/derivatives/enc_rep_rsa');
    // The name gives way last; the audit facts take only what it leaves.
    expect(name.className).toContain('[flex:0_1_auto]');
    // No menu of its own: its items are in the lens row's one "⋯" menu.
    expect(screen.queryByRole('button', { name: 'Open saved population…' })).toBeNull();
    expect(screen.queryByTitle('More')).toBeNull();
    // A folder set the Files panel is not browsing: its name is plain text.
    expect(name.tagName).not.toBe('BUTTON');
    expect(screen.getByRole('banner').className).not.toMatch(/\blg:|flex-wrap/);
  });

  it('says the grid state once, at set level, without internal vocabulary', () => {
    const set = openSet();
    const view = render(
      <StudioAuditBanner inline activeSet={set} readiness={deriveWorkspaceReadiness(set)} />,
    );
    const banner = screen.getByRole('region', { name: 'Set studio audit summary' });
    expect(banner).toHaveTextContent('Image grids not checked');
    expect(banner).toHaveTextContent('9 images');
    expect(banner.textContent).not.toMatch(/Deck first|Alignment|Support|Unmatched 0|Duplicates 0/);
    act(() => useSetStudioStore.getState().setGridCheck({ status: 'checking', message: null }));
    expect(banner).toHaveTextContent('Checking image grids');
    view.unmount();

    const checked = openSet(true);
    render(
      <StudioAuditBanner inline activeSet={checked} readiness={deriveWorkspaceReadiness(checked)} />,
    );
    const ready = screen.getByRole('region', { name: 'Set studio audit summary' });
    expect(ready).toHaveTextContent('Ready to compare');
    expect(ready).toHaveTextContent('Grid 2 mm grid (sampled)');
  });

  it('says nothing on the header when the set is ready; its status and facts are behind ⓘ', () => {
    const MATCHED = 'MNI152 6th Gen matched from the images (91×109×91); not declared by the files.';
    function Header({ readiness }: { readiness?: WorkspaceReadiness }) {
      const set = useSetStudioStore((state) => state.sets['folder-set']);
      const audit = useStudioSetAudit(set, readiness ?? deriveWorkspaceReadiness(set));
      return (
        <>
          <StudioSetStatusWord audit={audit} />
          <StudioSetInfo audit={audit} backgroundNote={MATCHED} />
        </>
      );
    }
    const checked = openSet(true);
    const view = render(<Header />);
    // Ready: no pill, no word on the header.
    expect(screen.queryByTestId('studio-set-status')).toBeNull();
    // The facts that were chips are in the ⓘ panel, with the grid's provenance.
    const info = screen.getByTestId('studio-set-info');
    expect(info).toHaveTextContent('Ready to compare');
    expect(info).toHaveTextContent('9 images');
    expect(info).toHaveTextContent('2 mm grid (sampled)');
    expect(info).toHaveTextContent('not declared by the files');
    expect(screen.getByTitle('Dataset details').closest('details')!.open).toBe(false);
    view.unmount();

    // Blocked: the status word is on the header, with its message.
    const blocked: WorkspaceReadiness = {
      state: 'blocked',
      eyebrow: 'Cannot compare',
      title: 'Blocked',
      message: 'These images are on different grids, so they cannot be averaged.',
      className: '',
    };
    render(<Header readiness={blocked} />);
    const status = screen.getByTestId('studio-set-status');
    expect(status).toHaveTextContent('Cannot compare');
    expect(within(status).getByTitle(blocked.message)).toBeInTheDocument();
    expect(checked.id).toBe('folder-set');
  });

  it('keeps a pending grid check as the header\'s status word', () => {
    openSet();
    function Header() {
      const set = useSetStudioStore((state) => state.sets['folder-set']);
      return <StudioSetStatusWord audit={useStudioSetAudit(set, deriveWorkspaceReadiness(set))} />;
    }
    render(<Header />);
    expect(screen.getByTestId('studio-set-status')).toHaveTextContent('Image grids not checked');
    act(() => useSetStudioStore.getState().setGridCheck({ status: 'checking', message: null }));
    expect(screen.getByTestId('studio-set-status')).toHaveTextContent('Checking image grids');
  });

  it('says how a set was opened without its review, and leads back to the review', () => {
    openSet();
    render(<StudioOpenNotice />);
    expect(screen.queryByTestId('studio-open-notice')).toBeNull();
    act(() =>
      useSetStudioStore.getState().setStudioOpenNotice({
        setId: 'folder-set',
        root: ROOT,
        message: 'Opened 35 members × 3 images from enc_rep_rsa.',
      }),
    );
    expect(screen.getByTestId('studio-open-notice')).toHaveTextContent(
      'Opened 35 members × 3 images from enc_rep_rsa.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review…' }));
    expect(service.reviewOpenedFolder).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('studio-open-notice')).toBeNull();
  });
});

describe('Folder review matrix', () => {
  it('summarises a matrix in one line', () => {
    expect(folderReviewSummary(35, 3, 0, 0)).toBe('35 members × 3 images, none missing');
    expect(folderReviewSummary(35, 3, 2, 0)).toBe('35 members × 3 images, 2 missing');
    expect(folderReviewSummary(2, 1, 1, 1)).toBe(
      '2 members × 1 image, 1 missing, 1 with more than one file',
    );
  });

  it('marks present images quietly and writes only the exceptions', () => {
    const candidate = folderCandidate();
    const groups = candidate.discovery!.groups;
    groups[1] = { ...groups[1], bindings: groups[1].bindings.slice(0, 2) };
    const store = useSetStudioStore.getState();
    store.dispatchImportEvent({ type: 'FOLDER_REVIEW_OPENED', root: ROOT });
    store.setImportPreviewResult('regex', [candidate], 'backend');
    render(<StudioFolderReview />);

    expect(screen.getByText('3 members × 3 images, 1 missing')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).queryByText('Available')).toBeNull();
    expect(within(table).getAllByText('Missing')).toHaveLength(1);
    // Eight present images, each still a way to its source path.
    const present = within(table).getAllByRole('button', { name: /: Available$/ });
    expect(present).toHaveLength(8);
    fireEvent.click(present[0]);
    expect(screen.getByLabelText('Image source')).toHaveTextContent('sub-1006/enc_rep/maps/same_item.nii.gz');
    // Reviewing already: another folder is reviewed too.
    fireEvent.click(screen.getByRole('button', { name: 'Change folder…' }));
    expect(service.chooseFolderReview).toHaveBeenCalledWith({ review: true });
  });
});

describe('Lens toolbar', () => {
  it('wraps to its column instead of clipping, and asks for a group in plain words', () => {
    render(
      <StudioLensSwitcher
        bare
        activeLens="compare"
        onSelectLens={() => {}}
        compareCohort={null}
        cohorts={[]}
        onSelectCompareCohort={() => {}}
      />,
    );
    const row = screen.getByRole('radiogroup', { name: 'Set studio lens' }).parentElement!;
    expect(row.className).toContain('flex-wrap');
    expect(row.className).not.toMatch(/flex-nowrap|shrink-0|\blg:/);
    expect(screen.getByRole('option', { name: 'Current vs … (choose a group)' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/cohort/i);
  });
});

describe('Opening a folder in one step', () => {
  it('says the folder is opening and what the scan is doing, with a way out', () => {
    const store = useSetStudioStore.getState();
    store.dispatchImportEvent({ type: 'FOLDER_REVIEW_OPENED', root: ROOT });
    store.beginFolderOntologyPreview(ROOT);
    render(<StudioFolderOpening root={ROOT} />);
    const view = screen.getByTestId('studio-folder-opening');
    expect(view).toHaveTextContent('Opening enc_rep_rsa');
    expect(view).toHaveTextContent('Finding images…');
    expect(view).toHaveAttribute('aria-busy', 'true');
    expect(service.retainFolderReview).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Open set' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(service.cancelReview).toHaveBeenCalledTimes(1);
  });
});


describe('a grid check that failed on a dropped remote connection', () => {
  const MOUNT = '/cache/mount-a';

  async function setUp() {
    const { useFileBrowserStore } = await import('@/stores/fileBrowserStore');
    const connection = await import('@/stores/remoteConnectionStore');
    connection.resetRemoteConnectionStore();
    useFileBrowserStore.setState({
      entries: [
        {
          id: MOUNT,
          name: 'trillium',
          path: MOUNT,
          type: 'directory',
          depth: 0,
          children: [],
          mountSource: { kind: 'remote', mountId: 'm1', host: 'trillium.alliancecan.ca', remotePath: '/scratch/brad/dsets' },
        } as never,
      ],
      recents: [],
      pinned: [],
    });
    return connection;
  }

  it.each(['panel', 'line'] as const)(
    'offers Reconnect before Retry in the %s, and checks again when the mount is back',
    async (variant) => {
      const { markRemoteMountActive } = await setUp();
      openSet();
      act(() =>
        useSetStudioStore.getState().setGridCheck({
          status: 'failed',
          message: 'The connection to the remote folder was lost before the image headers were read.',
          connectionLostPath: ROOT,
        }),
      );
      render(<StudioReadinessNotice lens="population" variant={variant} />);
      const notice = screen.getByTestId('studio-readiness');
      expect(notice).toHaveAttribute('data-phase', 'check-failed');
      const labels = within(notice)
        .getAllByRole('button')
        .map((button) => button.textContent);
      expect(labels).toEqual(['Reconnect', 'Retry']);

      // Another mount coming back is not this one.
      act(() => markRemoteMountActive('/cache/mount-b'));
      expect(service.checkActiveSetGrids).not.toHaveBeenCalled();
      act(() => markRemoteMountActive(MOUNT));
      expect(service.checkActiveSetGrids).toHaveBeenCalledTimes(1);
    },
  );

  it('offers no Reconnect, and no automatic check, for a check that failed another way', async () => {
    const { markRemoteMountActive } = await setUp();
    openSet();
    act(() =>
      useSetStudioStore.getState().setGridCheck({ status: 'failed', message: 'The headers could not be read.' }),
    );
    render(<StudioReadinessNotice lens="population" variant="panel" />);
    expect(screen.queryByTestId('studio-readiness-reconnect')).toBeNull();
    expect(screen.getByTestId('studio-readiness-action')).toHaveTextContent('Retry');
    act(() => markRemoteMountActive(MOUNT));
    expect(service.checkActiveSetGrids).not.toHaveBeenCalled();
  });
});
