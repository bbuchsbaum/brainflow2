/**
 * Round 5: white-matter lesions on FLAIR (state `lesion`). A different rhythm
 * from subfield tracing: many small objects of one label, found and checked
 * one by one, on an isotropic axial grid.
 *
 * - The brush carries an intensity range on FLAIR (a constraint of the gate,
 *   shown in the strip like "over unlocked"), and the lesion protocol's
 *   partial-volume rule replaces "voxel centre inside": a voxel is written
 *   when it is in range and more than half of it is inside the disc. The
 *   preview is exactly that set; touched in-range voxels that are half or
 *   less inside get a small hollow square ("left out, < 50%").
 * - The Inspector's label list becomes a lesion list: one row per 3D
 *   connected lesion (volume, slice span, location, reviewed), with next and
 *   previous lesion; the current lesion is the active one in the image, the
 *   reviewed ones quiet, the rest inactive, all in the one WMH colour.
 * - The slice ruler runs in axial k: a solid bar where every lesion on the
 *   slice is reviewed, a hollow one where one is not, the current lesion's
 *   span bracketed.
 *
 * The FLAIR is a MOCK made from the T1w template; the lesions are synthetic.
 */

import React from 'react';
import clsx from 'clsx';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, IconButton, SelectableRow } from '@/components/ui/bf';
import { SliceView, type Overlay, type Projector } from '@/modules/segmentation/components/shared/SliceView';
import { StatusItem, Swatch, ViewportFrame } from '@/modules/segmentation/components/shared/chrome';
import { bboxOf, fmtInt, fmtMm } from '@/modules/segmentation/components/shared/geometry';
import { LABEL_BY_ID, WMH } from '@/modules/segmentation/components/shared/mockData';
import { zoomFactor } from '@/modules/segmentation/components/shared/views';
import { PARTIAL_VOLUME_RULE } from '@/modules/segmentation/components/shared/workflowRules';
import type { Point, Voxel } from '@/modules/segmentation/components/shared/types';
import { LESION, lesionsOnK, type Lesion } from '@/modules/segmentation/__design__/lesionData';
import { HShell, InspectorFrame, SessionHeader, Sep, StripItem, TextToggle, ToolRail } from '@/modules/segmentation/components/directions/h/DirectionH';
import { PrimaryPanel, StateChip, TraceGrid } from './parts';
import { LESION_SCENE, RANGE } from './workflowData';

const WMH_DEF = LABEL_BY_ID.get(WMH)!;
/** Field of view of the primary (mm): the current lesion with its ventricle, voxels large enough for the partial-volume marks. */
const PRIMARY_FOV = 52;
const [, NY, NZ] = LESION.grid.dims;
const ORIGIN = LESION.grid.origin;
const CUR = LESION.rows.find((r) => r.id === LESION.current)!;

export const LESION_DISCLOSURE = 'Design mock · editing simulated · FLAIR is a mock made from the MNI152 T1w template · lesions synthetic';

/** Display (axial) to world mm. */
const worldOfAx = (c: number, r: number): [number, number, number] => [c + ORIGIN[0], NY - 1 - r + ORIGIN[1], LESION.k + ORIGIN[2]];

const LOCATION_SHORT: Record<Lesion['location'], string> = { periventricular: 'PV', deep: 'deep', juxtacortical: 'JC' };

/** Where a lesion sits: "L posterior". */
function whereOf(l: Lesion): string {
  const y = l.centre[1] + ORIGIN[1];
  const part = y < -30 ? 'posterior' : y > 10 ? 'anterior' : 'central';
  return `${l.side} ${part}`;
}

/** Lesion labels: each lesion its own partition, the current one active, reviewed ones quiet. */
function lesionOverlays(byLesion: ReadonlyArray<{ id: number; voxels: ReadonlyArray<readonly [number, number, number]> }>, ortho = false): Overlay[] {
  return byLesion
    .filter((l) => l.voxels.length)
    .map((l) => {
      const row = LESION.rows.find((r) => r.id === l.id)!;
      const current = l.id === LESION.current;
      if (ortho) {
        return { kind: 'labels', voxels: l.voxels, fill: current, active: current ? [WMH] : [], quiet: current ? [] : [WMH], gaps: false } as Overlay;
      }
      return {
        kind: 'labels',
        voxels: l.voxels,
        fill: false,
        active: current ? [WMH] : [],
        quiet: row.reviewed ? [WMH] : [],
        fillActive: current ? [WMH] : undefined,
        gaps: false,
      } as Overlay;
    });
}

/** Small hollow squares: in-range voxels the disc touches but covers by half or less (left out). */
function partialPath(vs: readonly Voxel[]): string {
  return vs.map(([c, r]) => `M${c + 0.3} ${r + 0.3}h0.4v0.4h-0.4Z`).join('');
}

function LesionTags({ p }: { p: Projector }) {
  return (
    <>
      {LESION_SCENE.byLesion.map((l) => {
        const all = LESION.labels.ax.filter((v) => v[2] === l.id);
        if (!all.length) return null;
        // Beside the lesion's topmost voxel, outside it.
        const top = [...all].sort((a, b) => a[1] - b[1] || b[0] - a[0])[0];
        const at = p.project([top[0] + 1.4, top[1] + 0.2]);
        if (at.x < 0 || at.y < 0 || at.x > p.width - 20 || at.y > p.height - 10) return null;
        const current = l.id === LESION.current;
        return (
          <span
            key={l.id}
            className={clsx(
              'pointer-events-none absolute whitespace-nowrap rounded-sm bg-bf-bg-canvas/80 px-1 font-mono text-bf-2xs leading-4',
              current ? 'text-bf-text-primary' : 'text-bf-text-secondary',
            )}
            style={{ left: at.x, top: at.y - 16 }}
            data-testid="lesion-tag"
          >
            L{l.id}
          </span>
        );
      })}
    </>
  );
}

function LesionTitle() {
  const [, , z] = worldOfAx(0, 0);
  return (
    <span className="flex min-w-0 items-baseline gap-2 whitespace-nowrap text-bf-xs" data-testid="primary-geometry" title={`Axial grid slice k ${LESION.k}, z ${fmtMm(z)} mm`}>
      <span className="text-bf-text-primary">Axial</span>
      <span className="font-mono text-bf-text-primary">
        k {LESION.k}/{LESION.grid.dims[2]}
      </span>
      <span className="font-mono text-bf-text-secondary">z {fmtMm(z)}</span>
      <span className="text-bf-text-secondary">
        FLAIR <span className="text-bf-text-muted">(mock)</span>
        <span className="font-mono text-bf-text-muted"> · 1.0 mm iso</span>
      </span>
    </span>
  );
}

/** Header line 2: the brush with its range and the partial-volume rule; the inline key for the hollow square. */
function RangeStrip() {
  return (
    <>
      <span className="flex min-w-0 items-center gap-0.5" data-testid="constraint-strip">
        <StripItem title="Active label (one label for every lesion; each connected lesion is a row in the list)">
          <Swatch color={WMH_DEF.color} size={8} />
          <span className="text-bf-text-primary">WMH</span>
        </StripItem>
        <Sep />
        <StripItem title="Paint over: background only (lesions never take another label's voxels)">over background</StripItem>
        <Sep />
        <StripItem title={`Intensity range on FLAIR: only voxels from ${RANGE.lo} to ${RANGE.hi} are written (click for the histogram)`}>
          <span data-testid="range-readout">range FLAIR {RANGE.lo}–{RANGE.hi}</span>
        </StripItem>
        <Sep />
        <StripItem title="2D disc on this axial slice">2D</StripItem>
        <Sep />
        <StripItem title="Brush diameter on the 1.0 mm FLAIR grid">⌀ {(RANGE.radiusMm * 2).toFixed(1)} mm</StripItem>
        <Sep />
        <StripItem title={`The lesion protocol's partial-volume rule: a voxel is written when more than ${PARTIAL_VOLUME_RULE * 100}% of it is inside (not its centre)`}>
          <span data-testid="pv-rule">&gt; 50% inside</span>
        </StripItem>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap text-bf-2xs text-bf-text-muted" data-testid="pv-key">
        <svg width={9} height={9} aria-hidden>
          <rect x={2} y={2} width={5} height={5} fill="none" className="stroke-bf-text-primary" strokeWidth={1} />
        </svg>
        in range, ≤ 50% inside: left out
      </span>
    </>
  );
}

/** The axial ruler: lesion status per slice (solid all reviewed, hollow one to review), the current lesion's span bracketed. */
function LesionRuler() {
  const ks = Array.from({ length: 30 }, (_, i) => 113 - i);
  const n = ks.length;
  const top = ks.indexOf(CUR.k[1]);
  const len = CUR.k[1] - CUR.k[0] + 1;
  return (
    <div className="flex w-[80px] shrink-0 flex-col border-l border-bf-border-subtle bg-bf-bg-panel-sunken py-1" aria-label="Slice ruler, axial k" data-testid="lesion-ruler" title="Axial slices, superior at the top. Solid: every lesion on the slice reviewed · hollow: a lesion to review · hairline: no lesion. N / ⇧N: next and previous lesion.">
      <span className="w-[20px] text-right font-mono text-bf-2xs text-bf-text-muted">S</span>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {ks.map((k) => {
          const on = lesionsOnK(k);
          const mark = on.length === 0 ? 'none' : on.every((l) => l.reviewed) ? 'solid' : 'open';
          const current = k === LESION.k;
          return (
            <div key={k} className={clsx('relative flex min-h-0 flex-1 items-center', current && 'bg-bf-bg-active')} title={`k ${k} · ${on.length ? on.map((l) => `L${l.id}${l.reviewed ? ' reviewed' : ''}`).join(', ') : 'no lesion'}`} data-status={mark}>
              {current ? <span className="absolute left-0 top-1/2 h-0 w-0 -translate-y-1/2 border-y-[3px] border-l-[4px] border-y-transparent border-l-bf-text-primary" aria-hidden /> : null}
              <span className={clsx('w-[20px] pr-0.5 text-right font-mono text-bf-2xs leading-none', current ? 'text-bf-text-primary' : 'text-bf-text-muted')}>
                {current || k % 10 === 0 ? k : ''}
              </span>
              <span className="flex w-[18px] items-center justify-center" data-mark={mark}>
                {mark === 'none' ? (
                  <span className="block h-px w-1.5 bg-bf-text-faint" />
                ) : mark === 'solid' ? (
                  <span className="block h-[3px] w-3.5 bg-bf-text-secondary" data-shape="bar" />
                ) : (
                  <span className="block h-[4px] w-3.5 border border-bf-text-secondary" data-shape="hollow-bar" />
                )}
              </span>
            </div>
          );
        })}
        <span
          className="pointer-events-none absolute left-[38px] flex items-center gap-[3px]"
          style={{ top: `${(top / n) * 100}%`, height: `${(len / n) * 100}%` }}
          aria-hidden
          data-ruler-caption="L1"
        >
          <span className="h-[calc(100%-6px)] w-[3px] border-y border-r border-bf-text-muted" />
          <span className="whitespace-nowrap bg-bf-bg-panel-sunken px-px font-mono text-bf-2xs leading-none text-bf-text-secondary">L{CUR.id}</span>
        </span>
      </div>
      <span className="w-[20px] text-right font-mono text-bf-2xs text-bf-text-muted">I</span>
    </div>
  );
}

function LesionOrtho({ plane }: { plane: 'cor' | 'sag' }) {
  const image = LESION.images[plane];
  const cur = LESION.components[LESION.current - 1];
  // Display coords of the current lesion's centre in this view.
  const [ci, cj, ck] = CUR.centre;
  const centre: Point = plane === 'cor' ? [ci + 0.5, NZ - 1 - ck + 0.5] : [NY - 1 - cj + 0.5, NZ - 1 - ck + 0.5];
  const row = NZ - 1 - LESION.k + 0.5;
  const voxels = (plane === 'cor' ? LESION.labels.cor : LESION.labels.sag).map(([c, r, id]) => [c, r, id] as const);
  const byLesion = LESION.rows.map((r) => ({ id: r.id, voxels: voxels.filter((v) => v[2] === r.id).map(([c, rr]) => [c, rr, WMH] as const) }));
  const pos = plane === 'cor' ? `y ${fmtMm(LESION.coronalJ + ORIGIN[1])}` : `x ${fmtMm(LESION.sagittalI + ORIGIN[0])}`;
  return (
    <ViewportFrame
      image={image}
      title={
        <span className="flex items-baseline gap-2 whitespace-nowrap text-bf-xs" title={`Through L${CUR.id} (${cur.length} vx). The band is the axial slice k ${LESION.k}. Same 1.0 mm grid: no reslice.`}>
          <span className="text-bf-text-primary">{plane === 'cor' ? 'Coronal' : 'Sagittal'}</span>
          <span className="font-mono text-bf-text-secondary">{pos}</span>
          <span className="text-bf-text-muted">through L{CUR.id} · grid</span>
        </span>
      }
    >
      <SliceView
        image={image}
        center={centre}
        fovMm={40}
        crosshair={centre}
        crosshairClearBox={bboxOf(voxels.filter((v) => v[2] === LESION.current).map(([c, r]) => [c, r] as Voxel), 2)}
        letters={false}
        overlays={[{ kind: 'band', through: [centre[0], row], dir: [1, 0], widthMm: 1, lengthMm: 12, ticks: true }, ...lesionOverlays(byLesion, true)]}
        aria-label={`${plane === 'cor' ? 'Coronal' : 'Sagittal'} FLAIR through lesion ${CUR.id}`}
      />
    </ViewportFrame>
  );
}

/** A 64-bin FLAIR histogram (log counts) with the range shaded: what the range admits, at a glance. */
function RangeHistogram() {
  const bins = LESION.histogram.bins;
  const max = Math.log1p(Math.max(...bins));
  const W = 300;
  const H = 34;
  const bw = W / bins.length;
  const x = (v: number) => (v / LESION.histogram.max) * W;
  return (
    <svg width="100%" height={H + 4} viewBox={`0 0 ${W} ${H + 4}`} preserveAspectRatio="none" aria-label="FLAIR histogram with the brush range" data-testid="range-histogram">
      <rect x={x(RANGE.lo)} y={0} width={x(RANGE.hi + 1) - x(RANGE.lo)} height={H} className="fill-bf-text-primary" fillOpacity={0.08} />
      {bins.map((b, i) => {
        const h = (Math.log1p(b) / max) * H;
        const inRange = (i + 0.5) * (LESION.histogram.max / bins.length) >= RANGE.lo;
        return <rect key={i} x={i * bw + 0.5} y={H - h} width={bw - 1} height={h} className={inRange ? 'fill-bf-text-primary' : 'fill-bf-text-muted'} fillOpacity={inRange ? 0.85 : 0.5} />;
      })}
      <line x1={x(RANGE.lo)} x2={x(RANGE.lo)} y1={0} y2={H + 4} className="stroke-bf-text-primary" strokeWidth={1} />
      <line x1={x(RANGE.hi + 1) - 0.5} x2={x(RANGE.hi + 1) - 0.5} y1={0} y2={H + 4} className="stroke-bf-text-primary" strokeWidth={1} />
    </svg>
  );
}

function RangeSection() {
  return (
    <section className="flex flex-col gap-1 border-b border-bf-border-subtle px-3 py-2" data-testid="range-section">
      <div className="flex items-baseline gap-2">
        <span className="text-bf-xs font-medium text-bf-text-primary">Range on FLAIR</span>
        <span className="font-mono text-bf-2xs text-bf-text-secondary">
          {RANGE.lo}–{RANGE.hi}
        </span>
        <span className="ml-auto text-bf-2xs text-bf-text-muted" title="The range limits what every tool writes; the display window is separate and unchanged">
          limits writing, not display
        </span>
      </div>
      <RangeHistogram />
      <span className="relative h-3 font-mono text-bf-2xs leading-3 text-bf-text-muted" aria-hidden>
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2 text-bf-text-secondary" style={{ left: `${(RANGE.lo / LESION.histogram.max) * 100}%` }}>
          {RANGE.lo}
        </span>
        <span className="absolute right-0">{LESION.histogram.max - 1}</span>
      </span>
      <span className="whitespace-nowrap font-mono text-bf-2xs text-bf-text-secondary" data-testid="brush-now" title="What the brush under the cursor writes now, and what it leaves">
        brush: +{LESION_SCENE.taken.length} vx · {LESION_SCENE.outOfRange.length} out of range · {LESION_SCENE.partial.length} ≤ 50% in
      </span>
    </section>
  );
}

/** The protocol line for lesions (collapsed like H's step card). */
function LesionStepCard() {
  const reviewed = LESION.rows.filter((r) => r.reviewed).length;
  return (
    <div className="flex flex-col border-b border-bf-border-subtle bg-bf-bg-panel-raised" data-testid="step-card">
      <button type="button" aria-expanded={false} className="flex h-8 items-center gap-2 px-3 text-left hover:bg-bf-bg-hover" title="Lesion protocol (example pack): every rule">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-bf-text-muted" aria-hidden />
        <Swatch color={WMH_DEF.color} size={9} />
        <span className="truncate text-bf-sm font-semibold text-bf-text-primary">Review each lesion</span>
        <span className="ml-auto font-mono text-bf-2xs text-bf-text-muted">
          {reviewed} of {LESION.rows.length} reviewed
        </span>
      </button>
      <p className="m-0 px-3 pb-2 pl-[34px] text-bf-2xs leading-snug text-bf-text-secondary">
        Rule · a voxel is lesion when more than half of it is inside the lesion; check each lesion in all three planes.
      </p>
    </div>
  );
}

/** The lesion list: one row per 3D connected lesion; next and previous; the current row open with its actions. */
function LesionList() {
  const total = LESION.rows.reduce((s, r) => s + r.mm3, 0);
  const reviewed = LESION.rows.filter((r) => r.reviewed).length;
  const idx = LESION.rows.findIndex((r) => r.id === LESION.current);
  return (
    <section className="flex flex-col gap-1 py-2" data-testid="lesion-list">
      <div className="flex items-center gap-2 px-3">
        <span className="text-bf-xs font-medium text-bf-text-primary">Lesions</span>
        <span className="whitespace-nowrap font-mono text-bf-2xs text-bf-text-muted" title={`Each row is one 26-connected lesion in 3D; editing that joins or splits lesions renumbers them. ${reviewed} reviewed.`}>
          {LESION.rows.length} · {fmtInt(total)} mm³
        </span>
        <span className="ml-auto flex items-center gap-0.5">
          <span className="whitespace-nowrap font-mono text-bf-2xs text-bf-text-secondary">
            L{LESION.current} of {LESION.rows.length}
          </span>
          <IconButton aria-label="Previous lesion" title="Previous lesion (⇧N)" icon={<ChevronLeft />} variant="ghost" size="sm" disabled={idx === 0} />
          <IconButton aria-label="Next lesion" title="Next lesion to review (N): L4" icon={<ChevronRight />} variant="ghost" size="sm" />
        </span>
      </div>
      <div className="grid grid-cols-[28px_minmax(0,1fr)_60px_62px_20px] items-center gap-x-2 px-3 text-bf-2xs text-bf-text-muted" aria-hidden>
        <span>#</span>
        <span>where</span>
        <span className="text-right">mm³</span>
        <span className="text-right">slices</span>
        <span />
      </div>
      <ol className="m-0 flex list-none flex-col p-0" aria-label="Lesions">
        {LESION.rows.map((r) => {
          const current = r.id === LESION.current;
          return (
            <li key={r.id} data-lesion-row={r.id} data-reviewed={r.reviewed || undefined}>
              <SelectableRow selected={current} tabIndex={current ? 0 : -1} className={clsx('grid min-h-6 grid-cols-[28px_minmax(0,1fr)_60px_62px_20px] gap-x-2 text-bf-xs', current ? 'text-bf-text-primary' : 'text-bf-text-secondary')}>
                <span className="font-mono">L{r.id}</span>
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="truncate">{whereOf(r)}</span>
                  <span className="text-bf-2xs text-bf-text-muted" title={r.location}>
                    {LOCATION_SHORT[r.location]}
                  </span>
                </span>
                <span className="text-right font-mono tabular-nums">{fmtInt(r.mm3)}</span>
                <span className="text-right font-mono text-bf-2xs tabular-nums text-bf-text-muted">
                  k {r.k[0]}–{r.k[1]}
                </span>
                <span className="flex justify-center" title={r.reviewed ? 'Reviewed' : 'To review'}>
                  {r.reviewed ? <Check className="h-3 w-3 text-bf-text-secondary" aria-label="reviewed" /> : <span className="h-2 w-2 rounded-full border border-bf-text-muted" aria-label="to review" />}
                </span>
              </SelectableRow>
              {current ? (
                <div className="flex items-center gap-1.5 border-l-2 border-bf-accent py-1.5 pl-[30px] pr-3" data-testid="lesion-open">
                  <Button size="sm" variant="secondary" title="Mark L1 reviewed and go to the next lesion to review (Enter)">
                    Mark L{r.id} reviewed ↵
                  </Button>
                  <Button size="sm" variant="ghost" title="Not a lesion: remove every voxel of L1 (logged)">
                    Remove
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <span className="px-3 text-bf-2xs text-bf-text-muted">
        PV periventricular {fmtInt(LESION.rows.filter((r) => r.location === 'periventricular').reduce((s, r) => s + r.mm3, 0))} mm³ · deep{' '}
        {fmtInt(LESION.rows.filter((r) => r.location !== 'periventricular').reduce((s, r) => s + r.mm3, 0))} mm³
      </span>
    </section>
  );
}

export function LesionState() {
  const brush = LESION_SCENE.brush;
  const curBox = bboxOf(LESION_SCENE.current.map(([c, r]) => [c, r] as Voxel), 2);
  const centre: Point = [(curBox.x0 + curBox.x1) / 2 - 2, (curBox.y0 + curBox.y1) / 2];
  const crosshair: Point = [CUR.centre[0] + 0.5, NY - 1 - CUR.centre[1] + 0.5];
  const [x, y, z] = worldOfAx(crosshair[0], crosshair[1]);
  const view = {
    image: LESION.images.ax,
    center: centre,
    fovMm: PRIMARY_FOV,
    crosshair,
    crosshairClearBox: curBox,
    crosshairClear: null,
    overlays: [
      ...lesionOverlays(LESION_SCENE.byLesion),
      { kind: 'path', d: partialPath(LESION_SCENE.partial), className: 'stroke-bf-bg-canvas', width: 3, opacity: 0.6 } as Overlay,
      { kind: 'path', d: partialPath(LESION_SCENE.partial), className: 'stroke-bf-text-primary', width: 1.25, opacity: 1, testId: 'pv-partial' } as Overlay,
    ],
    brush: { center: brush, radiusMm: RANGE.radiusMm, label: WMH, voxels: LESION_SCENE.taken },
  };
  return (
    <HShell
      testState="lesion"
      paint
      disclosure={LESION_DISCLOSURE}
      status={
        <>
          <StatusItem label="Crosshair" value={`(${fmtMm(x)}, ${fmtMm(y)}, ${fmtMm(z)})`} />
          <StatusItem label="Label" value="WMH" mono={false} />
          <StatusItem label="Lesion" value={`L${LESION.current} of ${LESION.rows.length}`} />
        </>
      }
      rail={<ToolRail state="tracing" active="brush" stepTools={['navigate', 'brush', 'eraser', 'contour', 'fill']} />}
      inspector={
        <InspectorFrame>
          <SessionHeader state="tracing" file="sub-07 WMH" status="on FLAIR grid · autosaved" />
          <LesionStepCard />
          <RangeSection />
          <LesionList />
        </InspectorFrame>
      }
    >
      <TraceGrid
        primary={
          <PrimaryPanel
            chip={<StateChip>Tracing</StateChip>}
            title={<LesionTitle />}
            right={
              <>
                <span className="font-mono text-bf-2xs text-bf-text-muted">{zoomFactor(PRIMARY_FOV)}</span>
                <TextToggle pressed={false} title="Linked contrasts (C): T1w and T2w at this slice">
                  Contrasts
                </TextToggle>
              </>
            }
            line2={<RangeStrip />}
            view={view}
            overlay={(p) => <LesionTags p={p} />}
            ruler={<LesionRuler />}
            ariaLabel="Primary view, axial FLAIR"
          />
        }
        side={
          <div className="grid min-h-0 grid-rows-2 gap-px">
            <LesionOrtho plane="cor" />
            <LesionOrtho plane="sag" />
          </div>
        }
      />
    </HShell>
  );
}
