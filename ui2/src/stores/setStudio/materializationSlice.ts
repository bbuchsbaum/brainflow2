import type {
  StudioComparePaneSpec,
  StudioMaterializationCacheSummary,
  StudioMaterializationJobDescriptor,
  StudioMaterializationJobSummary,
  StudioMaterializationStatus,
} from '@/types/studio';

const MAX_MATERIALIZATION_JOBS = 12;
const MAX_MATERIALIZATION_CACHE_ENTRIES = 48;

export interface SetStudioMaterializationSliceHost {
  materialization: StudioMaterializationStatus;
  comparePaneSpecs: StudioComparePaneSpec[];
  comparePaneLoading: boolean;
  compareRefreshingPaneIds: string[];
  activeMaterializationJobId: string | null;
  materializationJobs: Record<string, StudioMaterializationJobSummary>;
  materializationJobIds: string[];
  materializationCache: Record<string, StudioMaterializationCacheSummary>;
}

export interface SetStudioMaterializationSlice {
  beginMaterializationJob: (job: StudioMaterializationJobDescriptor) => void;
  completeMaterializationJob: (jobId: string, specs: StudioComparePaneSpec[]) => void;
  failMaterializationJob: (jobId: string, message: string) => void;
  cancelMaterializationJob: (jobId: string) => void;
  markMaterializationJobStale: (jobId: string) => void;
  isMaterializationJobActive: (jobId: string) => boolean;
  clearMaterializationJobs: () => void;
}

type MaterializationSliceStore = SetStudioMaterializationSliceHost & SetStudioMaterializationSlice;
type StoreSet = (
  partial:
    | Partial<SetStudioMaterializationSliceHost>
    | ((state: MaterializationSliceStore) => Partial<SetStudioMaterializationSliceHost>),
  replace?: false,
) => void;
type StoreGet = () => MaterializationSliceStore;

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function summarizeMaterializationStatus(
  base: StudioMaterializationStatus,
  jobs: Record<string, StudioMaterializationJobSummary>,
): StudioMaterializationStatus {
  const values = Object.values(jobs);
  return {
    ...base,
    pending: values.filter((job) => job.status === 'running').length,
    failed: values.filter((job) => job.status === 'failed').length,
  };
}

function keepRecentJobs(
  jobs: Record<string, StudioMaterializationJobSummary>,
  jobIds: string[],
): {
  jobs: Record<string, StudioMaterializationJobSummary>;
  jobIds: string[];
} {
  const nextJobIds = jobIds.slice(0, MAX_MATERIALIZATION_JOBS);
  const nextJobs: Record<string, StudioMaterializationJobSummary> = {};
  for (const jobId of nextJobIds) {
    const job = jobs[jobId];
    if (job) {
      nextJobs[jobId] = job;
    }
  }
  return { jobs: nextJobs, jobIds: nextJobIds };
}

function cacheSummariesFromPaneSpecs(
  jobId: string,
  paneSpecs: StudioComparePaneSpec[],
  updatedAtMs: number,
): Record<string, StudioMaterializationCacheSummary> {
  const summaries: Record<string, StudioMaterializationCacheSummary> = {};
  for (const pane of paneSpecs) {
    const binding = pane.binding;
    if (!binding?.materializationKey) {
      continue;
    }
    summaries[binding.materializationKey] = {
      key: binding.materializationKey,
      paneId: pane.id,
      status: binding.cacheStatus,
      message: binding.cacheMessage,
      sourcePath: binding.sourcePath,
      materializedAtMs: binding.materializedAtMs,
      provenancePath: binding.provenancePath,
      jobId,
      updatedAtMs,
    };
  }
  return summaries;
}

function keepRecentCacheEntries(
  cache: Record<string, StudioMaterializationCacheSummary>,
): Record<string, StudioMaterializationCacheSummary> {
  const entries = Object.values(cache)
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
    .slice(0, MAX_MATERIALIZATION_CACHE_ENTRIES);
  return entries.reduce<Record<string, StudioMaterializationCacheSummary>>((acc, entry) => {
    acc[entry.key] = entry;
    return acc;
  }, {});
}

function hasRunningJob(
  jobs: Record<string, StudioMaterializationJobSummary>,
  jobId: string | null,
): boolean {
  return Boolean(jobId && jobs[jobId]?.status === 'running');
}

function loadingStateFor(
  jobs: Record<string, StudioMaterializationJobSummary>,
  activeJobId: string | null,
): Pick<SetStudioMaterializationSliceHost, 'comparePaneLoading' | 'compareRefreshingPaneIds'> {
  const activeJob = activeJobId ? jobs[activeJobId] : null;
  if (activeJob?.status === 'running') {
    return {
      comparePaneLoading: true,
      compareRefreshingPaneIds: activeJob.paneIds,
    };
  }
  return {
    comparePaneLoading: false,
    compareRefreshingPaneIds: [],
  };
}

export function createMaterializationSlice(
  set: StoreSet,
  get: StoreGet,
): SetStudioMaterializationSlice {
  return {
    beginMaterializationJob: (job) => {
      set((state) => {
        const now = Date.now();
        const jobs = { ...state.materializationJobs };
        const previousActiveJobId = state.activeMaterializationJobId;
        if (
          previousActiveJobId &&
          previousActiveJobId !== job.id &&
          jobs[previousActiveJobId]?.status === 'running'
        ) {
          jobs[previousActiveJobId] = {
            ...jobs[previousActiveJobId],
            status: 'stale',
            progress: clampProgress(jobs[previousActiveJobId].progress),
            finishedAtMs: now,
            errorMessage: null,
          };
        }

        jobs[job.id] = {
          ...job,
          status: 'running',
          progress: 0.05,
          startedAtMs: now,
          finishedAtMs: null,
          errorMessage: null,
          cacheKeys: [],
        };

        const bounded = keepRecentJobs(jobs, [
          job.id,
          ...state.materializationJobIds.filter((jobId) => jobId !== job.id),
        ]);

        return {
          materializationJobs: bounded.jobs,
          materializationJobIds: bounded.jobIds,
          activeMaterializationJobId: job.id,
          comparePaneLoading: true,
          compareRefreshingPaneIds: job.paneIds,
          materialization: summarizeMaterializationStatus(state.materialization, bounded.jobs),
        };
      });
    },

    completeMaterializationJob: (jobId, specs) => {
      set((state) => {
        const job = state.materializationJobs[jobId];
        if (!job || job.status !== 'running' || state.activeMaterializationJobId !== jobId) {
          return {};
        }

        const now = Date.now();
        const cacheUpdates = cacheSummariesFromPaneSpecs(jobId, specs, now);
        const cache = keepRecentCacheEntries({
          ...state.materializationCache,
          ...cacheUpdates,
        });
        const cacheKeys = Object.keys(cacheUpdates);
        const jobs = {
          ...state.materializationJobs,
          [jobId]: {
            ...job,
            status: 'completed' as const,
            progress: 1,
            finishedAtMs: now,
            errorMessage: null,
            cacheKeys,
          },
        };

        return {
          comparePaneSpecs: specs,
          activeMaterializationJobId: null,
          materializationJobs: jobs,
          materializationCache: cache,
          comparePaneLoading: false,
          compareRefreshingPaneIds: [],
          materialization: summarizeMaterializationStatus(state.materialization, jobs),
        };
      });
    },

    failMaterializationJob: (jobId, message) => {
      set((state) => {
        const job = state.materializationJobs[jobId];
        if (!job || job.status !== 'running') {
          return {};
        }

        const jobs = {
          ...state.materializationJobs,
          [jobId]: {
            ...job,
            status: 'failed' as const,
            progress: clampProgress(job.progress),
            finishedAtMs: Date.now(),
            errorMessage: message,
          },
        };
        const nextActiveJobId =
          state.activeMaterializationJobId === jobId ? null : state.activeMaterializationJobId;
        const loading = loadingStateFor(jobs, nextActiveJobId);

        return {
          activeMaterializationJobId: nextActiveJobId,
          materializationJobs: jobs,
          ...loading,
          materialization: summarizeMaterializationStatus(state.materialization, jobs),
        };
      });
    },

    cancelMaterializationJob: (jobId) => {
      set((state) => {
        const job = state.materializationJobs[jobId];
        if (!job || job.status !== 'running') {
          return {};
        }

        const jobs = {
          ...state.materializationJobs,
          [jobId]: {
            ...job,
            status: 'cancelled' as const,
            progress: clampProgress(job.progress),
            finishedAtMs: Date.now(),
            errorMessage: null,
          },
        };
        const nextActiveJobId =
          state.activeMaterializationJobId === jobId ? null : state.activeMaterializationJobId;
        const loading = loadingStateFor(jobs, nextActiveJobId);

        return {
          activeMaterializationJobId: nextActiveJobId,
          materializationJobs: jobs,
          ...loading,
          materialization: summarizeMaterializationStatus(state.materialization, jobs),
        };
      });
    },

    markMaterializationJobStale: (jobId) => {
      set((state) => {
        const job = state.materializationJobs[jobId];
        if (!job || job.status !== 'running') {
          return {};
        }

        const jobs = {
          ...state.materializationJobs,
          [jobId]: {
            ...job,
            status: 'stale' as const,
            progress: clampProgress(job.progress),
            finishedAtMs: Date.now(),
            errorMessage: null,
          },
        };
        const nextActiveJobId =
          state.activeMaterializationJobId === jobId ? null : state.activeMaterializationJobId;
        const loading = loadingStateFor(jobs, nextActiveJobId);

        return {
          activeMaterializationJobId: nextActiveJobId,
          materializationJobs: jobs,
          ...loading,
          materialization: summarizeMaterializationStatus(state.materialization, jobs),
        };
      });
    },

    isMaterializationJobActive: (jobId) => {
      const state = get();
      return (
        state.activeMaterializationJobId === jobId &&
        hasRunningJob(state.materializationJobs, jobId)
      );
    },

    clearMaterializationJobs: () => {
      set((state) => ({
        activeMaterializationJobId: null,
        materializationJobs: {},
        materializationJobIds: [],
        materializationCache: {},
        comparePaneLoading: false,
        compareRefreshingPaneIds: [],
        materialization: {
          ...state.materialization,
          pending: 0,
          failed: 0,
        },
      }));
    },
  };
}
