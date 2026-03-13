import React from 'react';
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
  onClearDesignFilters,
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
  if (!activeSet) {
    return (
      <StudioPane title="Subjects" headerActions={headerActions} showHeader={false}>
        <div className="rounded-lg border border-border bg-background px-3 py-3">
          <div className="text-sm font-medium text-foreground">No study loaded</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">
            Use the actions above to import a table or manifest.
          </div>
        </div>
      </StudioPane>
    );
  }

  const previewColumns = activeSet?.designTablePreview?.columns ?? [];
  const previewRows = (activeSet?.designTablePreview?.rows ?? []).filter((row) =>
    visibleMemberIds ? visibleMemberIds.includes(row.id) : true
  );
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
        {showImportSummary ? (
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-foreground">Import Summary</div>
              <AuditBadge severity={activeSet.ingestAudit.join.severity}>
                {activeSet.ingestAudit.sourceLabel}
              </AuditBadge>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <AuditStat label="Matched" value={String(activeSet.ingestAudit.join.matchedRows)} />
              <AuditStat label="Unmatched" value={String(activeSet.ingestAudit.join.unmatchedRows)} />
              <AuditStat label="Duplicate Keys" value={String(activeSet.ingestAudit.join.duplicateKeys)} />
              <AuditStat label="Alignment" value={activeSet.ingestAudit.support.alignmentClass} />
            </div>
            <div className="mt-3 space-y-2">
              {activeSet.ingestAudit.notes.map((note) => (
                <div key={note} className="text-xs leading-5 text-muted-foreground">
                  {note}
                </div>
              ))}
            </div>
            {activeSet.ingestAudit.join.issueDetails.length > 0 ? (
              <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="text-xs font-medium text-foreground">Import issues</div>
                <div className="mt-2 space-y-1">
                  {activeSet.ingestAudit.join.issueDetails.map((detail) => (
                    <button
                      key={`${detail.message}-${detail.memberIds.join('|')}`}
                      type="button"
                      onClick={() => onSelectJoinIssue?.(detail)}
                      className="block w-full rounded-md px-2 py-1 text-left text-xs leading-5 text-foreground transition-colors hover:bg-amber-500/10"
                    >
                      {detail.message}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-lg border border-border bg-background px-3 py-2">
          <input
            value={designSearch ?? ''}
            onChange={(event) => onDesignSearchChange?.(event.target.value)}
            placeholder="Search design rows or member ids..."
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>

        {previewColumns.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Sort</span>
              <select
                value={sortColumn ?? ''}
                onChange={(event) => onSortColumnChange?.(event.target.value || null)}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
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
            >
              {sortDirection === 'desc' ? 'Descending' : 'Ascending'}
            </Button>
          </div>
        ) : null}

        {scopedCohortLabel ? (
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-foreground">
            Scoped to cohort {scopedCohortLabel}
            {onClearScope ? (
              <button
                type="button"
                onClick={onClearScope}
                className="ml-3 text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            ) : null}
          </div>
        ) : null}

        {issueFocusLabel ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>Issue focus {issueFocusLabel}</div>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" onClick={onUseIssueFocusInCompare} disabled={!activeIssueMemberIds?.length}>
                  Compare
                </Button>
                <Button variant="ghost" size="sm" onClick={onSaveIssueFocusAsCohort} disabled={!activeIssueMemberIds?.length}>
                  Save Group
                </Button>
                {onClearIssueFocus ? (
                  <button
                    type="button"
                    onClick={onClearIssueFocus}
                    className="ml-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {(designSearch?.trim() || (activeDesignFilters && activeDesignFilters.length > 0)) ? (
          <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-sm text-foreground">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span>Subset</span>
                {designSearch?.trim() ? (
                  <span className="rounded-full border border-violet-400/30 bg-violet-500/10 px-2.5 py-1 text-xs text-foreground">
                    search={designSearch.trim()}
                  </span>
                ) : null}
                {(activeDesignFilters ?? []).map((filter) => (
                  <button
                    key={`${filter.column}-${filter.value}`}
                    type="button"
                    onClick={() => onRemoveDesignFilter?.(filter)}
                    className="rounded-full border border-violet-400/30 bg-violet-500/10 px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-violet-500/20"
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
                      Save Group
                    </Button>
                  ) : null}
                  <button
                    type="button"
                    onClick={onClearSubsetNarrowing}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
          <div className="text-sm text-muted-foreground">
            {previewRows.length} visible members
          </div>
          <Button variant="ghost" size="sm" onClick={onSaveVisibleCohort} disabled={previewRows.length === 0}>
            Save Group
          </Button>
        </div>

        {quickFilterOptions && quickFilterOptions.length > 0 ? (
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="text-sm font-medium text-foreground">Filters</div>
            <div className="mt-3 space-y-3">
              {quickFilterOptions.map((option) => (
                <div key={option.column}>
                  <div className="text-xs text-muted-foreground">{option.column}</div>
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
                          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                            isActive
                              ? 'border-violet-500/50 bg-violet-500/10 text-foreground'
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
          <div className="rounded-lg border border-border bg-background">
            <div
              className="grid gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground"
              style={{ gridTemplateColumns: `repeat(${Math.max(visibleColumns.length, 1)}, minmax(0, 1fr))` }}
            >
              {visibleColumns.map((column) => <span key={column}>{column}</span>)}
            </div>
            {previewRows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => onSelectMember(row.id)}
                className={`grid w-full gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  row.id === activeMemberId
                    ? 'bg-accent text-accent-foreground'
                    : activeIssueMemberIds?.includes(row.id)
                      ? 'bg-amber-500/10 text-foreground'
                    : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
                style={{ gridTemplateColumns: `repeat(${Math.max(visibleColumns.length, 1)}, minmax(0, 1fr))` }}
              >
                {row.cells.slice(0, visibleColumns.length).map((cell, index) => (
                  <span key={`${row.id}-${visibleColumns[index] ?? index}`}>{cell}</span>
                ))}
              </button>
            ))}
          </div>
        ) : null}

        {showColumns ? (
          <div className="rounded-lg border border-border bg-background p-3">
            <CollapsibleSection title="Columns" defaultExpanded={false}>
              <div className="flex flex-wrap gap-2">
                {activeSet.designColumns.map((column) => (
                  <span
                    key={column}
                    className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground"
                  >
                    {column}
                  </span>
                ))}
              </div>
            </CollapsibleSection>
          </div>
        ) : null}

        {showGroups ? (
          <div className="rounded-lg border border-border bg-background p-3">
            <CollapsibleSection title="Groups" defaultExpanded>
              <div className="space-y-2">
                {cohorts.map((cohort) => (
                  <div
                    key={cohort.id}
                    className={`rounded-md border px-3 py-2 ${
                      cohort.id === activeScopeCohortId
                        ? 'border-sky-500/50 bg-sky-500/10'
                        : cohort.id === activeCompareCohortId
                          ? 'border-emerald-500/40 bg-emerald-500/10'
                          : 'border-border bg-card'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-medium text-foreground">{cohort.label}</div>
                          <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
                            {cohortOriginLabel(cohort)}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {cohort.memberCount} members
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 text-[11px]">
                        {cohort.id === activeCompareCohortId ? (
                          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-foreground">
                            Compare
                          </span>
                        ) : null}
                        {cohort.id === activeScopeCohortId ? (
                          <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-foreground">
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
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm text-foreground">{value}</div>
    </div>
  );
}

function AuditBadge({
  severity,
  children,
}: {
  severity: 'ok' | 'warning' | 'error';
  children: React.ReactNode;
}) {
  const className =
    severity === 'ok'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-foreground'
      : severity === 'warning'
        ? 'border-amber-500/40 bg-amber-500/10 text-foreground'
        : 'border-rose-500/40 bg-rose-500/10 text-foreground';

  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] ${className}`}>
      {children}
    </span>
  );
}
