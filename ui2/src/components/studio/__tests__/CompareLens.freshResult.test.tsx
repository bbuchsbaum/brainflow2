/**
 * Compare on a set opened from a remote mount, through the real services
 * (coordination, compare, source fetch) and the real store: what each pane
 * says while the images are fetched, while the maps are computed, and after.
 *
 * The backend answers a first computation with `cacheStatus: 'miss'` (nothing
 * was cached: it was computed now). That is a fresh result. It read "Out of
 * date" in the app, and stayed so, on all three computed panes.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../StudioRenderAdapter', () => ({
  StudioRenderAdapter: () => <div data-testid="pane-a-image" />,
}));
vi.mock('../StudioDerivedPaneCanvas', () => ({
  StudioDerivedPaneCanvas: ({ paneId }: { paneId: string }) => (
    <div data-testid={`derived-${paneId}`} />
  ),
}));
vi.mock('@/services/studio/StudioDisplayService', async (importOriginal) => ({
  // The lens looks the member's layer up (its scale is shared with pane B).
  ...(await importOriginal<typeof import('@/services/studio/StudioDisplayService')>()),
  getStudioDisplayService: () => ({
    ensureMemberDisplayed: async () => undefined,
    syncBackground: async () => ({ status: 'shown' }),
    retryBackground: async () => ({ status: 'shown' }),
    releaseStudioLayers: async () => undefined,
    isStudioMap: () => false,
  }),
}));
vi.mock('@/services/studio/SetIngestionService', () => ({
  getSetIngestionService: () => ({ cancelGridCheck: vi.fn(), checkActiveSetGrids: vi.fn() }),
}));
// The member on display is on the 2 mm MNI lattice: its header becomes the
// set's grid evidence after the member has loaded, as in the app.
vi.mock('@/services/studio/studioMemberGrid', () => ({
  readMemberGridHeader: async () => ({
    dims: [97, 115, 97],
    voxelToWorld: [2, 0, 0, -96, 0, 2, 0, -132, 0, 0, 2, -78, 0, 0, 0, 1],
    sformCode: 4,
    qformCode: 4,
  }),
}));

import { CompareLens } from '../CompareLens';
import { useStudioDerivedState } from '@/hooks/useStudioDerivedState';
import { StudioCoordinationService } from '@/services/studio/StudioCoordinationService';
import { resetStudioSourceFetchService } from '@/services/studio/StudioSourceFetchService';
import { folderCandidate, FOLDER_ROOT } from '@/services/studio/__tests__/studioFixtures';
import { setTransport, type BackendTransport } from '@/services/transport';
import { useAppModeStore } from '@/stores/appModeStore';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useStudioSourceFetchStore } from '@/stores/studioSourceFetchStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { FileTreeNode } from '@/types/filesystem';

const HOST = 'trillium.alliancecan.ca';
const CACHE = '/var/folders/9h/abc/T/brainflow_set_studio_cache';
const mount = {
  id: '/cache/mount-a',
  name: 'dsets',
  path: '/cache/mount-a',
  type: 'directory',
  depth: 0,
  mountSource: {
    kind: 'remote',
    mountId: 'mount-1',
    host: HOST,
    remotePath: '/scratch/brad/dsets',
  },
} as FileTreeNode;

type Harness = typeof window & {
  __harnessEvents?: {
    listen: (event: string, handler: (event: { payload: unknown }) => void) => () => void;
  };
};
interface Call {
  cmd: string;
  args: { request?: { fetchId?: string; activeMemberSourcePath?: string | null } };
  resolve: (value: unknown) => void;
}

let calls: Call[];
let emit: (payload: unknown) => void;
/** What the materialization job answers when polled. */
let jobStatus: () => unknown;
let coordination: StudioCoordinationService;
const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const count = (cmd: string) => calls.filter((call) => call.cmd === cmd).length;

/** The panes as the backend returns them for a first computation. */
function computedPanes(memberPath: string, cacheStatus: 'miss' | 'stale' | 'hit') {
  const derived = (id: string, title: string, label: string) => ({
    id,
    title,
    subtitle: '',
    status: 'live',
    reason: `${label} materialized after cache miss at ${CACHE}/${id}:2e0ba322.nii.gz.`,
    recipe: null,
    binding: {
      kind: 'derived_field',
      ready: true,
      sourcePath: `${CACHE}/${id}:2e0ba322.nii.gz`,
      materializationKey: `${id}:2e0ba322`,
      materializedAtMs: 1_700_000_000_000,
      cacheStatus,
      cacheMessage: 'No prior cache entry was found.',
      provenancePath: `${CACHE}/${id}:2e0ba322.json`,
    },
  });
  return [
    {
      id: 'current',
      title: 'sub-1006',
      subtitle: 'Current member',
      status: 'live',
      reason: 'Source-backed.',
      recipe: 'member(sub-1006)',
      binding: {
        kind: 'member_source',
        ready: true,
        sourcePath: memberPath,
        materializationKey: null,
        materializedAtMs: null,
        cacheStatus: 'source',
        cacheMessage: null,
        provenancePath: null,
      },
    },
    derived('cohort-mean', 'All members (n=3)', 'Derived cohort mean'),
    derived('residual', 'Residual', 'Derived residual'),
    derived('zscore', 'Z-score', 'Derived z-score'),
  ];
}

function Lens() {
  const derived = useStudioDerivedState();
  return (
    <CompareLens
      activeSet={derived.activeSet}
      activeFeature={derived.activeFeature}
      activeArtifact={derived.activeArtifact}
      activeMemberId={derived.activeMemberId}
      activeMember={derived.activeMember}
      compareCohort={derived.compareCohort}
      cohorts={[]}
      activeExpression={derived.activeExpression}
      paneSpecs={derived.comparePaneSpecs}
      loading={derived.comparePaneLoading}
      refreshingPaneIds={derived.compareRefreshingPaneIds}
      onSelectCohort={vi.fn()}
      onDrillToCohort={vi.fn()}
      onOpenCompareView={vi.fn()}
      onRecomputePane={vi.fn()}
    />
  );
}

/** The status badge and body text of pane `letter`. */
function pane(letter: 'A' | 'B' | 'C' | 'D') {
  const article = screen
    .getAllByRole('article')
    .find((candidate) => candidate.getAttribute('aria-label')?.startsWith(`${letter} `));
  if (!article) throw new Error(`No pane ${letter}`);
  const badge = article.querySelector('[data-pane-status]');
  return {
    status: badge?.getAttribute('data-pane-status') ?? null,
    label: badge?.textContent ?? null,
    text: article.textContent ?? '',
  };
}

/** A folder set on the remote mount, grids audited, in the Compare lens. */
function openAuditedRemoteSet() {
  useFileBrowserStore.setState({ entries: [mount] });
  const store = useSetStudioStore.getState();
  store.dispatchImportEvent({
    type: 'FOLDER_REVIEW_OPENED',
    root: FOLDER_ROOT,
    source: { root: FOLDER_ROOT, displayPath: '/scratch/brad/dsets/pcmri', label: HOST },
  });
  store.setImportPreviewResult('regex', [folderCandidate({ checked: true })], 'backend');
  useSetStudioStore.getState().confirmImportCandidate();
  useSetStudioStore.getState().setActiveLens('compare');
}

beforeEach(() => {
  calls = [];
  jobStatus = () => ({ state: 'running', result: null, error: null, message: null });
  const handlers: Array<(event: { payload: unknown }) => void> = [];
  emit = (payload) => handlers.forEach((handler) => handler({ payload }));
  (window as Harness).__harnessEvents = {
    listen: (_event, handler) => {
      handlers.push(handler);
      return () => {};
    },
  };
  setTransport({
    invoke: vi.fn(
      (cmd: string, args: unknown) =>
        new Promise((resolve) => {
          calls.push({ cmd, args: args as Call['args'], resolve });
          if (cmd === 'fetch_studio_sources') return;
          if (cmd === 'start_set_studio_compare_materialization') resolve('job-1');
          else if (cmd === 'get_set_studio_materialization_status') resolve(jobStatus());
          else resolve(true);
        }),
    ),
  } as unknown as BackendTransport);
  useSetStudioStore.setState(useSetStudioStore.getInitialState());
  useWorkspaceStore.setState({
    workspaces: new Map([['studio-ws', { id: 'studio-ws', type: 'set-studio' } as never]]),
  } as never);
  useAppModeStore.setState({ mode: 'studio' });
  resetStudioSourceFetchService();
  coordination = new StudioCoordinationService();
});
afterEach(() => {
  coordination.stop();
  cleanup();
  useAppModeStore.setState({ mode: 'imaging' });
  resetStudioSourceFetchService();
  useFileBrowserStore.setState({ entries: [] });
  delete (window as Harness).__harnessEvents;
});

it('says what each pane is doing while images are fetched and maps computed, and a fresh result reads Ready and stays so', async () => {
  openAuditedRemoteSet();
  render(<Lens />);
  act(() => coordination.start());
  await flush();

  // The images are being fetched. Pane A already shows the member's image.
  const fetch = calls.find((call) => call.cmd === 'fetch_studio_sources')!;
  expect(fetch).toBeDefined();
  expect(useStudioSourceFetchStore.getState().phase).toBe('checking');
  expect(screen.getByTestId('pane-a-image')).toBeInTheDocument();
  expect(pane('A')).toMatchObject({ status: 'ready', label: 'Ready' });
  for (const letter of ['B', 'C', 'D'] as const) {
    expect(pane(letter)).toMatchObject({ status: 'waiting', label: 'Waiting' });
    expect(pane(letter).text).toContain('Waiting for images…');
  }
  act(() => emit({ fetchId: fetch.args.request!.fetchId, done: 1, total: 3, mountLabel: HOST }));
  expect(useStudioSourceFetchStore.getState().phase).toBe('fetching');
  expect(pane('B').text).toContain('Waiting for images…');
  expect(document.body.textContent).not.toMatch(/Pending|Nothing to show yet|Out of date/);
  expect(count('start_set_studio_compare_materialization')).toBe(0);

  // The fetch lands: the maps are being computed.
  await act(async () => {
    fetch.resolve({
      status: 'ready',
      mountLabel: HOST,
      remoteCount: 3,
      fetchCount: 3,
      fetchBytes: 3_000_000,
      fetchedCount: 3,
    });
  });
  await waitFor(() => expect(count('get_set_studio_materialization_status')).toBeGreaterThan(0));
  expect(useStudioSourceFetchStore.getState().phase).toBe('idle');
  expect(pane('A')).toMatchObject({ status: 'ready', label: 'Ready' });
  for (const letter of ['B', 'C', 'D'] as const) {
    expect(pane(letter)).toMatchObject({ status: 'computing', label: 'Computing' });
    expect(pane(letter).text).toContain('Computing…');
  }
  expect(document.body.textContent).not.toMatch(/Pending|Nothing to show yet|Out of date/);

  // The job completes: nothing was cached, so every map was computed now.
  const start = calls.find((call) => call.cmd === 'start_set_studio_compare_materialization')!;
  const result = computedPanes(start.args.request!.activeMemberSourcePath!, 'miss');
  jobStatus = () => ({ state: 'completed', result, error: null, message: null });
  await waitFor(() => expect(screen.getByTestId('derived-zscore')).toBeInTheDocument());
  const allReady = () => {
    for (const letter of ['A', 'B', 'C', 'D'] as const)
      expect(pane(letter)).toMatchObject({ status: 'ready', label: 'Ready' });
    for (const id of ['cohort-mean', 'residual', 'zscore'])
      expect(screen.getByTestId(`derived-${id}`)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Out of date|Pending|Recompute to refresh/);
  };
  allReady();

  // What follows in the app changes no input of the computation: the header
  // of the member on display becomes the set's grid evidence, a background is
  // chosen, the "opened as" notice is shown, a pane is selected (which enters
  // the artifact history), and the fetch bookkeeping moves on.
  await flush();
  const store = () => useSetStudioStore.getState();
  expect(store().studioGridEvidence).not.toBeNull();
  const computations = count('start_set_studio_compare_materialization');
  act(() => {
    store().setStudioOpenNotice({
      setId: store().selection.activeSetId!,
      message: 'Opened as one member per folder.',
      root: FOLDER_ROOT,
    });
    coordination.chooseBackground('template:MNI152NLin2009cAsym_T1w_2mm');
    const artifact = store().activeArtifact!;
    store().setActiveArtifact({
      ...artifact,
      id: 'compare:cohort-mean:all',
      paneId: 'cohort-mean',
    });
    useStudioSourceFetchStore.setState((state) => ({ revision: state.revision + 1 }));
  });
  await flush();
  expect(store().artifactHistory.length).toBeGreaterThan(0);
  allReady();
  // Nothing was computed again either.
  expect(count('start_set_studio_compare_materialization')).toBe(computations);
  expect(computations).toBe(1);
});

it('a map computed again because its cached copy was out of date is the fresh result too', async () => {
  openAuditedRemoteSet();
  // The images are on this computer already: nothing to fetch.
  useFileBrowserStore.setState({ entries: [] });
  const members = Object.values(useSetStudioStore.getState().sets)[0].memberSummaries;
  jobStatus = () => ({
    state: 'completed',
    result: computedPanes(members[0].sourcePath!, 'stale'),
    error: null,
    message: null,
  });
  render(<Lens />);
  act(() => coordination.start());
  await waitFor(() => expect(screen.getByTestId('derived-zscore')).toBeInTheDocument());
  for (const letter of ['A', 'B', 'C', 'D'] as const)
    expect(pane(letter)).toMatchObject({ status: 'ready', label: 'Ready' });
  expect(document.body.textContent).not.toMatch(/Out of date/);
});
