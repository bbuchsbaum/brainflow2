/**
 * Direction H, "Hybrid" (round 1): A's tiled Workstation shell (large primary
 * panel, two orthogonal panels, a linked contrast strip at legible size, a
 * left tool rail, the label list in the Inspector, the constraint strip in
 * the view header) with C's protocol as a collapsible step card at the top of
 * the Inspector and its landmark limits in the orthogonal views, and B's
 * empty-state card, edge slice ruler and in-view status chip.
 *
 * Geometry is stated honestly: every panel header names its plane and the
 * native grid, the orthogonal panels draw the primary slice's true thickness,
 * and the brush readout gives in-plane voxels and through-plane slices. The
 * native 0.40 x 0.40 / 2.0 mm geometry is SIMULATED over 1 mm template
 * imagery, and the status bar says so.
 */

import React from 'react';
import clsx from 'clsx';
import {
  Brush,
  ChevronDown,
  ChevronRight,
  Diamond,
  Eraser,
  Layers3,
  Maximize2,
  MousePointer2,
  PaintBucket,
  PenTool,
  Plus,
  Search,
  Sprout,
  SquareDashed,
  Undo2,
  Check,
  AlertTriangle,
  Spline,
  MessageSquare,
} from 'lucide-react';
import {
  Button,
  Checkbox,
  Chip,
  IconButton,
  Section,
  SegmentedControl,
  Select,
  Slider,
  Switch,
  Tabs,
  TextField,
} from '@/components/ui/bf';
import { ConstraintStrip } from '@/modules/segmentation/components/shared/ConstraintStrip';
import { LabelList } from '@/modules/segmentation/components/shared/LabelList';
import {
  DiceTable,
  DisagreementNav,
  ProposalPill,
  ReviewDecision,
  ReviewLegend,
} from '@/modules/segmentation/components/shared/ProposalParts';
import { SliceView, type Overlay, type Projector } from '@/modules/segmentation/components/shared/SliceView';
import { Sparkline } from '@/modules/segmentation/components/shared/Sparkline';
import {
  LensBadge,
  ModeSwitcher,
  ShellFrame,
  StatusItem,
  Swatch,
  ViewportFrame,
} from '@/modules/segmentation/components/shared/chrome';
import { blockedCopy } from '@/modules/segmentation/components/shared/copy';
import {
  brushReadout,
  fmtInt,
  fmtMm,
  PLANE_AXIS,
  PLANE_NAME,
  slicePositionMm,
  voxelsOf,
  worldToDisplay,
} from '@/modules/segmentation/components/shared/geometry';
import {
  BRUSH,
  CA1,
  CONTRASTS,
  DG,
  INTERP,
  LABEL_BY_ID,
  NATIVE,
  NATIVE_GEOMETRY,
  NATIVE_SLICES_J,
  PROTOCOL,
  REVIEW_NAV,
  SESSION,
  TOOLS,
  areaByNativeSlice,
  labelColor,
  proposalSliceStatus,
  sessionLabels,
  tracingSliceStatus,
  yOfJ,
  type SliceStatus,
} from '@/modules/segmentation/components/shared/mockData';
import { CROSSHAIR_WORLD, OVERLAYS, SCENE } from '@/modules/segmentation/components/shared/scenes';
import { orthoViews, primaryView, stripViews, zoomFactor, type PanelProps } from '@/modules/segmentation/components/shared/views';
import type { DesignState, SliceImage, ToolId } from '@/modules/segmentation/components/shared/types';
import { DESIGN } from '@/modules/segmentation/__design__/designData';

const TOOL_ICON: Record<ToolId, React.ReactNode> = {
  navigate: <MousePointer2 />,
  brush: <Brush />,
  eraser: <Eraser />,
  contour: <PenTool />,
  fill: <PaintBucket />,
  interpolate: <Layers3 />,
  grow: <Sprout />,
};

/** Tools the protocol step suggests (soft defaults: the others stay usable and are logged). */
const STEP_TOOLS: readonly ToolId[] = ['navigate', 'brush', 'eraser', 'contour', 'interpolate'];

const PRIMARY_J = DESIGN.primaryJ;
const SLICE_INDEX = NATIVE_SLICES_J.indexOf(PRIMARY_J);
const SLAB = PROTOCOL.slab;
const READOUT = brushReadout(BRUSH.radiusMm * 2, NATIVE.spacing, BRUSH.shape);
const READOUT_TEXT = `${READOUT.across} vx across · ${READOUT.slices} slice`;
const GRID = { voxelMm3: NATIVE.voxelMm3 };
/** Neighbour slices of the primary on the native grid (one native slice = 2 template slices). */
const PREV_J = PRIMARY_J - NATIVE.stepJ;
const NEXT_J = PRIMARY_J + NATIVE.stepJ;
const DASH = { prev: '2 2', next: '6 3' } as const;

const isPaint = (s: DesignState) => s === 'tracing' || s === 'multi-contrast' || s === 'blocked' || s === 'zoom';

function activeTool(state: DesignState): ToolId {
  if (state === 'empty' || state === 'review') return 'navigate';
  if (state === 'proposal') return 'interpolate';
  return 'brush';
}

// ---------------------------------------------------------------- tool rail

function ToolRail({ state }: { state: DesignState }) {
  const active = activeTool(state);
  const session = state !== 'empty';
  const review = state === 'review';
  const step = TOOLS.filter((t) => STEP_TOOLS.includes(t.id));
  const other = TOOLS.filter((t) => !STEP_TOOLS.includes(t.id));
  const button = (t: (typeof TOOLS)[number], outside: boolean) => {
    const phase = t.phase > 2;
    const usable = t.id === 'navigate' || (session && !review && !phase);
    const tip = phase
      ? `${t.name} (${t.key}): later phase`
      : outside
        ? `${t.name} (${t.key}): not in step 6 defaults; allowed, logged`
        : `${t.name} (${t.key})`;
    return (
      <IconButton
        key={t.id}
        aria-label={`${t.name} (${t.key})`}
        title={tip}
        icon={TOOL_ICON[t.id]}
        size="sm"
        pressed={t.id === active}
        disabled={!usable}
        className={clsx(outside && usable && 'opacity-60')}
      />
    );
  };
  return (
    <nav
      aria-label="Segmentation tools"
      className="flex w-11 shrink-0 flex-col items-center gap-0.5 border-r border-bf-border-subtle bg-bf-bg-shell py-2"
    >
      {/* Before a segmentation exists only Navigate is offered. */}
      {session ? (
        <>
          {step.map((t) => button(t, false))}
          <div className="my-1.5 h-px w-5 bg-bf-border-subtle" aria-hidden />
          {other.map((t) => button(t, true))}
        </>
      ) : (
        button(TOOLS[0], false)
      )}
    </nav>
  );
}

// ------------------------------------------------------------ primary panel

function stateChip(state: DesignState): React.ReactNode {
  switch (state) {
    case 'blocked':
      return (
        <Chip icon={<AlertTriangle className="h-3 w-3 text-bf-warning" aria-hidden />} data-testid="status-chip">
          Blocked
        </Chip>
      );
    case 'proposal':
      return <ProposalPill />;
    case 'review':
      return <Chip data-testid="status-chip">Review · read only</Chip>;
    default:
      return <Chip data-testid="status-chip">Tracing</Chip>;
  }
}

/** "Coronal y −22.0 · T2w native oblique ⊥ long axis · 0.40×0.40 / 2.0 mm" */
function GeometryTitle({ image, native = true, short = false }: { image: SliceImage; native?: boolean; short?: boolean }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2 whitespace-nowrap text-bf-xs">
      <span className="text-bf-text-primary">{PLANE_NAME[image.plane]}</span>
      <span className="font-mono text-bf-text-secondary">
        {PLANE_AXIS[image.plane]} {fmtMm(slicePositionMm(image.plane, image.index))}
      </span>
      {native ? (
        <span className="text-bf-text-secondary">
          {image.contrast} {short ? 'native oblique' : NATIVE.plane}
          <span className="font-mono text-bf-text-muted"> · {NATIVE_GEOMETRY}</span>
        </span>
      ) : (
        <span className="text-bf-text-secondary">{image.contrast}</span>
      )}
    </span>
  );
}

function NeighbourLegend() {
  return (
    <span className="flex shrink-0 items-center gap-2 whitespace-nowrap font-mono text-bf-2xs text-bf-text-muted" title="Neighbour slices (toggle in Labels)">
      <svg width={16} height={6} aria-hidden>
        <line x1={0} y1={3} x2={16} y2={3} strokeWidth={1.25} strokeDasharray={DASH.prev} style={{ stroke: labelColor(CA1) }} />
      </svg>
      y {fmtMm(yOfJ(PREV_J), 0)}
      <svg width={16} height={6} aria-hidden>
        <line x1={0} y1={3} x2={16} y2={3} strokeWidth={1.25} strokeDasharray={DASH.next} style={{ stroke: labelColor(CA1) }} />
      </svg>
      y {fmtMm(yOfJ(NEXT_J), 0)}
    </span>
  );
}

function PrimaryHeader({ state, image, fovMm }: { state: DesignState; image: SliceImage; fovMm: number }) {
  const blocked = state === 'blocked';
  const c = blockedCopy();
  let line2: React.ReactNode;
  if (state === 'proposal') {
    line2 = (
      <span className="flex min-w-0 items-center gap-2 font-mono text-bf-xs text-bf-text-secondary">
        <Swatch color={labelColor(CA1)} size={8} />
        <span className="text-bf-text-primary">CA1</span>
        <span className="text-bf-text-faint">·</span>
        fill between slices y {fmtMm(yOfJ(INTERP.keyframesJ[0]), 0)} → {fmtMm(yOfJ(INTERP.keyframesJ[1]), 0)}
        <span className="text-bf-text-faint">·</span>
        locked labels not touched
      </span>
    );
  } else if (state === 'review') {
    line2 = (
      <span className="flex min-w-0 items-center gap-3 text-bf-xs text-bf-text-secondary">
        <span>
          Rater A <span className="text-bf-text-muted">solid</span> · rater B <span className="text-bf-text-muted">dashed where it departs</span>
        </span>
        <span className="font-mono text-bf-text-muted">
          disagreement {REVIEW_NAV.current} of {REVIEW_NAV.total} · subiculum medial border
        </span>
      </span>
    );
  } else {
    line2 = (
      <>
        <ConstraintStrip
          label={CA1}
          readout={READOUT_TEXT}
          blocked={blocked ? { reason: c.reason, detail: c.detail } : null}
        />
        {!blocked ? (
          <span className="ml-auto flex items-center gap-3">
            {state === 'zoom' ? (
              <span className="whitespace-nowrap font-mono text-bf-2xs text-bf-text-muted" title="The mock imagery is the 1 mm template; the native grid is simulated">
                grid lines: 1.0 mm imagery
              </span>
            ) : null}
            <NeighbourLegend />
          </span>
        ) : null}
      </>
    );
  }
  return (
    <div className="flex shrink-0 flex-col border-b border-bf-border-subtle bg-bf-bg-panel-sunken">
      <div className="flex h-7 items-center gap-2 px-2">
        {stateChip(state)}
        <GeometryTitle image={image} />
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <span className="font-mono text-bf-2xs text-bf-text-muted">
            slice {SLICE_INDEX + 1}/{NATIVE_SLICES_J.length} · {zoomFactor(fovMm)}
          </span>
          <IconButton aria-label="Full-bleed focus" title="Full-bleed focus (\)" icon={<Maximize2 />} size="xs" variant="ghost" />
        </span>
      </div>
      <div className="flex h-6 items-center gap-3 px-2">{line2}</div>
    </div>
  );
}

/** Overlays the primary panel adds in H: neighbour slices of the active label. */
function neighbourOverlays(): Overlay[] {
  const prev = voxelsOf(DESIGN.labels.cor(PREV_J), CA1);
  const next = voxelsOf(DESIGN.labels.cor(NEXT_J), CA1);
  return [
    { kind: 'voxels', voxels: prev, color: labelColor(CA1), outline: true, dash: DASH.prev, width: 1.25, bare: true, opacity: 0.6 },
    { kind: 'voxels', voxels: next, color: labelColor(CA1), outline: true, dash: DASH.next, width: 1.25, bare: true, opacity: 0.6 },
  ];
}

function hPrimary(state: DesignState): PanelProps {
  const p = primaryView(state);
  if (state === 'tracing' || state === 'multi-contrast') {
    return { ...p, fovMm: 48, overlays: [...neighbourOverlays(), ...(p.overlays ?? [])] };
  }
  if (state === 'blocked' || state === 'zoom') {
    return { ...p, overlays: [...neighbourOverlays(), ...(p.overlays ?? [])] };
  }
  if (state === 'proposal') return { ...p, fovMm: 48 };
  // Review: the crosshair stays out of the whole structure under review.
  if (state === 'review') return { ...p, crosshairClear: { center: SCENE.hippoCentre, radiusMm: 13 } };
  return p;
}

function BlockedCallout({ p }: { p: Projector }) {
  const copy = blockedCopy();
  const brush = p.project(SCENE.blocked.brush);
  // Park the message outside the traced structure (beside or below its bounding box), never on it.
  const xs = SCENE.blocked.base.map((v) => v[0]);
  const ys = SCENE.blocked.base.map((v) => v[1]);
  const left = p.project([Math.min(...xs), 0]).x;
  const bottom = p.project([0, Math.max(...ys) + 1]).y;
  const w = 268;
  const room = left - 24 >= w;
  const box = room ? { left: left - 24 - w, top: brush.y - 40 } : { left: Math.max(8, brush.x - w / 2), top: bottom + 16 };
  return (
    <>
      <div
        role="status"
        className="absolute flex flex-col gap-1.5 rounded-sm border border-bf-warning/60 bg-bf-bg-panel px-2.5 py-2 text-bf-xs"
        style={{ left: box.left, top: box.top, width: w }}
        data-testid="blocked-callout"
      >
        <span className="flex items-center gap-1.5 text-bf-text-primary">
          <AlertTriangle className="h-3.5 w-3.5 text-bf-warning" aria-hidden />
          Nothing painted: DG is locked
        </span>
        <span className="text-bf-text-secondary">DG was completed in step 4. {copy.explain.split('. ')[1]}</span>
        <span className="flex items-center gap-2">
          <Button variant="secondary" size="sm" title="Temporary unlock (⌥-drag): DG re-locks after this stroke; logged in provenance">
            Edit DG here
          </Button>
          <span className="text-bf-2xs text-bf-text-muted">re-locks after the stroke · logged</span>
        </span>
      </div>
    </>
  );
}

function CommentPin({ p }: { p: Projector }) {
  const g = SCENE.review.groups[0];
  if (!g) return null;
  const xs = g.map((v) => v[0]);
  const ys = g.map((v) => v[1]);
  const at = p.project([Math.max(...xs) + 1.5, Math.min(...ys) - 1.5]);
  return (
    <span
      className="pointer-events-none absolute flex h-5 items-center gap-1 rounded-sm border border-bf-border-strong bg-bf-bg-panel px-1 font-mono text-bf-2xs text-bf-text-primary"
      style={{ left: at.x, top: at.y - 20 }}
      title="Comment pinned at (−29, −22, −18)"
    >
      <MessageSquare className="h-3 w-3" aria-hidden />1
    </span>
  );
}

function ProposalBar() {
  const reviewed = INTERP.reviewed;
  const total = INTERP.orderJ.length;
  const pos = INTERP.orderJ.indexOf(INTERP.currentJ as (typeof INTERP.orderJ)[number]) + 1;
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-bf-border-subtle bg-bf-bg-panel px-2 py-1.5" data-testid="proposal-bar">
      <div className="flex min-w-0 items-center gap-3 text-bf-xs">
        <span className="whitespace-nowrap text-bf-text-primary">
          Reviewing slice {pos} of {total}
        </span>
        <span className="flex items-center gap-0.5" aria-label={`${reviewed} of ${total} interpolated slices reviewed`}>
          {INTERP.orderJ.map((j, i) => (
            <span
              key={j}
              className={clsx(
                'h-1.5 w-4 rounded-[1px]',
                i < reviewed ? 'bg-bf-text-secondary' : j === INTERP.currentJ ? 'bg-bf-text-primary' : 'border border-dashed border-bf-text-muted',
              )}
            />
          ))}
        </span>
        <span className="whitespace-nowrap text-bf-text-secondary">
          {reviewed} of {total} interpolated slices reviewed
        </span>
        <span className="ml-auto whitespace-nowrap font-mono text-bf-2xs text-bf-text-muted">
          +{fmtInt(SCENE.proposal.voxels.length)} vx here · {SCENE.proposal.skipped.length} locked skipped ×
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Button variant="primary" icon={<Swatch color={labelColor(CA1)} size={8} />} title="Accept CA1 on this slice and step to the next (Enter)">
          Accept CA1 here ↵
        </Button>
        <Button variant="secondary">Confirm CA1 on all {total}</Button>
        <Button variant="ghost">Discard</Button>
        <IconButton aria-label="Undo inside the proposal" title="Undo inside the proposal (2 steps); document undo is separate" icon={<Undo2 />} variant="ghost" />
        <span className="ml-auto whitespace-nowrap text-bf-2xs text-bf-text-muted">ghost shows every unreviewed slice</span>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- slice ruler

const RULER_TITLE: Record<SliceStatus, string> = {
  traced: 'traced',
  interpolated: 'interpolated, not reviewed',
  ai: 'AI-touched',
  empty: 'empty',
  reviewed: 'interpolated, reviewed',
  keyframe: 'keyframe',
};

function RulerTick({ status }: { status: SliceStatus }) {
  switch (status) {
    case 'traced':
    case 'reviewed':
      return <span className="block h-[3px] w-3.5 bg-bf-text-secondary" />;
    case 'interpolated':
      return <span className="block h-[5px] w-3.5 border border-dashed border-bf-text-secondary" />;
    case 'ai':
      return (
        <span className="flex items-center gap-[2px]">
          <span className="block h-[3px] w-2.5 bg-bf-text-secondary" />
          <span className="block h-[5px] w-[5px] rounded-full bg-bf-text-primary" />
        </span>
      );
    case 'keyframe':
      return <Diamond className="h-2.5 w-2.5 fill-current text-bf-text-primary" aria-hidden />;
    default:
      return <span className="block h-px w-1.5 bg-bf-text-faint" />;
  }
}

/** Through-plane slice ruler on the primary's edge: one row per native slice, anterior at the top. */
function SliceRuler({ state }: { state: DesignState }) {
  const rows = [...NATIVE_SLICES_J].reverse();
  const review = state === 'review';
  const proposal = state === 'proposal';
  const ca1 = areaByNativeSlice(CA1, 'all');
  const maxArea = Math.max(...ca1);
  const regions = (j: number) => DESIGN.review.regionsBySlice[String(j)] ?? 0;
  const maxRegions = Math.max(...NATIVE_SLICES_J.map(regions));
  const statusOf = (j: number): SliceStatus => (proposal ? proposalSliceStatus(j) : tracingSliceStatus(j));
  return (
    <div
      className="flex w-[52px] shrink-0 flex-col border-l border-bf-border-subtle bg-bf-bg-panel-sunken py-1"
      aria-label="Slice ruler"
      title="Slice ruler: ▬ traced · ┅ interpolated, not reviewed · ● AI-touched · ◆ keyframe · short tick empty. U next unreviewed, ⌥↓ next gap"
      data-testid="slice-ruler"
    >
      <span className="text-center font-mono text-bf-2xs text-bf-text-muted">A</span>
      <div className="flex min-h-0 flex-1 flex-col">
        {rows.map((j) => {
          const y = yOfJ(j);
          const current = j === PRIMARY_J;
          const limit = y === SLAB.toY || y === SLAB.fromY;
          const st = statusOf(j);
          const bar = proposal && (st === 'interpolated' || st === 'reviewed') ? ca1[NATIVE_SLICES_J.indexOf(j)] / maxArea : review ? regions(j) / maxRegions : 0;
          const visited = review && j >= PRIMARY_J && j <= PRIMARY_J + 4;
          return (
            <div
              key={j}
              className={clsx('relative flex min-h-0 flex-1 items-center', current && 'bg-bf-bg-active')}
              title={`y ${fmtMm(y, 0)} · ${review ? `${regions(j)} disagreement regions` : RULER_TITLE[st]}`}
              data-status={st}
            >
              {limit ? <span className="absolute inset-x-0 top-0 h-px bg-bf-text-secondary" aria-hidden /> : null}
              <span className={clsx('w-[22px] pr-0.5 text-right font-mono text-bf-2xs leading-none', current ? 'text-bf-text-primary' : 'text-bf-text-muted')}>
                {current || y % 10 === 0 ? fmtMm(y, 0) : ''}
              </span>
              <span className="flex w-4 items-center justify-center">
                {current ? <span className="absolute left-0 top-1/2 h-0 w-0 -translate-y-1/2 border-y-[3px] border-l-[4px] border-y-transparent border-l-bf-text-primary" aria-hidden /> : null}
                {review ? (
                  <span className={clsx('block h-[3px] w-3.5', regions(j) === 0 ? 'bg-bf-text-faint' : visited ? 'bg-bf-text-secondary' : 'border border-bf-text-secondary')} />
                ) : (
                  <RulerTick status={st} />
                )}
              </span>
              {bar > 0 ? <span className="ml-0.5 block h-[3px] bg-bf-text-muted" style={{ width: Math.max(1, bar * 10) }} aria-hidden /> : null}
            </div>
          );
        })}
      </div>
      <span className="text-center font-mono text-bf-2xs text-bf-text-muted">P</span>
      <span className="mt-1 flex flex-col items-center gap-0.5 border-t border-bf-border-subtle pt-1 font-mono text-bf-2xs leading-none text-bf-text-faint">
        <span title="Next unreviewed slice">{review ? 'N next' : 'U unrev.'}</span>
        <span title="Next empty slice inside the structure">⌥↓ gap</span>
      </span>
    </div>
  );
}

// ------------------------------------------------------------ orthogonals

function hOrtho(state: DesignState): { axial: PanelProps; sagittal: PanelProps } {
  const o = orthoViews(state);
  if (state === 'empty') return o;
  const ax = (y: number) => worldToDisplay('axial', [0, y, 0])[1];
  const sg = (y: number) => worldToDisplay('sagittal', [0, y, 0])[0];
  const y0 = CROSSHAIR_WORLD[1];
  const half = NATIVE.spacing[2] / 2;
  const limits = (f: (y: number) => number, axis: 'x' | 'y'): Overlay[] => [
    { kind: 'limit', axis, at: f(SLAB.toY + 0.5) - 0.5, label: 'head | body' },
    { kind: 'limit', axis, at: f(SLAB.fromY - 0.5) + 0.5, label: 'body | tail' },
    // The primary slice's true thickness (2.0 mm native), not a line.
    { kind: 'slab', axis, from: f(y0 - half) + (axis === 'y' ? 0.5 : -0.5), to: f(y0 + half) + (axis === 'y' ? 0.5 : -0.5), tone: 'slice' },
  ];
  return {
    axial: { ...o.axial, overlays: [...limits(ax, 'y'), ...(o.axial.overlays ?? [])] },
    sagittal: { ...o.sagittal, overlays: [...limits(sg, 'x'), ...(o.sagittal.overlays ?? [])] },
  };
}

function OrthoHeader({ image }: { image: SliceImage }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2 whitespace-nowrap text-bf-xs">
      <span className="text-bf-text-primary">{PLANE_NAME[image.plane]}</span>
      <span className="font-mono text-bf-text-secondary">
        {PLANE_AXIS[image.plane]} {fmtMm(slicePositionMm(image.plane, image.index))}
      </span>
      <span className="text-bf-text-muted">
        <span className="max-[1366px]:hidden">resliced · </span>slab {NATIVE.spacing[2].toFixed(1)} mm
      </span>
    </span>
  );
}

// ---------------------------------------------------------- bottom band

function ReferenceTile({ height }: { height: 'strip' | 'card' }) {
  const j = 106;
  return (
    <SliceView
      image={DESIGN.images.cor(j)}
      center={SCENE.hippoCentre}
      fovMm={height === 'card' ? 30 : 40}
      letters={false}
      overlays={OVERLAYS.labels(DESIGN.labels.cor(j), CA1)}
      aria-label={`Reference example, coronal y ${fmtMm(yOfJ(j), 0)} mm`}
    />
  );
}

function ContrastStrip({ state }: { state: DesignState }) {
  const multi = state === 'multi-contrast';
  const strip = stripViews(state);
  const titles = ['tracing', 'linked · 1.0 mm', 'view only'];
  return (
    <div className="flex h-full min-h-0 flex-col bg-bf-bg-canvas">
      <div className="flex h-6 shrink-0 items-center gap-3 border-b border-bf-border-subtle bg-bf-bg-panel-sunken px-2 text-bf-xs">
        <span className="text-bf-text-secondary">Linked contrasts</span>
        <span className="font-mono text-bf-2xs text-bf-text-muted">coronal y {fmtMm(CROSSHAIR_WORLD[1])} · same zoom and crosshair</span>
        <span className="ml-auto whitespace-nowrap text-bf-2xs text-bf-text-muted">hold Space to flicker T2w ↔ T1w in the primary</span>
      </div>
      <div className={clsx('grid min-h-0 flex-1 gap-px bg-bf-border-subtle', multi ? 'grid-cols-4' : 'grid-cols-3')}>
        {strip.map((v, i) => (
          <ViewportFrame
            key={v.image.key}
            image={v.image}
            title={
              <span className="flex items-center gap-1.5 whitespace-nowrap text-bf-xs">
                <span className="text-bf-text-primary">{v.image.contrast}</span>
                <span className="text-bf-text-muted">{titles[i]}</span>
              </span>
            }
            headerRight={v.image.viewOnly ? <LensBadge /> : null}
          >
            <SliceView {...v} fovMm={multi ? 44 : 52} letters={false} aria-label={`${v.image.contrast}, ${CONTRASTS[i].role}`} />
          </ViewportFrame>
        ))}
        {multi ? (
          <section aria-label="Reference example" className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-bf-bg-canvas">
            <div className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap border-b border-bf-border-subtle bg-bf-bg-panel-sunken px-2 text-bf-xs">
              <span className="text-bf-text-primary">Reference</span>
              <span className="text-bf-text-muted">pack example · y {fmtMm(yOfJ(106), 0)}</span>
            </div>
            <div className="relative min-h-0 flex-1">
              <ReferenceTile height="strip" />
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function AgreementBand() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-bf-bg-panel">
      <div className="flex h-6 shrink-0 items-center gap-3 border-b border-bf-border-subtle bg-bf-bg-panel-sunken px-2 text-bf-xs">
        <span className="text-bf-text-secondary">Agreement · rater A vs rater B</span>
        <span className="font-mono text-bf-2xs text-bf-text-muted">whole structure · {NATIVE_SLICES_J.length} native slices · sparklines navigate</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-3 py-1.5">
        <DiceTable columns="full" voxelMm3={NATIVE.voxelMm3} currentSlice={SLICE_INDEX} className="max-w-[820px]" />
      </div>
    </div>
  );
}

// ------------------------------------------------------------ the layouts

function TraceLayout({ state }: { state: DesignState }) {
  const multi = state === 'multi-contrast';
  const review = state === 'review';
  const primary = hPrimary(state);
  const ortho = hOrtho(state);
  const band = review ? '212px' : multi ? '264px' : '156px';
  return (
    <div
      className="grid h-full min-h-0 gap-px bg-bf-border-subtle"
      style={{ gridTemplateColumns: 'minmax(0,1fr) var(--h-ortho)', gridTemplateRows: `minmax(0,1fr) ${band}` }}
    >
      <section aria-label="Primary tracing view" className="flex min-h-0 min-w-0 flex-col bg-bf-bg-canvas" data-testid="primary-panel">
        <PrimaryHeader state={state} image={primary.image} fovMm={primary.fovMm} />
        <div className="flex min-h-0 flex-1">
          <div className="relative min-h-0 min-w-0 flex-1">
            <SliceView
              {...primary}
              grid={state === 'zoom'}
              aria-label="Primary tracing view, coronal T2w"
              overlay={(p) => (
                <>
                  {state === 'blocked' ? <BlockedCallout p={p} /> : null}
                  {review ? <CommentPin p={p} /> : null}
                </>
              )}
            />
          </div>
          <SliceRuler state={state} />
        </div>
        {state === 'proposal' ? <ProposalBar /> : null}
      </section>
      <div className="grid min-h-0 grid-rows-2 gap-px">
        <ViewportFrame image={ortho.axial.image} title={<OrthoHeader image={ortho.axial.image} />}>
          <SliceView {...ortho.axial} />
        </ViewportFrame>
        <ViewportFrame image={ortho.sagittal.image} title={<OrthoHeader image={ortho.sagittal.image} />}>
          <SliceView {...ortho.sagittal} />
        </ViewportFrame>
      </div>
      <div className="col-span-2 min-h-0">{review ? <AgreementBand /> : <ContrastStrip state={state} />}</div>
    </div>
  );
}

function EmptyLayout() {
  const primary = primaryView('empty');
  const ortho = orthoViews('empty');
  return (
    <div className="grid h-full min-h-0 gap-px bg-bf-border-subtle" style={{ gridTemplateColumns: 'minmax(0,1fr) var(--h-ortho)' }}>
      <section aria-label="Primary view" className="flex min-h-0 min-w-0 flex-col bg-bf-bg-canvas" data-testid="primary-panel">
        <div className="flex h-7 shrink-0 items-center gap-2 border-b border-bf-border-subtle bg-bf-bg-panel-sunken px-2">
          <GeometryTitle image={primary.image} />
        </div>
        <div className="relative min-h-0 flex-1">
          <SliceView {...primary} dim crosshair={null} />
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <StartCard />
          </div>
        </div>
      </section>
      <div className="grid min-h-0 grid-rows-2 gap-px">
        <ViewportFrame image={ortho.axial.image} title={<OrthoHeader image={ortho.axial.image} />}>
          <SliceView {...ortho.axial} dim crosshair={null} />
        </ViewportFrame>
        <ViewportFrame image={ortho.sagittal.image} title={<OrthoHeader image={ortho.sagittal.image} />}>
          <SliceView {...ortho.sagittal} dim crosshair={null} />
        </ViewportFrame>
      </div>
    </div>
  );
}

function StartCard() {
  return (
    <div className="flex w-[400px] max-w-full flex-col gap-3 rounded-sm border border-bf-border bg-bf-bg-panel p-4" data-testid="start-card">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-bf-md font-semibold text-bf-text-primary">Segment this image</h2>
        <p className="m-0 text-bf-xs text-bf-text-secondary">Choose the grid the labels live on and the label table, then start tracing.</p>
      </div>
      <label className="flex flex-col gap-1 text-bf-xs text-bf-text-muted">
        Reference grid
        <Select
          defaultValue="t2"
          options={[
            { value: 't2', label: `T2w · native oblique · ${NATIVE_GEOMETRY}` },
            { value: 't1', label: 'T1w · 1.0 mm isotropic' },
          ]}
        />
      </label>
      <label className="flex flex-col gap-1 text-bf-xs text-bf-text-muted">
        Label table
        <Select
          defaultValue="pack"
          options={[
            { value: 'pack', label: `Hippocampal subfields · ${PROTOCOL.version} (6 labels, 9 steps)` },
            { value: 'empty', label: 'Empty table' },
            { value: 'file', label: 'From a label file…' },
          ]}
        />
      </label>
      <div className="flex items-center gap-2">
        <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} title="New segmentation (⇧S)">
          New segmentation on T2w
        </Button>
        <Button variant="ghost">Open label file…</Button>
      </div>
      <details className="text-bf-2xs text-bf-text-muted">
        <summary className="cursor-pointer select-none text-bf-text-secondary">Why one reference grid?</summary>
        <p className="m-0 mt-1">
          Labels are stored on the grid you pick, voxel for voxel. Other images reslice to it for display; the labels are
          never resampled.
        </p>
      </details>
    </div>
  );
}

// -------------------------------------------------------------- inspector

function SessionHeader({ state }: { state: DesignState }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-bf-border-subtle px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="truncate text-bf-sm font-medium text-bf-text-primary">{SESSION.shortFile}</span>
        <span className="text-bf-2xs text-bf-text-muted">{state === 'review' ? 'rater B · submitted' : 'unsaved'}</span>
        <span className="ml-auto whitespace-nowrap text-bf-2xs text-bf-text-muted">{SESSION.rater}</span>
      </div>
      <div className="truncate font-mono text-bf-2xs text-bf-text-muted">
        grid T2w · {NATIVE_GEOMETRY} · {NATIVE_SLICES_J.length} slices
      </div>
    </div>
  );
}

function StepProgress({ current }: { current: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`Step ${current + 1} of ${PROTOCOL.steps.length}`}>
      {PROTOCOL.steps.map((s, i) => (
        <span
          key={s.id}
          className={clsx('h-1 w-2.5 rounded-[1px]', i < current ? 'bg-bf-text-muted' : i === current ? 'bg-bf-text-primary' : 'bg-bf-bg-active')}
        />
      ))}
    </span>
  );
}

/** C's protocol step, folded into one collapsible card above the label list. */
function StepCard({ state }: { state: DesignState }) {
  const review = state === 'review';
  const cur = review ? PROTOCOL.steps.length - 1 : PROTOCOL.currentStep;
  const open = state !== 'multi-contrast';
  return (
    <div className="flex flex-col border-b border-bf-border-subtle bg-bf-bg-panel-raised" data-testid="step-card">
      <div className="flex h-8 items-center gap-2 px-3">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-bf-text-muted" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5 text-bf-text-muted" aria-hidden />}
        {review ? null : <Swatch color={labelColor(CA1)} size={9} />}
        <span className="truncate text-bf-sm font-semibold text-bf-text-primary">{review ? 'Review vs rater B' : 'Trace CA1'}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <span className="font-mono text-bf-2xs text-bf-text-muted">
            step {cur + 1}/{PROTOCOL.steps.length}
          </span>
          <StepProgress current={cur} />
        </span>
      </div>
      {!open ? (
        <div className="px-3 pb-2 text-bf-2xs text-bf-text-muted">
          Rule 1: lateral border on the ventricle wall · reference shown in the strip · 2 checks left
        </div>
      ) : review ? (
        <div className="flex flex-col gap-2 px-3 pb-2.5 text-bf-xs text-bf-text-secondary">
          <p className="m-0">Visit landmark disagreements first: the CA1/subiculum line and the SRLM ends. Return with a note when a border breaks a rule.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-3 pb-2.5">
          <ol className="m-0 flex list-none flex-col gap-1 p-0 text-bf-xs text-bf-text-secondary">
            {PROTOCOL.ca1Rules.map((r, i) => (
              <li key={r} className={clsx('flex gap-2', (state === 'zoom' || state === 'tracing') && i === 0 && 'text-bf-text-primary')}>
                <span className="w-3 shrink-0 font-mono text-bf-2xs text-bf-text-muted">{i + 1}</span>
                <span>{r}</span>
              </li>
            ))}
          </ol>
          <div className="flex gap-2">
            <figure className="relative m-0 h-[92px] w-[112px] shrink-0 overflow-hidden rounded-sm border border-bf-border-subtle bg-bf-bg-canvas">
              <ReferenceTile height="card" />
              <figcaption className="absolute bottom-0.5 left-1 font-mono text-bf-2xs text-bf-text-secondary [text-shadow:0_0_3px_black]">
                ref y {fmtMm(yOfJ(106), 0)}
              </figcaption>
            </figure>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-1 text-bf-2xs text-bf-text-secondary">
                <Check className="h-3 w-3 shrink-0 text-bf-text-secondary" aria-hidden />
                <span>
                  Body slab y {fmtMm(SLAB.fromY, 0)} to {fmtMm(SLAB.toY, 0)} · here y {fmtMm(CROSSHAIR_WORLD[1], 0)}
                </span>
              </span>
              {PROTOCOL.ca1Checks.map((c) => (
                <Checkbox key={c.text} checked={c.done} onCheckedChange={() => undefined} className="-ml-1">
                  <span className="text-bf-2xs leading-tight">{c.text}</span>
                </Checkbox>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled title="Complete the checks first">
              Mark CA1 complete
            </Button>
            <span className="text-bf-2xs text-bf-text-muted">2 checks left · step tools are defaults, not limits</span>
          </div>
        </div>
      )}
    </div>
  );
}

function LabelsSection({ state }: { state: DesignState }) {
  const labels = sessionLabels(
    Object.fromEntries(
      [...LABEL_BY_ID.keys()].map((id) => [
        id,
        {
          ...(id === CA1 && state === 'proposal' ? { status: 'proposal' as const } : {}),
          ...(id !== CA1 && id !== 4 && id !== 5 ? { lockReason: `Locked: step ${id === 6 ? 3 : id === DG ? 4 : 5} complete` } : {}),
        },
      ]),
    ),
  );
  return (
    <Section
      title="Labels"
      meta="6"
      variant="static"
      divider={false}
      actions={
        <span className="flex items-center">
          <IconButton aria-label="Outline only" title="Outline only (O): drop the fills" icon={<SquareDashed />} pressed={false} size="sm" variant="ghost" />
          <IconButton aria-label="Neighbour slices" title="Neighbour slices: dotted y −24, dashed y −20 (,)" icon={<Spline />} pressed={state !== 'proposal'} size="sm" variant="ghost" />
          <IconButton aria-label="New label" icon={<Plus />} size="sm" variant="ghost" />
        </span>
      }
      bodyClassName="px-0"
    >
      <div className="flex flex-col gap-1">
        <div className="relative px-3">
          <Search className="pointer-events-none absolute left-5 top-1/2 h-3 w-3 -translate-y-1/2 text-bf-text-muted" aria-hidden />
          <TextField aria-label="Search labels" placeholder="Search labels" className="w-full pl-6" />
        </div>
        <LabelList
          labels={labels}
          activeId={CA1}
          hoveredId={state === 'tracing' ? DG : undefined}
          alertId={state === 'blocked' ? DG : undefined}
          grid={GRID}
          renderSpark={(l) => (
            <Sparkline
              values={l.voxels ? areaByNativeSlice(l.id) : areaByNativeSlice(l.id).map(() => 0)}
              current={SLICE_INDEX}
              hover={state === 'tracing' && l.id === DG ? SLICE_INDEX - 3 : undefined}
              color={l.color}
              width={72}
              height={14}
              label={`${l.name} area by slice`}
            />
          )}
        />
        <div className="flex flex-col gap-1 px-3 pt-0.5 text-bf-2xs text-bf-text-muted">
          <span>Lines: area per slice, | marks this slice. Click a line to jump.</span>
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5" aria-label="Slice ruler legend">
            Ruler
            <RulerTick status="traced" /> traced
            <RulerTick status="interpolated" /> interpolated
            <RulerTick status="ai" /> AI-touched
            <RulerTick status="keyframe" /> keyframe
          </span>
        </div>
      </div>
    </Section>
  );
}

function BrushSection() {
  return (
    <Section title="Brush" variant="static">
      <div className="flex flex-col gap-2 text-bf-xs">
        <Slider label="Diameter" min={0.4} max={10} step={0.4} value={3} onValueChange={() => undefined} showValue format={(v) => `${v.toFixed(1)} mm`} valueWidth="6ch" />
        <div className="flex items-center gap-2">
          <span className="w-20 text-bf-text-muted">Shape</span>
          <SegmentedControl aria-label="Brush shape" value="2d" onValueChange={() => undefined} options={[{ value: '2d', label: '2D disc' }, { value: '3d', label: '3D sphere' }]} />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-20 text-bf-text-muted">Paint over</span>
          <Select aria-label="Paint over" defaultValue="unlocked" className="flex-1" options={[{ value: 'unlocked', label: 'Unlocked labels' }, { value: 'background', label: 'Background only' }, { value: 'all', label: 'Everything' }]} />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-20 text-bf-text-muted">Range</span>
          <Switch checked={false} aria-label="Intensity range">Off</Switch>
        </div>
      </div>
    </Section>
  );
}

function ReviewInspector() {
  return (
    <div className="flex flex-col gap-3 px-3 py-2.5">
      <ReviewLegend vertical toggle />
      <DisagreementNav />
      <ReviewDecision />
    </div>
  );
}

function EmptyInspector() {
  return (
    <div className="flex flex-col gap-1 px-3 py-3">
      <span className="text-bf-xs font-medium text-bf-text-secondary">Loaded images</span>
      {CONTRASTS.slice(0, 2).map((c, i) => (
        <div key={c.key} className="flex flex-col text-bf-xs">
          <span className="text-bf-text-primary">{c.name}</span>
          <span className="font-mono text-bf-2xs text-bf-text-muted">{i === 0 ? `native oblique · ${NATIVE_GEOMETRY}` : '1.0 mm isotropic · reslices for display'}</span>
        </div>
      ))}
    </div>
  );
}

function Inspector({ state }: { state: DesignState }) {
  return (
    <aside aria-label="Inspector" className="flex w-[var(--h-inspector)] shrink-0 flex-col border-l border-bf-border-subtle bg-bf-bg-panel">
      <div className="flex h-8 shrink-0 items-center border-b border-bf-border-subtle px-2">
        <Tabs
          aria-label="Inspector mode"
          value="segment"
          onValueChange={() => undefined}
          items={[
            { value: 'inspect', label: 'Inspect' },
            { value: 'segment', label: 'Segment' },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {state === 'empty' ? (
          <EmptyInspector />
        ) : (
          <>
            <SessionHeader state={state} />
            <StepCard state={state} />
            {state === 'review' ? (
              <ReviewInspector />
            ) : (
              <>
                <LabelsSection state={state} />
                <BrushSection />
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function Status({ state }: { state: DesignState }) {
  const [x, y, z] = CROSSHAIR_WORLD;
  return (
    <>
      <StatusItem label="Crosshair" value={`(${fmtMm(x)}, ${fmtMm(y)}, ${fmtMm(z)})`} />
      {state !== 'empty' ? <StatusItem label="Slice" value={`${SLICE_INDEX + 1} of ${NATIVE_SLICES_J.length}`} /> : null}
      {state !== 'empty' ? <StatusItem label="Label" value={state === 'blocked' ? 'DG (locked)' : 'CA1'} mono={false} /> : null}
      {state !== 'empty' && state !== 'review' ? <StatusItem label="History" value={`${SESSION.historySteps} steps`} /> : null}
    </>
  );
}

export function DirectionH({ state }: { state: DesignState }) {
  return (
    <ShellFrame
      center={<ModeSwitcher value={state === 'empty' ? 'orthogonal' : 'trace'} />}
      right={<Button variant="ghost">Workspace</Button>}
      status={<Status state={state} />}
      simulatedGeometry={NATIVE_GEOMETRY}
    >
      <div
        className="flex h-full min-h-0 [--h-inspector:336px] [--h-ortho:240px] max-[1366px]:[--h-inspector:304px] max-[1366px]:[--h-ortho:220px]"
        data-direction="h"
        data-paint={isPaint(state) || undefined}
      >
        <ToolRail state={state} />
        <div className="flex min-w-0 flex-1 flex-col">{state === 'empty' ? <EmptyLayout /> : <TraceLayout state={state} />}</div>
        <Inspector state={state} />
      </div>
    </ShellFrame>
  );
}
