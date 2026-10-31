import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/api/host', () => ({
  useSelectedLayer: () => ({ id: 'layer-1', name: 'T1', type: 'volume', source: null }),
  useSelectedLayerId: () => 'layer-1',
  useLayerMetadata: () => ({ sourcePath: '/data/t1.nii.gz' }),
}));
vi.mock('@/modules/analysis/services/AnalysisService', () => ({
  getAnalysisService: () => ({}),
}));

import type { AnalysisDescriptor } from '@brainflow/api';
import { useAnalysisStore } from '@/modules/analysis/stores/analysisStore';
import { AnalysisWorkbenchWorkspace } from '@/modules/analysis/components/AnalysisWorkbenchWorkspace';
import { parametersJsonError } from '@/modules/analysis/components/parameters';

const DESCRIPTOR = {
  id: 'smooth',
  name: 'Smooth',
  version: '1.0.0',
  api_version: '1',
  description: 'Gaussian smoothing',
  inputs: ['volume'],
  params_schema: {},
  outputs: ['volume'],
  runner: { type: 'builtin' },
} as unknown as AnalysisDescriptor;

describe('Analysis parameters: inline JSON validation', () => {
  const startAnalysis = vi.fn(async () => 'job-1');
  beforeEach(() => {
    startAnalysis.mockClear();
    useAnalysisStore.setState({
      descriptors: [DESCRIPTOR],
      selectedAnalysisId: 'smooth',
      loadStatus: 'ready',
      jobs: [],
      paramDrafts: { smooth: '{ "fwhm_mm": 6 }' },
      startError: null,
      isStarting: false,
      startAnalysis,
    });
  });

  it('marks malformed JSON invalid under the field and disables Run Analysis', () => {
    render(<AnalysisWorkbenchWorkspace />);
    const run = screen.getByRole('button', { name: 'Run Analysis' });
    const area = screen.getByRole('textbox', { name: 'JSON' });
    expect(run).toBeEnabled();
    expect(area).not.toHaveAttribute('aria-invalid');

    fireEvent.change(area, { target: { value: '{ "fwhm_mm": ' } });
    expect(area).toHaveAttribute('aria-invalid', 'true');
    const msg = document.getElementById(area.getAttribute('aria-describedby')!)!;
    expect(msg.textContent).toMatch(/^Not valid JSON: /);
    // The message follows the field (FieldRow error slot), not the Run row.
    expect(area.compareDocumentPosition(msg) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run Analysis' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Run Analysis' }));
    expect(startAnalysis).not.toHaveBeenCalled();

    fireEvent.change(area, { target: { value: '{ "fwhm_mm": 8 }' } });
    expect(area).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('button', { name: 'Run Analysis' })).toBeEnabled();
  });

  it('parametersJsonError: empty means no parameters; bad JSON gets a sentence-case message', () => {
    expect(parametersJsonError('')).toBeNull();
    expect(parametersJsonError('  ')).toBeNull();
    expect(parametersJsonError('{"a": 1}')).toBeNull();
    expect(parametersJsonError('{')).toMatch(/^Not valid JSON: [a-z]/);
  });
});
