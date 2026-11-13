import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button, Chip, IconButton, StatusPill, type StatusKind } from '@/components/ui/bf';
import type {
  SpatialFieldSetSummary,
  StudioComparePaneSpec,
} from '@/types/studio';
import { paneReasonText } from './paneReasonText';
import { useStudioReadiness } from '@/hooks/useStudioReadiness';
import type { StudioReadinessPhase } from '@/services/studio/studioReadiness';
import { useStudioSourceFetchStore } from '@/stores/studioSourceFetchStore';
import './studio.css';

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
  onRecompute?: () => void;
  /** The pane was clicked (map, header or menu): it becomes the Inspector's artifact. */
  onSelect?: () => void;
  /** Open the pane's file in a new viewer tab. */
  onOpen?: () => void;
  /** Why the pane's file cannot be opened; null when it can. */
  openUnavailable?: string | null;
  onDrillToCohort?: () => void;
  /**
   * What the footer says of the pane's colour scale, when it is not the
   * map's own ("A and B share ±0.0145").
   */
  scaleNote?: string | null;
  /** Further entries of the pane's menu, after its own. */
  extraActions?: Array<{ label: string; onClick: () => void }>;
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
  onRecompute,
  onSelect,
  onOpen,
  openUnavailable = null,
  onDrillToCohort,
  scaleNote = null,
  extraActions,
  children,
}: StudioComparePaneProps) {
  const title = pane?.title ?? fallbackTitle;
  const subtitle = pane?.subtitle ?? fallbackSubtitle;
  const isDerived = pane?.binding?.kind === 'derived_field';
  // A pane that was waiting on the grid check reads the set's state live,
  // not from its spec: the spec is rebuilt only when the set becomes
  // comparable, so a check that lands "different grids" would otherwise
  // leave the badge on "Waiting" under text that says the set cannot be
  // averaged. Badge and text come from the same reading.
  const gridReadiness = useStudioReadiness('compare');
  const setLevel = pane?.notReady?.kind === 'grid-check' && gridReadiness.phase !== 'ready';
  // A remote set's images are fetched before anything is computed: until
  // they are here, a pane that is being computed is waiting for them.
  const fetching = useStudioSourceFetchStore(
    (state) => state.phase === 'checking' || state.phase === 'fetching',
  );
  const waitingOnFetch =
    fetching && letter !== 'A' && (isRefreshing || (isAnyLoading && !pane?.binding?.ready));
  const status = waitingOnFetch
    ? 'waiting'
    : paneStatus(
        pane,
        isRefreshing,
        // Pane A shows the member's own image: nothing is computed for it.
        isAnyLoading && letter !== 'A',
        setLevel ? gridReadiness.phase : null,
      );
  const waitingText = waitingOnFetch
    ? WAITING_FOR_IMAGES_TEXT
    : setLevel
      ? gridReadiness.short
      : (pane?.notReady?.message ?? null);
  // Each fact once per pane. The header names the subject (the member, the
  // group) and what the pane computes; the footer adds only what the header
  // does not say: the member's place in the set, or the group's size.
  const memberIndex =
    letter === 'A' && activeMemberId ? (activeSet?.memberIds ?? []).indexOf(activeMemberId) : -1;
  const sizeText =
    letter === 'A'
      ? memberIndex >= 0
        ? `Member ${memberIndex + 1} of ${activeSet?.memberIds.length ?? 0}`
        : null
      : cohortMemberCount != null
        ? `${cohortMemberCount} ${cohortMemberCount === 1 ? 'member' : 'members'}`
        : null;
  const normalization = parseRecipeField(pane?.recipe ?? null, 'norm');
  const threshold = parseRecipeField(pane?.recipe ?? null, 'threshold');
  // The header and chips clip in a narrow pane: everything is here.
  const provenanceTitle = [
    title,
    subtitle || null,
    sizeText,
    normalization ? `Normalization ${normalization}` : null,
    threshold ? `Threshold ${threshold}` : null,
    scaleNote,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <article
      aria-label={`${letter} ${title}`}
      aria-current={selected || undefined}
      onClickCapture={onSelect}
      className={`studio-compare-pane flex min-h-0 min-w-0 flex-col overflow-hidden rounded-sm border bg-card transition-shadow ${
        selected ? ACCENT_BORDER[accent] : 'border-border'
      }`}
    >
      {/* Header */}
      {/* One line, so four panes fit a 1372×887 window (QA N13 c). */}
      <header className="flex items-center justify-between gap-2 border-b border-border bg-card/80 px-2 py-1">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            aria-hidden
            className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-bf-xs font-semibold ${ACCENT_BADGE[accent]}`}
          >
            {letter}
          </span>
          {/* The title gives way last: the subtitle shrinks a thousand times
              faster, and leaves altogether in a narrow pane (studio.css). */}
          <div className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden" title={provenanceTitle}>
            <span
              className={`min-w-0 max-w-full truncate text-bf-md font-semibold [flex:0_1_auto] ${ACCENT_TEXT[accent]}`}
            >
              {title}
            </span>
            {subtitle ? (
              <span className="studio-pane-secondary min-w-0 truncate text-bf-xs text-muted-foreground [flex:0_1000_auto]">
                {subtitle}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <StatusBadge status={status} />
          <PaneActionsMenu
            isDerived={isDerived}
            isRefreshing={isRefreshing}
            openUnavailable={
              openUnavailable ?? (isRefreshing ? 'The map is being recomputed.' : null)
            }
            onRecompute={onRecompute}
            onOpen={onOpen}
            extraActions={extraActions}
          />
        </div>
      </header>

      {/* Body — host area for the renderer canvas (or skeleton/empty state) */}
      <div className="relative min-h-0 flex-1 bg-bf-bg-canvas">
        {/* The live body draws its own colorbar (a static chip sat on the
            viewer's lock button and showed no real scale; QA F44). */}
        {children ?? (
          <PaneSkeleton status={status} reason={pane?.reason ?? null} waiting={waitingText} />
        )}
      </div>

      {/* Footer: one line that never scrolls. Secondary chips leave first. */}
      <footer
        className="flex min-h-[1.75rem] flex-nowrap items-center gap-1.5 overflow-hidden border-t border-border bg-card/80 px-2 py-1 text-bf-xs text-muted-foreground"
        title={provenanceTitle}
      >
        {letter !== 'A' && cohortId && onDrillToCohort && sizeText ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={onDrillToCohort}
            aria-label={`Show the ${cohortMemberCount} members of ${cohortLabel ?? 'this group'}`}
            icon={<DrillIcon />}
            iconPosition="right"
            className="min-w-0 shrink tabular-nums"
          >
            <span className="truncate">{sizeText}</span>
          </Button>
        ) : sizeText ? (
          <span className="min-w-0 truncate tabular-nums">{sizeText}</span>
        ) : null}
        {scaleNote ? (
          <span data-testid="studio-pane-scale-note" className="min-w-0 truncate tabular-nums">
            {scaleNote}
          </span>
        ) : null}
        {normalization ? <FactChip label="Normalization" value={normalization} /> : null}
        {threshold ? <FactChip label="Threshold" value={threshold} /> : null}
      </footer>
    </article>
  );
}

function FactChip({ label, value }: { label: string; value: string }) {
  return (
    <Chip title={`${label} ${value}`} className="studio-pane-secondary min-w-0 shrink truncate">
      <span className="text-muted-foreground">{label}</span>{' '}
      <span className="text-foreground">{value}</span>
    </Chip>
  );
}

/** A pane whose computation is waiting for a remote set's images. */
export const WAITING_FOR_IMAGES_TEXT = 'Waiting for images…';

/**
 * `waiting`: an input is not available yet (grids unchecked or being
 * checked, images being fetched, no member, no group or comparison chosen).
 * `unavailable`: the set cannot provide it (different grids). Neither is a
 * failure; `failed` is a computation that was run and did not succeed.
 * `computing` is a first result on its way, `recomputing` a new one for a
 * pane that has one.
 *
 * There is no "out of date" here. A pane's inputs (member, group, comparison,
 * readiness) are the key the panes are recomputed on, so a change replaces
 * the result instead of leaving an old one on screen. The binding's
 * `cacheStatus` is not a freshness reading: it says how the result on screen
 * was obtained. `miss` is "computed now, nothing was cached" and `stale` is
 * "computed again because the cached copy was out of date"; both are results
 * of this request, as fresh as a cache `hit`.
 */
type PaneStatus =
  | 'ready'
  | 'recomputing'
  | 'computing'
  | 'failed'
  | 'pending'
  | 'waiting'
  | 'unavailable';

function paneStatus(
  pane: StudioComparePaneSpec | undefined,
  isRefreshing: boolean,
  isAnyLoading: boolean,
  /** The set's live readiness, for a pane that was waiting on its grid check. */
  setPhase: StudioReadinessPhase | null = null,
): PaneStatus {
  if (isRefreshing) return pane?.binding?.ready ? 'recomputing' : 'computing';
  if (!pane) return isAnyLoading ? 'computing' : 'pending';
  if (pane.notReady && setPhase) return setPhase === 'unavailable' ? 'unavailable' : 'waiting';
  if (pane.notReady)
    return pane.notReady.kind === 'different-grids' ||
      pane.notReady.kind === 'not-confirmed' ||
      pane.notReady.kind === 'no-mean'
      ? 'unavailable'
      : 'waiting';
  if (pane.status === 'blocked') return 'failed';
  if (pane.binding?.cacheStatus === 'failed') return 'failed';
  if (pane.binding?.ready) return 'ready';
  if (isAnyLoading || pane.status === 'pending') return 'computing';
  return 'pending';
}

const PANE_STATUS: Record<PaneStatus, { status: StatusKind; label: string }> = {
  ready: { status: 'success', label: 'Ready' },
  recomputing: { status: 'running', label: 'Recomputing' },
  computing: { status: 'running', label: 'Computing' },
  failed: { status: 'failed', label: 'Failed' },
  pending: { status: 'queued', label: 'Pending' },
  waiting: { status: 'queued', label: 'Waiting' },
  unavailable: { status: 'neutral', label: 'Unavailable' },
};

function StatusBadge({ status }: { status: PaneStatus }) {
  const { status: kind, label } = PANE_STATUS[status] ?? PANE_STATUS.pending;
  return (
    <StatusPill role="status" status={kind} title={label} data-pane-status={status}>
      <span className="studio-pane-status-word">{label}</span>
    </StatusPill>
  );
}

function PaneActionsMenu({
  isDerived,
  isRefreshing,
  openUnavailable,
  onRecompute,
  onOpen,
  extraActions,
}: {
  isDerived: boolean;
  isRefreshing: boolean;
  /** Why the file cannot be opened; null when it can. */
  openUnavailable: string | null;
  onRecompute?: () => void;
  onOpen?: () => void;
  extraActions?: Array<{ label: string; onClick: () => void }>;
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

  const items: Array<{ label: string; onClick: () => void; disabled?: boolean; title?: string }> =
    [];
  if (isDerived && onRecompute) {
    items.push({
      label: isRefreshing ? 'Recomputing…' : 'Recompute',
      onClick: onRecompute,
      disabled: isRefreshing,
    });
  }
  if (onOpen) {
    items.push({
      label: 'Open in viewer',
      onClick: onOpen,
      disabled: !!openUnavailable,
      title:
        openUnavailable ??
        (isDerived
          ? 'Open the derived map in a new viewer tab'
          : 'Open the source file in a new viewer tab'),
    });
  }
  if (extraActions) items.push(...extraActions);
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
              title={item.title}
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
  waiting,
}: {
  status: PaneStatus;
  reason: string | null;
  /** What the pane is waiting for, when an input is missing. */
  waiting: string | null;
}) {
  const message =
    status === 'recomputing'
      ? 'Recomputing…'
      : status === 'computing'
        ? 'Computing…'
        : status === 'waiting' || status === 'unavailable'
          ? (waiting ?? 'Nothing to show yet.')
          : status === 'failed'
            ? (paneReasonText(reason) ?? 'This map could not be computed.')
            : status === 'ready'
              ? 'Map ready.'
              : (paneReasonText(reason) ?? 'Nothing to show yet.');
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-bf-xs text-muted-foreground">
      {message}
    </div>
  );
}

function parseRecipeField(recipe: string | null, key: string): string | null {
  if (!recipe) return null;
  const match = new RegExp(`${key}\\s*[:=]\\s*([^,;|\\n]+)`, 'i').exec(recipe);
  return match ? match[1].trim() : null;
}
