/**
 * Proposal and review pieces (research contract 3 and "Review mode"):
 * a proposal names its target in the confirm button, lists its keyframes and
 * has its own undo, separate from document undo; review shows the two raters'
 * line styles, the disagreement count and next/previous navigation.
 */

import React from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Diamond, Undo2 } from 'lucide-react';
import { Button, IconButton, SegmentedControl, StatusPill, TextArea } from '@/components/ui/bf';
import { SquareDashed } from 'lucide-react';
import { LineSample, Swatch } from './chrome';
import { canApprove, fmtInt, fmtMm } from './geometry';
import { DICE_THRESHOLD, KEYFRAMES, LABEL_BY_ID, PROPOSAL, REVIEW, REVIEW_NAV, REVIEW_ROWS, labelColor } from './mockData';
import { Sparkline } from './Sparkline';

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

/** A small texture swatch matching the review overlay's achromatic textures. */
export function TextureSwatch({ kind }: { kind: 'a-only' | 'b-only' | 'relabelled' }) {
  const d =
    kind === 'a-only' ? 'M-2 12L12 -2M4 16L16 4M-6 8L8 -6' : kind === 'b-only' ? 'M-2 0L12 14M4 -4L16 8M-6 4L8 18' : 'M-2 12L12 -2M4 16L16 4M-2 0L12 14M4 -4L16 8';
  return (
    <svg width={14} height={10} aria-hidden className="shrink-0 rounded-[1px] bg-bf-bg-canvas">
      <path d={d} className="stroke-bf-text-primary" strokeWidth={1.25} />
    </svg>
  );
}

/** Rater legend: A solid in label colour, B only where it departs (neutral dash), three achromatic textures. */
export function ReviewLegend({
  className,
  vertical,
  toggle = false,
}: {
  className?: string;
  vertical?: boolean;
  /** Show the A / B / both toggle (key A, B or Shift+B in the tooltip). */
  toggle?: boolean;
}) {
  return (
    <div className={clsx('flex flex-col gap-1.5 text-bf-xs text-bf-text-secondary', className)}>
      {toggle ? (
        <SegmentedControl
          aria-label="Raters shown"
          size="sm"
          value="both"
          onValueChange={() => undefined}
          options={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
            { value: 'both', label: 'Both' },
          ]}
          className="self-start"
          title="Show rater A, rater B or both (A / B / ⇧B)"
        />
      ) : null}
      <div className={clsx('flex gap-x-4 gap-y-1', vertical ? 'flex-col' : 'flex-wrap items-center')}>
        <span className="flex items-center gap-1.5">
          <LineSample color={labelColor(1)} />
          {REVIEW.raterA} · solid, label colour
        </span>
        <span className="flex items-center gap-1.5">
          <LineSample dashed />
          {REVIEW.raterB}, only where it departs
        </span>
        <span className="flex items-center gap-1.5">
          <TextureSwatch kind="a-only" />A only
          <TextureSwatch kind="b-only" />B only
          <TextureSwatch kind="relabelled" />
          relabelled
        </span>
      </div>
    </div>
  );
}

/** "Disagreement 3 of 48 · 3 visited" with previous/next (N / Shift+N, in the tooltip). */
export function DisagreementNav({ className }: { className?: string; keys?: boolean }) {
  return (
    <div className={clsx('flex items-center gap-1', className)}>
      <IconButton aria-label="Previous disagreement" title="Previous disagreement (⇧N)" icon={<ChevronLeft />} variant="secondary" />
      <span className="whitespace-nowrap px-1 text-bf-xs text-bf-text-secondary">
        Disagreement <span className="font-mono tabular-nums text-bf-text-primary">{REVIEW_NAV.current}</span> of{' '}
        <span className="font-mono tabular-nums text-bf-text-primary">{REVIEW_NAV.total}</span>
      </span>
      <IconButton aria-label="Next disagreement" title="Next disagreement (N)" icon={<ChevronRight />} variant="secondary" />
    </div>
  );
}

/**
 * Return is the default; Approve stays disabled until every disagreement has
 * been visited (`geometry.canApprove`).
 */
export function ReviewDecision({ className, comment = true }: { className?: string; comment?: boolean }) {
  const approve = canApprove(Array.from({ length: REVIEW_NAV.visited }, (_, i) => i), REVIEW_NAV.total);
  const left = REVIEW_NAV.total - REVIEW_NAV.visited;
  return (
    <div className={clsx('flex flex-col gap-2', className)} data-testid="review-decision">
      {comment ? (
        <TextArea
          aria-label="Comment for rater B"
          rows={2}
          defaultValue="Subiculum medial border stops short of the SRLM tip (rule 2); see pin 1."
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="primary">Return to rater B</Button>
        <Button variant="secondary" disabled={!approve} title={approve ? undefined : `Visit every disagreement first (${left} left)`}>
          Approve
        </Button>
        {!approve ? (
          <span className="text-bf-2xs text-bf-text-muted">
            {REVIEW_NAV.visited} of {REVIEW_NAV.total} visited
          </span>
        ) : null}
      </div>
    </div>
  );
}

function fmtDelta(v: number | null): string {
  if (v === null) return 'n/a';
  const s = `${Math.abs(v).toFixed(0)}%`;
  return v > 0.5 ? `+${s}` : v < -0.5 ? `−${s}` : '0%';
}

/**
 * Agreement per label: every label is listed (n/a where a rater did not
 * trace it), with Dice, both volumes, signed Δ%, HD95 and disagreement by
 * slice as a navigating sparkline. The flag threshold is stated.
 */
export function DiceTable({
  className,
  columns = 'compact',
  voxelMm3 = 1,
  currentSlice,
}: {
  className?: string;
  /** `full` adds volumes and HD95 (a wide panel). */
  columns?: 'compact' | 'full';
  /** Volume of one voxel, mm³ (volumes are shown in mm³). */
  voxelMm3?: number;
  currentSlice?: number;
}) {
  const full = columns === 'full';
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <table className="w-full border-collapse text-bf-xs">
        <thead>
          <tr className="text-bf-2xs text-bf-text-muted">
            <th className="py-0.5 text-left font-normal">Label</th>
            <th className="py-0.5 pr-2 text-right font-normal">Dice</th>
            {full ? <th className="py-0.5 pr-2 text-right font-normal">A mm³</th> : null}
            {full ? <th className="py-0.5 pr-2 text-right font-normal">B mm³</th> : null}
            <th className="py-0.5 pr-2 text-right font-normal">Δ B−A</th>
            {full ? <th className="py-0.5 pr-2 text-right font-normal">HD95</th> : null}
            <th className="py-0.5 text-left font-normal">Disagreement by slice</th>
          </tr>
        </thead>
        <tbody>
          {REVIEW_ROWS.map((d) => {
            const def = LABEL_BY_ID.get(d.label)!;
            const flagged = d.dice !== null && d.dice < DICE_THRESHOLD;
            return (
              <tr key={d.label} className="text-bf-text-secondary">
                <td className="py-0.5">
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    <Swatch color={def.color} size={8} />
                    {def.name}
                  </span>
                </td>
                <td
                  className={clsx('py-0.5 pr-2 text-right font-mono tabular-nums', flagged ? 'text-bf-warning' : d.dice === null ? 'text-bf-text-muted' : 'text-bf-text-primary')}
                  title={d.note}
                >
                  {d.dice === null ? 'n/a' : d.dice.toFixed(2)}
                  {flagged ? ' ▲' : ''}
                </td>
                {full ? <td className="py-0.5 pr-2 text-right font-mono tabular-nums">{fmtInt(d.volA * voxelMm3)}</td> : null}
                {full ? (
                  <td className="py-0.5 pr-2 text-right font-mono tabular-nums">{d.volB ? fmtInt(d.volB * voxelMm3) : <span className="text-bf-text-muted">—</span>}</td>
                ) : null}
                <td className="py-0.5 pr-2 text-right font-mono tabular-nums">{d.volB ? fmtDelta(d.deltaPct) : <span className="text-bf-text-muted">n/a</span>}</td>
                {full ? (
                  <td className="py-0.5 pr-2 text-right font-mono tabular-nums">{d.hd95 === null ? <span className="text-bf-text-muted">n/a</span> : `${d.hd95.toFixed(1)}`}</td>
                ) : null}
                <td className="py-0.5">
                  {d.volB ? (
                    <Sparkline values={d.bySlice} current={currentSlice} label={`${def.name} disagreement by slice`} width={full ? 120 : 56} height={14} />
                  ) : (
                    <span className="text-bf-2xs text-bf-text-muted">{d.note}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <span className="text-bf-2xs text-bf-text-muted">
        ▲ Dice below {DICE_THRESHOLD.toFixed(2)} · Δ = (B − A) / A{full ? ' · HD95 in mm' : ''} · n/a: not traced by both raters
      </span>
    </div>
  );
}
