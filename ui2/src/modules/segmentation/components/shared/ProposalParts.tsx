/**
 * Proposal and review pieces (research contract 3 and "Review mode"):
 * a proposal names its target in the confirm button, lists its keyframes and
 * has its own undo, separate from document undo; review shows the two raters'
 * line styles, the disagreement count and next/previous navigation.
 */

import React from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Diamond, Undo2 } from 'lucide-react';
import { Button, IconButton, StatusPill } from '@/components/ui/bf';
import { SquareDashed } from 'lucide-react';
import { Kbd, LineSample, Swatch } from './chrome';
import { fmtInt, fmtMm } from './geometry';
import { KEYFRAMES, LABEL_BY_ID, PROPOSAL, REVIEW, labelColor } from './mockData';

export function ProposalPill() {
  return (
    <StatusPill status="neutral" icon={<SquareDashed className="h-3 w-3" aria-hidden />} className="text-bf-text-primary">
      Proposal
    </StatusPill>
  );
}

/** "Confirm CA1" + discard + proposal undo. */
export function ProposalActions({ layout = 'row', className }: { layout?: 'row' | 'stack'; className?: string }) {
  const name = LABEL_BY_ID.get(PROPOSAL.label)?.name ?? '';
  return (
    <div className={clsx('flex items-center gap-1.5', layout === 'stack' && 'flex-wrap', className)}>
      <Button variant="primary" icon={<Swatch color={labelColor(PROPOSAL.label)} size={8} />}>
        Confirm {name}
      </Button>
      <Button variant="secondary">Discard</Button>
      <IconButton
        aria-label={`Undo in proposal (${PROPOSAL.proposalUndo} steps)`}
        title="Undo inside the proposal; document undo is separate"
        icon={<Undo2 />}
        variant="ghost"
      />
    </div>
  );
}

/** What the proposal will do, in numbers. */
export function ProposalSummary({ className }: { className?: string }) {
  return (
    <div className={clsx('flex flex-col gap-0.5 font-mono text-bf-2xs tabular-nums text-bf-text-secondary', className)}>
      <span>
        +{fmtInt(PROPOSAL.addVoxels)} vx · {PROPOSAL.gapSlices} slices · {PROPOSAL.changedVoxels} relabelled
      </span>
      <span className="text-bf-text-muted">{PROPOSAL.protectedSkipped} vx skipped: locked labels protected</span>
    </div>
  );
}

/** Keyframes and gap slices of the fill-between proposal. */
export function KeyframeList({ currentY = -22, dense = false }: { currentY?: number; dense?: boolean }) {
  const [a, b] = KEYFRAMES;
  const rows: Array<{ y: number; kind: 'keyframe' | 'gap'; voxels?: number }> = [
    { y: b.y, kind: 'keyframe', voxels: b.voxels },
    ...Array.from({ length: PROPOSAL.gapSlices }, (_, i) => ({ y: b.y - 1 - i, kind: 'gap' as const })),
    { y: a.y, kind: 'keyframe', voxels: a.voxels },
  ];
  const shown = dense ? rows.filter((r) => r.kind === 'keyframe' || r.y === currentY) : rows;
  return (
    <ol className="flex flex-col" aria-label="Keyframes and proposed slices">
      {shown.map((r) => {
        const current = r.y === currentY;
        return (
          <li
            key={r.y}
            className={clsx(
              'flex h-5 items-center gap-2 px-2 font-mono text-bf-2xs tabular-nums',
              current ? 'bg-bf-bg-active text-bf-text-primary' : 'text-bf-text-secondary',
            )}
            aria-current={current ? 'location' : undefined}
          >
            {r.kind === 'keyframe' ? (
              <Diamond className="h-3 w-3 fill-current text-bf-text-primary" aria-hidden />
            ) : (
              <span aria-hidden className="inline-block h-2.5 w-2.5 border border-dashed border-bf-text-muted" />
            )}
            <span className="w-14">y {fmtMm(r.y)}</span>
            <span className="font-sans text-bf-text-muted">
              {r.kind === 'keyframe' ? `keyframe · ${r.voxels} vx` : current ? 'proposal · this slice' : 'proposal'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Rater legend: A solid, B dashed, disagreement hatch. */
export function ReviewLegend({ className, vertical }: { className?: string; vertical?: boolean }) {
  return (
    <div className={clsx('flex gap-x-4 gap-y-1 text-bf-xs text-bf-text-secondary', vertical ? 'flex-col' : 'flex-wrap items-center', className)}>
      <span className="flex items-center gap-1.5">
        <LineSample />
        {REVIEW.raterA}
      </span>
      <span className="flex items-center gap-1.5">
        <LineSample dashed />
        {REVIEW.raterB}
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-2.5 w-3.5 rounded-sm border border-bf-warning bg-bf-warning-soft" />
        Disagreement
      </span>
    </div>
  );
}

/** "Disagreement 3 of 14" with previous/next (N / Shift+N). */
export function DisagreementNav({ className, keys = true }: { className?: string; keys?: boolean }) {
  return (
    <div className={clsx('flex items-center gap-1', className)}>
      <IconButton aria-label="Previous disagreement" icon={<ChevronLeft />} variant="secondary" />
      <span className="px-1 text-bf-xs text-bf-text-secondary">
        Disagreement <span className="font-mono tabular-nums text-bf-text-primary">{REVIEW.current}</span> of{' '}
        <span className="font-mono tabular-nums text-bf-text-primary">{REVIEW.disagreements}</span>
      </span>
      <IconButton aria-label="Next disagreement" icon={<ChevronRight />} variant="secondary" />
      {keys ? (
        <span className="ml-1 flex items-center gap-1 text-bf-2xs text-bf-text-muted">
          <Kbd>N</Kbd>
        </span>
      ) : null}
    </div>
  );
}

export function ReviewDecision({ className }: { className?: string }) {
  return (
    <div className={clsx('flex items-center gap-1.5', className)}>
      <Button variant="primary">Approve</Button>
      <Button variant="secondary">Return to rater B</Button>
    </div>
  );
}

/** Per-label Dice between raters (a small table, summary only). */
export function DiceTable({ className }: { className?: string }) {
  return (
    <table className={clsx('w-full border-collapse text-bf-xs', className)}>
      <thead>
        <tr className="text-bf-2xs text-bf-text-muted">
          <th className="py-0.5 text-left font-normal">Label</th>
          <th className="py-0.5 text-right font-normal">Dice</th>
        </tr>
      </thead>
      <tbody>
        {REVIEW.dice.map((d) => {
          const def = LABEL_BY_ID.get(d.label)!;
          return (
            <tr key={d.label} className="text-bf-text-secondary">
              <td className="py-0.5">
                <span className="flex items-center gap-1.5">
                  <Swatch color={def.color} size={8} />
                  {def.name}
                </span>
              </td>
              <td className={clsx('py-0.5 text-right font-mono tabular-nums', d.dice < 0.7 && 'text-bf-warning')}>
                {d.dice.toFixed(2)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
