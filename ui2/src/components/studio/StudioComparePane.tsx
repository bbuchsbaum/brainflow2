import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button, Chip, IconButton, StatusPill, type StatusKind } from '@/components/ui/bf';
import type {
  SpatialFieldSetSummary,
  StudioComparePaneSpec,
} from '@/types/studio';
import { paneReasonText } from './paneReasonText';

export type ComparePaneLetter = 'A' | 'B' | 'C' | 'D';
export type ComparePaneAccent = 'sky' | 'emerald' | 'amber' | 'violet';

interface StudioComparePaneProps {
  letter: ComparePaneLetter;
  accent: ComparePaneAccent;
  pane: StudioComparePaneSpec | undefined;
  fallbackTitle: string;
  fallbackSubtitle: string;
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

// Pane identity is carried by the letter badge; chrome stays neutral so the
// amber accent remains reserved for selection and status colours for status.
const ACCENT_TEXT: Record<ComparePaneAccent, string> = {
  sky: 'text-foreground',
  emerald: 'text-foreground',
  amber: 'text-foreground',
  violet: 'text-foreground',
};

const ACCENT_BORDER: Record<ComparePaneAccent, string> = {
  sky: 'border-primary/60',
  emerald: 'border-primary/60',
  amber: 'border-primary/60',
  violet: 'border-primary/60',
};

const ACCENT_BADGE: Record<ComparePaneAccent, string> = {
  sky: 'bg-bf-bg-active text-foreground',
  emerald: 'bg-bf-bg-active text-foreground',
  amber: 'bg-bf-bg-active text-foreground',
  violet: 'bg-bf-bg-active text-foreground',
};

export function StudioComparePane({
  letter,
  accent,
  pane,
  fallbackTitle,
  fallbackSubtitle,
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
  const provenanceTitle = [
    memberCountText,
    reducer ? `Reducer ${reducer}` : null,
    normalization ? `Norm ${normalization}` : null,
    threshold ? `Threshold ${threshold}` : null,
    supportLabel ? `Support ${supportLabel}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <article
      aria-label={`${letter} ${title}`}
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-sm border bg-card transition-shadow ${
        selected ? ACCENT_BORDER[accent] : 'border-border'
      }`}
    >
      {/* Header */}
      {/* One line, so four panes fit a 1372×887 window (QA N13 c). */}
      <header className="flex items-center justify-between gap-2 border-b border-border bg-card/80 px-2 py-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className={`inline-flex h-5 w-5 items-center justify-center rounded-sm text-bf-xs font-semibold ${ACCENT_BADGE[accent]}`}
          >
            {letter}
          </span>
          <div className="flex min-w-0 items-baseline gap-2 overflow-hidden" title={`${title} · ${subtitle}`}>
            <span className={`min-w-0 max-w-full truncate text-bf-md font-semibold ${ACCENT_TEXT[accent]}`}>{title}</span>
            <span className="min-w-0 truncate text-bf-xs text-muted-foreground">{subtitle}</span>
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
      <div className="relative min-h-0 flex-1 bg-bf-bg-canvas">
        {/* The live body draws its own colorbar (a static chip sat on the
            viewer's lock button and showed no real scale; QA F44). */}
        {children ?? <PaneSkeleton status={status} reason={pane?.reason ?? null} />}
      </div>

      {/* Footer provenance chips */}
      <footer
        className="flex flex-nowrap items-center gap-1.5 overflow-hidden border-t border-border bg-card/80 px-2 py-1 text-bf-xs text-muted-foreground"
        // The chips clip in a narrow pane: the full provenance is here.
        title={provenanceTitle}
      >
        {letter !== 'A' && cohortId && onDrillToCohort ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={onDrillToCohort}
            aria-label={`Drill to ${cohortLabel ?? 'cohort'} members`}
            icon={<DrillIcon />}
            iconPosition="right"
            className="font-mono tabular-nums"
          >
            {memberCountText}
          </Button>
        ) : (
          <Chip mono>{memberCountText}</Chip>
        )}
        {reducer ? <FactChip label="Reducer" value={reducer} /> : null}
        {normalization ? <FactChip label="Norm" value={normalization} /> : null}
        {threshold ? <FactChip label="Threshold" value={threshold} /> : null}
        {supportLabel ? <FactChip label="Support" value={supportLabel} shrink /> : null}
      </footer>
    </article>
  );
}

function FactChip({ label, value, shrink = false }: { label: string; value: string; shrink?: boolean }) {
  // The last chip (Support) truncates rather than clip at the pane edge.
  return (
    <Chip title={`${label} ${value}`} className={shrink ? 'min-w-0 shrink truncate' : 'shrink-0'}>
      <span className="text-muted-foreground">{label}</span>{' '}
      <span className="text-foreground">{value}</span>
    </Chip>
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

const PANE_STATUS: Record<PaneStatus, { status: StatusKind; label: string }> = {
  ready: { status: 'success', label: 'Ready' },
  recomputing: { status: 'running', label: 'Recomputing' },
  computing: { status: 'running', label: 'Computing' },
  stale: { status: 'warning', label: 'Stale' },
  failed: { status: 'failed', label: 'Failed' },
  pending: { status: 'queued', label: 'Pending' },
};

function StatusBadge({ status }: { status: PaneStatus }) {
  const { status: kind, label } = PANE_STATUS[status] ?? PANE_STATUS.pending;
  return (
    <StatusPill role="status" status={kind}>
      {label}
    </StatusPill>
  );
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
      <IconButton
        size="xs"
        variant="secondary"
        icon={<MoreHorizontal />}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
        aria-label="More actions"
        onClick={() => setOpen((p) => !p)}
      />
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-7 z-20 min-w-[180px] overflow-hidden rounded-sm border border-border bg-card shadow-md"
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
              className={`block w-full px-3 py-2 text-left text-bf-sm transition-colors hover:bg-accent hover:text-accent-foreground ${
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
            ? paneReasonText(reason) ?? 'Materialization failed.'
            : status === 'ready'
              ? 'Map ready.'
              : paneReasonText(reason) ?? 'No binding yet.';
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-bf-xs text-muted-foreground">
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
