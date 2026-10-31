import { cn } from '@/utils/cn';
import { studioMetadata } from '@/services/studio/studioMetadata';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { findScrollContainer, scrollIntoContainer } from '@/utils/scrollIntoContainer';
import {
  Button,
  Chip,
  FilterChip,
  KeyValue,
  Notice,
  Pager,
  Section,
  SELECTED,
  Select,
  TextField,
} from '@/components/ui/bf';
import { StudioPane } from './StudioPane';
import {
  DISTANCE_TO_MEAN_SORT,
  type MeanDistanceSnapshot,
} from '@/services/studio/StudioMeanDistanceService';
import { formatLayerValue } from '@/utils/valueFormat';
import type {
  SpatialFieldSetSummary,
  StudioCohortSummary,
  StudioJoinIssueDetail,
} from '@/types/studio';

interface DesignPaneProps {
  activeSet: SpatialFieldSetSummary | null;
  headerActions?: React.ReactNode;
  cohorts: StudioCohortSummary[];
  activeMemberId: string | null;
  activeCompareCohortId?: string | null;
  activeScopeCohortId?: string | null;
  activeIssueMemberIds?: string[];
  visibleMemberIds?: string[];
  designSearch?: string;
  sortColumn?: string | null;
  sortDirection?: 'asc' | 'desc';
  activeDesignFilters?: Array<{ column: string; value: string }>;
  quickFilterOptions?: Array<{ column: string; values: string[] }>;
  scopedCohortLabel?: string | null;
  issueFocusLabel?: string | null;
  onClearScope?: () => void;
  onClearIssueFocus?: () => void;
  onDesignSearchChange?: (value: string) => void;
  onSortColumnChange?: (value: string | null) => void;
  onToggleSortDirection?: () => void;
  onToggleDesignFilter?: (filter: { column: string; value: string }) => void;
  onRemoveDesignFilter?: (filter: { column: string; value: string }) => void;
  onClearDesignFilters?: () => void;
  onClearSubsetNarrowing?: () => void;
  onSelectMember: (memberId: string) => void;
  /** Distances to the group mean for the listed group (distance sort only). */
  meanDistance?: MeanDistanceSnapshot | null;
  /** Focus an observation and show it in the Deck. */
  onOpenInDeck?: (memberId: string) => void;
  onUseFilteredSubsetInCompare?: () => void;
  onSaveFilteredSubsetAsCohort?: () => void;
  onUseCompareCohort?: (cohortId: string | null) => void;
  onScopeToCohort?: (cohortId: string | null) => void;
  onSaveVisibleCohort?: () => void;
  onRenameCohort?: (cohort: StudioCohortSummary) => void;
  onDeleteCohort?: (cohort: StudioCohortSummary) => void;
  onSelectJoinIssue?: (issue: StudioJoinIssueDetail) => void;
  onSaveIssueFocusAsCohort?: () => void;
  onUseIssueFocusInCompare?: () => void;
}

export function DesignPane({
  activeSet,
  headerActions,
  cohorts,
  activeMemberId,
  activeCompareCohortId,
  activeScopeCohortId,
  activeIssueMemberIds,
  visibleMemberIds,
  designSearch,
  sortColumn,
  sortDirection,
  activeDesignFilters,
  quickFilterOptions,
  scopedCohortLabel,
  issueFocusLabel,
  onClearScope,
  onClearIssueFocus,
  onDesignSearchChange,
  onSortColumnChange,
  onToggleSortDirection,
  onToggleDesignFilter,
  onRemoveDesignFilter,
  onClearSubsetNarrowing,
  onSelectMember,
  meanDistance,
  onOpenInDeck,
  onUseFilteredSubsetInCompare,
  onSaveFilteredSubsetAsCohort,
  onUseCompareCohort,
  onScopeToCohort,
  onSaveVisibleCohort,
  onRenameCohort,
  onDeleteCohort,
  onSelectJoinIssue,
  onSaveIssueFocusAsCohort,
  onUseIssueFocusInCompare,
}: DesignPaneProps) {
  const [page, setPage] = useState(0);
  const memberKey = JSON.stringify(visibleMemberIds ?? activeSet?.memberIds ?? []);
  useEffect(() => { setPage(previous => previous === 0 ? previous : 0); }, [activeSet?.id, memberKey]);
  // Keep the selected design row in view (the rail can push it below the fold).
  // Scroll only the pane's own scroller: `scrollIntoView` also scrolls
  // overflow-hidden ancestors (it shifted the GoldenLayout root by 3px).
  // A selection made before the panel has its height (GoldenLayout sizes
  // panels after mount) stays pending until the scroller has a size.
  const selectedRowRef = useRef<HTMLButtonElement | null>(null);
  const keepInViewPending = useRef(false);
  useEffect(() => {
    keepInViewPending.current = true;
    const tryKeep = () => {
      const el = selectedRowRef.current;
      if (!keepInViewPending.current || !el) return;
      const container = findScrollContainer(el);
      if (container && container.clientHeight === 0) return;
      scrollIntoContainer(el);
      keepInViewPending.current = false;
    };
    tryKeep();
    const container = selectedRowRef.current ? findScrollContainer(selectedRowRef.current) : null;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(tryKeep);
    observer.observe(container);
    return () => observer.disconnect();
  }, [activeMemberId]);
  // Keyboard focus survives a filter toggle. Toggling can unmount the chip
  // (a self-removing Subset chip; the Filters section re-derives from the
  // narrowed population and may vanish), so remember what was toggled and,
  // if focus fell out of the pane, restore it deterministically:
  // same chip -> next / previous Subset chip -> the same filter in the other
  // group -> the Subset or Filters group -> the search field.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pendingFocusRef = useRef<{ key: string; subsetIndex: number } | null>(null);
  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    const root = rootRef.current;
    if (!pending || !root) return;
    pendingFocusRef.current = null;
    const active = document.activeElement;
    // Only when focus was actually lost (fell to <body>); never steal it.
    if (active && active !== document.body) return;
    const q = (selector: string) => root.querySelector<HTMLElement>(selector);
    const byKey = (key: string) =>
      Array.from(root.querySelectorAll<HTMLElement>('[data-filter-key]')).find(
        (el) => el.getAttribute('data-filter-key') === key,
      );
    const subsetChips = Array.from(root.querySelectorAll<HTMLElement>('[data-filter-key^="subset:"]'));
    const filterId = pending.key.slice(pending.key.indexOf(":") + 1);
    const candidates: Array<HTMLElement | null | undefined> = [
      byKey(pending.key),
      pending.subsetIndex >= 0 ? subsetChips[pending.subsetIndex] : undefined,
      pending.subsetIndex > 0 ? subsetChips[pending.subsetIndex - 1] : undefined,
      byKey(pending.key.startsWith('subset:') ? `quick:${filterId}` : `subset:${filterId}`),
      q('[data-filter-group="subset"]'),
      q('[data-filter-group="filters"]'),
      q('input[type="search"]'),
    ];
    candidates.find((el) => el?.isConnected)?.focus();
  });
  if (!activeSet) {
    return (
      <StudioPane title="Subjects" headerActions={headerActions} showHeader={false}>
        <Notice role={undefined} severity="neutral">
          <div className="font-medium text-foreground">No study loaded</div>
          <div>Import a table or NeuroTabs manifest from the Set studio tab to list its subjects here.</div>
        </Notice>
      </StudioPane>
    );
  }

  const metadata = studioMetadata(activeSet, []);
  const previewColumns = metadata.columns;
  const orderedIds = visibleMemberIds ?? activeSet.memberIds;
  const previewRows = orderedIds.flatMap(id => {
    const values = metadata.rows.get(id);
    return values ? [{ id, cells: previewColumns.map(column => values[column]) }] : [];
  });
  const pageCount = Math.max(1, Math.ceil(previewRows.length / 80));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleColumns = previewColumns.slice(0, 4);
  const distanceSort = sortColumn === DISTANCE_TO_MEAN_SORT;
  const distances = distanceSort && meanDistance?.status === 'ready' ? meanDistance.byMember : null;
  const deckTarget =
    activeMemberId && orderedIds.includes(activeMemberId) ? activeMemberId : (orderedIds[0] ?? null);
  const showImportSummary =
    activeSet.ingestAudit.join.severity !== 'ok' ||
    activeSet.ingestAudit.join.issueDetails.length > 0 ||
    activeSet.ingestAudit.join.unmatchedRows > 0 ||
    activeSet.ingestAudit.join.duplicateKeys > 0;
  const showPreview = visibleColumns.length > 0 && previewRows.length > 0;
  // One column template shared by the header and every row grid (so columns
  // align), weighted by each column's longest text: "diagnosis" gets room
  // and short codes ("F", "22") stay narrow, instead of four equal columns
  // that either overlap ("diagnosis" ran into "sex") or truncate ids.
  const pageRows = previewRows.slice(currentPage * 80, (currentPage + 1) * 80);
  const columnTemplate =
    (visibleColumns.length === 0
      ? 'minmax(0, 1fr)'
      : visibleColumns
          .map((column, index) => {
            const longest = Math.max(
              column.length,
              ...pageRows.map((row) => String(row.cells[index] ?? '').length),
            );
            return `minmax(0, ${Math.min(24, Math.max(3, longest))}fr)`;
          })
          .join(' ')) + (distances ? ' minmax(0, 9fr)' : '');
  const showColumns = activeSet.designColumns.length > 0;
  const showGroups = cohorts.length > 0;

  return (
    <StudioPane
      title="Subjects"
      headerActions={headerActions}
      showHeader={false}
    >
      <div ref={rootRef} className="space-y-3">
        {metadata.issue && <Notice role="alert" severity="danger">{metadata.issue}</Notice>}
        {showImportSummary ? (
          <Section
            variant="static"
            divider={false}
            title="Import summary"
            className="rounded-sm border border-border bg-background"
            bodyClassName="space-y-2"
          >
            <KeyValue
              items={[
                // Where the rows came from: a neutral fact under the title (in
                // the header it clipped "Import summary" in the 320px rail).
                // Join severity is carried by the Import issues notice and the
                // audit banner.
                { label: 'Source', value: activeSet.ingestAudit.sourceLabel, mono: false },
                { label: 'Matched', value: String(activeSet.ingestAudit.join.matchedRows) },
                { label: 'Unmatched', value: String(activeSet.ingestAudit.join.unmatchedRows) },
                { label: 'Duplicate keys', value: String(activeSet.ingestAudit.join.duplicateKeys) },
                { label: 'Alignment', value: activeSet.ingestAudit.support.alignmentClass },
              ]}
            />
            {activeSet.ingestAudit.notes.map((note) => (
              <div key={note} className="text-bf-sm leading-5 text-muted-foreground">
                {note}
              </div>
            ))}
            {activeSet.ingestAudit.join.issueDetails.length > 0 ? (
              <Notice role={undefined} severity="warning">
                <div className="font-medium">Import issues</div>
                <ul className="mt-1 space-y-1">
                  {activeSet.ingestAudit.join.issueDetails.map((detail) => {
                    const n = detail.memberIds.length;
                    const action = n > 1 ? `Show ${n} rows` : 'Show row';
                    return (
                      <li key={`${detail.message}-${detail.memberIds.join('|')}`}>
                        {/* The description is plain text; only the action is a link. */}
                        <span>{detail.message}</span>{' '}
                        {n > 0 ? (
                          <Button
                            variant="link"
                            className="min-h-6"
                            size="sm"
                            aria-label={`${action}: ${detail.message}`}
                            onClick={() => onSelectJoinIssue?.(detail)}
                          >
                            {action}
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </Notice>
            ) : null}
          </Section>
        ) : null}

        <TextField
          type="search"
          aria-label="Search design rows or member IDs"
          value={designSearch ?? ''}
          onChange={(event) => onDesignSearchChange?.(event.target.value)}
          placeholder="Search design rows or member IDs…"
        />

        {previewColumns.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 text-bf-xs text-muted-foreground">Sort</span>
              <Select
                value={sortColumn ?? ''}
                onValueChange={(value) => onSortColumnChange?.(value || null)}
              >
                <option value="">Design order</option>
                {previewColumns.map((column) => (
                  <option key={column} value={column}>
                    {column}
                  </option>
                ))}
                {activeSet.supportKind === 'volume' ? (
                  <option value={DISTANCE_TO_MEAN_SORT}>Distance to group mean</option>
                ) : null}
              </Select>
            </label>
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleSortDirection}
              disabled={!sortColumn}
              // Disabled (design order has no direction) but still readable:
              // muted text at full opacity instead of 50%-faded secondary.
              className="disabled:opacity-100 disabled:text-muted-foreground"
            >
              {sortDirection === 'desc' ? 'Descending' : 'Ascending'}
            </Button>
          </div>
        ) : null}

        {distanceSort ? (
          <div className="flex flex-wrap items-center justify-between gap-2" aria-label="Distance to group mean">
            <div role="status" className="min-w-0 text-bf-sm text-muted-foreground">
              {meanDistance?.status === 'ready'
                ? `Distance to the mean of ${meanDistance.groupSize} members over ${meanDistance.supportVoxels} shared voxels: Euclidean, with correlation distance (1 − r). The mean includes each member (not leave-one-out).${unmeasuredNote(meanDistance)}`
                : meanDistance?.status === 'failed'
                  ? `No distances: ${meanDistance.error ?? 'the calculation failed.'}`
                  : `Computing distances to the mean of ${meanDistance?.groupSize ?? orderedIds.length} members…`}
            </div>
            {onOpenInDeck && deckTarget ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onOpenInDeck(deckTarget)}
                title={`Show ${deckTarget} in the Deck`}
              >
                Open {deckTarget} in Deck
              </Button>
            ) : null}
          </div>
        ) : null}

        {scopedCohortLabel ? (
          <Notice
            role={undefined}
            severity="info"
            action={
              onClearScope ? (
                <Button variant="link" className="min-h-6" size="sm" onClick={onClearScope}>
                  Clear
                </Button>
              ) : undefined
            }
          >
            Scoped to cohort {scopedCohortLabel}
          </Notice>
        ) : null}

        {issueFocusLabel ? (
          <Notice
            role={undefined}
            severity="warning"
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" size="sm" onClick={onUseIssueFocusInCompare} disabled={!activeIssueMemberIds?.length}>
                  Compare
                </Button>
                <Button variant="ghost" size="sm" onClick={onSaveIssueFocusAsCohort} disabled={!activeIssueMemberIds?.length}>
                  Save group
                </Button>
                {onClearIssueFocus ? (
                  <Button variant="link" className="min-h-6" size="sm" onClick={onClearIssueFocus}>
                    Clear
                  </Button>
                ) : null}
              </div>
            }
          >
            Issue focus {issueFocusLabel}
          </Notice>
        ) : null}

        {(designSearch?.trim() || (activeDesignFilters && activeDesignFilters.length > 0)) ? (
          <div className="rounded-sm border border-border bg-bf-bg-panel-raised px-3 py-2 text-bf-sm text-foreground">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div
                role="group"
                aria-label="Subset"
                tabIndex={-1}
                data-filter-group="subset"
                className="flex flex-wrap items-center gap-2 outline-none"
              >
                <span>Subset</span>
                {designSearch?.trim() ? (
                  <Chip>search={designSearch.trim()}</Chip>
                ) : null}
                {(activeDesignFilters ?? []).map((filter, index) => (
                  <FilterChip
                    key={`${filter.column}-${filter.value}`}
                    pressed
                    title="Remove filter"
                    data-filter-key={`subset:${filter.column}=${filter.value}`}
                    onPressedChange={() => {
                      pendingFocusRef.current = {
                        key: `subset:${filter.column}=${filter.value}`,
                        subsetIndex: index,
                      };
                      onRemoveDesignFilter?.(filter);
                    }}
                  >
                    {filter.column}={filter.value}
                  </FilterChip>
                ))}
              </div>
              {onClearSubsetNarrowing ? (
                <div className="flex flex-wrap items-center gap-2">
                  {onUseFilteredSubsetInCompare ? (
                    <Button variant="ghost" size="sm" onClick={onUseFilteredSubsetInCompare}>
                      Compare
                    </Button>
                  ) : null}
                  {onSaveFilteredSubsetAsCohort ? (
                    <Button variant="ghost" size="sm" onClick={onSaveFilteredSubsetAsCohort}>
                      Save group
                    </Button>
                  ) : null}
                  <Button variant="link" className="min-h-6" size="sm" onClick={onClearSubsetNarrowing}>
                    Clear
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <div className="text-bf-sm text-muted-foreground">
            {previewRows.length} visible members
          </div>
          <Button variant="ghost" size="sm" onClick={onSaveVisibleCohort} disabled={previewRows.length === 0}>
            Save group
          </Button>
        </div>

        {quickFilterOptions && quickFilterOptions.length > 0 ? (
          <Section
            variant="static"
            title="Filters"
            bodyClassName="space-y-3"
            tabIndex={-1}
            data-filter-group="filters"
            className="outline-none"
          >
            {quickFilterOptions.map((option) => (
              <div key={option.column} role="group" aria-label={option.column}>
                <div className="text-bf-xs text-muted-foreground">{option.column}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {option.values.map((value) => {
                    const isActive = Boolean(
                      activeDesignFilters?.some(
                        (filter) => filter.column === option.column && filter.value === value
                      )
                    );
                    return (
                      <FilterChip
                        key={`${option.column}-${value}`}
                        pressed={isActive}
                        data-filter-key={`quick:${option.column}=${value}`}
                        onPressedChange={() => {
                          pendingFocusRef.current = {
                            key: `quick:${option.column}=${value}`,
                            subsetIndex: -1,
                          };
                          onToggleDesignFilter?.({ column: option.column, value });
                        }}
                      >
                        {value}
                      </FilterChip>
                    );
                  })}
                </div>
              </div>
            ))}
          </Section>
        ) : null}

        {showPreview ? (
          <div className="rounded-sm border border-border bg-background">
            <div
              className="grid gap-3 border-b border-border px-3 py-2 text-bf-sm text-muted-foreground"
              style={{ gridTemplateColumns: columnTemplate }}
            >
              {/* Truncate so a long header ("diagnosis") never runs into its neighbour. */}
              {visibleColumns.map((column) => (
                <span key={column} className="min-w-0 truncate" title={column}>
                  {column}
                </span>
              ))}
              {distances ? (
                <span className="min-w-0 truncate text-right" title="Euclidean distance to the group mean (correlation distance 1 − r)">
                  Distance
                </span>
              ) : null}
            </div>
            {pageRows.map((row) => (
              <button
                key={row.id}
                ref={row.id === activeMemberId ? selectedRowRef : undefined}
                type="button"
                onClick={() => onSelectMember(row.id)}
                className={`grid w-full gap-3 px-3 py-2 text-left text-bf-md transition-colors ${
                  row.id === activeMemberId
                    ? SELECTED
                    : activeIssueMemberIds?.includes(row.id)
                      ? 'text-bf-warning hover:bg-accent'
                    : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
                style={{ gridTemplateColumns: columnTemplate }}
              >
                {row.cells.slice(0, visibleColumns.length).map((cell, index) => (
                  <span key={`${row.id}-${visibleColumns[index] ?? index}`} className="min-w-0 truncate">
                    {cell}
                  </span>
                ))}
                {distances ? (
                  <DistanceCell distance={distances.get(row.id)} />
                ) : null}
              </button>
            ))}
            {pageCount > 1 && (
              <div className="flex items-center justify-end border-t border-border p-1">
                <Pager
                  label="Observations"
                  noun="page"
                  page={currentPage + 1}
                  count={pageCount}
                  onPageChange={(next) => setPage(next - 1)}
                />
              </div>
            )}
          </div>
        ) : null}

        {showColumns ? (
          <Section title="Columns" defaultOpen={false} meta={String(activeSet.designColumns.length)}>
            <div className="flex flex-wrap gap-1.5">
              {activeSet.designColumns.map((column) => (
                <Chip key={column} mono>
                  {column}
                </Chip>
              ))}
            </div>
          </Section>
        ) : null}

        {showGroups ? (
          <Section title="Groups" defaultOpen meta={String(cohorts.length)}>
              <div className="space-y-2">
                {cohorts.map((cohort) => (
                  <div
                    key={cohort.id}
                    className={`rounded-sm border px-3 py-2 ${
                      cohort.id === activeScopeCohortId
                        ? cn('border-border', SELECTED)
                        : cohort.id === activeCompareCohortId
                          ? 'border-border bg-bf-bg-active'
                          : 'border-border bg-card'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-bf-md font-medium text-foreground">{cohort.label}</div>
                          <Chip>{cohortOriginLabel(cohort)}</Chip>
                        </div>
                        <div className="mt-1 text-bf-sm text-muted-foreground">
                          {cohort.memberCount} members
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 text-bf-xs">
                        {cohort.id === activeCompareCohortId ? (
                          <Chip>Compare</Chip>
                        ) : null}
                        {cohort.id === activeScopeCohortId ? (
                          <Chip>Scope</Chip>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onUseCompareCohort?.(cohort.id)}
                        disabled={cohort.id === activeCompareCohortId}
                      >
                        Compare
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onScopeToCohort?.(cohort.id)}
                        disabled={cohort.id === activeScopeCohortId}
                      >
                        Scope
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRenameCohort?.(cohort)}
                      >
                        Rename
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDeleteCohort?.(cohort)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
          </Section>
        ) : null}
      </div>
    </StudioPane>
  );
}

/** Listed members the calculation could not measure (no usable source). */
function unmeasuredNote(snapshot: MeanDistanceSnapshot): string {
  const missing = snapshot.listSize - snapshot.groupSize;
  return missing > 0
    ? ` ${missing} listed member${missing === 1 ? '' : 's'} without a usable source ${missing === 1 ? 'is' : 'are'} not measured.`
    : '';
}

function DistanceCell({
  distance,
}: {
  distance: { euclidean: number; correlation: number | null } | undefined;
}) {
  if (!distance)
    return (
      <span className="min-w-0 truncate text-right text-muted-foreground" title="Not part of the measured group">
        —
      </span>
    );
  const euclidean = formatLayerValue(distance.euclidean);
  const correlation = distance.correlation === null ? null : formatLayerValue(distance.correlation);
  return (
    <span
      className="min-w-0 truncate text-right font-mono tabular-nums"
      data-testid="distance-to-mean"
      title={`Euclidean ${euclidean}; correlation distance ${correlation ?? 'undefined (constant map)'}; the mean includes this member`}
    >
      {euclidean}
      <span className="text-muted-foreground"> ({correlation ?? '—'})</span>
    </span>
  );
}

function cohortOriginLabel(cohort: StudioCohortSummary): string {
  switch (cohort.originKind) {
    case 'issue_focus':
      return 'Issue';
    case 'saved_snapshot':
      return 'Snapshot';
    case 'imported':
    default:
      return 'Imported';
  }
}
