import { studioMetadata } from '@/services/studio/studioMetadata';
import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { StudioPane } from './StudioPane';
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
  if (!activeSet) {
    return (
      <StudioPane title="Subjects" headerActions={headerActions} showHeader={false}>
        <div className="rounded-sm border border-border bg-background px-3 py-3">
          <div className="text-bf-md font-medium text-foreground">No study loaded</div>
          <div className="mt-1 text-bf-sm leading-5 text-muted-foreground">
            Use the actions above to import a table or manifest.
          </div>
        </div>
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
  const showImportSummary =
    activeSet.ingestAudit.join.severity !== 'ok' ||
    activeSet.ingestAudit.join.issueDetails.length > 0 ||
    activeSet.ingestAudit.join.unmatchedRows > 0 ||
    activeSet.ingestAudit.join.duplicateKeys > 0;
  const showPreview = visibleColumns.length > 0 && previewRows.length > 0;
  const showColumns = activeSet.designColumns.length > 0;
  const showGroups = cohorts.length > 0;

  return (
    <StudioPane
      title="Subjects"
      headerActions={headerActions}
      showHeader={false}
    >
      <div className="space-y-3">
        {metadata.issue && <p role="alert" className="text-bf-sm text-destructive">{metadata.issue}</p>}
        {showImportSummary ? (
          <div className="rounded-sm border border-border bg-background p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-bf-md font-medium text-foreground">Import summary</div>
              {/* The source label names where rows came from; it is not a
                  status, so it stays neutral. Join severity is carried by
                  the Import issues box and the audit banner. */}
              <SourceBadge>{activeSet.ingestAudit.sourceLabel}</SourceBadge>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-bf-md">
              <AuditStat label="Matched" value={String(activeSet.ingestAudit.join.matchedRows)} />
              <AuditStat label="Unmatched" value={String(activeSet.ingestAudit.join.unmatchedRows)} />
              <AuditStat label="Duplicate keys" value={String(activeSet.ingestAudit.join.duplicateKeys)} />
              <AuditStat label="Alignment" value={activeSet.ingestAudit.support.alignmentClass} />
            </div>
            <div className="mt-3 space-y-2">
              {activeSet.ingestAudit.notes.map((note) => (
                <div key={note} className="text-bf-sm leading-5 text-muted-foreground">
                  {note}
                </div>
              ))}
            </div>
            {activeSet.ingestAudit.join.issueDetails.length > 0 ? (
              <div className="mt-3 rounded-sm border border-bf-warning/50 p-3">
                <div className="text-bf-sm font-medium text-bf-warning">Import issues</div>
                <div className="mt-2 space-y-1">
                  {activeSet.ingestAudit.join.issueDetails.map((detail) => (
                    <button
                      key={`${detail.message}-${detail.memberIds.join('|')}`}
                      type="button"
                      onClick={() => onSelectJoinIssue?.(detail)}
                      className="block w-full rounded-sm px-2 py-1 text-left text-bf-sm leading-5 text-foreground transition-colors hover:bg-accent"
                    >
                      {detail.message}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-sm border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background">
          <input
            aria-label="Search design rows or member IDs"
            value={designSearch ?? ''}
            onChange={(event) => onDesignSearchChange?.(event.target.value)}
            placeholder="Search design rows or member IDs…"
            className="w-full bg-transparent text-bf-md text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
          />
        </div>

        {previewColumns.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-background px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-bf-sm text-muted-foreground">Sort</span>
              <select
                value={sortColumn ?? ''}
                onChange={(event) => onSortColumnChange?.(event.target.value || null)}
                className="rounded-sm border border-border bg-card px-3 py-1.5 text-bf-md text-foreground"
              >
                <option value="">Design order</option>
                {previewColumns.map((column) => (
                  <option key={column} value={column}>
                    {column}
                  </option>
                ))}
              </select>
            </div>
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

        {scopedCohortLabel ? (
          <div className="rounded-sm border border-primary/40 bg-primary/10 px-3 py-2 text-bf-md text-foreground">
            Scoped to cohort {scopedCohortLabel}
            {onClearScope ? (
              <button
                type="button"
                onClick={onClearScope}
                className="ml-3 text-bf-sm text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            ) : null}
          </div>
        ) : null}

        {issueFocusLabel ? (
          <div className="rounded-sm border border-bf-warning/50 px-3 py-2 text-bf-md text-foreground">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>Issue focus {issueFocusLabel}</div>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" onClick={onUseIssueFocusInCompare} disabled={!activeIssueMemberIds?.length}>
                  Compare
                </Button>
                <Button variant="ghost" size="sm" onClick={onSaveIssueFocusAsCohort} disabled={!activeIssueMemberIds?.length}>
                  Save group
                </Button>
                {onClearIssueFocus ? (
                  <button
                    type="button"
                    onClick={onClearIssueFocus}
                    className="ml-1 text-bf-sm text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {(designSearch?.trim() || (activeDesignFilters && activeDesignFilters.length > 0)) ? (
          <div className="rounded-sm border border-border bg-bf-bg-panel-raised px-3 py-2 text-bf-md text-foreground">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span>Subset</span>
                {designSearch?.trim() ? (
                  <span className="rounded-sm border border-border bg-bf-bg-active px-2.5 py-1 text-bf-sm text-foreground">
                    search={designSearch.trim()}
                  </span>
                ) : null}
                {(activeDesignFilters ?? []).map((filter) => (
                  <button
                    key={`${filter.column}-${filter.value}`}
                    type="button"
                    onClick={() => onRemoveDesignFilter?.(filter)}
                    className="rounded-sm border border-border bg-bf-bg-active px-2.5 py-1 text-bf-sm text-foreground transition-colors hover:bg-accent"
                  >
                    {filter.column}={filter.value}
                  </button>
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
                  <button
                    type="button"
                    onClick={onClearSubsetNarrowing}
                    className="text-bf-sm text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 rounded-sm border border-border bg-background px-3 py-2">
          <div className="text-bf-md text-muted-foreground">
            {previewRows.length} visible members
          </div>
          <Button variant="ghost" size="sm" onClick={onSaveVisibleCohort} disabled={previewRows.length === 0}>
            Save group
          </Button>
        </div>

        {quickFilterOptions && quickFilterOptions.length > 0 ? (
          <div className="rounded-sm border border-border bg-background p-3">
            <div className="text-bf-md font-medium text-foreground">Filters</div>
            <div className="mt-3 space-y-3">
              {quickFilterOptions.map((option) => (
                <div key={option.column}>
                  <div className="text-bf-sm text-muted-foreground">{option.column}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {option.values.map((value) => {
                      const isActive = Boolean(
                        activeDesignFilters?.some(
                          (filter) => filter.column === option.column && filter.value === value
                        )
                      );
                      return (
                        <button
                          key={`${option.column}-${value}`}
                          type="button"
                          onClick={() => onToggleDesignFilter?.({ column: option.column, value })}
                          className={`rounded-sm border px-2.5 py-1 text-bf-sm transition-colors ${
                            isActive
                              ? 'border-border bg-bf-bg-selected shadow-[inset_2px_0_0_var(--bf-accent)] text-foreground'
                              : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                          }`}
                        >
                          {value}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {showPreview ? (
          <div className="rounded-sm border border-border bg-background">
            <div
              className="grid gap-2 border-b border-border px-3 py-2 text-bf-sm text-muted-foreground"
              style={{ gridTemplateColumns: `repeat(${Math.max(visibleColumns.length, 1)}, minmax(0, 1fr))` }}
            >
              {visibleColumns.map((column) => <span key={column}>{column}</span>)}
            </div>
            {previewRows.slice(currentPage * 80, (currentPage + 1) * 80).map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => onSelectMember(row.id)}
                className={`grid w-full gap-2 px-3 py-2 text-left text-bf-md transition-colors ${
                  row.id === activeMemberId
                    ? 'bg-accent text-accent-foreground'
                    : activeIssueMemberIds?.includes(row.id)
                      ? 'text-bf-warning hover:bg-accent'
                    : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
                style={{ gridTemplateColumns: `repeat(${Math.max(visibleColumns.length, 1)}, minmax(0, 1fr))` }}
              >
                {row.cells.slice(0, visibleColumns.length).map((cell, index) => (
                  <span key={`${row.id}-${visibleColumns[index] ?? index}`}>{cell}</span>
                ))}
              </button>
            ))}
            {pageCount > 1 && (
              <div className="flex items-center justify-between border-t border-border p-2 text-bf-sm">
                <Button size="sm" variant="ghost" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous observations</Button>
                <span>Page {currentPage + 1} / {pageCount}</span>
                <Button size="sm" variant="ghost" disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}>Next observations</Button>
              </div>
            )}
          </div>
        ) : null}

        {showColumns ? (
          <div className="rounded-sm border border-border bg-background p-3">
            <CollapsibleSection title="Columns" defaultExpanded={false}>
              <div className="flex flex-wrap gap-2">
                {activeSet.designColumns.map((column) => (
                  <span
                    key={column}
                    className="rounded-sm border border-border bg-card px-2.5 py-1 text-bf-sm text-muted-foreground"
                  >
                    {column}
                  </span>
                ))}
              </div>
            </CollapsibleSection>
          </div>
        ) : null}

        {showGroups ? (
          <div className="rounded-sm border border-border bg-background p-3">
            <CollapsibleSection title="Groups" defaultExpanded>
              <div className="space-y-2">
                {cohorts.map((cohort) => (
                  <div
                    key={cohort.id}
                    className={`rounded-sm border px-3 py-2 ${
                      cohort.id === activeScopeCohortId
                        ? 'border-border bg-bf-bg-selected shadow-[inset_2px_0_0_var(--bf-accent)]'
                        : cohort.id === activeCompareCohortId
                          ? 'border-border bg-bf-bg-active'
                          : 'border-border bg-card'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-bf-md font-medium text-foreground">{cohort.label}</div>
                          <span className="rounded-sm border border-border bg-background px-2 py-0.5 text-bf-2xs text-muted-foreground">
                            {cohortOriginLabel(cohort)}
                          </span>
                        </div>
                        <div className="mt-1 text-bf-sm text-muted-foreground">
                          {cohort.memberCount} members
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 text-bf-xs">
                        {cohort.id === activeCompareCohortId ? (
                          <span className="rounded-sm border border-border bg-bf-bg-active px-2 py-1 text-foreground">
                            Compare
                          </span>
                        ) : null}
                        {cohort.id === activeScopeCohortId ? (
                          <span className="rounded-sm border border-primary/50 bg-primary/10 px-2 py-1 text-foreground">
                            Scope
                          </span>
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
            </CollapsibleSection>
          </div>
        ) : null}
      </div>
    </StudioPane>
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

function AuditStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 py-1">
      <div className="text-bf-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-bf-md text-foreground">{value}</div>
    </div>
  );
}

function SourceBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm border border-border px-2 py-0.5 text-bf-xs text-bf-text-secondary">
      {children}
    </span>
  );
}
