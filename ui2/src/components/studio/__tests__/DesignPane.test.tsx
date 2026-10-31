import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DesignPane } from '../DesignPane';
import { DISTANCE_TO_MEAN_SORT } from '@/services/studio/StudioMeanDistanceService';
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
    sourceLabel: 'NeuroTabs manifest',
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

    const subsetBanner = screen.getByText('Subset').closest('div.rounded-sm');
    expect(subsetBanner).not.toBeNull();
    const subsetScope = within(subsetBanner!);

    expect(subsetScope.getByText('search=control')).toBeInTheDocument();
    expect(subsetScope.getByRole('button', { name: 'site=site-a' })).toBeInTheDocument();

    fireEvent.click(subsetScope.getByRole('button', { name: 'Compare' }));
    expect(onUseFilteredSubsetInCompare).toHaveBeenCalledTimes(1);

    fireEvent.click(subsetScope.getByRole('button', { name: 'Save group' }));
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

    // Only the action is a link; the description is plain text.
    expect(screen.getByText('Duplicate source for sub002').tagName).toBe('SPAN');
    fireEvent.click(screen.getByRole('button', { name: 'Show row: Duplicate source for sub002' }));
    expect(onSelectJoinIssue).toHaveBeenCalledWith({
      message: 'Duplicate source for sub002',
      memberIds: ['sub002'],
    });
  });
});

it('pages complete metadata in canonical visible order without truncating the population', () => {
  const ids = Array.from({ length: 161 }, (_, i) => `obs-${String(i + 1).padStart(3, '0')}`);
  const set: SpatialFieldSetSummary = { ...ACTIVE_SET, memberIds: ids, memberCount: ids.length,
    designColumns: ['observation', 'participant'],
    memberSummaries: ids.map((id, i) => ({ id, sourcePath: null, designValues: { observation: id, participant: `P${Math.floor(i / 2)}` } })),
  };
  const focus = vi.fn();
  const view = render(<DesignPane activeSet={set} cohorts={[]} onSelectMember={focus} />);
  expect(screen.getByText('161 visible members')).toBeVisible();
  expect(screen.getByRole('button', { name: 'obs-001 P0' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'obs-081 P40' })).toBeNull();
  expect(screen.getByRole('group', { name: 'Observations, page 1 of 3' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  fireEvent.click(screen.getByRole('button', { name: 'obs-081 P40' }));
  expect(focus).toHaveBeenCalledWith('obs-081');
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  expect(screen.getByRole('button', { name: 'obs-161 P80' })).toBeVisible();
  view.rerender(<DesignPane activeSet={set} cohorts={[]} visibleMemberIds={['obs-160', 'obs-002']} onSelectMember={focus} />);
  expect(screen.getByRole('button', { name: 'obs-160 P79' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'obs-002 P0' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
});

it('keeps the selected design row in view by scrolling only its own scroller', () => {
  const calls: unknown[] = [];
  const original = (Element.prototype as any).scrollIntoView;
  (Element.prototype as any).scrollIntoView = function (arg: unknown) {
    calls.push(arg);
  };
  try {
    const view = render(
      <DesignPane activeSet={ACTIVE_SET} cohorts={COHORTS} activeMemberId="sub001" onSelectMember={vi.fn()} />,
    );
    // StudioPane's body is the one scroller (overflow-auto).
    const scroller = document.querySelector('.overflow-auto') as HTMLElement;
    expect(scroller).not.toBeNull();
    scroller.style.overflowY = 'auto'; // jsdom has no Tailwind stylesheet
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 100 });
    scroller.getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 300, width: 300, height: 100, x: 0, y: 0, toJSON() {} }) as DOMRect;
    const row = screen.getByRole('button', { name: /^sub002 case/ });
    row.getBoundingClientRect = () => ({ top: 150, bottom: 180, left: 0, right: 300, width: 300, height: 30, x: 0, y: 150, toJSON() {} }) as DOMRect;
    scroller.scrollTop = 0;
    view.rerender(
      <DesignPane activeSet={ACTIVE_SET} cohorts={COHORTS} activeMemberId="sub002" onSelectMember={vi.fn()} />,
    );
    // Minimal "nearest" scroll of the pane scroller; never scrollIntoView
    // (which also scrolls overflow-hidden ancestors such as the GL root).
    expect(scroller.scrollTop).toBe(80);
    expect(calls).toHaveLength(0);
  } finally {
    (Element.prototype as any).scrollIntoView = original;
  }
});

describe('DesignPane filter chip focus', () => {
  const OPTIONS = [
    { column: 'diagnosis', values: ['control', 'case'] },
    { column: 'site', values: ['site-a', 'site-b'] },
  ];

  function Host({ hideOptionsWhenFiltered = false, initial = [] as Array<{ column: string; value: string }> }) {
    const [filters, setFilters] = useState(initial);
    const toggle = (f: { column: string; value: string }) =>
      setFilters((prev) =>
        prev.some((p) => p.column === f.column && p.value === f.value)
          ? prev.filter((p) => !(p.column === f.column && p.value === f.value))
          : [...prev, f],
      );
    return (
      <DesignPane
        activeSet={ACTIVE_SET}
        cohorts={[]}
        activeDesignFilters={filters}
        // Mirrors the store: options derive from the narrowed population and
        // vanish when it is empty (the harness case that dropped focus).
        quickFilterOptions={hideOptionsWhenFiltered && filters.length > 0 ? [] : OPTIONS}
        onToggleDesignFilter={toggle}
        onRemoveDesignFilter={toggle}
        onClearSubsetNarrowing={() => setFilters([])}
        onSelectMember={vi.fn()}
      />
    );
  }

  const filtersGroup = () => screen.getByRole('group', { name: 'Filters' });
  const subsetGroup = () => screen.getByRole('group', { name: 'Subset' });

  it('keeps focus on a toggled quick-filter chip (Space then Enter)', () => {
    render(<Host />);
    const chip = within(filtersGroup()).getByRole('button', { name: 'control' });
    chip.focus();
    act(() => { fireEvent.click(chip); });
    const after = within(filtersGroup()).getByRole('button', { name: 'control' });
    expect(after).toHaveAttribute('aria-pressed', 'true');
    expect(document.activeElement).toBe(after);
    act(() => { fireEvent.click(after); });
    expect(document.activeElement).toBe(within(filtersGroup()).getByRole('button', { name: 'control' }));
    expect(within(filtersGroup()).getByRole('button', { name: 'control' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('moves focus to the matching Subset chip when the Filters section unmounts', () => {
    render(<Host hideOptionsWhenFiltered />);
    const chip = within(filtersGroup()).getByRole('button', { name: 'control' });
    chip.focus();
    act(() => { fireEvent.click(chip); });
    const subsetChip = within(subsetGroup()).getByRole('button', { name: 'diagnosis=control' });
    expect(document.activeElement).toBe(subsetChip);
    // Removing it brings the quick filter back; focus returns to that chip.
    act(() => { fireEvent.click(subsetChip); });
    expect(document.activeElement).toBe(within(filtersGroup()).getByRole('button', { name: 'control' }));
  });

  it('moves focus to the next, then previous, Subset chip when one removes itself', () => {
    render(
      <Host
        initial={[
          { column: 'diagnosis', value: 'control' },
          { column: 'site', value: 'site-a' },
          { column: 'site', value: 'site-b' },
        ]}
      />,
    );
    const first = within(subsetGroup()).getByRole('button', { name: 'diagnosis=control' });
    first.focus();
    act(() => { fireEvent.click(first); });
    expect(document.activeElement).toBe(within(subsetGroup()).getByRole('button', { name: 'site=site-a' }));
    const last = within(subsetGroup()).getByRole('button', { name: 'site=site-b' });
    last.focus();
    act(() => { fireEvent.click(last); });
    expect(document.activeElement).toBe(within(subsetGroup()).getByRole('button', { name: 'site=site-a' }));
    // The last Subset chip: the Subset block unmounts; focus lands on the
    // same filter's quick chip.
    act(() => { fireEvent.click(document.activeElement as HTMLElement); });
    expect(document.activeElement).toBe(within(filtersGroup()).getByRole('button', { name: 'site-a' }));
  });

  it('does not steal focus that is elsewhere', () => {
    render(<Host hideOptionsWhenFiltered />);
    const search = screen.getByRole('searchbox');
    const chip = within(filtersGroup()).getByRole('button', { name: 'control' });
    search.focus();
    act(() => { fireEvent.click(chip); });
    expect(document.activeElement).toBe(search);
  });

  it('offers the distance-to-mean sort and shows each distance with an Open in Deck action', () => {
    const onSortColumnChange = vi.fn();
    const onOpenInDeck = vi.fn();
    const props = {
      activeSet: ACTIVE_SET,
      cohorts: COHORTS,
      activeMemberId: 'sub002',
      visibleMemberIds: ['sub003', 'sub002', 'sub001'],
      onSelectMember: vi.fn(),
      onSortColumnChange,
      onOpenInDeck,
    };
    const { rerender } = render(<DesignPane {...props} sortColumn={null} />);
    const sort = screen.getByRole('combobox');
    expect(within(sort).getByRole('option', { name: 'Distance to group mean' })).toBeInTheDocument();
    fireEvent.change(sort, { target: { value: DISTANCE_TO_MEAN_SORT } });
    expect(onSortColumnChange).toHaveBeenCalledWith(DISTANCE_TO_MEAN_SORT);

    rerender(
      <DesignPane
        {...props}
        sortColumn={DISTANCE_TO_MEAN_SORT}
        sortDirection="desc"
        meanDistance={{ key: 'k', listKey: 'l', listSize: 3, status: 'pending', byMember: new Map(), supportVoxels: 0, groupSize: 2, error: null }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Computing distances to the mean of 2 members');
    expect(screen.queryAllByTestId('distance-to-mean')).toHaveLength(0);

    rerender(
      <DesignPane
        {...props}
        sortColumn={DISTANCE_TO_MEAN_SORT}
        sortDirection="desc"
        meanDistance={{
          key: 'k',
          listKey: 'l',
          listSize: 4,
          status: 'ready',
          byMember: new Map([
            ['sub003', { memberId: 'sub003', euclidean: 4, correlation: 0 }],
            ['sub002', { memberId: 'sub002', euclidean: 1.4142, correlation: 0.2254 }],
            ['sub001', { memberId: 'sub001', euclidean: 0.5, correlation: null }],
          ]),
          supportVoxels: 4,
          groupSize: 3,
          error: null,
        }}
      />,
    );
    // The measured group (3 of 4 listed), and the mean's composition.
    expect(screen.getByRole('status')).toHaveTextContent(
      'Distance to the mean of 3 members over 4 shared voxels',
    );
    expect(screen.getByRole('status')).toHaveTextContent('includes each member (not leave-one-out)');
    expect(screen.getByRole('status')).toHaveTextContent('1 listed member without a usable source is not measured.');
    const cells = screen.getAllByTestId('distance-to-mean').map((cell) => cell.textContent);
    expect(cells[0]).toMatch(/^4/);
    expect(cells[1]).toBe("1.41 (0.23)");
    expect(cells[2]).toMatch(/\(—\)$/);
    fireEvent.click(screen.getByRole('button', { name: 'Open sub002 in Deck' }));
    expect(onOpenInDeck).toHaveBeenCalledWith('sub002');

    rerender(
      <DesignPane
        {...props}
        sortColumn={DISTANCE_TO_MEAN_SORT}
        meanDistance={{ key: 'k', listKey: 'l', listSize: 3, status: 'failed', byMember: new Map(), supportVoxels: 0, groupSize: 3, error: 'grids differ' }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('No distances: grids differ');
  });
});
