import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BidsCoverageMatrix } from '../BidsCoverageMatrix';
import { useBidsStore } from '@/stores/bidsStore';
import type { BidsDatasetSummary } from '@/stores/bidsStore';

// Mock FileLoadingService — not needed for rendering tests
vi.mock('@/services/FileLoadingService', () => ({
  getFileLoadingService: () => ({ loadFile: vi.fn() }),
}));

function makeSummary(): BidsDatasetSummary {
  return {
    path: '/data/ds001',
    name: 'ds001',
    bids_version: '1.7.0',
    license: null,
    authors: [],
    subject_count: 3,
    session_ids: ['01'],
    task_ids: ['rest'],
    modalities: ['anat', 'func'],
    total_file_count: 6,
    total_size_bytes: 2048,
    coverage: {
      subjects: ['01', '02', '03'],
      columns: [
        { session: null, modality: 'T1w', suffix: 'T1w', task: null, label: 'T1w' },
        { session: null, modality: 'bold', suffix: 'bold', task: 'rest', label: 'rest/bold' },
      ],
      cells: [
        // sub-01: T1w present, bold present
        [
          { present: true, run_count: 1, size_bytes: 512, file_paths: ['/data/ds001/sub-01/anat/sub-01_T1w.nii.gz'] },
          { present: true, run_count: 2, size_bytes: 1024, file_paths: ['/data/ds001/sub-01/func/sub-01_task-rest_bold.nii.gz'] },
        ],
        // sub-02: T1w present, bold missing
        [
          { present: true, run_count: 1, size_bytes: 512, file_paths: ['/data/ds001/sub-02/anat/sub-02_T1w.nii.gz'] },
          { present: false, run_count: 0, size_bytes: 0, file_paths: [] },
        ],
        // sub-03: both missing
        [
          { present: false, run_count: 0, size_bytes: 0, file_paths: [] },
          { present: false, run_count: 0, size_bytes: 0, file_paths: [] },
        ],
      ],
    },
    participants: [],
    participant_columns: [],
    task_designs: [],
    validation: { passed: true, critical_count: 0, warning_count: 0, issues: [] },
    storage_by_modality: {},
  };
}

describe('BidsCoverageMatrix', () => {
  beforeEach(() => {
    useBidsStore.getState().reset();
  });

  it('renders null when no summary is loaded', () => {
    const { container } = render(<BidsCoverageMatrix />);
    expect(container.firstChild).toBeNull();
  });

  it('renders formatted subject labels for each subject', () => {
    useBidsStore.setState({ summary: makeSummary() });

    render(<BidsCoverageMatrix />);

    // formatSubjectId prepends "sub-" when not already present
    expect(screen.getByText('sub-01')).toBeInTheDocument();
    expect(screen.getByText('sub-02')).toBeInTheDocument();
    expect(screen.getByText('sub-03')).toBeInTheDocument();
  });

  it('renders column header labels', () => {
    useBidsStore.setState({ summary: makeSummary() });

    render(<BidsCoverageMatrix />);

    expect(screen.getByText('T1w')).toBeInTheDocument();
    expect(screen.getByText('rest/bold')).toBeInTheDocument();
  });

  it('renders correct number of data cells (one per subject × column)', () => {
    useBidsStore.setState({ summary: makeSummary() });

    render(<BidsCoverageMatrix />);

    // 3 subjects × 2 columns = 6 gridcell elements
    const cells = screen.getAllByRole('gridcell');
    expect(cells).toHaveLength(6);
  });
});
