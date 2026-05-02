import { create } from 'zustand';
import type {
  AnalysisDescriptor,
  AnalysisInput,
  AnalysisJobStatus,
  AnalysisStartRequest,
} from '@brainflow/api';
import { getAnalysisService } from '@/services/analysis/AnalysisService';

type AnalysisLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface AnalysisStoreState {
  descriptors: AnalysisDescriptor[];
  selectedAnalysisId: string | null;
  loadStatus: AnalysisLoadStatus;
  loadError: string | null;
  jobs: AnalysisJobStatus[];
  startError: string | null;
  isStarting: boolean;
  paramDrafts: Record<string, string>;
  loadAnalyses: () => Promise<void>;
  selectAnalysis: (analysisId: string | null) => void;
  setParamDraft: (analysisId: string, draft: string) => void;
  startAnalysis: (request: AnalysisStartRequest) => Promise<string | null>;
  refreshJob: (jobId: string) => Promise<AnalysisJobStatus | null>;
  pollActiveJobs: () => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;
  resetStartError: () => void;
  setStartError: (message: string | null) => void;
}

function upsertJob(jobs: AnalysisJobStatus[], nextJob: AnalysisJobStatus): AnalysisJobStatus[] {
  const existingIndex = jobs.findIndex((job) => job.job_id === nextJob.job_id);
  if (existingIndex === -1) {
    return [nextJob, ...jobs];
  }

  const nextJobs = [...jobs];
  nextJobs[existingIndex] = nextJob;
  return nextJobs;
}

function buildDefaultParamsFromSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') {
    return {};
  }

  const properties = (schema as { properties?: Record<string, unknown> }).properties;
  if (!properties || typeof properties !== 'object') {
    return {};
  }

  return Object.entries(properties).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (value && typeof value === 'object' && 'default' in value) {
      acc[key] = (value as { default: unknown }).default;
    }
    return acc;
  }, {});
}

function buildInitialDraft(descriptor: AnalysisDescriptor): string {
  const defaults = buildDefaultParamsFromSchema(descriptor.params_schema);
  return JSON.stringify(defaults, null, 2);
}

function getActiveJobIds(jobs: AnalysisJobStatus[]): string[] {
  return jobs
    .filter((job) => job.state === 'queued' || job.state === 'running')
    .map((job) => job.job_id);
}

export const useAnalysisStore = create<AnalysisStoreState>((set, get) => ({
  descriptors: [],
  selectedAnalysisId: null,
  loadStatus: 'idle',
  loadError: null,
  jobs: [],
  startError: null,
  isStarting: false,
  paramDrafts: {},

  loadAnalyses: async () => {
    set({ loadStatus: 'loading', loadError: null });

    try {
      const descriptors = await getAnalysisService().listAnalyses();
      set((state) => {
        const nextDrafts = { ...state.paramDrafts };
        descriptors.forEach((descriptor) => {
          if (!(descriptor.id in nextDrafts)) {
            nextDrafts[descriptor.id] = buildInitialDraft(descriptor);
          }
        });

        return {
          descriptors,
          selectedAnalysisId: state.selectedAnalysisId ?? descriptors[0]?.id ?? null,
          loadStatus: 'ready',
          loadError: null,
          paramDrafts: nextDrafts,
        };
      });
    } catch (error) {
      set({
        loadStatus: 'error',
        loadError: error instanceof Error ? error.message : 'Failed to load analyses',
      });
    }
  },

  selectAnalysis: (analysisId) => set({ selectedAnalysisId: analysisId, startError: null }),

  setParamDraft: (analysisId, draft) =>
    set((state) => ({
      paramDrafts: {
        ...state.paramDrafts,
        [analysisId]: draft,
      },
    })),

  startAnalysis: async (request) => {
    set({ isStarting: true, startError: null });

    try {
      const jobId = await getAnalysisService().startAnalysis(request);
      const status = await getAnalysisService().getJobStatus(jobId);
      set((state) => ({
        isStarting: false,
        jobs: status ? upsertJob(state.jobs, status) : state.jobs,
      }));
      return jobId;
    } catch (error) {
      set({
        isStarting: false,
        startError: error instanceof Error ? error.message : 'Failed to start analysis',
      });
      return null;
    }
  },

  refreshJob: async (jobId) => {
    const status = await getAnalysisService().getJobStatus(jobId);
    if (!status) {
      return null;
    }

    set((state) => ({
      jobs: upsertJob(state.jobs, status),
    }));
    return status;
  },

  pollActiveJobs: async () => {
    const activeJobIds = getActiveJobIds(get().jobs);
    await Promise.all(activeJobIds.map((jobId) => get().refreshJob(jobId)));
  },

  cancelJob: async (jobId) => {
    await getAnalysisService().cancelAnalysis(jobId);
    await get().refreshJob(jobId);
  },

  resetStartError: () => set({ startError: null }),
  setStartError: (message) => set({ startError: message }),
}));

export function buildAnalysisStartRequest(
  analysisId: string,
  inputs: AnalysisInput[],
  rawParams: string | undefined
): AnalysisStartRequest {
  let parsedParams: unknown = {};
  if (rawParams && rawParams.trim().length > 0) {
    parsedParams = JSON.parse(rawParams);
  }

  return {
    analysis_id: analysisId,
    inputs,
    params: parsedParams,
  };
}
