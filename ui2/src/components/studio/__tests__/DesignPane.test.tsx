import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DesignPane } from '../DesignPane';
import type {
  SpatialFieldSetSummary,
  StudioCohortSummary,
} from '@/types/studio';

const ACTIVE_SET: SpatialFieldSetSummary = {
  id: 'study-a',
  name: 'Study A',
  memberCount: 3,
  primaryFeatureId: 'statmap',
  supportKind: 'volume',
  supportLabel: 'MNI152 2mm template',
  alignmentClass: 'same-grid',
  designColumns: ['subject', 'diagnosis', 'site'],
  designTablePreview: {
    columns: ['subject', 'diagnosis', 'site'],
    rows: [
      { id: 'sub001', cells: ['sub001', 'control', 'site-a'] },
      { id: 'sub002', cells: ['sub002', 'case', 'site-a'] },
      { id: 'sub003', cells: ['sub003', 'control', 'site-b'] },
    ],
  },
  memberSummaries: [
    { id: 'sub001', sourcePath: null },
    { id: 'sub002', sourcePath: null },
    { id: 'sub003', sourcePath: null },
  ],
  memberIds: ['sub001', 'sub002', 'sub003'],
  savedCohortIds: ['cohort-1'],
  ingestAudit: {
    sourceLabel: 'NFTab manifest',
    join: {
      matchedRows: 3,
      unmatchedRows: 0,
      duplicateKeys: 0,
      severity: 'ok',
      issueDetails: [{ message: 'Duplicate source for sub002', memberIds: ['sub002'] }],
    },
    support: {
      supportLabel: 'MNI152 2mm template',
      alignmentClass: 'same-grid',
      readyForCompare: true,
      severity: 'ok',
    },
    notes: ['All members are compare-safe.'],
  },
};

const COHORTS: StudioCohortSummary[] = [
  {
    id: 'cohort-1',
    label: 'Controls',
    memberCount: 2,
    description: 'Control subjects',
    memberIds: ['sub001', 'sub003'],
    originKind: 'imported',
    originLabel: 'Manifest',
  },
];

describe('DesignPane', () => {
  it('renders subset controls and forwards subset actions', () => {
    const onUseFilteredSubsetInCompare = vi.fn();
    const onSaveFilteredSubsetAsCohort = vi.fn();
    const onClearSubsetNarrowing = vi.fn();
    const onRemoveDesignFilter = vi.fn();

    render(
      <DesignPane
        activeSet={ACTIVE_SET}
        cohorts={COHORTS}
        activeMemberId="sub001"
        visibleMemberIds={['sub001', 'sub003']}
        designSearch="control"
        activeDesignFilters={[{ column: 'site', value: 'site-a' }]}
        onDesignSearchChange={vi.fn()}
        onClearSubsetNarrowing={onClearSubsetNarrowing}
        onRemoveDesignFilter={onRemoveDesignFilter}
        onUseFilteredSubsetInCompare={onUseFilteredSubsetInCompare}
        onSaveFilteredSubsetAsCohort={onSaveFilteredSubsetAsCohort}
        onSelectMember={vi.fn()}
      />
    );

    const subsetBanner = screen.getByText('Subset').closest('div.rounded-lg');
    expect(subsetBanner).not.toBeNull();
    const subsetScope = within(subsetBanner!);

    expect(subsetScope.getByText('search=control')).toBeInTheDocument();
    expect(subsetScope.getByRole('button', { name: 'site=site-a' })).toBeInTheDocument();

    fireEvent.click(subsetScope.getByRole('button', { name: 'Compare' }));
    expect(onUseFilteredSubsetInCompare).toHaveBeenCalledTimes(1);

    fireEvent.click(subsetScope.getByRole('button', { name: 'Save Group' }));
    expect(onSaveFilteredSubsetAsCohort).toHaveBeenCalledTimes(1);

    fireEvent.click(subsetScope.getByRole('button', { name: 'Clear' }));
    expect(onClearSubsetNarrowing).toHaveBeenCalledTimes(1);

    fireEvent.click(subsetScope.getByRole('button', { name: 'site=site-a' }));
    expect(onRemoveDesignFilter).toHaveBeenCalledWith({ column: 'site', value: 'site-a' });
  });

  it('supports table sorting and quick-filter toggles', () => {
    const onSortColumnChange = vi.fn();
    const onToggleSortDirection = vi.fn();
    const onToggleDesignFilter = vi.fn();
    const onSelectJoinIssue = vi.fn();

    render(
      <DesignPane
        activeSet={ACTIVE_SET}
        cohorts={COHORTS}
        activeMemberId="sub001"
        sortColumn="diagnosis"
        sortDirection="asc"
        quickFilterOptions={[
          { column: 'diagnosis', values: ['control', 'case'] },
          { column: 'site', values: ['site-a', 'site-b'] },
        ]}
        onDesignSearchChange={vi.fn()}
        onSortColumnChange={onSortColumnChange}
        onToggleSortDirection={onToggleSortDirection}
        onToggleDesignFilter={onToggleDesignFilter}
        onSelectJoinIssue={onSelectJoinIssue}
        onSelectMember={vi.fn()}
      />
    );

    fireEvent.change(screen.getByDisplayValue('diagnosis'), {
      target: { value: 'site' },
    });
    expect(onSortColumnChange).toHaveBeenCalledWith('site');

    fireEvent.click(screen.getByRole('button', { name: 'Ascending' }));
    expect(onToggleSortDirection).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'control' }));
    expect(onToggleDesignFilter).toHaveBeenCalledWith({
      column: 'diagnosis',
      value: 'control',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate source for sub002' }));
    expect(onSelectJoinIssue).toHaveBeenCalledWith({
      message: 'Duplicate source for sub002',
      memberIds: ['sub002'],
    });
  });
});
