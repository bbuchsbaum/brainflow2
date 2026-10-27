import React from 'react';
import { Chip, Notice, SelectableRow, useRovingFocus } from '@/components/ui/bf';
import type { StudioDesignFilter } from '@/types/studio';

interface StudioStripProps {
  memberIds: string[];
  activeMemberId: string | null;
  scopeLabel?: string | null;
  issueFocusLabel?: string | null;
  searchLabel?: string | null;
  filterLabels?: string[];
  filters?: StudioDesignFilter[];
  sortLabel?: string | null;
  contextIssue?: string | null;
  onSelectMember: (memberId: string) => void;
  onClearScope?: () => void;
  onClearSearch?: () => void;
  onRemoveFilter?: (filter: StudioDesignFilter) => void;
}

export function StudioStrip({
  memberIds,
  activeMemberId,
  scopeLabel,
  issueFocusLabel,
  searchLabel,
  filterLabels,
  filters,
  sortLabel,
  contextIssue,
  onSelectMember,
  onClearScope,
  onClearSearch,
  onRemoveFilter,
}: StudioStripProps) {
  const hasChips =
    Boolean(scopeLabel) ||
    Boolean(issueFocusLabel) ||
    Boolean(searchLabel) ||
    Boolean(sortLabel) ||
    (filterLabels?.length ?? 0) > 0;

  const filterEntries = filters
    ? filters.map((filter, index) => ({
        filter,
        label: filterLabels?.[index] ?? `${filter.column}=${filter.value}`,
      }))
    : (filterLabels ?? []).map((label) => ({ filter: null as StudioDesignFilter | null, label }));

  const roving = useRovingFocus({
    ids: memberIds,
    activeId: activeMemberId,
    orientation: 'horizontal',
  });

  return (
    <section
      aria-label="Set studio strip"
      className="col-span-3 flex flex-col gap-2 rounded-sm border border-border bg-card p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-bf-xs font-medium text-muted-foreground">
          Studio strip
          <span className="text-muted-foreground"> — current set</span>
          <span
            className="ml-2 text-foreground tabular-nums"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            ({memberIds.length} {memberIds.length === 1 ? 'member' : 'members'})
          </span>
        </div>
        {hasChips ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {scopeLabel ? (
              <ContextChip
                label="Scope"
                value={scopeLabel}
                onClear={onClearScope}
              />
            ) : null}
            {issueFocusLabel ? (
              <ContextChip label="Issue" value={issueFocusLabel} />
            ) : null}
            {searchLabel ? (
              <ContextChip
                label="Search"
                value={searchLabel}
                onClear={onClearSearch}
              />
            ) : null}
            {filterEntries.map(({ filter, label }) => (
              <ContextChip
                key={label}
                label="Filter"
                value={label}
                onClear={
                  filter && onRemoveFilter ? () => onRemoveFilter(filter) : undefined
                }
              />
            ))}
            {sortLabel ? <ContextChip label="Sort" value={sortLabel} /> : null}
          </div>
        ) : null}
      </div>

      {contextIssue ? (
        <Notice role="alert" severity="danger">
          {contextIssue}
        </Notice>
      ) : activeMemberId && !memberIds.includes(activeMemberId) ? (
        <Notice severity="info">
          Focus: <span className="font-mono">{activeMemberId}</span> · hidden by list filters
        </Notice>
      ) : null}

      <div
        role="listbox"
        aria-label="Members"
        aria-orientation="horizontal"
        onKeyDown={roving.onKeyDown}
        className="flex gap-2 overflow-x-auto p-0.5 pb-1"
      >
        {memberIds.map((memberId) => (
          <SelectableRow
            key={memberId}
            variant="card"
            {...roving.getItemProps(memberId)}
            selected={memberId === activeMemberId}
            onSelect={() => onSelectMember(memberId)}
            title={memberId}
            className="min-w-[112px] shrink-0"
          >
            <span className="block truncate font-mono text-bf-sm tabular-nums">{memberId}</span>
          </SelectableRow>
        ))}
        {memberIds.length === 0 ? (
          <div className="px-3 py-2 text-bf-sm text-muted-foreground">
            No members in scope.
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** A static context chip ("Scope S001") with an optional remove button. */
function ContextChip({
  label,
  value,
  onClear,
}: {
  label: string;
  value: string;
  onClear?: () => void;
}) {
  return (
    <Chip
      title={`${label} ${value}`}
      className="max-w-[200px]"
      onRemove={onClear}
      removeLabel={`${label.toLowerCase()} ${value}`}
    >
      <span className="text-muted-foreground">{label}</span> {value}
    </Chip>
  );
}
