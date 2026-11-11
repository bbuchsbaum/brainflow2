import React, { useId, useMemo, useState } from 'react';
import type { DatasetAnalysis } from '@brainflow/api';
import { FOCUS_RING, TextField, rowVariants, useRovingFocus } from '@/components/ui/bf';
import { cn } from '@/utils/cn';
import { MONO, NOTE, Spoken } from './cardParts';
import {
  analysisSubjects,
  analysisTable,
  filterAnalysisRows,
  sortAnalysisRows,
  stableAnalysisOrder,
  type AnalysisRowModel,
  type AnalysisSort,
  type AnalysisSortKey,
} from './datasetCardFormat';

/** A filter box is worth its row once the list no longer fits a glance. */
export const ANALYSIS_FILTER_FROM = 11;
/**
 * On the filter box: Escape empties a filter that has text and goes no
 * further. The card's host reads this too, so that press does not close it.
 */
export const ESCAPE_CLEARS_SELECTOR = 'input[data-escape-clears]';

/** The row draws the focus ring of the button in its title cell. */
const ROW_FOCUS =
  'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--bf-border-focus)] has-[:focus-visible]:[outline-offset:-6px]';

export interface AnalysesTableProps {
  analyses: readonly DatasetAnalysis[];
  /** Accessible name of the table ("Analyses in derivatives"). */
  label: string;
  /** The folders are not counted yet: subject cells wait, and cannot be sorted. */
  countsPending: boolean;
  /** Counting failed: the subject cells say nothing rather than a wrong zero. */
  countsMissing: boolean;
  onOpen: (path: string) => void;
}

function SortHeader({
  label,
  column,
  sort,
  disabled = false,
  onSort,
}: {
  label: string;
  column: AnalysisSortKey;
  sort: AnalysisSort | null;
  disabled?: boolean;
  onSort: (key: AnalysisSortKey) => void;
}) {
  const active = sort?.key === column;
  // The header cell carries the sort state; the control in it is a button.
  return (
    <span
      role="columnheader"
      aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'}
      className="flex min-w-0"
    >
      <button
        type="button"
        aria-disabled={disabled || undefined}
        title={disabled ? undefined : `Sort by ${label.toLowerCase()}`}
        onClick={() => {
          if (!disabled) onSort(column);
        }}
        className={cn(
          'min-w-0 truncate rounded-sm border-0 bg-transparent p-0 text-left text-bf-xs leading-4',
          active ? 'text-bf-text-secondary' : 'text-bf-text-muted',
          disabled ? 'cursor-default' : 'cursor-pointer hover:text-bf-text-primary',
          FOCUS_RING,
        )}
      >
        {label}
        {active ? <span aria-hidden>{sort.descending ? ' ↓' : ' ↑'}</span> : null}
      </button>
    </span>
  );
}

function rowTooltip(row: AnalysisRowModel): string {
  const { analysis } = row;
  return [
    row.fullTitle,
    row.named ? analysis.folderName : null,
    analysis.date ? `Date: ${analysis.date}` : null,
    analysis.hasDescription ? null : 'No description file',
    analysis.issue ? `Description: ${analysis.issue}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The analyses of a collection: one line each. The title of a row is a
 * button that opens that analysis's card (Enter or Space), and a click
 * anywhere on the row does the same. The buttons are one tab stop; arrow
 * keys, Home and End move between them. A prefix every title shares is said
 * once above the table.
 *
 * Until the user sorts, rows keep the places they were first listed in and
 * later arrivals go after them (see {@link stableAnalysisOrder}).
 */
export function AnalysesTable({
  analyses,
  label,
  countsPending,
  countsMissing,
  onOpen,
}: AnalysesTableProps) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<AnalysisSort | null>(null);
  const filterId = useId();
  // Derived state, adjusted while rendering: the first-seen order of the rows.
  const [order, setOrder] = useState<readonly string[]>(() =>
    analyses.map((analysis) => analysis.path),
  );
  const nextOrder = stableAnalysisOrder(order, analyses);
  if (nextOrder !== order) setOrder(nextOrder);
  const model = useMemo(() => {
    const byPath = new Map(analyses.map((analysis) => [analysis.path, analysis]));
    const listed = nextOrder
      .map((path) => byPath.get(path))
      .filter((analysis): analysis is DatasetAnalysis => analysis !== undefined);
    return analysisTable(listed);
  }, [analyses, nextOrder]);
  const subjectsKnown = !countsPending && !countsMissing;
  // A sort by counts that are not here yet would order by zeros.
  const effectiveSort = sort?.key === 'subjects' && !subjectsKnown ? null : sort;
  const rows = useMemo(
    () => sortAnalysisRows(filterAnalysisRows(model.rows, query), effectiveSort),
    [model.rows, query, effectiveSort],
  );
  const ids = useMemo(() => rows.map((row) => row.analysis.path), [rows]);
  const roving = useRovingFocus({ ids });

  const onSort = (key: AnalysisSortKey) => {
    setSort((current) =>
      current?.key === key
        ? { key, descending: !current.descending }
        : // Most subjects first, newest first; names from the start.
          { key, descending: key !== 'name' },
    );
  };

  const columns = [
    'minmax(0,1.7fr)',
    model.showFolder ? 'minmax(0,1fr)' : null,
    model.showGeneratedBy ? 'minmax(0,0.8fr)' : null,
    model.showDate ? '92px' : null,
    '104px',
  ]
    .filter(Boolean)
    .join(' ');
  const grid = { gridTemplateColumns: columns };
  const filtering = analyses.length >= ANALYSIS_FILTER_FROM;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {filtering ? (
        <div className="flex items-center gap-2">
          <label htmlFor={filterId} className="sr-only">
            Filter analyses by title or folder name
          </label>
          <TextField
            id={filterId}
            type="search"
            value={query}
            placeholder="Filter analyses"
            data-escape-clears=""
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // The first Escape empties the filter; the next closes the card.
              if (event.key !== 'Escape' || query === '') return;
              event.preventDefault();
              event.stopPropagation();
              setQuery('');
            }}
            className="max-w-[240px]"
          />
          {query.trim() ? (
            <span role="status" className={cn(NOTE, 'tabular-nums')}>
              {rows.length} of {analyses.length}
            </span>
          ) : null}
        </div>
      ) : null}
      {model.prefix ? (
        <p className={NOTE} data-testid="analysis-title-prefix">
          Every title begins <span className="text-bf-text-secondary">{model.prefix.trim()}</span>;
          it is left out below.
        </p>
      ) : null}
      <div
        role="table"
        aria-label={label}
        className="flex min-w-0 flex-col rounded-sm border border-bf-border"
      >
        <div role="rowgroup">
          <div
            role="row"
            style={grid}
            className="grid items-center gap-x-3 border-b border-bf-border bg-bf-bg-panel px-2 py-1"
          >
            <SortHeader label="Analysis" column="name" sort={effectiveSort} onSort={onSort} />
            {model.showFolder ? (
              <span role="columnheader" className="text-bf-xs leading-4 text-bf-text-muted">
                Folder
              </span>
            ) : null}
            {model.showGeneratedBy ? (
              <span role="columnheader" className="text-bf-xs leading-4 text-bf-text-muted">
                Generated by
              </span>
            ) : null}
            {model.showDate ? (
              <SortHeader label="Date" column="date" sort={effectiveSort} onSort={onSort} />
            ) : null}
            <SortHeader
              label="Subjects"
              column="subjects"
              sort={effectiveSort}
              disabled={!subjectsKnown}
              onSort={onSort}
            />
          </div>
        </div>
        <div role="rowgroup" onKeyDown={roving.onKeyDown}>
          {rows.map((row, index) => {
            const { analysis } = row;
            const subjects = analysisSubjects(analysis);
            return (
              <div
                key={analysis.path}
                role="row"
                data-analysis={analysis.folderName}
                title={rowTooltip(row)}
                // The button in the title cell is the control; a click on
                // the rest of the row (and the button's own, which bubbles
                // here) opens the same analysis.
                onClick={() => onOpen(analysis.path)}
                style={{ ...grid, paddingLeft: 8 }}
                className={cn(
                  rowVariants({ variant: 'row' }),
                  ROW_FOCUS,
                  'grid min-h-7 cursor-pointer gap-x-3 pr-2 text-bf-text-primary',
                  index < rows.length - 1 && 'border-b border-bf-border-subtle',
                )}
              >
                <span role="cell" className="flex min-w-0 items-baseline gap-2">
                  <button
                    type="button"
                    data-analysis-open
                    {...roving.getItemProps(analysis.path)}
                    className={cn(
                      'min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-inherit focus-visible:outline-none',
                      row.named ? 'text-bf-md' : MONO,
                    )}
                  >
                    <Spoken text={row.title} spoken={row.fullTitle} />
                  </button>
                  {analysis.issue ? (
                    <span className="shrink-0 text-bf-xs text-bf-text-muted">
                      description not read in full
                    </span>
                  ) : null}
                </span>
                {model.showFolder ? (
                  <span role="cell" className={cn(MONO, 'min-w-0 truncate text-bf-text-muted')}>
                    {row.named ? analysis.folderName : ''}
                  </span>
                ) : null}
                {model.showGeneratedBy ? (
                  <span role="cell" className="min-w-0 truncate text-bf-sm text-bf-text-secondary">
                    {row.generatedBy?.name}
                    {row.generatedBy?.name && row.generatedBy.version ? ' ' : null}
                    {row.generatedBy?.version ? (
                      <span className={MONO}>{row.generatedBy.version}</span>
                    ) : null}
                  </span>
                ) : null}
                {model.showDate ? (
                  <span
                    role="cell"
                    className={cn(MONO, 'min-w-0 truncate tabular-nums text-bf-text-secondary')}
                  >
                    {analysis.date ?? ''}
                  </span>
                ) : null}
                <span
                  role="cell"
                  data-subjects={subjectsKnown ? 'counted' : countsPending ? 'pending' : 'unknown'}
                  className="min-w-0 truncate text-bf-sm tabular-nums"
                >
                  {subjectsKnown ? (
                    <Spoken text={subjects.text} spoken={subjects.spoken} />
                  ) : countsPending ? (
                    <Spoken text="…" spoken="Counting" className="text-bf-text-faint" />
                  ) : (
                    <Spoken text="–" spoken="Not counted" className="text-bf-text-faint" />
                  )}
                </span>
              </div>
            );
          })}
          {rows.length === 0 ? (
            <div role="row" className="px-2 py-2">
              <span role="cell" className={NOTE}>
                {query.trim()
                  ? `No analysis matches “${query.trim()}”.`
                  : countsPending
                    ? 'Looking for analyses…'
                    : 'No analyses are listed.'}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
