import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BidsValidationPanel } from '../BidsValidationPanel';
import { useBidsStore } from '@/stores/bidsStore';
import type { BidsDatasetSummary } from '@/stores/bidsStore';

// EventBus is used inside IssueItem; mock it so the component renders without side-effects
vi.mock('@/events/EventBus', () => ({
  getEventBus: () => ({ emit: vi.fn() }),
}));

function makeSummaryWithValidation(
  passed: boolean,
  issues: BidsDatasetSummary['validation']['issues'],
): BidsDatasetSummary {
  return {
    path: '/data/ds001',
    name: 'ds001',
    bids_version: '1.7.0',
    license: null,
    authors: [],
    subject_count: 1,
    session_ids: [],
    task_ids: [],
    modalities: [],
    total_file_count: 0,
    total_size_bytes: 0,
    coverage: {
      subjects: [],
      columns: [],
      cells: [],
    },
    participants: [],
    participant_columns: [],
    task_designs: [],
    validation: {
      passed,
      critical_count: issues.filter(i => i.severity === 'critical').length,
      warning_count: issues.filter(i => i.severity === 'medium' || i.severity === 'low').length,
      issues,
    },
    storage_by_modality: {},
  };
}

describe('BidsValidationPanel', () => {
  beforeEach(() => {
    useBidsStore.getState().reset();
  });

  it('renders null when no summary is loaded', () => {
    const { container } = render(<BidsValidationPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders passed message when validation.passed is true', () => {
    useBidsStore.setState({
      summary: makeSummaryWithValidation(true, []),
    });

    render(<BidsValidationPanel />);

    expect(screen.getByText(/Passed/)).toBeInTheDocument();
  });

  it('renders critical section when critical issues exist', () => {
    useBidsStore.setState({
      summary: makeSummaryWithValidation(false, [
        { severity: 'critical', description: 'Missing sidecar', file: null, rule: 'BIDS_001' },
        { severity: 'low', description: 'Optional field absent', file: null, rule: 'BIDS_010' },
      ]),
    });

    render(<BidsValidationPanel />);

    // CollapsibleSection renders its title as button text including severity label
    expect(screen.getByText(/Critical \(1\)/)).toBeInTheDocument();
    expect(screen.getByText('Missing sidecar')).toBeInTheDocument();
  });

  it('does not render sections for severities with zero issues', () => {
    useBidsStore.setState({
      summary: makeSummaryWithValidation(false, [
        { severity: 'critical', description: 'Bad file', file: null, rule: 'BIDS_002' },
      ]),
    });

    render(<BidsValidationPanel />);

    // "High", "Medium", and "Low" sections should not appear since there are no such issues
    expect(screen.queryByText(/High \(/)).toBeNull();
    expect(screen.queryByText(/Medium \(/)).toBeNull();
    expect(screen.queryByText(/Low \(/)).toBeNull();
  });
});
