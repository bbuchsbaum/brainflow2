/**
 * The label list: one SelectableRow per label (research, "The label list").
 * Swatch, id, name, voxel count, mm³, status, eye and lock. The selected row
 * is the active label: selected fill plus the amber left edge from the
 * primitive (the only amber in the list). Lock and eye are real toggles
 * (IconButton `pressed`); protection never depends on visibility.
 */

import React from 'react';
import clsx from 'clsx';
import { CircleDashed, Eye, EyeOff, Lock, LockOpen, SquareDashed } from 'lucide-react';
import { IconButton, SelectableRow, StatusPill } from '@/components/ui/bf';
import { Swatch } from './chrome';
import { fmtInt } from './geometry';
import type { LabelState } from './types';

export function LabelStatusPill({ status, compact }: { status: LabelState['status']; compact?: boolean }) {
  switch (status) {
    case 'complete':
      return <StatusPill status="success">{compact ? 'Done' : 'Complete'}</StatusPill>;
    case 'proposal':
      return (
        <StatusPill status="neutral" icon={<SquareDashed className="h-3 w-3" aria-hidden />} className="text-bf-text-primary">
          Proposal
        </StatusPill>
      );
    case 'in-progress':
      return (
        <StatusPill status="neutral" icon={<CircleDashed className="h-3 w-3" aria-hidden />}>
          {compact ? 'Open' : 'In progress'}
        </StatusPill>
      );
    default:
      return <StatusPill status="neutral">{compact ? '—' : 'Not started'}</StatusPill>;
  }
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
            <span className="whitespace-nowrap">{fmtInt(label.voxels)} vx</span>
            <span className="text-bf-text-faint">·</span>
            <span className="whitespace-nowrap">{fmtInt(label.mm3)} mm³</span>
            {note ? (
              <>
                <span className="text-bf-text-faint">·</span>
                <span className={clsx('truncate font-sans', alert && 'text-bf-warning')}>{note}</span>
              </>
            ) : null}
          </span>
        ) : null}
      </span>
      {showStatus ? (
        <span role="gridcell" className="flex shrink-0 items-center">
          <LabelStatusPill status={label.status} compact={compact} />
        </span>
      ) : null}
      <span role="gridcell" className="flex shrink-0 items-center">
        <IconButton
          aria-label={`${label.visible ? 'Hide' : 'Show'} ${label.name}`}
          icon={label.visible ? <Eye /> : <EyeOff />}
          tabIndex={-1}
          className={compact ? 'h-5 w-5' : undefined}
        />
        <IconButton
          aria-label={`${label.locked ? 'Unlock' : 'Lock'} ${label.name}`}
          title={label.lockReason}
          icon={label.locked ? <Lock /> : <LockOpen />}
          pressed={label.locked}
          tabIndex={-1}
          className={clsx(compact ? 'h-5 w-5' : undefined, alert && 'text-bf-warning shadow-[inset_0_-2px_0_var(--bf-warning)]')}
        />
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
        />
      ))}
    </div>
  );
}
