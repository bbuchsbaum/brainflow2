/**
 * Runs in lens, the BIDS tab of the bottom dock: sorted, and keyboard navigable
 * as one listbox. Long lists render only the rows in view.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SelectableRow } from '@/components/ui/bf';
import { openRunInViewer } from '@/services/bids/openRunInViewer';
import { useBidsModel, useBidsStore } from '@/stores/bidsStore';
import { acquisitionKey, formatTr, naturalCompare, runLabel, type BidsRunFacts } from '@/stores/bidsModel';
import { truncateBidsName } from '@/utils/bids';
import { cn } from '@/utils/cn';

type SortKey = 'run' | 'tr' | 'volumes' | 'fd' | 'tsnr';

const ROW_PX = 24;
const OVERSCAN = 6;
const GRID = 'minmax(180px, 1fr) 56px 56px 64px 72px 56px 64px';
const RUN_CHAR_PX = 6.7;
const FIXED_COLUMNS_PX = 368 + 24;
const FD_BAR_SCALE_MM = 0.8;
const FD_BAR_PX = 60;
const TSNR_BAR_SCALE = 80;
const TSNR_BAR_PX = 50;

const SORT_VALUE: Record<Exclude<SortKey, 'run'>, (facts: BidsRunFacts) => number | null> = {
  tr: (facts) => facts.tr,
  volumes: (facts) => facts.volumes,
  fd: (facts) => facts.meanFd,
  tsnr: (facts) => facts.tsnr,
};

function sortRuns(runs: BidsRunFacts[], key: SortKey, descending: boolean): BidsRunFacts[] {
  const direction = descending ? -1 : 1;
  const sorted = [...runs];
  if (key === 'run') {
    return sorted.sort((a, b) => direction * naturalCompare(a.run.id, b.run.id));
  }
  const value = SORT_VALUE[key];
  // Runs without the value stay last in either direction.
  return sorted.sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === null) return right === null ? naturalCompare(a.run.id, b.run.id) : 1;
    if (right === null) return -1;
    return direction * (left - right) || naturalCompare(a.run.id, b.run.id);
  });
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
  numeric = true,
}: {
  label: string;
  column: SortKey;
  sort: { key: SortKey; descending: boolean };
  onSort: (key: SortKey) => void;
  numeric?: boolean;
}) {
  const active = sort.key === column;
  return (
    <button
      type="button"
      role="columnheader"
      aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'}
      onClick={() => onSort(column)}
      className={cn(
        'cursor-pointer text-bf-text-faint hover:text-bf-text-primary',
        'focus-visible:outline focus-visible:outline-1 focus-visible:outline-bf-accent',
        numeric ? 'text-right' : 'text-left',
        active && 'text-bf-text-secondary',
      )}
    >
      {label}
      {active ? (sort.descending ? ' ↓' : ' ↑') : ''}
    </button>
  );
}

const Bar = ({ width, hot }: { width: number; hot?: boolean }) => (
  <span
    className={cn('block h-[3px] self-center', hot ? 'bg-bf-text-primary' : 'bg-bf-text-faint')}
    style={{ width: Math.max(0, Math.min(width, FD_BAR_PX)) }}
  />
);

const RunRow = React.memo(function RunRow({
  facts,
  selected,
  chars,
  top,
  onSelect,
}: {
  facts: BidsRunFacts;
  selected: boolean;
  chars: number;
  top: number;
  onSelect: (id: string) => void;
}) {
  const label = runLabel(facts.run);
  const hot = facts.overThreshold;
  return (
    <SelectableRow
      focusable={false}
      selected={selected}
      id={`bids-run-${facts.run.id}`}
      onSelect={() => onSelect(facts.run.id)}
      title={facts.run.id}
      className="absolute inset-x-0 grid items-center gap-x-2 pr-3 font-mono text-bf-xs"
      style={{ top, height: ROW_PX, gridTemplateColumns: GRID, scrollSnapAlign: 'start' }}
    >
      <span
        className={cn(
          'overflow-hidden whitespace-nowrap',
          selected ? 'text-bf-text-primary' : 'text-bf-text-secondary',
          facts.excluded && 'line-through decoration-bf-text-faint',
        )}
      >
        {truncateBidsName(label, chars)}
      </span>
      <span className="text-right">{facts.tr === null ? '' : formatTr(facts.tr)}</span>
      <span className="text-right">{facts.volumes ?? ''}</span>
      <span className={cn('text-right', hot && 'font-medium text-bf-text-primary')}>
        {facts.meanFd?.toFixed(2) ?? ''}
      </span>
      {facts.meanFd !== null ? <Bar width={(facts.meanFd / FD_BAR_SCALE_MM) * FD_BAR_PX} hot={hot} /> : <span />}
      <span className="text-right">{facts.tsnr !== null ? Math.round(facts.tsnr) : ''}</span>
      {facts.tsnr !== null ? <Bar width={(facts.tsnr / TSNR_BAR_SCALE) * TSNR_BAR_PX} /> : <span />}
    </SelectableRow>
  );
});

export function BidsRunsDock() {
  const model = useBidsModel();
  const selectedRunId = useBidsStore((state) => state.selectedRunId);
  const selectRun = useBidsStore((state) => state.selectRun);
  const requestAction = useBidsStore((state) => state.requestAction);
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'fd', descending: true });
  const [task, setTask] = useState<string | null>(null);
  const [allImages, setAllImages] = useState(false);
  const [view, setView] = useState({ top: 0, height: 300, width: 800 });
  const list = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);

  const { lens, runs: images, ofRuns, bold, ofBold, tasks } = model.lens;
  // "Run" means a BOLD run, as in Findings; a lens with none (a T1w finding)
  // shows the images it has, so a list is never empty for that reason.
  const showAll = allImages || (bold.length === 0 && images.length > 0);
  const lensRuns = showAll ? images : bold;
  const facet = tasks.find((entry) => entry.task === task) ?? null;
  const runs = useMemo(() => {
    const scoped = facet ? lensRuns.filter((facts) => facts.run.task === facet.task) : lensRuns;
    return sortRuns(scoped, sort.key, sort.descending);
  }, [lensRuns, facet, sort]);

  useEffect(() => {
    const el = frame.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const height = el.clientHeight || 300;
      const width = el.clientWidth || 800;
      setView((old) => (old.height === height && old.width === width ? old : { ...old, height, width }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const selectedIndex = useMemo(
    // An echoed run has one row, whichever echo the matrix selected.
    () => (selectedRunId ? runs.findIndex((facts) => acquisitionKey(facts.run.id) === acquisitionKey(selectedRunId)) : -1),
    [runs, selectedRunId],
  );

  useEffect(() => {
    const el = list.current;
    if (!el || selectedIndex < 0) return;
    const top = selectedIndex * ROW_PX;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_PX > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_PX - el.clientHeight;
  }, [selectedIndex]);

  const handleSort = useCallback((key: SortKey) => {
    setSort((old) =>
      old.key === key ? { key, descending: !old.descending } : { key, descending: key !== 'run' },
    );
  }, []);

  const move = (delta: number) => {
    if (runs.length === 0) return;
    const next = Math.max(0, Math.min(runs.length - 1, selectedIndex + delta));
    selectRun(runs[selectedIndex < 0 ? 0 : next].run.id);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const key = event.key;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (key === 'ArrowDown' || key === 'j') {
      handled();
      move(1);
    } else if (key === 'ArrowUp' || key === 'k') {
      handled();
      move(-1);
    } else if (key === 'Home') {
      handled();
      if (runs.length) selectRun(runs[0].run.id);
    } else if (key === 'End') {
      handled();
      if (runs.length) selectRun(runs[runs.length - 1].run.id);
    } else if (key === 'Enter' && selectedIndex >= 0) {
      handled();
      void openRunInViewer(runs[selectedIndex].run);
    } else if (key === ' ') {
      handled();
      requestAction('quick-look');
    }
  };

  const first = Math.max(0, Math.floor(view.top / ROW_PX) - OVERSCAN);
  const last = Math.min(runs.length, Math.ceil((view.top + view.height) / ROW_PX) + OVERSCAN);
  const chars = Math.max(24, Math.floor((view.width - FIXED_COLUMNS_PX) / RUN_CHAR_PX));

  const kind = showAll ? 'images' : 'BOLD runs';
  const noun = lens ? `${lens.label} ${kind}` : kind;
  const count = facet
    ? `${runs.length} of ${lensRuns.length} ${noun} · task ${facet.task}`
    : `${lensRuns.length} of ${showAll ? ofRuns : ofBold} ${kind}`;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="bids-runs-dock">
      <div className="flex h-[30px] shrink-0 items-center gap-3 border-b border-bf-border-subtle px-3 text-bf-xs text-bf-text-muted">
        <b className="font-medium text-bf-text-primary">{lens ? 'In lens' : showAll ? 'All images' : 'BOLD runs'}</b>
        <span data-testid="bids-runs-count">
          {count}
          {model.partial ? ' so far' : ''}
        </span>
        <select
          aria-label="Images shown"
          value={allImages ? 'all' : 'bold'}
          onChange={(event) => setAllImages(event.target.value === 'all')}
          className="h-5 rounded-bf-xs border border-bf-border bg-bf-bg-input text-bf-xs text-bf-text-secondary"
        >
          <option value="bold">BOLD runs</option>
          <option value="all">All images</option>
        </select>
        {tasks.length > 1 && (
          <select
            aria-label="Task"
            value={facet?.task ?? ''}
            onChange={(event) => setTask(event.target.value || null)}
            className="h-5 rounded-bf-xs border border-bf-border bg-bf-bg-input text-bf-xs text-bf-text-secondary"
          >
            <option value="">All tasks</option>
            {tasks.map((entry) => (
              <option key={entry.task} value={entry.task}>
                task {entry.task}
              </option>
            ))}
          </select>
        )}
      </div>
      <div
        role="row"
        className="grid h-6 shrink-0 items-center gap-x-2 border-b border-bf-border-subtle pl-2 pr-3 text-bf-2xs"
        style={{ gridTemplateColumns: GRID }}
      >
        <SortHeader label="run" column="run" sort={sort} onSort={handleSort} numeric={false} />
        <SortHeader label="TR s" column="tr" sort={sort} onSort={handleSort} />
        <SortHeader label="vols" column="volumes" sort={sort} onSort={handleSort} />
        <SortHeader label="FD mm" column="fd" sort={sort} onSort={handleSort} />
        <span />
        <SortHeader label="tSNR" column="tsnr" sort={sort} onSort={handleSort} />
        <span />
      </div>
      <div ref={frame} className="min-h-0 flex-1">
      <div
        ref={list}
        role="listbox"
        tabIndex={0}
        aria-label={lens ? 'Runs in lens' : kind}
        aria-activedescendant={selectedIndex >= 0 ? `bids-run-${runs[selectedIndex].run.id}` : undefined}
        data-testid="bids-runs-list"
        onKeyDown={handleKeyDown}
        onScroll={(event) => {
          const top = event.currentTarget.scrollTop;
          setView((old) => (old.top === top ? old : { ...old, top }));
        }}
        className="relative overflow-auto focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-bf-accent"
        // Whole rows: no half row at the bottom edge.
        style={{ height: Math.floor(view.height / ROW_PX) * ROW_PX, scrollSnapType: 'y proximity' }}
      >
        <div className="relative" style={{ height: runs.length * ROW_PX }}>
          {runs.slice(first, last).map((facts, offset) => (
            <RunRow
              key={facts.run.id}
              facts={facts}
              top={(first + offset) * ROW_PX}
              selected={facts.run.id === runs[selectedIndex]?.run.id}
              chars={chars}
              onSelect={selectRun}
            />
          ))}
        </div>
      </div>
      </div>
    </div>
  );
}
