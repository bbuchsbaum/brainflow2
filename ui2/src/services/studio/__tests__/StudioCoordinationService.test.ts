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
  }),
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
    mocks.emit.mockReset();
    bootstrapStore();
    service = new StudioCoordinationService();
    service.start();
  });

  afterEach(() => {
    service.stop();
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
