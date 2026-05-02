import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisDescriptor, AnalysisJobStatus } from '@brainflow/api';

const mockAnalysisService = vi.hoisted(() => ({
  listAnalyses: vi.fn(),
  startAnalysis: vi.fn(),
  getJobStatus: vi.fn(),
  cancelAnalysis: vi.fn(),
}));

vi.mock('@/services/analysis/AnalysisService', () => ({
  getAnalysisService: () => mockAnalysisService,
}));

import { buildAnalysisStartRequest, useAnalysisStore } from '@/stores/analysisStore';

function resetAnalysisStore() {
  useAnalysisStore.setState({
    descriptors: [],
    selectedAnalysisId: null,
    loadStatus: 'idle',
    loadError: null,
    jobs: [],
    startError: null,
    isStarting: false,
    paramDrafts: {},
  });
}

const builtinDescriptor: AnalysisDescriptor = {
  id: 'builtin-copy-volume',
  name: 'Builtin: Copy Selected Volume',
  version: '0.1.0',
  api_version: '0.1',
  description: 'Copies a selected volume',
  inputs: ['volume'],
  params_schema: {
    type: 'object',
    properties: {
      note: {
        type: 'string',
        default: 'hello',
      },
    },
  },
  outputs: ['volume', 'metadata'],
  runner: { type: 'builtin' },
};

describe('analysisStore', () => {
  beforeEach(() => {
    resetAnalysisStore();
    mockAnalysisService.listAnalyses.mockReset();
    mockAnalysisService.startAnalysis.mockReset();
    mockAnalysisService.getJobStatus.mockReset();
    mockAnalysisService.cancelAnalysis.mockReset();
  });

  it('loads descriptors and seeds default parameter drafts', async () => {
    mockAnalysisService.listAnalyses.mockResolvedValue([builtinDescriptor]);

    await useAnalysisStore.getState().loadAnalyses();

    const state = useAnalysisStore.getState();
    expect(state.loadStatus).toBe('ready');
    expect(state.selectedAnalysisId).toBe('builtin-copy-volume');
    expect(state.paramDrafts['builtin-copy-volume']).toBe(
      JSON.stringify({ note: 'hello' }, null, 2)
    );
  });

  it('starts an analysis and stores the initial job status snapshot', async () => {
    const jobStatus: AnalysisJobStatus = {
      job_id: 'job-1',
      analysis_id: 'builtin-copy-volume',
      state: 'running',
      started_at_ms: 1n,
      finished_at_ms: null,
      progress: 0.25,
      message: 'Copying selected volume',
      artifacts: null,
      error: null,
    };

    mockAnalysisService.startAnalysis.mockResolvedValue('job-1');
    mockAnalysisService.getJobStatus.mockResolvedValue(jobStatus);

    const request = buildAnalysisStartRequest(
      'builtin-copy-volume',
      [
        {
          kind: 'volume',
          handle: 'vol-1',
          path: '/tmp/source.nii.gz',
          name: 'Source Volume',
          metadata: {},
        },
      ],
      '{"note":"hello"}'
    );

    const jobId = await useAnalysisStore.getState().startAnalysis(request);

    expect(jobId).toBe('job-1');
    expect(useAnalysisStore.getState().jobs).toEqual([jobStatus]);
    expect(mockAnalysisService.startAnalysis).toHaveBeenCalledWith(request);
    expect(mockAnalysisService.getJobStatus).toHaveBeenCalledWith('job-1');
  });
});
