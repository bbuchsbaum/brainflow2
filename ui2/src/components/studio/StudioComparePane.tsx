import React, { useEffect, useRef, useState } from 'react';
import type {
  SpatialFieldSetSummary,
  StudioComparePaneSpec,
} from '@/types/studio';

export type ComparePaneLetter = 'A' | 'B' | 'C' | 'D';
export type ComparePaneAccent = 'sky' | 'emerald' | 'amber' | 'violet';

interface StudioComparePaneProps {
  letter: ComparePaneLetter;
  accent: ComparePaneAccent;
  pane: StudioComparePaneSpec | undefined;
  fallbackTitle: string;
  fallbackSubtitle: string;
  unitsLabel: string;
  selected: boolean;
  isRefreshing: boolean;
  isAnyLoading: boolean;
  cohortMemberCount: number | null;
  cohortLabel: string | null;
  cohortId: string | null;
  activeMemberId: string | null;
  activeSet: SpatialFieldSetSummary | null;
  onInspect?: () => void;
  onRecompute?: () => void;
  onOpen?: () => void;
  onDrillToCohort?: () => void;
  children?: React.ReactNode;
}

const ACCENT_TEXT: Record<ComparePaneAccent, string> = {
  sky: 'text-sky-700 dark:text-sky-200',
  emerald: 'text-emerald-700 dark:text-emerald-200',
  amber: 'text-amber-700 dark:text-amber-200',
  violet: 'text-violet-700 dark:text-violet-200',
};

const ACCENT_BORDER: Record<ComparePaneAccent, string> = {
  sky: 'border-sky-500/30',
  emerald: 'border-emerald-500/30',
  amber: 'border-amber-500/30',
  violet: 'border-violet-500/30',
};

const ACCENT_BADGE: Record<ComparePaneAccent, string> = {
  sky: 'bg-sky-500/15 text-sky-700 dark:text-sky-200',
  emerald: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-200',
  violet: 'bg-violet-500/15 text-violet-700 dark:text-violet-200',
};

export function StudioComparePane({
  letter,
  accent,
  pane,
  fallbackTitle,
  fallbackSubtitle,
  unitsLabel,
  selected,
  isRefreshing,
  isAnyLoading,
  cohortMemberCount,
  cohortLabel,
  cohortId,
  activeMemberId,
  activeSet,
  onInspect,
  onRecompute,
  onOpen,
  onDrillToCohort,
  children,
}: StudioComparePaneProps) {
  const title = pane?.title ?? fallbackTitle;
  const subtitle = pane?.subtitle ?? fallbackSubtitle;
  const status = paneStatus(pane, isRefreshing, isAnyLoading);
  const isDerived = pane?.binding?.kind === 'derived_field';
  const memberCountText =
    letter === 'A'
      ? activeMemberId ?? '—'
      : cohortMemberCount != null
        ? `n=${cohortMemberCount}`
        : pane?.binding?.kind === 'member_source'
          ? '1 member'
          : '—';
  const reducer = parseRecipeField(pane?.recipe ?? null, 'reducer') ?? defaultReducer(letter);
  const normalization = parseRecipeField(pane?.recipe ?? null, 'norm');
  const threshold = parseRecipeField(pane?.recipe ?? null, 'threshold');
  const supportLabel = activeSet?.supportLabel ?? null;

  return (
    <article
      aria-label={`${letter} ${title}`}
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-card transition-shadow ${
        selected ? `${ACCENT_BORDER[accent]} shadow-md` : 'border-border'
      }`}
    >
      {/* Header */}
      <header className="flex items-center justify-between gap-3 border-b border-border bg-card/80 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className={`inline-flex h-5 w-5 items-center justify-center rounded text-[11px] font-semibold ${ACCENT_BADGE[accent]}`}
          >
            {letter}
          </span>
          <div className="min-w-0">
            <div className={`truncate text-sm font-semibold ${ACCENT_TEXT[accent]}`}>{title}</div>
            <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <StatusBadge status={status} />
          <PaneActionsMenu
            isDerived={isDerived}
            isRefreshing={isRefreshing}
            canOpen={Boolean(pane?.binding?.ready) && !isRefreshing}
            onInspect={onInspect}
            onRecompute={onRecompute}
            onOpen={onOpen}
          />
        </div>
      </header>

      {/* Body — host area for the renderer canvas (or skeleton/empty state) */}
      <div className="relative min-h-0 flex-1 bg-black">
        {children ?? <PaneSkeleton status={status} reason={pane?.reason ?? null} />}
        <ColorbarChip label={unitsLabel} />
      </div>

      {/* Footer provenance chips */}
      <footer className="flex flex-wrap items-center gap-1.5 border-t border-border bg-card/80 px-3 py-2 text-[11px] text-muted-foreground">
        {letter !== 'A' && cohortId && onDrillToCohort ? (
          <button
            type="button"
            onClick={onDrillToCohort}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors hover:bg-accent hover:text-accent-foreground ${ACCENT_BORDER[accent]}`}
            aria-label={`Drill to ${cohortLabel ?? 'cohort'} members`}
          >
            <span className="tabular-nums" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {memberCountText}
            </span>
            <DrillIcon />
          </button>
        ) : (
          <span
            className="inline-flex items-center rounded-full border border-border bg-background/60 px-2 py-0.5 tabular-nums"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {memberCountText}
          </span>
        )}
        {reducer ? <Chip label="Reducer" value={reducer} /> : null}
        {normalization ? <Chip label="Norm" value={normalization} /> : null}
        {threshold ? <Chip label="Threshold" value={threshold} /> : null}
        {supportLabel ? <Chip label="Support" value={supportLabel} /> : null}
      </footer>
    </article>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background/60 px-2 py-0.5">
      <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground/80">
        {label}
      </span>
      <span className="text-foreground">{value}</span>
    </span>
  );
}

type PaneStatus = 'ready' | 'recomputing' | 'computing' | 'stale' | 'failed' | 'pending';

function paneStatus(
  pane: StudioComparePaneSpec | undefined,
  isRefreshing: boolean,
  isAnyLoading: boolean
): PaneStatus {
  if (isRefreshing) return 'recomputing';
  if (!pane) return 'pending';
  if (pane.status === 'blocked') return 'failed';
  if (pane.binding) {
    switch (pane.binding.cacheStatus) {
      case 'failed':
        return 'failed';
      case 'stale':
      case 'miss':
      case 'unavailable':
        return 'stale';
      case 'hit':
      case 'source':
      case 'forced':
      case 'synthetic':
        return 'ready';
    }
  }
  if (isAnyLoading || pane.status === 'pending') return 'computing';
  return 'pending';
}

function StatusBadge({ status }: { status: PaneStatus }) {
  const { className, glyph, label } = describeStatus(status);
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${className}`}
    >
      {glyph}
    </span>
  );
}

function describeStatus(status: PaneStatus): {
  className: string;
  glyph: string;
  label: string;
} {
  switch (status) {
    case 'ready':
      return {
        className: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
        glyph: '✓',
        label: 'Ready',
      };
    case 'recomputing':
      return {
        className: 'border-sky-500/40 bg-sky-500/15 text-sky-600 dark:text-sky-300',
        glyph: '↻',
        label: 'Recomputing',
      };
    case 'computing':
      return {
        className: 'border-sky-500/40 bg-sky-500/15 text-sky-600 dark:text-sky-300',
        glyph: '⏳',
        label: 'Computing',
      };
    case 'stale':
      return {
        className: 'border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-300',
        glyph: '⚠',
        label: 'Stale',
      };
    case 'failed':
      return {
        className: 'border-rose-500/40 bg-rose-500/15 text-rose-600 dark:text-rose-300',
        glyph: '!',
        label: 'Failed',
      };
    case 'pending':
    default:
      return {
        className: 'border-border bg-background text-muted-foreground',
        glyph: '·',
        label: 'Pending',
      };
  }
}

function PaneActionsMenu({
  isDerived,
  isRefreshing,
  canOpen,
  onInspect,
  onRecompute,
  onOpen,
}: {
  isDerived: boolean;
  isRefreshing: boolean;
  canOpen: boolean;
  onInspect?: () => void;
  onRecompute?: () => void;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const items: Array<{ label: string; onClick: () => void; disabled?: boolean }> = [];
  if (onInspect) {
    items.push({ label: 'Inspect', onClick: onInspect });
  }
  if (isDerived && onRecompute) {
    items.push({
      label: isRefreshing ? 'Recomputing…' : 'Recompute',
      onClick: onRecompute,
      disabled: isRefreshing,
    });
  }
  if (onOpen) {
    items.push({
      label: isDerived ? 'Open derived output' : 'Open source',
      onClick: onOpen,
      disabled: !canOpen,
    });
  }
  if (items.length === 0) return null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
        aria-label="More actions"
        onClick={() => setOpen((p) => !p)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      >
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden>
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-7 z-20 min-w-[180px] overflow-hidden rounded-md border border-border bg-card shadow-md"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                setOpen(false);
                item.onClick();
              }}
              className={`block w-full px-3 py-2 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground ${
                item.disabled ? 'cursor-not-allowed opacity-40' : ''
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DrillIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
    >
      <path d="M5 8h6M8 5l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ColorbarChip({ label }: { label: string }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border border-border bg-background/80 px-2 py-0.5 text-[10px] uppercase tracking-[0.06em] text-muted-foreground"
    >
      <span className="h-2 w-3 rounded-sm bg-gradient-to-r from-sky-600 via-slate-200 to-rose-500" />
      <span className="font-mono">{label}</span>
    </div>
  );
}

function PaneSkeleton({
  status,
  reason,
}: {
  status: PaneStatus;
  reason: string | null;
}) {
  const message =
    status === 'recomputing'
      ? 'Recomputing…'
      : status === 'computing'
        ? 'Computing…'
        : status === 'stale'
          ? 'Stale — recompute to refresh.'
          : status === 'failed'
            ? reason ?? 'Materialization failed.'
            : reason ?? 'No binding yet.';
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-muted-foreground">
      {message}
    </div>
  );
}

function defaultReducer(letter: ComparePaneLetter): string | null {
  switch (letter) {
    case 'B':
      return 'Mean';
    case 'C':
      return 'Current − Mean';
    case 'D':
      return '(Current − Mean) / σ';
    case 'A':
    default:
      return null;
  }
}

function parseRecipeField(recipe: string | null, key: string): string | null {
  if (!recipe) return null;
  const match = new RegExp(`${key}\\s*[:=]\\s*([^,;|\\n]+)`, 'i').exec(recipe);
  return match ? match[1].trim() : null;
}
