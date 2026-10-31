/**
 * The label list: one SelectableRow per label (research, "The label list").
 * Swatch, id, name, volume (mm³ on a 1 mm grid, vx and mm³ otherwise), an
 * optional area-by-slice sparkline, a status glyph, eye and lock. The selected row
 * is the active label: selected fill plus the amber left edge from the
 * primitive (the only amber in the list). Lock and eye are real toggles
 * (IconButton `pressed`); protection never depends on visibility.
 */

import React from 'react';
import clsx from 'clsx';
import { Check, Circle, CircleDashed, Eye, EyeOff, Lock, LockOpen, SquareDashed } from 'lucide-react';
import { IconButton, SelectableRow } from '@/components/ui/bf';
import { Swatch } from './chrome';
import { fmtInt, formatVolume, type CountGrid } from './geometry';
import type { LabelState } from './types';

const STATUS_TEXT: Record<LabelState['status'], string> = {
  complete: 'Complete',
  proposal: 'Proposal pending',
  'in-progress': 'In progress',
  'not-started': 'Not started',
};

/**
 * Label status as an unboxed glyph (critique round 0: no boxed green chips
 * competing with the crosshair). The word is the tooltip and the accessible
 * name; `compact` callers get the same glyph.
 */
export function LabelStatusPill({ status }: { status: LabelState['status']; compact?: boolean }) {
  const icon =
    status === 'complete' ? (
      <Check className="h-3.5 w-3.5 text-bf-text-secondary" aria-hidden />
    ) : status === 'proposal' ? (
      <SquareDashed className="h-3.5 w-3.5 text-bf-text-primary" aria-hidden />
    ) : status === 'in-progress' ? (
      <CircleDashed className="h-3.5 w-3.5 text-bf-text-secondary" aria-hidden />
    ) : (
      <Circle className="h-2.5 w-2.5 text-bf-text-faint" aria-hidden />
    );
  return (
    <span className="inline-flex h-4 w-4 items-center justify-center" title={STATUS_TEXT[status]} data-status={status}>
      {icon}
      <span className="sr-only">{STATUS_TEXT[status]}</span>
    </span>
  );
}

export interface LabelRowProps {
  label: LabelState;
  active?: boolean;
  /** Hover-highlight (the label under the cursor). */
  hovered?: boolean;
  /** `full`: two lines with counts; `compact`: one line (overlay lists). */
  density?: 'full' | 'compact';
  /** Muted row (out of scope for the current protocol step). */
  muted?: boolean;
  /** Flash the lock (the label that just blocked a stroke). */
  alert?: boolean;
  showStatus?: boolean;
  /** Extra text on the second line (a lock reason). */
  note?: string;
  /** Grid the counts are on (default 1 mm isotropic). */
  grid?: CountGrid;
  /** A trailing graphic (the area-by-slice sparkline). */
  spark?: React.ReactNode;
  /** Read-only rows (review) hide the lock. */
  readOnly?: boolean;
  /** Show the eye toggle (default true; lean rows move visibility to the context menu). */
  showEye?: boolean;
}

export function LabelRow({
  label,
  active = false,
  hovered = false,
  density = 'full',
  muted = false,
  alert = false,
  showStatus = true,
  note,
  grid,
  spark,
  readOnly = false,
  showEye = true,
}: LabelRowProps) {
  const compact = density === 'compact';
  return (
    <SelectableRow
      role="row"
      selected={active}
      aria-label={`${label.name}, ${fmtInt(label.voxels)} voxels${label.locked ? ', locked' : ''}`}
      data-force-hover={hovered || undefined}
      data-label-id={label.id}
      className={clsx(compact ? 'min-h-6 gap-1.5' : 'min-h-9 gap-2', muted && 'opacity-55')}
      tabIndex={active ? 0 : -1}
    >
      <span role="gridcell" className="flex items-center">
        <Swatch color={label.color} size={compact ? 9 : 11} />
      </span>
      <span role="gridcell" className="flex min-w-0 flex-1 flex-col justify-center">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="w-4 shrink-0 text-right font-mono text-bf-2xs text-bf-text-faint">{label.id}</span>
          <span className={clsx('truncate', active ? 'font-medium text-bf-text-primary' : 'text-bf-text-primary')}>{label.name}</span>
          {compact ? (
            <span className="ml-auto shrink-0 font-mono text-bf-2xs tabular-nums text-bf-text-muted">{fmtInt(label.voxels)}</span>
          ) : null}
        </span>
        {!compact ? (
          <span className="flex min-w-0 items-baseline gap-1.5 pl-[22px] font-mono text-bf-2xs tabular-nums text-bf-text-muted">
            <span className="whitespace-nowrap">{formatVolume(label.voxels, grid)}</span>
            {note ? (
              <>
                <span className="text-bf-text-faint">·</span>
                <span className={clsx('truncate font-sans', alert && 'text-bf-warning')}>{note}</span>
              </>
            ) : null}
            {spark ? <span className="ml-auto flex shrink-0 items-center self-center font-sans">{spark}</span> : null}
          </span>
        ) : null}
      </span>
      {showStatus ? (
        <span role="gridcell" className="flex shrink-0 items-center">
          <LabelStatusPill status={label.status} compact={compact} />
        </span>
      ) : null}
      <span role="gridcell" className="flex shrink-0 items-center">
        {showEye ? (
          <IconButton
            aria-label={`${label.visible ? 'Hide' : 'Show'} ${label.name}`}
            icon={label.visible ? <Eye /> : <EyeOff />}
            tabIndex={-1}
            className={compact ? 'h-5 w-5' : undefined}
          />
        ) : null}
        {readOnly ? null : (
          <IconButton
            aria-label={`${label.locked ? 'Unlock' : 'Lock'} ${label.name}`}
            title={alert ? `${label.lockReason ?? 'Locked'}: refused the last stroke` : label.lockReason}
            icon={label.locked ? <Lock /> : <LockOpen />}
            pressed={label.locked}
            tabIndex={-1}
            className={clsx(compact ? 'h-5 w-5' : undefined, alert && 'text-bf-warning shadow-[inset_0_-2px_0_var(--bf-warning)]')}
          />
        )}
      </span>
    </SelectableRow>
  );
}

export interface LabelListProps {
  labels: readonly LabelState[];
  activeId: number;
  hoveredId?: number;
  density?: 'full' | 'compact';
  mutedIds?: readonly number[];
  alertId?: number;
  showStatus?: boolean;
  notes?: Partial<Record<number, string>>;
  grid?: CountGrid;
  renderSpark?: (label: LabelState) => React.ReactNode;
  readOnly?: boolean;
  showEye?: boolean;
  'aria-label'?: string;
  className?: string;
}

export function LabelList({
  labels,
  activeId,
  hoveredId,
  density = 'full',
  mutedIds = [],
  alertId,
  showStatus = true,
  notes = {},
  grid,
  renderSpark,
  readOnly,
  showEye,
  'aria-label': ariaLabel = 'Labels',
  className,
}: LabelListProps) {
  return (
    <div role="grid" aria-label={ariaLabel} className={clsx('flex flex-col', className)}>
      {labels.map((l) => (
        <LabelRow
          key={l.id}
          label={l}
          active={l.id === activeId}
          hovered={l.id === hoveredId}
          density={density}
          muted={mutedIds.includes(l.id)}
          alert={l.id === alertId}
          showStatus={showStatus}
          note={notes[l.id]}
          grid={grid}
          spark={renderSpark?.(l)}
          readOnly={readOnly}
          showEye={showEye}
        />
      ))}
    </div>
  );
}
