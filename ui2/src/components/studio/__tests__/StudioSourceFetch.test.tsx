import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTransport, type BackendTransport } from '@/services/transport';
import { usePopulationSourcesLocal } from '@/hooks/useStudioSourceFetch';
import { useAppModeStore } from '@/stores/appModeStore';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useStudioSourceFetchStore } from '@/stores/studioSourceFetchStore';
import { markRemoteMountActive, resetRemoteConnectionStore } from '@/stores/remoteConnectionStore';
import {
  getStudioSourceFetchService,
  resetStudioSourceFetchService,
} from '@/services/studio/StudioSourceFetchService';
import { folderCandidate, FOLDER_ROOT } from '@/services/studio/__tests__/studioFixtures';
import type { FileTreeNode } from '@/types/filesystem';
import { LensCanvas } from '../LensCanvas';
import { StudioSourceFetchNotice } from '../StudioSourceFetchNotice';

const coordination = vi.hoisted(() => ({ retryComparePanes: vi.fn() }));
vi.mock('@/services/studio/StudioCoordinationService', () => ({
  getStudioCoordinationService: () => coordination,
}));
vi.mock('@/services/studio/SetIngestionService', () => ({
  getSetIngestionService: () => ({ cancelGridCheck: vi.fn(), checkActiveSetGrids: vi.fn() }),
}));
vi.mock('../PopulationLens', () => ({
  PopulationLens: () => <div data-testid="population-lens" />,
}));
vi.mock('../CompareLens', () => ({ CompareLens: () => <div data-testid="compare-lens" /> }));
vi.mock('../DeckLens', () => ({ DeckLens: () => <div data-testid="deck-lens" /> }));

const HOST = 'trillium.alliancecan.ca';
const mount = {
  id: '/cache/mount-a',
  name: 'dsets',
  path: '/cache/mount-a',
  type: 'directory',
  depth: 0,
  mountSource: { kind: 'remote', mountId: 'mount-1', host: HOST, remotePath: '/scratch/brad/dsets' },
} as FileTreeNode;

/** The folder set, grids checked, as the Studio holds it after "Open as set". */
function openSet() {
  const store = useSetStudioStore.getState();
  store.dispatchImportEvent({
    type: 'FOLDER_REVIEW_OPENED',
    root: FOLDER_ROOT,
    source: { root: FOLDER_ROOT, displayPath: '/scratch/brad/dsets/pcmri', label: HOST },
  });
  store.setImportPreviewResult('regex', [folderCandidate({ checked: true })], 'backend');
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
  onOpenComparePane: () => {},
  onInspectComparePane: () => {},
  onRecomputeComparePane: () => {},
  onInspectCurrentArtifact: () => {},
  onOpenCurrentSource: () => {},
  onOpenCompareView: () => {},
  onClearScope: () => {},
};

type Harness = typeof window & {
  __harnessEvents?: { listen: (event: string, handler: (event: { payload: unknown }) => void) => () => void };
};
interface FetchArgs {
  fetchId?: string;
  request: { fetchId: string; allowLarge: boolean; sources: { path: string; label: string }[] };
}
type Pending = { cmd: string; args: FetchArgs; resolve: (value: unknown) => void };
let calls: Pending[];
let emit: (payload: unknown) => void;
const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

beforeEach(() => {
  calls = [];
  const handlers: Array<(event: { payload: unknown }) => void> = [];
  emit = (payload) => handlers.forEach((handler) => handler({ payload }));
  (window as Harness).__harnessEvents = {
    listen: (_event: string, handler: (event: { payload: unknown }) => void) => {
      handlers.push(handler);
      return () => {};
    },
  };
  setTransport({
    invoke: vi.fn(
      (cmd: string, args: unknown) =>
        new Promise((resolve) => {
          calls.push({ cmd, args: args as FetchArgs, resolve });
          if (cmd !== 'fetch_studio_sources') resolve(true);
        }),
    ),
  } as unknown as BackendTransport);
  useSetStudioStore.setState(useSetStudioStore.getInitialState());
  useFileBrowserStore.setState({ entries: [] });
  // The lenses are the Studio's: a fetch is not started from outside it.
  useAppModeStore.setState({ mode: 'studio' });
  resetStudioSourceFetchService();
  coordination.retryComparePanes.mockClear();
});
afterEach(() => {
  cleanup();
  useAppModeStore.setState({ mode: 'imaging' });
  resetStudioSourceFetchService();
  useFileBrowserStore.setState({ entries: [] });
  delete (window as Harness).__harnessEvents;
});

describe('Population on a set in a local folder', () => {
  it('opens at once: no fetch step, no backend call, no notice', () => {
    const set = openSet();
    render(<LensCanvas {...lensProps} activeLens="population" activeSet={set} />);
    expect(screen.getByTestId('population-lens')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-source-fetch')).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('Population on a set on a remote mount', () => {
  it('fetches the active image of every member, shows the count, then opens', async () => {
    useFileBrowserStore.setState({ entries: [mount] });
    const set = openSet();
    render(<LensCanvas {...lensProps} activeLens="population" activeSet={set} />);

    const panel = screen.getByTestId('studio-source-fetch');
    expect(panel).toHaveAttribute('aria-busy', 'true');
    expect(panel).toHaveTextContent(`Checking images on ${HOST}…`);
    expect(screen.queryByTestId('population-lens')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();

    await flush();
    const fetches = calls.filter((call) => call.cmd === 'fetch_studio_sources');
    expect(fetches).toHaveLength(1);
    const { request } = fetches[0].args;
    // One image per member: the active one, not all three of each.
    expect(request.sources.map((source: { label: string }) => source.label)).toEqual([
      'sub-1006',
      'sub-1007',
      'sub-1008',
    ]);
    expect(
      request.sources.every((source: { path: string }) => source.path.endsWith('same_item.nii.gz')),
    ).toBe(true);

    act(() => emit({ fetchId: request.fetchId, done: 1, total: 3, mountLabel: HOST }));
    expect(panel).toHaveAttribute('data-phase', 'fetching');
    expect(panel).toHaveTextContent(`Fetching images from ${HOST}… 1 of 3`);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33');

    await act(async () => {
      fetches[0].resolve({
        status: 'ready',
        mountLabel: HOST,
        remoteCount: 3,
        fetchCount: 3,
        fetchBytes: 3_000_000,
        fetchedCount: 3,
      });
    });
    await flush();
    expect(screen.getByTestId('population-lens')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-source-fetch')).toBeNull();
    expect(calls.filter((call) => call.cmd === 'fetch_studio_sources')).toHaveLength(1);
  });

  it('keeps fetching when the lens is left', async () => {
    useFileBrowserStore.setState({ entries: [mount] });
    const set = openSet();
    const view = render(<LensCanvas {...lensProps} activeLens="population" activeSet={set} />);
    await flush();
    view.rerender(<LensCanvas {...lensProps} activeLens="deck" activeSet={set} />);
    expect(calls.some((call) => call.cmd === 'cancel_studio_source_fetch')).toBe(false);
    expect(useStudioSourceFetchStore.getState().phase).toBe('checking');
  });
});

describe('Population after a fetch was ended', () => {
  const answer = {
    status: 'ready',
    mountLabel: HOST,
    remoteCount: 3,
    fetchCount: 3,
    fetchBytes: 3_000_000,
    fetchedCount: 3,
  };
  const fetches = () => calls.filter((call) => call.cmd === 'fetch_studio_sources');

  it('fetches again at once, before the backend has answered the old one', async () => {
    useFileBrowserStore.setState({ entries: [mount] });
    const set = openSet();
    render(<LensCanvas {...lensProps} activeLens="population" activeSet={set} />);
    await flush();
    expect(fetches()).toHaveLength(1);

    // The fetch is ended (as a change of set does) and its invoke is still
    // unanswered when the lens asks for its images.
    act(() => getStudioSourceFetchService().reset());
    await flush();
    expect(fetches()).toHaveLength(2);
    expect(fetches()[1].args.request.fetchId).not.toBe(fetches()[0].args.request.fetchId);
    expect(fetches()[1].args.request.sources).toHaveLength(3);
    expect(screen.getByTestId('studio-source-fetch')).toHaveAttribute('data-phase', 'checking');

    await act(async () => fetches()[1].resolve(answer));
    await flush();
    expect(screen.getByTestId('population-lens')).toBeInTheDocument();
  });

  it('asks again when a fetch was aborted and nothing else changed', async () => {
    useFileBrowserStore.setState({ entries: [mount] });
    openSet();
    const aborted = Object.assign(new Error('Image fetch cancelled.'), { name: 'AbortError' });
    // An aborted fetch: it rejects and leaves the state as it was (idle).
    const pending = vi
      .spyOn(getStudioSourceFetchService(), 'pending')
      .mockImplementation(() => Promise.reject(aborted));
    const { result } = renderHook(() => usePopulationSourcesLocal());
    await flush();
    expect(result.current).toBe(false);
    expect(pending).toHaveBeenCalledTimes(1);
    act(() => useStudioSourceFetchStore.setState((state) => ({ revision: state.revision + 1 })));
    await flush();
    expect(pending).toHaveBeenCalledTimes(2);
    // Outside the Studio nothing is started.
    act(() => {
      useAppModeStore.setState({ mode: 'imaging' });
      useStudioSourceFetchStore.setState((state) => ({ revision: state.revision + 1 }));
    });
    await flush();
    expect(pending).toHaveBeenCalledTimes(2);
  });

  it('Cancel on "Checking images…" always stops, and Continue fetches', async () => {
    useFileBrowserStore.setState({ entries: [mount] });
    const set = openSet();
    // Nothing is in flight: the panel stands in while the lens waits.
    vi.spyOn(getStudioSourceFetchService(), 'pending').mockImplementationOnce(() => null);
    render(<LensCanvas {...lensProps} activeLens="population" activeSet={set} />);
    await flush();
    const panel = screen.getByTestId('studio-source-fetch');
    expect(panel).toHaveTextContent('Checking images on');
    expect(fetches()).toHaveLength(0);

    fireEvent.click(screen.getByTestId('studio-source-fetch-action'));
    expect(panel).toHaveAttribute('data-phase', 'stopped');
    expect(panel).not.toHaveAttribute('aria-busy');
    await flush();
    expect(fetches()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await flush();
    expect(fetches()).toHaveLength(1);
    expect(panel).toHaveAttribute('data-phase', 'checking');
  });

  it('offers Retry when the backend refuses an image Files shows no remote folder for', async () => {
    // No remote folder in Files: the lens opens as for a local set.
    const set = openSet();
    render(<LensCanvas {...lensProps} activeLens="population" activeSet={set} />);
    expect(screen.getByTestId('population-lens')).toBeInTheDocument();
    const members = useSetStudioStore.getState().sets['folder-set'].memberSummaries;
    const sources = members.map((member) => ({ path: member.sourcePath!, label: member.id }));

    act(() => {
      getStudioSourceFetchService().refused(
        { Io: { code: 8255, details: `same_item.nii.gz has not been fetched from ${HOST} yet.` } },
        sources,
      );
    });
    const panel = screen.getByTestId('studio-source-fetch');
    expect(panel).toHaveAttribute('data-phase', 'failed');
    expect(panel).toHaveTextContent(`same_item.nii.gz has not been fetched from ${HOST} yet.`);
    expect(screen.queryByTestId('population-lens')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await flush();
    // The backend is asked which folders it has connected, then for the images.
    const listed = calls.find((call) => call.cmd === 'list_remote_mounts');
    expect(listed).toBeDefined();
    await flush();
    expect(fetches()).toHaveLength(1);
    await act(async () => fetches()[0].resolve(answer));
    await flush();
    expect(screen.getByTestId('population-lens')).toBeInTheDocument();
  });
});

describe('StudioSourceFetchNotice', () => {
  const show = (state: Partial<ReturnType<typeof useStudioSourceFetchStore.getState>>) =>
    act(() => useStudioSourceFetchStore.setState({ mountLabel: HOST, ...state }));

  it('says nothing above Compare when nothing is being fetched', () => {
    const { container } = render(<StudioSourceFetchNotice lens="compare" variant="line" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the count as progress, and Cancel stops the fetch', () => {
    const stop = vi.spyOn(getStudioSourceFetchService(), 'stop');
    render(<StudioSourceFetchNotice lens="compare" variant="line" />);
    show({ phase: 'fetching', done: 12, total: 35 });
    const notice = screen.getByTestId('studio-source-fetch');
    expect(notice).toHaveTextContent(`Fetching images from ${HOST}… 12 of 35`);
    expect(notice).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel image fetch' }));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(coordination.retryComparePanes).not.toHaveBeenCalled();
  });

  it('offers Continue after a stop, saying what is kept', () => {
    const resume = vi.spyOn(getStudioSourceFetchService(), 'resume');
    render(<StudioSourceFetchNotice lens="compare" variant="line" />);
    show({ phase: 'stopped', done: 12, total: 35 });
    expect(screen.getByTestId('studio-source-fetch')).toHaveTextContent(
      'Image fetch stopped 12 of 35 images are on this computer and are kept. Continue fetches the rest.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(resume).toHaveBeenCalledTimes(1);
    expect(coordination.retryComparePanes).toHaveBeenCalledTimes(1);
  });

  it('states the size of a large fetch and waits for the go-ahead', () => {
    const resume = vi.spyOn(getStudioSourceFetchService(), 'resume');
    render(<StudioSourceFetchNotice lens="population" variant="panel" />);
    show({ phase: 'confirm', total: 35, bytes: 3 * 1024 ** 3 });
    const panel = screen.getByTestId('studio-source-fetch');
    expect(panel).toHaveTextContent(`Fetch 3.0 GB from ${HOST}?`);
    expect(panel).toHaveTextContent('Population needs 35 images (3.0 GB)');
    expect(panel).not.toHaveAttribute('aria-busy');
    expect(screen.queryByRole('progressbar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fetch images' }));
    expect(resume).toHaveBeenCalledTimes(1);
    // Population's gate fetches by itself; only Compare is computed on request.
    expect(coordination.retryComparePanes).not.toHaveBeenCalled();
  });

  it('gives a failure in plain words, with Retry', () => {
    render(<StudioSourceFetchNotice lens="population" variant="panel" />);
    show({
      phase: 'failed',
      done: 13,
      total: 35,
      message: `sub-1014: same_item.nii.gz is not on ${HOST}.`,
    });
    const panel = screen.getByTestId('studio-source-fetch');
    expect(panel).toHaveTextContent('The images could not be fetched');
    expect(panel).toHaveTextContent(
      `sub-1014: same_item.nii.gz is not on ${HOST}. The images already fetched are kept.`,
    );
    expect(panel.textContent).not.toMatch(/os error|ScalingError|I\/O/);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  describe('after a fetch that failed on a dropped connection', () => {
    const LOST = `${mount.path}/pcmri/sub-1006/same_item.nii.gz`;
    const lost = {
      phase: 'failed' as const,
      done: 13,
      total: 35,
      message: 'The remote folder is not connected. Reconnect to continue.',
      connectionLostPath: LOST,
    };
    beforeEach(() => {
      resetRemoteConnectionStore();
      useFileBrowserStore.setState({ entries: [mount], recents: [], pinned: [] });
    });

    it.each([
      ['panel', 'population'],
      ['line', 'compare'],
    ] as const)(
      'offers Reconnect before Retry in the %s, and fetches again when the mount is back',
      (variant, lens) => {
        const resume = vi.spyOn(getStudioSourceFetchService(), 'resume');
        render(<StudioSourceFetchNotice lens={lens} variant={variant} />);
        show(lost);
        const notice = screen.getByTestId('studio-source-fetch');
        const labels = within(notice)
          .getAllByRole('button')
          .map((button) => button.textContent);
        expect(labels).toEqual(['Reconnect', 'Retry']);
        expect(screen.getByTestId('studio-source-fetch-reconnect')).toBeEnabled();

        // Another mount coming back is not this one.
        act(() => markRemoteMountActive('/cache/mount-b'));
        expect(resume).not.toHaveBeenCalled();
        act(() => markRemoteMountActive(mount.path));
        expect(resume).toHaveBeenCalledTimes(1);
        expect(coordination.retryComparePanes).toHaveBeenCalledTimes(lens === 'compare' ? 1 : 0);
        resume.mockRestore();
      },
    );

    it('offers no Reconnect, and no automatic fetch, for a failure of another kind', () => {
      const resume = vi.spyOn(getStudioSourceFetchService(), 'resume');
      render(<StudioSourceFetchNotice lens="population" variant="panel" />);
      show({ ...lost, message: `sub-1014: same_item.nii.gz is not on ${HOST}.`, connectionLostPath: null });
      expect(screen.queryByTestId('studio-source-fetch-reconnect')).toBeNull();
      expect(screen.getByTestId('studio-source-fetch-action')).toHaveTextContent('Retry');
      act(() => markRemoteMountActive(mount.path));
      expect(resume).not.toHaveBeenCalled();
      resume.mockRestore();
    });

    it('does not fetch again once the failure is no longer shown', () => {
      const resume = vi.spyOn(getStudioSourceFetchService(), 'resume');
      render(<StudioSourceFetchNotice lens="compare" variant="line" />);
      show(lost);
      show({ phase: 'fetching', done: 13, total: 35, connectionLostPath: null });
      expect(screen.queryByTestId('studio-source-fetch-reconnect')).toBeNull();
      act(() => markRemoteMountActive(mount.path));
      expect(resume).not.toHaveBeenCalled();
      resume.mockRestore();
    });
  });
});
