import React from 'react';
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

  return (
    <section
      aria-label="Set Studio strip"
      className="col-span-3 flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Studio Strip
          <span className="text-muted-foreground/70"> — Current Set</span>
          <span
            className="ml-2 font-mono text-foreground tabular-nums"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            ({memberIds.length} {memberIds.length === 1 ? 'member' : 'members'})
          </span>
        </div>
        {hasChips ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {scopeLabel ? (
              <Chip
                tone="sky"
                label="Scope"
                value={scopeLabel}
                onClear={onClearScope}
              />
            ) : null}
            {issueFocusLabel ? (
              <Chip tone="amber" label="Issue" value={issueFocusLabel} />
            ) : null}
            {searchLabel ? (
              <Chip
                tone="violet"
                label="Search"
                value={searchLabel}
                onClear={onClearSearch}
              />
            ) : null}
            {filterEntries.map(({ filter, label }) => (
              <Chip
                key={label}
                tone="violet"
                label="Filter"
                value={label}
                onClear={
                  filter && onRemoveFilter ? () => onRemoveFilter(filter) : undefined
                }
              />
            ))}
            {sortLabel ? <Chip tone="muted" label="Sort" value={sortLabel} /> : null}
          </div>
        ) : null}
      </div>

      {contextIssue ? (
        <p role="alert" className="text-xs text-destructive">
          {contextIssue}
        </p>
      ) : activeMemberId && !memberIds.includes(activeMemberId) ? (
        <p role="status" className="text-xs text-muted-foreground">
          Focus: <span className="font-mono">{activeMemberId}</span> · hidden by list filters
        </p>
      ) : null}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {memberIds.map((memberId) => {
          const isActive = memberId === activeMemberId;
          return (
            <button
              key={memberId}
              type="button"
              onClick={() => onSelectMember(memberId)}
              title={memberId}
              className={`min-w-[112px] rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                isActive
                  ? 'border-sky-500 bg-sky-500/10 text-foreground shadow-sm'
                  : 'border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              <span
                className="block truncate font-mono text-xs tabular-nums"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {memberId}
              </span>
            </button>
          );
        })}
        {memberIds.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            No members in scope.
          </div>
        ) : null}
      </div>
    </section>
  );
}

type ChipTone = 'sky' | 'amber' | 'violet' | 'muted';

function Chip({
  tone,
  label,
  value,
  onClear,
}: {
  tone: ChipTone;
  label: string;
  value: string;
  onClear?: () => void;
}) {
  const toneClass =
    tone === 'sky'
      ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200'
      : tone === 'amber'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200'
        : tone === 'violet'
          ? 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-200'
          : 'border-border bg-background text-muted-foreground';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${toneClass}`}
    >
      <span className="text-[10px] font-medium uppercase tracking-[0.06em] opacity-80">
        {label}
      </span>
      <span className="max-w-[160px] truncate">{value}</span>
      {onClear ? (
        <button
          type="button"
          aria-label={`Clear ${label.toLowerCase()}`}
          onClick={onClear}
          className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-current/70 transition-colors hover:bg-background/40 hover:text-current"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
