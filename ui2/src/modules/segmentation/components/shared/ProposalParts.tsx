/**
 * Proposal and review pieces (research contract 3 and "Review mode"):
 * a proposal names its target in the confirm button, lists its keyframes and
 * has its own undo, separate from document undo; review shows the two raters'
 * line styles, the disagreement count and next/previous navigation.
 */

import React from 'react';
import clsx from 'clsx';
import { Check, ChevronLeft, ChevronRight, Diamond, Undo2 } from 'lucide-react';
import {
  Button,
  IconButton,
  SegmentedControl,
  SelectableRow,
  StatusPill,
  TextArea,
} from '@/components/ui/bf';
import { SquareDashed } from 'lucide-react';
import { LineSample, Swatch } from './chrome';
import { canApprove, fmtInt, fmtMm } from './geometry';
import {
  DICE_THRESHOLD,
  DISAGREEMENTS,
  FLAG_MIN_VX,
  KEYFRAMES,
  LABEL_BY_ID,
  PROPOSAL,
  REVIEW,
  REVIEW_NAV,
  REVIEW_ROWS,
  labelColor,
} from './mockData';
import { Sparkline } from './Sparkline';

export function ProposalPill() {
  return (
    <StatusPill
      status="neutral"
      icon={<SquareDashed className="h-3 w-3" aria-hidden />}
      className="text-bf-text-primary"
    >
      Proposal
    </StatusPill>
  );
}

/** "Confirm CA1" + discard + proposal undo. */
export function ProposalActions({
  layout = 'row',
  className,
}: {
  layout?: 'row' | 'stack';
  className?: string;
}) {
  const name = LABEL_BY_ID.get(PROPOSAL.label)?.name ?? '';
  return (
    <div
      className={clsx('flex items-center gap-1.5', layout === 'stack' && 'flex-wrap', className)}
    >
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
    <div
      className={clsx(
        'flex flex-col gap-0.5 font-mono text-bf-2xs tabular-nums text-bf-text-secondary',
        className,
      )}
    >
      <span>
        +{fmtInt(PROPOSAL.addVoxels)} vx · {PROPOSAL.gapSlices} slices · {PROPOSAL.changedVoxels}{' '}
        relabelled
      </span>
      <span className="text-bf-text-muted">
        {PROPOSAL.protectedSkipped} vx skipped: locked labels protected
      </span>
    </div>
  );
}

/** Keyframes and gap slices of the fill-between proposal. */
export function KeyframeList({
  currentY = -22,
  dense = false,
}: {
  currentY?: number;
  dense?: boolean;
}) {
  const [a, b] = KEYFRAMES;
  const rows: Array<{ y: number; kind: 'keyframe' | 'gap'; voxels?: number }> = [
    { y: b.y, kind: 'keyframe', voxels: b.voxels },
    ...Array.from({ length: PROPOSAL.gapSlices }, (_, i) => ({
      y: b.y - 1 - i,
      kind: 'gap' as const,
    })),
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
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 border border-dashed border-bf-text-muted"
              />
            )}
            <span className="w-14">y {fmtMm(r.y)}</span>
            <span className="font-sans text-bf-text-muted">
              {r.kind === 'keyframe'
                ? `keyframe · ${r.voxels} vx`
                : current
                  ? 'proposal · this slice'
                  : 'proposal'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A small texture swatch matching the review overlay's achromatic textures:
 * A only as sparse dots, B only as dense hatching, relabelled crossed (form
 * and density differ, so they read apart at 4x).
 */
export function TextureSwatch({ kind }: { kind: 'a-only' | 'b-only' | 'relabelled' }) {
  return (
    <svg
      width={14}
      height={10}
      aria-hidden
      className="shrink-0 rounded-[1px] bg-bf-bg-canvas"
      data-texture={kind}
    >
      {kind === 'a-only' ? (
        [2, 7, 12].flatMap((x) =>
          [2.5, 7.5].map((y) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={1} className="fill-bf-text-primary" />
          )),
        )
      ) : kind === 'b-only' ? (
        <path
          d="M-2 4L4 -2M-2 8L8 -2M0 10L10 0M4 10L12 2M8 10L14 4M12 10L16 6"
          className="stroke-bf-text-primary"
          strokeWidth={1}
        />
      ) : (
        <path
          d="M-2 12L12 -2M4 16L16 4M-2 0L12 14M4 -4L16 8"
          className="stroke-bf-text-primary"
          strokeWidth={1.25}
        />
      )}
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
      <div
        className={clsx('flex gap-x-4 gap-y-1', vertical ? 'flex-col' : 'flex-wrap items-center')}
      >
        <span className="flex items-center gap-1.5">
          <LineSample color={labelColor(1)} />
          {REVIEW.raterA} · solid, label colour
        </span>
        <span className="flex items-center gap-1.5" data-rater="b">
          <LineSample dashed muted />
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

/** "Flagged 3 of 13 · 47 in all" with previous/next (N / Shift+N, in the tooltip). */
export function DisagreementNav({ className }: { className?: string; keys?: boolean }) {
  return (
    <div className={clsx('flex items-center gap-1', className)}>
      <IconButton
        aria-label="Previous disagreement"
        title="Previous flagged disagreement (⇧N)"
        icon={<ChevronLeft />}
        variant="secondary"
      />
      <span className="whitespace-nowrap px-1 text-bf-xs text-bf-text-secondary">
        Flagged{' '}
        <span className="font-mono tabular-nums text-bf-text-primary">
          {REVIEW_NAV.currentFlagged}
        </span>{' '}
        of <span className="font-mono tabular-nums text-bf-text-primary">{REVIEW_NAV.flagged}</span>
        <span className="text-bf-text-muted"> · {REVIEW_NAV.total} in all</span>
      </span>
      <IconButton
        aria-label="Next disagreement"
        title="Next flagged disagreement (N)"
        icon={<ChevronRight />}
        variant="secondary"
      />
    </div>
  );
}

/**
 * Return is the default; Approve stays disabled until every flagged
 * disagreement has been visited (`geometry.canApprove`; flagged = touches a
 * protocol landmark or at least `FLAG_MIN_VX` voxels).
 */
export function ReviewDecision({
  className,
  comment = true,
}: {
  className?: string;
  comment?: boolean;
}) {
  const approve = canApprove(REVIEW_NAV.visitedIds, REVIEW_NAV.flagged);
  const left = REVIEW_NAV.flagged - REVIEW_NAV.visited;
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
        <Button
          variant="secondary"
          disabled={!approve}
          title={approve ? undefined : `Visit every flagged disagreement first (${left} left)`}
        >
          Approve
        </Button>
        {!approve ? (
          <span className="text-bf-2xs text-bf-text-muted">
            {REVIEW_NAV.visited} of {REVIEW_NAV.flagged} flagged visited
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Disagreement regions, flagged first then by size; visited regions are ticked, the current one selected. */
export function DisagreementList({ limit = 7, className }: { limit?: number; className?: string }) {
  const shown = DISAGREEMENTS.slice(0, limit);
  const visited = new Set(REVIEW_NAV.visitedIds);
  return (
    <div className={clsx('flex flex-col', className)} data-testid="disagreement-list">
      <div className="flex items-baseline gap-2 px-3 pb-1 text-bf-2xs text-bf-text-muted">
        <span className="text-bf-xs text-bf-text-secondary">Disagreements</span>
        <span>flagged first: landmark or ≥ {FLAG_MIN_VX} vx</span>
      </div>
      <ol className="m-0 flex list-none flex-col p-0" aria-label="Disagreement regions">
        {shown.map((r) => {
          const def = LABEL_BY_ID.get(r.label)!;
          const current = r.id === REVIEW_NAV.current;
          return (
            <li
              key={r.id}
              aria-current={current ? 'true' : undefined}
              data-flagged={r.flagged || undefined}
            >
              <SelectableRow
                selected={current}
                tabIndex={current ? 0 : -1}
                className={clsx(
                  'min-h-6 gap-2 text-bf-xs',
                  current ? 'text-bf-text-primary' : 'text-bf-text-secondary',
                )}
              >
                <span className="w-3 shrink-0 text-center">
                  {visited.has(r.id) ? (
                    <Check className="h-3 w-3 text-bf-text-secondary" aria-label="visited" />
                  ) : null}
                </span>
                <span className="w-9 shrink-0 font-mono text-bf-2xs tabular-nums text-bf-text-muted">
                  k {r.k}
                </span>
                <Swatch color={def.color} size={8} />
                <span className="min-w-0 flex-1 truncate">
                  {def.name}
                  {r.landmark ? <span className="text-bf-text-muted"> · {r.landmark}</span> : null}
                </span>
                <span className="shrink-0 font-mono text-bf-2xs tabular-nums text-bf-text-muted">
                  {r.vx} vx
                </span>
                <span
                  className="w-2 shrink-0 text-bf-2xs text-bf-text-secondary"
                  title={r.flagged ? 'Flagged' : undefined}
                >
                  {r.flagged ? '▲' : ''}
                </span>
              </SelectableRow>
            </li>
          );
        })}
      </ol>
      <span className="px-3 pt-1 text-bf-2xs text-bf-text-muted">
        {DISAGREEMENTS.length - shown.length} more · ▲ flagged ({REVIEW_NAV.flagged}); Approve waits
        for these
      </span>
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
 * trace it), with Dice, volumes, signed Δ%, HD95 and disagreement by slice
 * as navigating per-slice bars. The flag threshold is stated. `inspector`
 * fits a 300 px column: A volume only, HD95 split in-plane / through-plane.
 */
export function DiceTable({
  className,
  columns = 'compact',
  voxelMm3 = 1,
  currentSlice,
}: {
  className?: string;
  /** `full` adds volumes and HD95 (a wide panel); `inspector` the narrow column. */
  columns?: 'compact' | 'full' | 'inspector';
  /** Volume of one voxel, mm³ (volumes are shown in mm³). */
  voxelMm3?: number;
  currentSlice?: number;
}) {
  const full = columns === 'full';
  const insp = columns === 'inspector';
  const th = clsx('whitespace-nowrap py-0.5 text-right font-normal', insp ? 'pr-1.5' : 'pr-2');
  const td = clsx(
    'whitespace-nowrap py-0.5 text-right font-mono tabular-nums',
    insp ? 'pr-1.5' : 'pr-2',
  );
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <table className="w-full border-collapse text-bf-xs">
        <thead>
          <tr className="text-bf-2xs text-bf-text-muted">
            <th className="py-0.5 text-left font-normal">Label</th>
            <th className={th}>Dice</th>
            {full || insp ? <th className={th}>A mm³</th> : null}
            {full ? <th className={th}>B mm³</th> : null}
            <th className={th}>Δ B−A</th>
            {full ? <th className={th}>HD95</th> : null}
            {insp ? (
              <th className={th} title="HD95 in mm: in-plane / through-plane">
                HD95
              </th>
            ) : null}
            <th className="py-0.5 text-left font-normal">
              {insp ? 'By slice' : 'Disagreement by slice'}
            </th>
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
                  className={clsx(
                    td,
                    flagged
                      ? 'text-bf-warning'
                      : d.dice === null
                        ? 'text-bf-text-muted'
                        : 'text-bf-text-primary',
                  )}
                  title={d.note}
                >
                  {d.dice === null ? 'n/a' : d.dice.toFixed(2)}
                  {flagged ? ' ▲' : ''}
                </td>
                {full || insp ? <td className={td}>{fmtInt(d.volA * voxelMm3)}</td> : null}
                {full ? (
                  <td className={td}>
                    {d.volB ? (
                      fmtInt(d.volB * voxelMm3)
                    ) : (
                      <span className="text-bf-text-muted">—</span>
                    )}
                  </td>
                ) : null}
                <td className={td}>
                  {d.volB ? fmtDelta(d.deltaPct) : <span className="text-bf-text-muted">n/a</span>}
                </td>
                {full ? (
                  <td className={td}>
                    {d.hd95 === null ? (
                      <span className="text-bf-text-muted">n/a</span>
                    ) : (
                      `${d.hd95.toFixed(1)}`
                    )}
                  </td>
                ) : null}
                {insp ? (
                  <td className={clsx(td, 'whitespace-nowrap')}>
                    {d.hd95InPlane === null || d.hd95Through === null ? (
                      <span className="text-bf-text-muted">n/a</span>
                    ) : (
                      `${d.hd95InPlane.toFixed(1)}/${d.hd95Through.toFixed(0)}`
                    )}
                  </td>
                ) : null}
                <td className="py-0.5">
                  {d.volB ? (
                    <Sparkline
                      values={d.bySlice}
                      current={currentSlice}
                      label={`${def.name} disagreement by slice`}
                      width={insp ? 60 : full ? 120 : 56}
                      height={14}
                      variant={insp ? 'bars' : 'line'}
                    />
                  ) : (
                    <span className="text-bf-2xs text-bf-text-muted">
                      {insp ? 'B: none' : d.note}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <span className="text-bf-2xs text-bf-text-muted">
        {insp
          ? `▲ Dice < ${DICE_THRESHOLD.toFixed(2)} · Δ = (B − A) / A · HD95 mm, in-plane / through-plane · ERC: not traced by B`
          : `▲ Dice below ${DICE_THRESHOLD.toFixed(2)} · Δ = (B − A) / A${full ? ' · HD95 in mm' : ''} · n/a: not traced by both raters`}
      </span>
    </div>
  );
}
