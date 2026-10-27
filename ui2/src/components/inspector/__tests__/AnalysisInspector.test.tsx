import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/analysis/AnalysisService', () => ({ getAnalysisService: () => ({}) }));

import { AnalysisInspector } from '../analysis/AnalysisInspector';
import { useAnalysisStore } from '@/stores/analysisStore';

const descriptor = {
  id: 'gaussian-smoothing',
  name: 'Gaussian Smoothing',
  version: '0.1.0',
  api_version: '1',
  description: 'Smooth a volume with an isotropic Gaussian kernel.',
  inputs: ['volume'],
  params_schema: {},
  outputs: ['volume', 'metadata'],
  runner: { type: 'builtin' },
};

afterEach(() => {
  act(() => useAnalysisStore.setState({ descriptors: [], selectedAnalysisId: null, jobs: [] }));
});

describe('AnalysisInspector', () => {
  it('shows the empty hint when nothing is selected', () => {
    render(<AnalysisInspector />);
    expect(screen.getByText('No analysis selected')).toBeTruthy();
  });

  it('follows the workbench selection and shows the latest job', () => {
    act(() =>
      useAnalysisStore.setState({
        descriptors: [descriptor as never],
        selectedAnalysisId: 'gaussian-smoothing',
        jobs: [
          {
            job_id: 'job-1',
            analysis_id: 'gaussian-smoothing',
            state: 'completed',
            started_at_ms: null,
            finished_at_ms: null,
            progress: 1,
            message: null,
            artifacts: [],
            error: null,
          } as never,
        ],
      }),
    );
    render(<AnalysisInspector />);
    expect(screen.queryByText('No analysis selected')).toBeNull();
    expect(screen.getByText('Gaussian Smoothing')).toBeTruthy();
    expect(screen.getByText('volume, metadata')).toBeTruthy();
    expect(screen.getByText('job-1')).toBeTruthy();
    expect(screen.getByText('Completed')).toBeTruthy();
  });
});
