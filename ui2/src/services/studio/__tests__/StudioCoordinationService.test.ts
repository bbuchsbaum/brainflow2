import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioCoordinationService } from '../StudioCoordinationService';
import { useSetStudioStore } from '@/stores/setStudioStore';
import type {
  SpatialFieldSetSummary,
  StudioCohortSummary,
  StudioComparePaneSpec,
  StudioFeatureSummary,
  StudioFieldExpressionSummary,
  StudioMemberSummary,
} from '@/types/studio';

const mocks = vi.hoisted(() => ({
  materializeComparePanes: vi.fn(),
  ensureMemberDisplayed: vi.fn(),
  syncBackground: vi.fn(),
  retryBackground: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('../StudioCompareService', () => ({
  getStudioCompareService: () => ({
    materializeComparePanes: mocks.materializeComparePanes,
  }),
}));

vi.mock('../StudioDisplayService', () => ({
  getStudioDisplayService: () => ({
    ensureMemberDisplayed: mocks.ensureMemberDisplayed,
    syncBackground: mocks.syncBackground,
    retryBackground: mocks.retryBackground,
  }),
}));

// No member layer exists in these tests: there is no header to read.
vi.mock('../studioMemberGrid', () => ({
  readMemberGridHeader: async () => null,
}));

vi.mock('@/events/EventBus', () => ({
  getEventBus: () => ({
    emit: mocks.emit,
  }),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

const members: StudioMemberSummary[] = [
  { id: 'sub001', sourcePath: '/study/sub001/tstat.nii.gz' },
  { id: 'sub002', sourcePath: '/study/sub002/tstat.nii.gz' },
];

const set: SpatialFieldSetSummary = {
  id: 'set-a',
  name: 'Set A',
  sourceKind: 'imported',
  importContract: {
    readiness: 'compare_ready',
    provenanceKind: 'manifest',
    provenanceLabel: '/study/nftab.yaml',
    canImport: true,
    capabilities: ['import', 'deck', 'compare', 'materialize_compare'],
    reason: 'Fixture is compare-ready.',
  },
  memberCount: members.length,
  primaryFeatureId: 'tstat',
  supportKind: 'volume',
  supportLabel: 'MNI152 2mm template',
  alignmentClass: 'same-grid',
  designColumns: ['subject'],
  designTablePreview: null,
  memberSummaries: members,
  memberIds: members.map((member) => member.id),
  savedCohortIds: ['cohort-a'],
  ingestAudit: {
    sourceLabel: 'NeuroTabs manifest',
    join: {
      matchedRows: members.length,
      unmatchedRows: 0,
      duplicateKeys: 0,
      severity: 'ok',
      issueDetails: [],
    },
    support: {
      supportLabel: 'MNI152 2mm template',
      alignmentClass: 'same-grid',
      readyForCompare: true,
      severity: 'ok',
    },
    notes: [],
  },
};

const feature: StudioFeatureSummary = {
  id: 'tstat',
  label: 'T-stat',
  kind: 'volume',
};

const cohort: StudioCohortSummary = {
  id: 'cohort-a',
  label: 'Matched controls',
  memberCount: members.length,
  description: 'Fixture cohort',
  memberIds: members.map((member) => member.id),
  originKind: 'imported',
  originLabel: 'NeuroTabs manifest',
};

const expression: StudioFieldExpressionSummary = {
  id: 'expr-z',
  label: 'Z-score',
  kind: 'comparison',
  recipe: 'zscore(current, cohort:cohort-a)',
  cohortId: cohort.id,
};

function comparePane(path: string, key: string): StudioComparePaneSpec {
  return {
    id: 'zscore',
    title: 'Z-score',
    subtitle: 'Cohort-relative comparison',
    status: 'live',
    reason: 'Derived z-score cache is ready.',
    recipe: expression.recipe,
    binding: {
      kind: 'derived_field',
      ready: true,
      sourcePath: path,
      materializationKey: key,
      materializedAtMs: 42,
      cacheStatus: 'hit',
      cacheMessage: 'Cache hit.',
      provenancePath: `${path}.json`,
    },
  };
}

function bootstrapStore() {
  useSetStudioStore.getState().bootstrapStudio({
    set,
    features: [feature],
    cohorts: [cohort],
    expressions: [expression],
    selection: {
      activeLens: 'deck',
      activeMemberId: members[0].id,
      compareCohortId: cohort.id,
      activeExpressionId: expression.id,
    },
  });
}

function refreshArgs() {
  return {
    activeSet: set,
    activeMember: members[0],
    compareCohort: cohort,
    activeExpression: expression,
    forceRematerialize: false,
  };
}

describe('StudioCoordinationService materialization jobs', () => {
  let service: StudioCoordinationService;

  beforeEach(() => {
    useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
    mocks.materializeComparePanes.mockReset();
    mocks.ensureMemberDisplayed.mockReset();
    mocks.ensureMemberDisplayed.mockResolvedValue(undefined);
    mocks.syncBackground.mockReset();
    mocks.syncBackground.mockImplementation(async (sourcePath: string | null) => ({
      status: sourcePath ? 'ready' : 'none',
      sourcePath,
    }));
    mocks.emit.mockReset();
    bootstrapStore();
    service = new StudioCoordinationService();
    service.start();
  });

  afterEach(() => {
    service.stop();
  });

  it('keeps population focus changes out of file loading and materialization', () => {
    useSetStudioStore.getState().setActiveLens('population');
    mocks.ensureMemberDisplayed.mockClear();
    mocks.materializeComparePanes.mockClear();
    const selection = useSetStudioStore.getState().population.working;
    useSetStudioStore.getState().setActiveMember('sub002');
    expect(mocks.ensureMemberDisplayed).not.toHaveBeenCalled();
    expect(mocks.materializeComparePanes).not.toHaveBeenCalled();
    expect(useSetStudioStore.getState().population.working).toBe(selection);
    expect(useSetStudioStore.getState().activeArtifact).toBeNull();
  });

  it('restarts a canceled comparison when returning from the population view', async () => {
    const first = deferred<StudioComparePaneSpec[]>();
    const second = deferred<StudioComparePaneSpec[]>();
    mocks.materializeComparePanes.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    useSetStudioStore.getState().setActiveLens('compare');
    expect(mocks.materializeComparePanes).toHaveBeenCalledTimes(1);
    const signal = mocks.materializeComparePanes.mock.calls[0][1].signal;
    useSetStudioStore.getState().setActiveLens('population');
    expect(signal.aborted).toBe(true);
    useSetStudioStore.getState().setActiveLens('compare');
    expect(mocks.materializeComparePanes).toHaveBeenCalledTimes(2);
    first.resolve([comparePane('/old.nii', 'old')]);
    second.resolve([comparePane('/fresh.nii', 'fresh')]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(useSetStudioStore.getState().comparePaneSpecs[0]?.binding?.sourcePath).toBe('/fresh.nii');
  });

  it('ignores stale compare materialization responses after a newer request starts', async () => {
    const first = deferred<StudioComparePaneSpec[]>();
    const second = deferred<StudioComparePaneSpec[]>();
    mocks.materializeComparePanes
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const firstRefresh = service.refreshComparePanes(refreshArgs());
    const firstJobId = useSetStudioStore.getState().activeMaterializationJobId;
    const secondRefresh = service.refreshComparePanes(refreshArgs());
    const secondJobId = useSetStudioStore.getState().activeMaterializationJobId;

    expect(firstJobId).not.toBeNull();
    expect(secondJobId).not.toBe(firstJobId);
    expect(useSetStudioStore.getState().materializationJobs[firstJobId!]?.status).toBe('stale');

    second.resolve([comparePane('/cache/second-z.nii.gz', 'zscore:second')]);
    await secondRefresh;

    expect(useSetStudioStore.getState().comparePaneSpecs).toEqual([
      comparePane('/cache/second-z.nii.gz', 'zscore:second'),
    ]);
    expect(useSetStudioStore.getState().materializationJobs[secondJobId!]?.status).toBe(
      'completed',
    );
    expect(useSetStudioStore.getState().materializationCache['zscore:second']).toMatchObject({
      sourcePath: '/cache/second-z.nii.gz',
      status: 'hit',
    });

    first.resolve([comparePane('/cache/first-z.nii.gz', 'zscore:first')]);
    await firstRefresh;

    expect(useSetStudioStore.getState().comparePaneSpecs).toEqual([
      comparePane('/cache/second-z.nii.gz', 'zscore:second'),
    ]);
    expect(useSetStudioStore.getState().materializationCache['zscore:first']).toBeUndefined();
  });

  it('keeps cancelled materialization responses from updating compare panes', async () => {
    const pending = deferred<StudioComparePaneSpec[]>();
    mocks.materializeComparePanes.mockReturnValueOnce(pending.promise);

    const refresh = service.refreshComparePanes(refreshArgs());
    const jobId = useSetStudioStore.getState().activeMaterializationJobId;

    expect(jobId).not.toBeNull();
    expect(useSetStudioStore.getState().comparePaneLoading).toBe(true);
    expect(service.cancelActiveMaterialization()).toBe(true);
    expect(useSetStudioStore.getState().materializationJobs[jobId!]?.status).toBe('cancelled');
    expect(useSetStudioStore.getState().comparePaneLoading).toBe(false);

    pending.resolve([comparePane('/cache/cancelled-z.nii.gz', 'zscore:cancelled')]);
    await refresh;

    expect(useSetStudioStore.getState().comparePaneSpecs).toEqual([]);
    expect(useSetStudioStore.getState().materializationJobs[jobId!]?.status).toBe('cancelled');
    expect(useSetStudioStore.getState().materializationCache['zscore:cancelled']).toBeUndefined();
  });
});

describe('StudioCoordinationService population transitions', () => {
  let service: StudioCoordinationService;
  beforeEach(() => {
    useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
    mocks.ensureMemberDisplayed.mockReset().mockResolvedValue(undefined);
    bootstrapStore();
    useSetStudioStore.setState({
      sets: {
        [set.id]: {
          ...set,
          designTablePreview: {
            columns: ['subject', 'group'],
            rows: [
              { id: 'sub001', cells: ['sub001', 'A'] },
              { id: 'sub002', cells: ['sub002', 'B'] },
            ],
          },
        },
      },
    });
    service = new StudioCoordinationService();
  });
  afterEach(() => service.stop());

  it('preserves focus when search or issue highlighting hides the focused person', () => {
    service.start();
    useSetStudioStore.getState().setDesignSearch('sub002');
    useSetStudioStore.setState({ activeIssueMemberIds: ['sub002'], activeIssueLabel: 'Review' });
    expect(useSetStudioStore.getState().selection.activeMemberId).toBe('sub001');
    expect(useSetStudioStore.getState().designSearch).toBe('sub002');
  });

  it('preserves filters on startup and displays the newly eligible focus', () => {
    const filters = [{ column: 'group', value: 'B' }];
    useSetStudioStore.setState({ activeDesignFilters: filters });
    service.start();
    expect(useSetStudioStore.getState().activeDesignFilters).toEqual(filters);
    expect(useSetStudioStore.getState().selection.activeMemberId).toBe('sub002');
    expect(mocks.ensureMemberDisplayed).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'set-a' }),
      'sub002',
    );
  });

  it('keeps metadata filters even when search produces no quick-filter suggestions', () => {
    service.start();
    const filters = [{ column: 'group', value: 'A' }];
    useSetStudioStore.setState({ activeDesignFilters: filters });
    useSetStudioStore.getState().setDesignSearch('no matches');
    expect(useSetStudioStore.getState().activeDesignFilters).toEqual(filters);
    expect(useSetStudioStore.getState().selection.activeMemberId).toBe('sub001');
  });

  it('clears focus for a valid empty context and restores it when eligibility returns', () => {
    service.start();
    useSetStudioStore.setState({ activeDesignFilters: [{ column: 'group', value: 'C' }] });
    expect(useSetStudioStore.getState().selection.activeMemberId).toBeNull();
    useSetStudioStore.getState().clearDesignFilters();
    expect(useSetStudioStore.getState().selection.activeMemberId).toBe('sub001');
  });

  it('retains invalid filters and focus for explicit repair rather than widening eligibility', () => {
    const filters = [{ column: 'unavailable', value: 'A' }];
    useSetStudioStore.setState({ activeDesignFilters: filters });
    service.start();
    expect(useSetStudioStore.getState().activeDesignFilters).toEqual(filters);
    expect(useSetStudioStore.getState().selection.activeMemberId).toBe('sub001');
  });
});

describe('StudioCoordinationService background', () => {
  const TEMPLATE = 'template:MNI152NLin2009cAsym_T1w_1mm';
  const OTHER = 'template:MNI152NLin6Asym_T1w_1mm';
  let service: StudioCoordinationService;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
    mocks.materializeComparePanes.mockReset();
    mocks.ensureMemberDisplayed.mockReset();
    mocks.ensureMemberDisplayed.mockResolvedValue(undefined);
    mocks.syncBackground.mockReset();
    mocks.syncBackground.mockImplementation(async (sourcePath: string | null) => ({
      status: sourcePath ? 'ready' : 'none',
      sourcePath,
    }));
    bootstrapStore();
    service = new StudioCoordinationService();
    service.start();
  });
  afterEach(() => service.stop());

  it('hands a change of background to the display service once, not on every member', () => {
    // The fixture's support declares no space: no background to start with.
    expect(mocks.syncBackground).toHaveBeenCalledTimes(1);
    expect(mocks.syncBackground).toHaveBeenLastCalledWith(null);

    useSetStudioStore.getState().setStudioBackground(TEMPLATE);
    expect(mocks.syncBackground).toHaveBeenCalledTimes(2);
    expect(mocks.syncBackground).toHaveBeenLastCalledWith(TEMPLATE);

    useSetStudioStore.getState().setActiveMember('sub002');
    useSetStudioStore.getState().setActiveMember('sub001');
    expect(mocks.syncBackground).toHaveBeenCalledTimes(2);

    useSetStudioStore.getState().setStudioBackground(null);
    expect(mocks.syncBackground).toHaveBeenLastCalledWith(null);
  });

  it('does not load a template for the Population lens, which samples its own', () => {
    useSetStudioStore.getState().setActiveLens('population');
    mocks.syncBackground.mockClear();
    useSetStudioStore.getState().setStudioBackground(TEMPLATE);
    expect(mocks.syncBackground).not.toHaveBeenCalled();
    useSetStudioStore.getState().setActiveLens('deck');
    expect(mocks.syncBackground).toHaveBeenCalledWith(TEMPLATE);
  });

  it('reports a template that could not be opened, for that template only', async () => {
    mocks.syncBackground.mockResolvedValueOnce({ status: 'failed', sourcePath: TEMPLATE });
    useSetStudioStore.getState().setStudioBackground(TEMPLATE);
    await settle();
    expect(useSetStudioStore.getState().studioBackgroundIssue).toEqual({
      sourcePath: TEMPLATE,
      message: 'This template could not be opened.',
    });
    // Choosing again clears it.
    useSetStudioStore.getState().setStudioBackground(OTHER);
    expect(useSetStudioStore.getState().studioBackgroundIssue).toBeNull();
  });

  it('reports a rejected request as a failure instead of leaving it unhandled', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.syncBackground.mockRejectedValueOnce(new Error('layer service down'));
    useSetStudioStore.getState().setStudioBackground(TEMPLATE);
    await settle();
    expect(useSetStudioStore.getState().studioBackgroundIssue).toEqual({
      sourcePath: TEMPLATE,
      message: 'This template could not be opened.',
    });
    warn.mockRestore();
  });

  it('tries a failed template again when the same one is chosen again', async () => {
    mocks.syncBackground.mockResolvedValueOnce({ status: 'failed', sourcePath: TEMPLATE });
    mocks.retryBackground.mockReset();
    mocks.retryBackground.mockResolvedValue({ status: 'ready', sourcePath: TEMPLATE });
    service.chooseBackground(TEMPLATE);
    await settle();
    expect(useSetStudioStore.getState().studioBackgroundIssue?.sourcePath).toBe(TEMPLATE);
    expect(mocks.retryBackground).not.toHaveBeenCalled();

    service.chooseBackground(TEMPLATE);
    expect(mocks.retryBackground).toHaveBeenCalledWith(TEMPLATE);
    await settle();
    expect(useSetStudioStore.getState().studioBackgroundIssue).toBeNull();
    // A template that is fine is not reloaded by choosing it again.
    service.chooseBackground(TEMPLATE);
    expect(mocks.retryBackground).toHaveBeenCalledTimes(1);
  });

  it('records a choice through the service', () => {
    service.chooseBackground(OTHER);
    expect(useSetStudioStore.getState().studioBackground).toEqual({
      setId: 'set-a',
      sourcePath: OTHER,
    });
    expect(mocks.syncBackground).toHaveBeenLastCalledWith(OTHER);
    service.chooseBackground(null);
    expect(mocks.syncBackground).toHaveBeenLastCalledWith(null);
  });

  it('asks again for the active member on a retry, and not once stopped', () => {
    mocks.ensureMemberDisplayed.mockClear();
    service.retryActiveMember();
    expect(mocks.ensureMemberDisplayed).toHaveBeenCalledTimes(1);
    const [activeSet, memberId] = mocks.ensureMemberDisplayed.mock.calls[0];
    expect(activeSet.id).toBe('set-a');
    expect(memberId).toBe(useSetStudioStore.getState().selection.activeMemberId);
    service.stop();
    service.retryActiveMember();
    expect(mocks.ensureMemberDisplayed).toHaveBeenCalledTimes(1);
  });

  it('drops a failure that arrives after another background was chosen', async () => {
    const late = deferred<{ status: 'failed'; sourcePath: string }>();
    mocks.syncBackground.mockReturnValueOnce(late.promise);
    useSetStudioStore.getState().setStudioBackground(TEMPLATE);
    useSetStudioStore.getState().setStudioBackground(OTHER);
    late.resolve({ status: 'failed', sourcePath: TEMPLATE });
    await settle();
    expect(useSetStudioStore.getState().studioBackgroundIssue).toBeNull();
  });

  it('drops a failure that arrives after another set was opened', async () => {
    const late = deferred<{ status: 'failed'; sourcePath: string }>();
    mocks.syncBackground.mockReturnValueOnce(late.promise);
    useSetStudioStore.getState().setStudioBackground(TEMPLATE);
    useSetStudioStore.getState().bootstrapStudio({
      set: { ...set, id: 'set-b' },
      background: TEMPLATE,
      features: [feature],
      cohorts: [cohort],
      expressions: [expression],
    });
    mocks.syncBackground.mockClear();
    late.resolve({ status: 'failed', sourcePath: TEMPLATE });
    await settle();
    expect(useSetStudioStore.getState().studioBackgroundIssue).toBeNull();
  });
});

describe('StudioCoordinationService automatic grid check', () => {
  const unchecked: SpatialFieldSetSummary = {
    ...set,
    id: 'set-unchecked',
    importContract: { ...set.importContract!, readiness: 'review_required', capabilities: ['import', 'deck'] },
    supportLabel: 'headers not sampled',
    alignmentClass: 'unknown',
    ingestAudit: {
      ...set.ingestAudit,
      support: {
        supportLabel: 'headers not sampled',
        alignmentClass: 'unknown',
        readyForCompare: false,
        severity: 'ok',
      },
    },
    discoveryRequest: {
      root: '/study',
      filePattern: 'x',
      includePatterns: [],
      excludePatterns: [],
      rolePatterns: [],
      requiredRoles: [],
      maxDepth: 4,
      maxFiles: 100,
    },
  };
  let service: StudioCoordinationService;
  const autoCheckGrids = vi.fn();

  function open(target: SpatialFieldSetSummary, lens: 'deck' | 'population' | 'compare' = 'deck') {
    useSetStudioStore.getState().bootstrapStudio({
      set: target,
      features: [feature],
      cohorts: [cohort],
      expressions: [expression],
      selection: {
        activeLens: lens,
        activeMemberId: members[0].id,
        compareCohortId: cohort.id,
        activeExpressionId: expression.id,
      },
    });
  }

  beforeEach(() => {
    useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
    autoCheckGrids.mockReset();
    mocks.materializeComparePanes.mockReset();
    mocks.materializeComparePanes.mockResolvedValue([]);
    mocks.ensureMemberDisplayed.mockReset();
    mocks.syncBackground.mockReset();
    mocks.syncBackground.mockResolvedValue({ status: 'none', sourcePath: null });
    service = new StudioCoordinationService();
  });

  afterEach(() => {
    service.stop();
  });

  it('starts the check only after the first member is on display', async () => {
    const display = deferred<void>();
    mocks.ensureMemberDisplayed.mockReturnValue(display.promise);
    open(unchecked);
    service.start({ autoCheckGrids });
    await Promise.resolve();
    // The member's image is still loading: the header reads wait for it.
    expect(mocks.ensureMemberDisplayed).toHaveBeenCalled();
    expect(autoCheckGrids).not.toHaveBeenCalled();

    display.resolve();
    await vi.waitFor(() => expect(autoCheckGrids).toHaveBeenCalled());
  });

  it('starts it even when the member could not be displayed', async () => {
    mocks.ensureMemberDisplayed.mockRejectedValue(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    open(unchecked);
    service.start({ autoCheckGrids });
    await vi.waitFor(() => expect(autoCheckGrids).toHaveBeenCalled());
    warn.mockRestore();
  });

  it('starts it at once in Population, where no member image is loaded', () => {
    mocks.ensureMemberDisplayed.mockResolvedValue(undefined);
    open(unchecked, 'population');
    service.start({ autoCheckGrids });
    expect(autoCheckGrids).toHaveBeenCalled();
    expect(mocks.ensureMemberDisplayed).not.toHaveBeenCalled();
  });

  it('leaves a set alone whose grids are known, or whose check is running', async () => {
    mocks.ensureMemberDisplayed.mockResolvedValue(undefined);
    open(set);
    service.start({ autoCheckGrids });
    await Promise.resolve();
    await Promise.resolve();
    expect(autoCheckGrids).not.toHaveBeenCalled();

    open(unchecked, 'population');
    autoCheckGrids.mockClear();
    useSetStudioStore.getState().setGridCheck({ status: 'checking', message: null });
    useSetStudioStore.getState().setActiveMember(members[1].id);
    expect(autoCheckGrids).not.toHaveBeenCalled();
  });

  it('computes the Compare panes by itself when the check makes the set comparable', async () => {
    mocks.ensureMemberDisplayed.mockResolvedValue(undefined);
    open(unchecked, 'compare');
    service.start({ autoCheckGrids });
    await vi.waitFor(() => expect(mocks.materializeComparePanes).toHaveBeenCalledTimes(1));

    // The header check lands: the same set, now on one grid.
    useSetStudioStore.getState().applySetAudit(unchecked.id, {
      supportLabel: set.supportLabel,
      alignmentClass: 'same-grid',
      ingestAudit: set.ingestAudit,
      memberSummaries: unchecked.memberSummaries,
      importContract: set.importContract,
    });

    await vi.waitFor(() => expect(mocks.materializeComparePanes).toHaveBeenCalledTimes(2));
    expect(mocks.materializeComparePanes.mock.calls[1][0].activeSet.importContract.readiness).toBe(
      'compare_ready',
    );
  });
});

