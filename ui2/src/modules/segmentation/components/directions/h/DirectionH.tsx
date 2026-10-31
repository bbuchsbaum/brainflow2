/**
 * Direction H, "Hybrid" (round 2): A's tiled Workstation shell (large primary
 * panel, two orthogonal panels, a left tool rail, the label list in the
 * Inspector, the brush constraints in the view header) with C's protocol as
 * a collapsed step card and its landmark limits in the orthogonal views, and
 * B's empty-state card, edge slice ruler and in-view status chip.
 *
 * Round 2 is subtraction and coherence: the contrast strip is off while
 * tracing (a header toggle, on in the multi-contrast layout); the Brush
 * section is folded into the constraint strip, whose items are controls;
 * label rows keep swatch, id, name, volume, status and lock; one meaning per
 * dash (rater B only); the crosshair stays out of the structure being edited.
 *
 * Round 3 is balance: labels stroke the inner edge of their own voxels with
 * an emphasis hierarchy (the active label 1.5 px plus a faint inset fill);
 * the Inspector holds the step's way forward (open checks, a k-matched
 * reference, "Mark CA1 complete") and per-slice bars for every label on the
 * ruler's axis; the orthogonal views fit the structure with native slice
 * ticks and landmark zones in a gutter; review leads with the decision.
 *
 * Round 4 is one static fix pass: muted labels are tints, not alpha (SRLM
 * moved to teal), islands of the active label get a ring; the slice matrix
 * shows the active row and the rows with problems on one scale (gaps, jumps,
 * outside the pack's range) with the rest behind "Show all labels"; the step
 * card wraps its rule and lists every check beside a readable example drawn
 * in its own style; the orthogonals show the active label only, fitted to
 * 80% with a locator and the slab's tilted ticks; review reconciles flagged
 * regions (Keep A / Take B / Edit). The design summary is in DESIGN.md.
 *
 * Round 5 adds workflow states on the same shell (`workflow/`): this file
 * exports its parts (rail, headers, ruler, Inspector sections, `HShell`) and
 * `hViews.ts` holds the view data both use.
 *
 * Geometry is stated honestly: the primary is named by native slice (k), the
 * orthogonal views say they are world-frame reslices and draw the native
 * slab tilted by the (SIMULATED) obliquity, and the brush readout gives the
 * native voxel count next to what the 1 mm mock imagery can draw.
 */

import React from 'react';
import clsx from 'clsx';
import {
  AlertTriangle,
  Brush,
  Check,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Layers3,
  Maximize2,
  MessageSquare,
  MousePointer2,
  PaintBucket,
  PenTool,
  Plus,
  Sparkles,
  Sprout,
  Undo2,
} from 'lucide-react';
import { Button, Chip, IconButton, Section, SegmentedControl, SelectableRow, Select, Slider, Tabs, TextArea } from '@/components/ui/bf';
import { LabelList } from '@/modules/segmentation/components/shared/LabelList';
import { ProposalPill, TextureSwatch } from '@/modules/segmentation/components/shared/ProposalParts';
import { SliceView, type Projector } from '@/modules/segmentation/components/shared/SliceView';
import { LineSample, ModeSwitcher, ShellFrame, StatusItem, Swatch, ViewportFrame } from '@/modules/segmentation/components/shared/chrome';
import { blockedCopy } from '@/modules/segmentation/components/shared/copy';
import {
  areaFlags,
  bboxOf,
  canApprove,
  labelIslands,
  type AreaFlag,
  fmtInt,
  fmtMm,
  PLANE_AXIS,
  PLANE_NAME,
  slicePositionMm,
  voxelsOf,
} from '@/modules/segmentation/components/shared/geometry';
import {
  BRUSH,
  CA1,
  CONTRASTS,
  DICE_THRESHOLD,
  DISAGREEMENTS,
  FLAG_MIN_VX,
  INTERP,
  LABEL_BY_ID,
  LABEL_DEFS,
  LABEL_VOLUMES,
  NATIVE,
  NATIVE_GEOMETRY,
  NATIVE_SLICES_J,
  PROTOCOL,
  QUIET_LABELS,
  RECONCILE,
  RECONCILE_LABEL,
  REVIEW_NAV,
  REVIEW_ROWS,
  SESSION,
  TOOLS,
  areaByNativeSlice,
  labelColor,
  labelTint,
  proposalSliceStatus,
  sessionLabels,
  tracingSliceStatus,
  yOfJ,
} from '@/modules/segmentation/components/shared/mockData';
import { B_NONE, CROSSHAIR_WORLD, SCENE } from '@/modules/segmentation/components/shared/scenes';
import { orthoViews, primaryView, stripViews, zoomFactor } from '@/modules/segmentation/components/shared/views';
import type { DesignState, SliceImage, ToolId } from '@/modules/segmentation/components/shared/types';
import { DESIGN } from '@/modules/segmentation/__design__/designData';
import {
  DIAMETER,
  DRAWN,
  GRID,
  ISLANDS_HERE,
  N_SLICES,
  NEIGHBOUR_OPACITY,
  NEXT_J,
  PREV_J,
  PRIMARY_J,
  READOUT,
  SLAB,
  SLICE_K,
  STRUCTURE_BOX,
  hOrtho,
  hPrimary,
  isPaint,
  jOfY,
  kOf,
} from './hViews';

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


function activeTool(state: DesignState): ToolId {
  if (state === 'empty' || state === 'review') return 'navigate';
  if (state === 'proposal') return 'interpolate';
  return 'brush';
}

/** A small text toggle (named, not an unlabelled glyph). */
export function TextToggle({
  pressed,
  children,
  title,
  className,
}: {
  pressed: boolean;
  children: React.ReactNode;
  title: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      className={clsx(
        'inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-sm px-1.5 text-bf-2xs',
        pressed
          ? 'bg-bf-bg-active text-bf-text-primary shadow-[inset_0_-1px_0_var(--bf-text-muted)]'
          : 'text-bf-text-muted hover:bg-bf-bg-hover hover:text-bf-text-secondary',
        className,
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- tool rail

/**
 * The tool rail. Round 5: `active` overrides the state's tool, `ai` adds the
 * AI assist tool at the end of the rail (only when a provider is configured;
 * "pending" while its licence gate is open), `extra` appends tools of another
 * workflow (the lesion range brush), and `stepTools` replaces the step's
 * suggested tools.
 */
export function ToolRail({
  state,
  active: activeOverride,
  ai,
  extra,
  stepTools = STEP_TOOLS,
}: {
  state: DesignState;
  active?: ToolId | 'ai' | string;
  ai?: 'on' | 'off' | 'pending';
  extra?: React.ReactNode;
  stepTools?: readonly ToolId[];
}) {
  const active = activeOverride ?? activeTool(state);
  const session = state !== 'empty';
  // Review is read only: paint tools are not offered at all.
  const paint = session && state !== 'review';
  const step = TOOLS.filter((t) => stepTools.includes(t.id));
  const other = TOOLS.filter((t) => !stepTools.includes(t.id));
  const button = (t: (typeof TOOLS)[number], outside: boolean) => {
    const phase = t.phase > 2;
    const usable = t.id === 'navigate' || (paint && !phase);
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
      {paint ? (
        <>
          {step.map((t) => button(t, false))}
          {extra}
          <div className="my-1.5 h-px w-5 bg-bf-border-subtle" aria-hidden />
          {other.map((t) => button(t, true))}
          {ai ? (
            <>
              <div className="my-1.5 h-px w-5 bg-bf-border-subtle" aria-hidden />
              <IconButton
                aria-label="AI assist (A)"
                title={ai === 'pending' ? 'AI assist (A): licence to acknowledge first' : 'AI assist (A): nnInteractive prompts; results are proposals'}
                icon={<Sparkles />}
                size="sm"
                pressed={active === 'ai' || ai === 'pending'}
                data-testid="ai-tool"
              />
            </>
          ) : null}
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

/** "Oblique coronal  k 11/20  T2w native ⊥ long axis · 0.40×0.40 / 2.0 mm": named by native slice, not by a world coordinate. */
export function GeometryTitle({ image }: { image: SliceImage }) {
  const [x, y, z] = CROSSHAIR_WORLD;
  return (
    <span
      className="flex min-w-0 items-baseline gap-2 whitespace-nowrap text-bf-xs"
      title={`Native slice k ${SLICE_K} of ${N_SLICES}; centre (${fmtMm(x)}, ${fmtMm(y)}, ${fmtMm(z)}) mm world. World y varies across an oblique slice.`}
      data-testid="primary-geometry"
    >
      <span className="text-bf-text-primary">Oblique coronal</span>
      <span className="font-mono text-bf-text-primary">
        k {SLICE_K}/{N_SLICES}
      </span>
      <span className="min-w-0 truncate text-bf-text-secondary">
        {image.contrast} native ⊥ long axis
        <span className="font-mono text-bf-text-muted"> · {NATIVE_GEOMETRY}</span>
      </span>
    </span>
  );
}

export function Sep() {
  return <span className="text-bf-text-faint">·</span>;
}

/** One constraint as a control: click opens its popover. */
export function StripItem({ children, title, open = false }: { children: React.ReactNode; title: string; open?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-haspopup="dialog"
      aria-expanded={open}
      className={clsx(
        'inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm px-1 font-mono text-bf-xs',
        open ? 'bg-bf-bg-active text-bf-text-primary' : 'text-bf-text-secondary hover:bg-bf-bg-hover',
      )}
    >
      {children}
    </button>
  );
}

/**
 * The constraint strip as the brush controls (the Brush section folded in):
 * label, paint-over, shape, size with its native readout, range. Each item
 * opens a popover; `sizeOpen` shows the size popover as an example.
 */
export function BrushStrip({ sizeOpen = false }: { sizeOpen?: boolean }) {
  const def = LABEL_BY_ID.get(CA1)!;
  return (
    <div className="relative flex min-w-0 items-center gap-0.5" data-testid="constraint-strip" aria-label="Brush constraints (click to change)">
      <StripItem title="Active label (click to pick another; Alt-click a voxel picks its label)">
        <Swatch color={def.color} size={8} />
        <span className="text-bf-text-primary">{def.name}</span>
      </StripItem>
      <Sep />
      <StripItem title="Paint over: unlocked labels (click: background only, everything)">over unlocked</StripItem>
      <Sep />
      <StripItem title="Brush shape: 2D disc, one native slice (click for 3D sphere)">{BRUSH.shape}</StripItem>
      <Sep />
      <StripItem
        open={sizeOpen}
        title={`Brush diameter. On the native ${NATIVE_GEOMETRY} grid it writes ${READOUT.across} voxels across, ${READOUT.slices} slice; the 1 mm mock imagery can only draw ${DRAWN.across} across.`}
      >
        ⌀ {DIAMETER.toFixed(1)} mm
        <span className="text-bf-text-muted" data-testid="brush-readout">
          = {READOUT.across} native vx ({DRAWN.across} drawn)
        </span>
      </StripItem>
      {sizeOpen ? <SizePopover /> : null}
    </div>
  );
}

function SizePopover() {
  return (
    <div
      role="dialog"
      aria-label="Brush size"
      className="absolute left-[150px] top-[calc(100%+4px)] z-20 flex w-[300px] flex-col gap-2 rounded-sm border border-bf-border bg-bf-bg-panel-raised p-2.5 text-bf-xs shadow-lg"
      data-testid="size-popover"
    >
      <span className="text-bf-text-secondary">Diameter</span>
      <Slider label="Diameter" min={0.4} max={10} step={0.4} value={DIAMETER} onValueChange={() => undefined} showValue format={(v) => `${v.toFixed(1)} mm`} valueWidth="6ch" />
      <div className="flex items-center gap-2">
        <span className="w-16 text-bf-text-muted">Shape</span>
        <SegmentedControl
          aria-label="Brush shape"
          size="sm"
          value="2d"
          onValueChange={() => undefined}
          options={[
            { value: '2d', label: '2D disc' },
            { value: '3d', label: '3D sphere' },
          ]}
        />
      </div>
      <span className="flex flex-col font-mono text-bf-2xs text-bf-text-muted">
        <span>
          native: {READOUT.across} vx across · {READOUT.inPlane} vx · {READOUT.slices} slice
        </span>
        <span>drawn: {DRAWN.across} across (mock imagery is 1.0 mm)</span>
      </span>
    </div>
  );
}

/**
 * A tiny inline legend for the two quiet marks on the primary that have no
 * other key: the neighbour slice (a faint grey line) and an island ring.
 * Legible without a tooltip; the keys stay in the tooltip.
 */
export function NeighbourKey({ island = true }: { island?: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-2.5 whitespace-nowrap font-mono text-bf-2xs text-bf-text-muted">
      <span
        className="flex items-center gap-1.5"
        title={`Neighbour: CA1 on k ${kOf(PREV_J)} (y ${fmtMm(yOfJ(PREV_J), 0)}), the slice you came from, drawn only where it departs from k ${SLICE_K} by more than one voxel. Hold , for k ${kOf(NEXT_J)}.`}
        data-testid="neighbour-key"
      >
        <svg width={14} height={6} aria-hidden>
          <line x1={0} y1={3} x2={14} y2={3} strokeWidth={1} className="stroke-bf-text-primary" strokeOpacity={NEIGHBOUR_OPACITY} />
        </svg>
        <span className="font-sans">neighbour</span> k {kOf(PREV_J)}
      </span>
      {island ? (
        <span className="flex items-center gap-1" title="A ring marks an island: a piece of CA1 not connected to the rest on this slice" data-testid="island-key">
          <svg width={9} height={9} aria-hidden>
            <circle cx={4.5} cy={4.5} r={3.5} fill="none" strokeWidth={1} className="stroke-bf-text-primary" />
          </svg>
          <span className="font-sans">island</span>
        </span>
      ) : null}
    </span>
  );
}

function PrimaryHeader({ state, image, fovMm }: { state: DesignState; image: SliceImage; fovMm: number }) {
  const multi = state === 'multi-contrast';
  const review = state === 'review';
  let line2: React.ReactNode = null;
  if (state === 'proposal') {
    line2 = (
      <span className="flex min-w-0 items-center gap-2 whitespace-nowrap font-mono text-bf-xs text-bf-text-secondary">
        <Swatch color={LABEL_BY_ID.get(CA1)!.color} size={8} />
        <span className="text-bf-text-primary">CA1</span>
        <Sep />
        fill between slices k {kOf(INTERP.keyframesJ[0])} → k {kOf(INTERP.keyframesJ[1])}
        <Sep />
        locked labels not touched
      </span>
    );
  } else if (!review) {
    line2 = (
      <>
        <BrushStrip sizeOpen={state === 'zoom'} />
        {state !== 'blocked' ? (
          <span className="ml-auto flex items-center gap-3">
            <NeighbourKey island={ISLANDS_HERE > 0} />
          </span>
        ) : null}
      </>
    );
  }
  return (
    <div className="relative z-10 flex shrink-0 flex-col border-b border-bf-border-subtle bg-bf-bg-panel-sunken">
      <div className="flex h-7 items-center gap-2 px-2">
        {stateChip(state)}
        <GeometryTitle image={image} />
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className="font-mono text-bf-2xs text-bf-text-muted" title="Zoom relative to fitting the slice">
            {zoomFactor(fovMm)}
          </span>
          {review ? null : (
            <TextToggle
              pressed={multi}
              title={multi ? 'Linked contrasts (C): on in the multi-contrast layout' : 'Linked contrasts (C): off for CA-field steps traced on T2w; on automatically for steps whose rule cites T1w (ERC, uncus, head). Click or press C to show T1w, the unsharp lens and the reference.'}
            >
              Contrasts
            </TextToggle>
          )}
          <IconButton aria-label="Full-bleed focus" title="Full-bleed focus (\)" icon={<Maximize2 />} size="xs" variant="ghost" />
        </span>
      </div>
      {line2 ? <div className="flex h-6 items-center gap-2 px-1.5">{line2}</div> : null}
    </div>
  );
}


/** Size of the blocked card (px), for placing it. */
const BLOCKED_CARD = { w: 268, h: 112, inset: 12 };

/**
 * The blocked card sits in the corner of the view nearest the cursor whose
 * rectangle does not overlap the structure's extent (plus the clear box's
 * margin), so it never covers the anatomy being edited.
 */
function blockedCardBox(p: Projector, cursor: { x: number; y: number }): { left: number; top: number } {
  const { w, h, inset } = BLOCKED_CARD;
  const a = p.project([STRUCTURE_BOX.x0, STRUCTURE_BOX.y0]);
  const b = p.project([STRUCTURE_BOX.x1, STRUCTURE_BOX.y1]);
  const corners = [
    { left: inset, top: inset },
    { left: p.width - w - inset, top: inset },
    { left: inset, top: p.height - h - inset },
    { left: p.width - w - inset, top: p.height - h - inset },
  ];
  const clear = (c: { left: number; top: number }) => c.left + w < a.x || c.left > b.x || c.top + h < a.y || c.top > b.y;
  const dist = (c: { left: number; top: number }) => Math.hypot(c.left + w / 2 - cursor.x, c.top + h / 2 - cursor.y);
  const ok = corners.filter(clear).sort((x, y) => dist(x) - dist(y));
  return ok[0] ?? [...corners].sort((x, y) => dist(x) - dist(y))[0];
}

function BlockedCallout({ p }: { p: Projector }) {
  const copy = blockedCopy();
  const brush = p.project(SCENE.blocked.brush);
  const box = blockedCardBox(p, brush);
  const w = BLOCKED_CARD.w;
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute flex flex-col gap-1.5 rounded-sm border border-bf-warning/60 bg-bf-bg-panel px-2.5 py-2 text-bf-xs"
      style={{ left: box.left, top: box.top, width: w }}
      data-testid="blocked-callout"
    >
      <span className="flex items-center gap-1.5 text-bf-text-primary">
        <AlertTriangle className="h-3.5 w-3.5 text-bf-warning" aria-hidden />
        Nothing painted: DG is locked
      </span>
      <span className="text-bf-text-secondary">
        DG was completed in step 4. {copy.explain.split('. ')[1]} <span className="font-mono text-bf-text-muted">{copy.detail}.</span>
      </span>
      <span className="flex items-center gap-2">
        <Button variant="secondary" size="sm" title="Temporary unlock (⌥-drag): DG re-locks after this stroke; logged in provenance">
          Edit DG here
        </Button>
        <span className="text-bf-2xs text-bf-text-muted">re-locks after the stroke · logged</span>
      </span>
    </div>
  );
}

/** A direct "B: none" note beside each label rater B never traced (it is outlined, not textured). */
function BNoneTags({ p }: { p: Projector }) {
  return (
    <>
      {B_NONE.map((id) => {
        const vs = voxelsOf(SCENE.labelsA, id);
        if (!vs.length) return null;
        const b = bboxOf(vs);
        const at = p.project([b.x1 + 0.6, (b.y0 + b.y1) / 2]);
        return (
          <span
            key={id}
            className="pointer-events-none absolute whitespace-nowrap rounded-sm bg-bf-bg-canvas/80 px-1 font-sans text-bf-2xs leading-4 text-bf-text-secondary"
            style={{ left: at.x, top: at.y - 8 }}
            data-testid="b-none-tag"
          >
            {LABEL_BY_ID.get(id)!.name} · B: none
          </span>
        );
      })}
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

/** Review the interpolation slice by slice: progress counted once; "Confirm all" is subordinate and asks again. */
export function ProposalBar() {
  const reviewed = INTERP.reviewed;
  const total = INTERP.orderJ.length;
  const unreviewed = total - reviewed;
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-bf-border-subtle bg-bf-bg-panel px-2 py-1.5" data-testid="proposal-bar">
      <div className="flex min-w-0 items-center gap-2 text-bf-xs">
        <span className="flex items-center gap-0.5" aria-hidden>
          {INTERP.orderJ.map((j, i) => (
            <span
              key={j}
              className={clsx(
                'h-1.5 w-4 rounded-[1px]',
                i < reviewed ? 'bg-bf-text-secondary' : j === INTERP.currentJ ? 'bg-bf-text-primary' : 'border border-bf-text-muted',
              )}
            />
          ))}
        </span>
        <span className="whitespace-nowrap text-bf-text-primary" data-testid="proposal-progress">
          {reviewed} of {total} reviewed
        </span>
        <span className="ml-auto whitespace-nowrap font-mono text-bf-2xs text-bf-text-muted">
          +{fmtInt(SCENE.proposal.voxels.length)} vx here · {SCENE.proposal.skipped.length} locked voxels kept
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Button variant="primary" icon={<Swatch color={LABEL_BY_ID.get(CA1)!.color} size={8} />} title="Accept CA1 on this slice and step to the next (Enter)">
          Accept CA1 here ↵
        </Button>
        <Button variant="ghost">Discard</Button>
        <IconButton aria-label="Undo inside the proposal" title="Undo inside the proposal (2 steps); document undo is separate" icon={<Undo2 />} variant="ghost" />
        <Button
          variant="ghost"
          className="ml-auto text-bf-text-muted"
          title={`${unreviewed} slices are unreviewed: asks once more, then logs "accepted unreviewed" in provenance`}
        >
          Confirm all {total}…
        </Button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- slice ruler

/** Two encodings plus the caret: solid = done (traced, reviewed, visited), open = needs review; a hairline = nothing there. */
type Mark = 'solid' | 'open' | 'none';

interface RulerRow {
  j: number;
  k: number;
  mark: Mark;
  /** Direct label for a keyframe. */
  key?: boolean;
  /** Why the slice is open (direct label of its run). */
  why?: string;
  title: string;
  /** A direct note beside the mark (round 5: "last" for the last edit). */
  note?: string;
}

function rulerRows(state: DesignState): RulerRow[] {
  const review = state === 'review';
  const proposal = state === 'proposal';
  // Review: a flagged slice is done once every region it belongs to is decided.
  const decidedIds = new Set(RECONCILE.regions.filter((g) => g.decision).flatMap((g) => g.ids));
  return [...NATIVE_SLICES_J].reverse().map((j) => {
    const k = kOf(j);
    if (review) {
      const flagged = DISAGREEMENTS.filter((r) => r.flagged && r.k === k);
      const left = flagged.filter((r) => !decidedIds.has(r.id)).length;
      const mark: Mark = flagged.length === 0 ? 'none' : left ? 'open' : 'solid';
      return { j, k, mark, why: 'decide', title: `k ${k} · ${flagged.length} flagged, ${flagged.length - left} decided` };
    }
    if (proposal) {
      const st = proposalSliceStatus(j);
      const mark: Mark = st === 'interpolated' ? 'open' : st === 'empty' ? 'none' : 'solid';
      return { j, k, mark, key: st === 'keyframe', why: 'review', title: `k ${k} · ${st === 'reviewed' ? 'interpolated, reviewed' : st === 'interpolated' ? 'interpolated, not reviewed' : st}` };
    }
    const st = tracingSliceStatus(j);
    const mark: Mark = st === 'interpolated' || st === 'ai' ? 'open' : st === 'empty' ? 'none' : 'solid';
    return { j, k, mark, why: st === 'ai' ? 'AI' : 'interp.', title: `k ${k} · ${st === 'ai' ? 'AI-touched, not reviewed' : st === 'interpolated' ? 'interpolated, not reviewed' : st}` };
  });
}

/** Contiguous runs of open rows, with the direct label of each. */
function openRuns(rows: readonly RulerRow[]): Array<{ start: number; len: number; why: string }> {
  const runs: Array<{ start: number; len: number; why: string }> = [];
  rows.forEach((r, i) => {
    const last = runs[runs.length - 1];
    if (r.mark !== 'open') return;
    if (last && last.start + last.len === i && last.why === r.why) last.len++;
    else runs.push({ start: i, len: 1, why: r.why ?? '' });
  });
  return runs;
}

/**
 * Through-plane slice ruler on the primary's edge, in native slices (k),
 * anterior at the top. Labelled directly with short horizontal captions
 * beside a bracket over each open run; the body-slab limits are hairlines.
 * Tracing and proposal: a solid bar is done, a thin hollow bar needs review.
 * Review: a solid triangle is a flagged slice whose regions are decided, a
 * hollow one is still to decide (the same ▲ as in the region header).
 */
export function SliceRuler({
  state,
  marks,
}: {
  state: DesignState;
  /** Round 5: per-k overrides (an AI result's slices: seen solid, unseen hollow "AI"; a recovered session's last edit). */
  marks?: Readonly<Record<number, { mark: 'solid' | 'open' | 'none'; why?: string; title?: string; key?: boolean; note?: string }>>;
}) {
  const rows = rulerRows(state).map((r) => (marks?.[r.k] ? { ...r, ...marks[r.k] } : r));
  const runs = openRuns(rows);
  const n = rows.length;
  const review = state === 'review';
  return (
    <div
      className="flex w-[80px] shrink-0 flex-col border-l border-bf-border-subtle bg-bf-bg-panel-sunken py-1"
      aria-label="Slice ruler, native slices"
      title={`Native slices k 1–${n}. ${review ? 'Solid ▲: flagged, region decided · hollow: to decide' : 'Solid: done · hollow: needs review'} · hairline: empty. Jump: U next unreviewed, ⌥↓ next gap${review ? ', N next flagged' : ''}.`}
      data-testid="slice-ruler"
    >
      <span className="w-[20px] text-right font-mono text-bf-2xs text-bf-text-muted">A</span>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {rows.map((r) => {
          const current = r.j === PRIMARY_J;
          const y = yOfJ(r.j);
          return (
            <div
              key={r.j}
              className={clsx('relative flex min-h-0 flex-1 items-center', current && 'bg-bf-bg-active')}
              title={r.title}
              data-status={r.mark}
            >
              {y === SLAB.toY ? <span className="absolute inset-x-0 top-0 h-px bg-bf-text-muted" title="head | body limit" aria-hidden /> : null}
              {y === SLAB.fromY ? <span className="absolute inset-x-0 bottom-0 h-px bg-bf-text-muted" title="body | tail limit" aria-hidden /> : null}
              {current ? (
                <span className="absolute left-0 top-1/2 h-0 w-0 -translate-y-1/2 border-y-[3px] border-l-[4px] border-y-transparent border-l-bf-text-primary" aria-hidden />
              ) : null}
              <span className={clsx('w-[20px] pr-0.5 text-right font-mono text-bf-2xs leading-none', current ? 'text-bf-text-primary' : 'text-bf-text-muted')}>
                {current || r.k % 5 === 0 ? r.k : ''}
              </span>
              <span className="flex w-[18px] items-center justify-center" data-mark={r.mark}>
                {r.mark === 'none' ? (
                  <span className="block h-px w-1.5 bg-bf-text-faint" />
                ) : review ? (
                  <svg width={9} height={8} aria-hidden data-shape="triangle">
                    <path
                      d="M4.5 1L8 7H1Z"
                      className={r.mark === 'solid' ? 'fill-bf-text-secondary stroke-bf-text-secondary' : 'fill-none stroke-bf-text-secondary'}
                      strokeWidth={1}
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : r.mark === 'solid' ? (
                  <span className="block h-[3px] w-3.5 bg-bf-text-secondary" data-shape="bar" />
                ) : (
                  <span className="block h-[4px] w-3.5 border border-bf-text-secondary" data-shape="hollow-bar" />
                )}
              </span>
              {r.note ? (
                <span className="pl-1 font-sans text-bf-2xs leading-none text-bf-text-secondary" data-ruler-note>
                  {r.note}
                </span>
              ) : r.key ? (
                <span className="pl-1 font-sans text-bf-2xs leading-none text-bf-text-muted">key</span>
              ) : null}
            </div>
          );
        })}
        {runs.map((run) => (
          <span
            key={run.start}
            className="pointer-events-none absolute left-[38px] flex items-center gap-[3px]"
            style={{ top: `${(run.start / n) * 100}%`, height: `${(run.len / n) * 100}%` }}
            aria-hidden
            data-ruler-caption={run.why}
          >
            <span className="h-[calc(100%-6px)] w-[3px] border-y border-r border-bf-text-muted" />
            <span className="whitespace-nowrap bg-bf-bg-panel-sunken px-px font-sans text-bf-2xs leading-none text-bf-text-muted">{run.why}</span>
          </span>
        ))}
      </div>
      <span className="w-[20px] text-right font-mono text-bf-2xs text-bf-text-muted">P</span>
    </div>
  );
}


export function OrthoHeader({ image, slab = true }: { image: SliceImage; slab?: boolean }) {
  const plane = image.plane === 'axial' ? 'axial' : 'sagittal';
  return (
    <span
      className="flex min-w-0 items-baseline gap-2 whitespace-nowrap text-bf-xs"
      title={`Resliced in the world frame, the hippocampus fitted to 80% (the corner locator shows where); CA1 only. The band and the tilted edge ticks are the primary's native slice (2.0 mm), tilted ${NATIVE.tiltDeg[plane]}° (simulated obliquity). Gutter: one tick per native slice (k ${SLICE_K} longer), the head | body | tail limits.`}
    >
      <span className="text-bf-text-primary">{PLANE_NAME[image.plane]}</span>
      <span className="font-mono text-bf-text-secondary">
        {PLANE_AXIS[image.plane]} {fmtMm(slicePositionMm(image.plane, image.index))}
      </span>
      <span className="text-bf-text-muted">
        {slab ? (
          <>
            <span className="max-[1366px]:hidden">world frame · slab ∠{NATIVE.tiltDeg[plane]}°</span>
            <span className="min-[1367px]:hidden">world · ∠{NATIVE.tiltDeg[plane]}°</span>
          </>
        ) : (
          'world frame'
        )}
      </span>
    </span>
  );
}

// ---------------------------------------------------------- bottom band

/** The pack's example at the primary's native position (k-matched), CA1 complete; mock: the template's own labels. */
const REFERENCE_J = PRIMARY_J;

export function ReferenceTile({ fovMm = 40 }: { fovMm?: number }) {
  return (
    <SliceView
      image={DESIGN.images.cor(REFERENCE_J)}
      center={SCENE.hippoCentre}
      fovMm={fovMm}
      letters={false}
      // Example style: neutral hairlines and CA1 as a flat fill, never the user's stroke grammar.
      overlays={[{ kind: 'labels', voxels: DESIGN.labels.cor(REFERENCE_J), active: [CA1], example: true }]}
      aria-label={`Reference example, coronal k ${kOf(REFERENCE_J)}`}
    />
  );
}

/**
 * Multi-contrast only: the linked contrasts at the primary's zoom and centre
 * (crosshair as edge ticks) and the reference. The T2w tile is gone (the
 * primary is the T2w), so three tiles share the width.
 */
function ContrastStrip({ fovMm }: { fovMm: number }) {
  const strip = stripViews('multi-contrast').slice(1);
  const titles = ['1.0 mm', 'view only'];
  return (
    <div className="flex h-full min-h-0 flex-col bg-bf-bg-canvas" data-testid="contrast-strip">
      <div
        className="flex h-6 shrink-0 items-center gap-2 border-b border-bf-border-subtle bg-bf-bg-panel-sunken px-2 text-bf-xs"
        title={`Same native slice, centre and zoom as the primary (${zoomFactor(fovMm)}). Hold Space to flicker T2w and T1w in the primary.`}
      >
        <span className="text-bf-text-secondary">Linked</span>
        <Sep />
        <span className="font-mono text-bf-2xs text-bf-text-muted" data-testid="strip-caption">
          k {SLICE_K}
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-3 gap-px bg-bf-border-subtle">
        {strip.map((v, i) => (
          <ViewportFrame
            key={v.image.key}
            image={v.image}
            title={
              <span className="flex items-center gap-1.5 whitespace-nowrap text-bf-xs">
                <span className="text-bf-text-primary">{v.image.contrast}</span>
                <span className="text-bf-text-muted" data-testid={v.image.viewOnly ? 'view-only-caption' : undefined}>
                  {titles[i]}
                </span>
              </span>
            }
          >
            <SliceView {...v} fovMm={fovMm} crosshairTicks letters={false} aria-label={`${v.image.contrast}, ${CONTRASTS[i + 1].role}`} />
          </ViewportFrame>
        ))}
        <section aria-label="Reference example" className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-bf-bg-canvas">
          <div className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap border-b border-bf-border-subtle bg-bf-bg-panel-sunken px-2 text-bf-xs">
            <span className="text-bf-text-primary">Example</span>
            <span className="text-bf-text-muted">pack · k {kOf(REFERENCE_J)}</span>
            <ExampleKey className="ml-auto" />
          </div>
          <div className="relative min-h-0 flex-1">
            <ReferenceTile fovMm={fovMm} />
          </div>
        </section>
      </div>
    </div>
  );
}

/** The example's own key: neutral hairline boundaries, CA1 as a flat fill (not a stroke). */
export function ExampleKey({ className }: { className?: string }) {
  return (
    <span className={clsx('flex items-center gap-1 text-bf-2xs text-bf-text-muted', className)} data-testid="example-key" title="A pack example, not your labels: boundaries are neutral hairlines and CA1 is a flat fill">
      <span className="h-2 w-3 rounded-[1px] border border-bf-text-primary/80" style={{ background: `color-mix(in srgb, ${labelColor(CA1)} 40%, transparent)` }} aria-hidden />
      example
    </span>
  );
}

// ------------------------------------------------------------ the layouts

function TraceLayout({ state }: { state: DesignState }) {
  const multi = state === 'multi-contrast';
  const review = state === 'review';
  const primary = hPrimary(state);
  const ortho = hOrtho(state);
  return (
    <div
      className="grid h-full min-h-0 gap-px bg-bf-border-subtle"
      style={{ gridTemplateColumns: 'minmax(0,1fr) var(--h-ortho)', gridTemplateRows: multi ? 'minmax(0,1fr) 264px' : 'minmax(0,1fr)' }}
    >
      <section aria-label="Primary tracing view" className="flex min-h-0 min-w-0 flex-col bg-bf-bg-canvas" data-testid="primary-panel">
        <PrimaryHeader state={state} image={primary.image} fovMm={primary.fovMm} />
        <div className="flex min-h-0 flex-1">
          <div className="relative min-h-0 min-w-0 flex-1">
            <SliceView
              {...primary}
              grid={state === 'zoom'}
              aria-label="Primary tracing view, oblique coronal T2w"
              overlay={(p) => (
                <>
                  {state === 'blocked' ? <BlockedCallout p={p} /> : null}
                  {review ? <CommentPin p={p} /> : null}
                  {review ? <BNoneTags p={p} /> : null}
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
      {multi ? (
        <div className="col-span-2 min-h-0">
          <ContrastStrip fovMm={primary.fovMm} />
        </div>
      ) : null}
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
        <ViewportFrame image={ortho.axial.image} title={<OrthoHeader image={ortho.axial.image} slab={false} />}>
          <SliceView {...ortho.axial} dim crosshair={null} />
        </ViewportFrame>
        <ViewportFrame image={ortho.sagittal.image} title={<OrthoHeader image={ortho.sagittal.image} slab={false} />}>
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

export function SessionHeader({ state, status, file }: { state: DesignState; status?: React.ReactNode; file?: string }) {
  const review = state === 'review';
  return (
    <div className="flex items-center gap-2 border-b border-bf-border-subtle px-3 py-2" title={`Labels live on the T2w grid, ${NATIVE_GEOMETRY}, ${N_SLICES} native slices`}>
      <span className="truncate text-bf-sm font-medium text-bf-text-primary">{file ?? SESSION.shortFile}</span>
      <span className="whitespace-nowrap text-bf-2xs text-bf-text-muted" data-testid="session-status">
        {status ?? (review ? 'v2 · all labels complete · vs rater B' : 'on T2w grid · unsaved')}
      </span>
      <span className="ml-auto whitespace-nowrap text-bf-2xs text-bf-text-muted">{SESSION.rater}</span>
    </div>
  );
}

export function StepProgress({ current }: { current: number }) {
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

/** The open checks, and the rule each one speaks to. */
const OPEN_CHECKS = PROTOCOL.ca1Checks.filter((c) => !c.done);
const CHECK_RULE: Record<string, number> = { 'Lateral border on the ventricle wall': 1, 'CA1/subiculum line drawn': 2, 'Every body slice from y −32 to −16': 0 };

/** C's protocol step, collapsed to one summary line (the rule for the next open check; all rules behind the chevron). */
export function StepCard({ state }: { state: DesignState }) {
  const review = state === 'review';
  const cur = review ? PROTOCOL.steps.length - 1 : PROTOCOL.currentStep;
  const summary = review
    ? 'Visit flagged first: the CA1/subiculum line and the SRLM ends.'
    : 'Rule 2 · medial border: from the SRLM tip straight down to the white matter';
  return (
    <div className="flex flex-col border-b border-bf-border-subtle bg-bf-bg-panel-raised" data-testid="step-card" data-collapsed="true">
      <button
        type="button"
        aria-expanded={false}
        title={review ? 'Show the review protocol' : `Show every rule:\n${PROTOCOL.ca1Rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`}
        className="flex h-8 items-center gap-2 px-3 text-left hover:bg-bf-bg-hover"
      >
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-bf-text-muted" aria-hidden />
        {review ? null : <Swatch color={LABEL_BY_ID.get(CA1)!.color} size={9} />}
        <span className="truncate text-bf-sm font-semibold text-bf-text-primary">{review ? 'Review vs rater B' : 'Trace CA1'}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <span className="font-mono text-bf-2xs text-bf-text-muted">
            step {cur + 1}/{PROTOCOL.steps.length}
          </span>
          <StepProgress current={cur} />
        </span>
      </button>
      {/* The rule wraps (two lines in the Inspector); it is never cut with an ellipsis. */}
      <p className="m-0 px-3 pb-2 pl-[34px] text-bf-2xs leading-snug text-bf-text-secondary" title={PROTOCOL.ca1Rules[1]} data-testid="step-rule">
        {summary}
      </p>
    </div>
  );
}

/**
 * The step's way forward, under the collapsed card: every check (the done
 * one ticked), the k-matched example large enough to read (click to
 * enlarge) and "Mark CA1 complete" (disabled until the checks are done).
 * The multi-contrast layout shows the example in its strip instead.
 */
export function StepNext({ state }: { state: DesignState }) {
  const thumb = state !== 'multi-contrast';
  return (
    <div className="flex gap-2.5 border-b border-bf-border-subtle px-3 py-2" data-testid="step-next">
      {thumb ? (
        <button
          type="button"
          className="group relative h-[112px] w-[112px] shrink-0 cursor-zoom-in overflow-hidden rounded-sm border border-bf-border-subtle p-0"
          title={`Pack example at k ${kOf(REFERENCE_J)}, CA1 complete: neutral hairline boundaries, CA1 as a flat fill. Click to enlarge; hold X to flicker it into the primary.`}
          aria-label="Enlarge the pack example"
          data-testid="reference-thumb"
        >
          <ReferenceTile fovMm={22} />
          <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-bf-bg-canvas/80 px-1 py-px text-bf-2xs text-bf-text-secondary">
            <span>example · k {kOf(REFERENCE_J)}</span>
            <Maximize2 className="h-3 w-3" aria-hidden />
          </span>
        </button>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-bf-xs" aria-label="Checks">
          {PROTOCOL.ca1Checks.map((c) => (
            <li
              key={c.text}
              className={clsx('flex min-w-0 items-start gap-1.5 leading-snug', c.done ? 'text-bf-text-muted' : 'text-bf-text-secondary')}
              data-check={c.done ? 'done' : 'open'}
              title={CHECK_RULE[c.text] ? `Rule ${CHECK_RULE[c.text]}: ${PROTOCOL.ca1Rules[CHECK_RULE[c.text] - 1]}` : undefined}
            >
              <span
                className={clsx(
                  'mt-[2px] flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-[1px] border',
                  c.done ? 'border-bf-text-secondary bg-bf-text-secondary text-bf-bg-panel' : 'border-bf-text-muted',
                )}
                aria-hidden
              >
                {c.done ? <Check className="h-2 w-2" strokeWidth={3} /> : null}
              </span>
              <span>{c.text === 'Every body slice from y −32 to −16' ? `Every body slice, k ${kOf(jOfY(SLAB.fromY))}–${kOf(jOfY(SLAB.toY))}` : c.text}</span>
            </li>
          ))}
        </ul>
        <span>
          <Button
            variant="secondary"
            size="sm"
            disabled
            title={`Finish the ${OPEN_CHECKS.length} open checks first. Marking complete locks CA1 and opens every label in the slice matrix for a last look.`}
          >
            Mark CA1 complete
          </Button>
        </span>
      </div>
    </div>
  );
}

type MatrixEmphasis = 'active' | 'inactive' | 'quiet';

interface MatrixRow {
  id: number;
  values: readonly number[];
  emphasis: MatrixEmphasis;
  note?: string;
  /** The pack's expected k-range: a faint band behind the bars. */
  expected?: readonly [number, number];
  flags?: readonly AreaFlag[];
  /** Slices where the label has an island (a neutral ring under the bar). */
  islands?: readonly number[];
  /** Slices drawn as hollow bars (a pending proposal, not yet reviewed). */
  hollow?: readonly number[];
}

const FLAG_WORD: Record<AreaFlag['kind'], string> = { gap: 'gap', jump: 'jump', outside: 'out', missing: 'missing' };

/** "jump ×3 · out": what is wrong with a row, in words, at its end. */
function flagSummary(flags: readonly AreaFlag[]): string {
  const counts = new Map<string, number>();
  for (const f of flags) counts.set(FLAG_WORD[f.kind], (counts.get(FLAG_WORD[f.kind]) ?? 0) + 1);
  return [...counts].map(([w, n]) => (n > 1 ? `${w} ×${n}` : w)).join(' · ');
}

function flagTitle(f: AreaFlag): string {
  if (f.kind === 'jump') return `area changes by more than 40% from k ${f.k - 1} to k ${f.k}`;
  if (f.kind === 'gap') return `k ${f.k} is empty between traced slices`;
  if (f.kind === 'outside') return `traced on k ${f.k}, outside the pack's expected range`;
  return `missing on k ${f.k}, inside the pack's expected range`;
}

/** Ruler order: k 20 (anterior) at the left, as the ruler reads top to bottom. */
const colOfK = (k: number) => N_SLICES - k;

/**
 * Small multiples by native slice on ONE common scale (the maximum is
 * printed once, in the caption): a row of bars per label in the slice
 * ruler's order (anterior k 20 left), k 11 marked through every row. Bars
 * use each label's own colour at its emphasis (muted rows are tints, not
 * alpha). Behind each row a faint band is the pack's expected k-range;
 * problems are short warning ticks above the slice and named at the row's
 * end (gap, jump > 40%, out of range); islands are a neutral ring under the
 * bar; a pending proposal is hollow bars. Every slice is a button: click to
 * go there. `more` rows sit behind a "Show all labels" disclosure.
 */
export function SliceMatrix({
  rows,
  more = [],
  caption,
  testId,
  unit = 'vx',
  hover = null,
}: {
  rows: readonly MatrixRow[];
  more?: readonly MatrixRow[];
  caption: React.ReactNode;
  testId: string;
  unit?: string;
  /** A slice shown as hovered (static capture of the click affordance). */
  hover?: { id: number; k: number } | null;
}) {
  const max = Math.max(1, ...[...rows, ...more].flatMap((r) => r.values));
  const pct = (k: number) => `${((colOfK(k) + 0.5) / N_SLICES) * 100}%`;
  const hovered = hover ? [...rows, ...more].find((r) => r.id === hover.id) : null;
  const renderRow = (r: MatrixRow) => {
    const def = LABEL_BY_ID.get(r.id)!;
    const colour = labelTint(r.id, r.emphasis);
    const flaggedK = new Set((r.flags ?? []).map((f) => f.k));
    return (
      <div key={r.id} className="flex items-center gap-2" style={{ height: 22 }} data-matrix-row={r.id} data-emphasis={r.emphasis}>
        <span className={clsx('w-[52px] shrink-0 truncate text-bf-2xs', r.emphasis === 'active' ? 'font-medium text-bf-text-primary' : 'text-bf-text-secondary')}>
          {def.name}
        </span>
        <span className="relative block h-full min-w-0 flex-1">
          {r.expected ? (
            <span
              className="absolute bottom-[4px] top-[4px] bg-bf-text-primary/[0.07]"
              style={{
                left: `${(colOfK(r.expected[1]) / N_SLICES) * 100}%`,
                width: `${((r.expected[1] - r.expected[0] + 1) / N_SLICES) * 100}%`,
              }}
              data-expected={`${r.expected[0]}-${r.expected[1]}`}
              aria-hidden
            />
          ) : null}
          <span className="absolute inset-x-0 bottom-[4px] h-px bg-bf-text-faint" aria-hidden />
          <span className="absolute bottom-0 top-0 w-px bg-bf-text-muted" style={{ left: pct(SLICE_K) }} aria-hidden />
          <span className="absolute inset-0 flex">
            {Array.from({ length: N_SLICES }, (_, c) => {
              const k = N_SLICES - c;
              const v = r.values[k - 1] ?? 0;
              const h = v > 0 ? Math.max(1, (v / max) * 13) : 0;
              const hollow = r.hollow?.includes(k);
              const isHover = hover?.id === r.id && hover.k === k;
              const flags = (r.flags ?? []).filter((f) => f.k === k);
              return (
                <button
                  key={k}
                  type="button"
                  className={clsx(
                    'relative h-full min-w-0 flex-1 cursor-pointer p-0 hover:bg-bf-bg-hover',
                    isHover && 'bg-bf-bg-hover shadow-[inset_0_0_0_1px_var(--bf-text-muted)]',
                  )}
                  title={`${def.name} · k ${k} · ${v} ${unit}${hollow ? ' (proposed, not reviewed)' : ''}${flags.length ? ` · ${flags.map(flagTitle).join('; ')}` : ''}. Click to go to k ${k}.`}
                  aria-label={`${def.name}, k ${k}: ${v} ${unit}`}
                  data-k={k}
                  data-hovered={isHover || undefined}
                >
                  {v > 0 ? (
                    <span
                      className={clsx('absolute bottom-[4px] left-px right-px block', hollow && 'border')}
                      style={hollow ? { height: h, borderColor: colour } : { height: h, background: colour }}
                      data-bar={hollow ? 'hollow' : 'solid'}
                    />
                  ) : null}
                  {flaggedK.has(k) ? <span className="absolute left-1/2 top-0 block h-[4px] w-[2px] -translate-x-1/2 bg-bf-warning" data-flag={flags.map((f) => f.kind).join(' ')} /> : null}
                  {r.islands?.includes(k) ? (
                    <span className="absolute bottom-0 left-1/2 block h-[4px] w-[4px] -translate-x-1/2 rounded-full border border-bf-text-secondary" data-island-k={k} />
                  ) : null}
                </button>
              );
            })}
          </span>
          {r.note ? <span className="pointer-events-none absolute bottom-[6px] left-1 text-bf-2xs leading-none text-bf-text-muted">{r.note}</span> : null}
        </span>
        <span className="w-[74px] shrink-0 whitespace-nowrap text-right text-bf-2xs text-bf-warning" data-flag-summary>
          {r.flags?.length ? flagSummary(r.flags) : ''}
        </span>
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-1 px-3 py-2" data-testid={testId}>
      <span className="flex items-baseline gap-2 text-bf-2xs text-bf-text-muted">
        {caption}
        <span className="ml-auto font-mono" data-testid={`${testId}-scale`} title="Every row on one scale: the tallest bar in any row is this many voxels">
          one scale · max {fmtInt(max)} {unit}
        </span>
      </span>
      <div className="flex flex-col">
        {rows.map(renderRow)}
        {more.length ? (
          <details className="group" data-testid={`${testId}-more`}>
            <summary className="flex h-5 cursor-pointer select-none items-center text-bf-2xs text-bf-text-secondary">Show all labels ({more.length} more)</summary>
            {more.map(renderRow)}
          </details>
        ) : null}
        <div className="flex items-start gap-2" aria-hidden>
          <span className="w-[52px] shrink-0 text-right font-mono text-bf-2xs leading-4 text-bf-text-faint">A</span>
          <span className="relative block h-4 min-w-0 flex-1 font-mono text-bf-2xs leading-4">
            {[20, 15, 10, 5, 1]
              .filter((k) => Math.abs(k - SLICE_K) > 1)
              .map((k) => (
                <span key={k} className="absolute -translate-x-1/2 text-bf-text-faint" style={{ left: pct(k) }}>
                  {k}
                </span>
              ))}
            <span className="absolute -translate-x-1/2 text-bf-text-primary" style={{ left: pct(SLICE_K) }} data-current-k>
              {SLICE_K}
            </span>
          </span>
          <span className="w-[74px] shrink-0 font-mono text-bf-2xs leading-4 text-bf-text-faint">P</span>
        </div>
        {hovered && hover ? (
          <span className="pt-0.5 font-mono text-bf-2xs text-bf-text-secondary" data-testid={`${testId}-hover`}>
            {LABEL_BY_ID.get(hovered.id)!.name} k {hover.k} · {hovered.values[hover.k - 1]} {unit}
            {(hovered.flags ?? []).filter((f) => f.k === hover.k).map((f) => ` · ${FLAG_WORD[f.kind]}`)} · click: go to k {hover.k}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Native slices where a label has islands (mock: the slices with rater A's labels; k 11 from the tracing scene). */
function islandSlices(label: number): number[] {
  const out: number[] = [];
  for (const j of NATIVE_SLICES_J) {
    const k = kOf(j);
    if (j === PRIMARY_J) {
      if (ISLANDS_HERE > 0) out.push(k);
      continue;
    }
    if (areaByNativeSlice(label)[k - 1] === 0 || !DESIGN.labels.corJ.includes(j)) continue;
    if (labelIslands(DESIGN.labels.cor(j), label).length) out.push(k);
  }
  return out;
}

/**
 * The tracing matrix: the active label's row, every row with a flagged
 * problem, and the rest behind "Show all labels". In the proposal the CA1
 * row shows the pending slices as hollow bars (reviewed slices solid).
 */
function tracingMatrixRows(state: DesignState): { rows: MatrixRow[]; more: MatrixRow[] } {
  const all = LABEL_DEFS.map((d): MatrixRow => {
    const vol = LABEL_VOLUMES[d.id];
    let values = areaByNativeSlice(d.id);
    let hollow: number[] | undefined;
    if (d.id === CA1 && state === 'proposal') {
      // Keyframes and proposed slices from the interpolation; unreviewed slices hollow.
      const full = areaByNativeSlice(CA1, 'all');
      const ks = [...INTERP.keyframesJ, ...INTERP.orderJ].map(kOf);
      values = full.map((v, i) => (ks.includes(i + 1) ? v : 0));
      hollow = INTERP.orderJ.slice(INTERP.reviewed).map(kOf);
    }
    const expected = PROTOCOL.expectedK[d.id];
    const flags = d.id === CA1 && state === 'proposal' ? [] : areaFlags(values, expected ?? null, vol?.complete ?? false);
    return {
      id: d.id,
      values,
      emphasis: d.id === CA1 ? 'active' : QUIET_LABELS.includes(d.id) ? 'quiet' : 'inactive',
      note: values.every((v) => v === 0) ? 'not started' : undefined,
      expected,
      flags,
      islands: d.id === CA1 && state !== 'proposal' ? islandSlices(CA1) : undefined,
      hollow,
    };
  });
  return {
    rows: all.filter((r) => r.id === CA1 || (r.flags?.length ?? 0) > 0),
    more: all.filter((r) => r.id !== CA1 && !(r.flags?.length ?? 0)),
  };
}

/** The tracing capture shows one slice as hovered (the first flagged jump), so the click affordance is visible. */
const HOVER_DEMO = (() => {
  const { rows } = tracingMatrixRows('tracing');
  const r = rows.find((x) => x.flags?.some((f) => f.kind === 'jump'));
  const f = r?.flags?.find((x) => x.kind === 'jump');
  return r && f ? { id: r.id, k: f.k } : null;
})();

/**
 * The Labels section and the slice matrix. Round 5: `pending` shows a
 * proposal on CA1 that is not the fill-between one (an AI result): its
 * slices as hollow bars over the traced ones, the label's status Proposal.
 */
export function LabelsSection({
  state,
  pending,
  hover,
}: {
  state: DesignState;
  pending?: { values: readonly number[]; hollow: readonly number[] };
  hover?: { id: number; k: number } | null;
}) {
  const base = tracingMatrixRows(state);
  const matrix = pending
    ? {
        rows: base.rows.map((r) => (r.id === CA1 ? { ...r, values: pending.values, hollow: pending.hollow, flags: [], islands: undefined } : r)),
        more: base.more,
      }
    : base;
  const labels = sessionLabels(
    Object.fromEntries(
      [...LABEL_BY_ID.keys()].map((id) => [
        id,
        {
          ...(id === CA1 && (state === 'proposal' || pending) ? { status: 'proposal' as const } : {}),
          ...(id !== CA1 && id !== 4 && id !== 5 ? { lockReason: `Complete and locked: step ${id === 6 ? 3 : id === 3 ? 4 : 5}` } : {}),
        },
      ]),
    ),
  );
  return (
    <>
      <Section
        title="Labels"
        meta="6"
        variant="static"
        divider={false}
        actions={
          <span className="flex items-center gap-0.5">
            <TextToggle
              pressed={false}
              title="Outline only (O): drop the active label's faint fill. Hold F for fills on every label."
            >
              Outline only
            </TextToggle>
            <TextToggle
              pressed={isPaint(state) && state !== 'blocked'}
              title={`Neighbour slice (,): CA1 on k ${kOf(PREV_J)} as a faint grey line where it departs from k ${SLICE_K}; hold , for k ${kOf(NEXT_J)}`}
            >
              Neighbour
            </TextToggle>
            <IconButton aria-label="New label" title="New label" icon={<Plus />} size="sm" variant="ghost" />
          </span>
        }
        bodyClassName="px-0"
      >
        <LabelList labels={labels} activeId={CA1} grid={GRID} showEye={false} lockDisplay="departures" />
      </Section>
      <SliceMatrix
        testId="slice-matrix"
        caption={
          <span title="Area per native slice on the slice ruler's axis (anterior left), every row on one scale. Band: the pack's expected range. Ticks: a gap, a jump over 40% or a slice out of range. Ring: an island. Click a slice to go there.">
            Area by native slice
          </span>
        }
        {...matrix}
        hover={hover !== undefined ? hover : state === 'tracing' ? HOVER_DEMO : null}
      />
    </>
  );
}

function fmtDelta(v: number | null): string {
  if (v === null) return 'n/a';
  const t = `${Math.abs(v).toFixed(0)}%`;
  return v > 0.5 ? `+${t}` : v < -0.5 ? `−${t}` : '0%';
}

/** Label · Dice · Δ only; HD95 and the per-slice rows are behind a disclosure. */
function AgreementTable() {
  return (
    <table className="w-full border-collapse text-bf-xs" data-testid="agreement-table">
      <thead>
        <tr className="text-bf-2xs text-bf-text-muted">
          <th className="py-0.5 text-left font-normal">Label</th>
          <th className="w-14 py-0.5 text-right font-normal">Dice</th>
          <th className="w-16 py-0.5 text-right font-normal" title="(B − A) / A">
            Δ B−A
          </th>
        </tr>
      </thead>
      <tbody>
        {REVIEW_ROWS.map((d) => {
          const def = LABEL_BY_ID.get(d.label)!;
          const low = d.dice !== null && d.dice < DICE_THRESHOLD;
          return (
            <tr key={d.label} className="text-bf-text-secondary">
              <td className="py-0.5">
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <Swatch color={def.color} size={8} />
                  {def.name}
                </span>
              </td>
              <td className={clsx('py-0.5 text-right font-mono tabular-nums', low ? 'text-bf-warning' : d.dice === null ? 'text-bf-text-muted' : 'text-bf-text-primary')}>
                {d.dice === null ? 'n/a' : d.dice.toFixed(2)}
                <span className="inline-block w-3 text-center">{low ? '▲' : ''}</span>
              </td>
              <td className="py-0.5 text-right font-mono tabular-nums">
                {d.volB ? fmtDelta(d.deltaPct) : <span className="font-sans text-bf-text-muted">B: none</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Rater A's volume and HD95 split into in-plane and through-plane columns (no "1.0/2" fraction). */
function Hd95Table() {
  return (
    <table className="w-full border-collapse text-bf-xs" data-testid="hd95-table">
      <thead>
        <tr className="text-bf-2xs text-bf-text-muted">
          <th className="py-0.5 text-left font-normal">Label</th>
          <th className="w-14 py-0.5 text-right font-normal">A mm³</th>
          <th className="w-16 py-0.5 text-right font-normal" title="HD95 in mm, within the slice">
            HD95 in
          </th>
          <th className="w-16 py-0.5 text-right font-normal" title="HD95 in mm, across slices: whole 2.0 mm native slices (mock)">
            HD95 thru
          </th>
        </tr>
      </thead>
      <tbody>
        {REVIEW_ROWS.map((d) => (
          <tr key={d.label} className="text-bf-text-secondary">
            <td className="py-0.5">{LABEL_BY_ID.get(d.label)!.name}</td>
            <td className="py-0.5 text-right font-mono tabular-nums">{fmtInt(d.volA * NATIVE.voxelMm3)}</td>
            <td className="py-0.5 text-right font-mono tabular-nums">{d.hd95InPlane === null ? <span className="font-sans text-bf-text-muted">n/a</span> : d.hd95InPlane.toFixed(1)}</td>
            <td className="py-0.5 text-right font-mono tabular-nums">{d.hd95Through === null ? <span className="font-sans text-bf-text-muted">n/a</span> : d.hd95Through.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The texture legend, shown on hover of "Both" and inside the details. */
const TEXTURE_LEGEND = 'Rater A (you): solid, label colour · rater B: grey dash, only where it departs · A only: dots · B only: dense hatch · relabelled: crossed. Labels B did not trace are outlined only.';

function DisagreementHeader() {
  return (
    <div className="flex items-center gap-1 px-3">
      <span className="text-bf-xs text-bf-text-secondary">Disagreements</span>
      <span
        className="font-mono text-bf-2xs tabular-nums text-bf-text-muted"
        title={`▲ flagged: a protocol landmark or ≥ ${FLAG_MIN_VX} vx; grouped into regions (one label at one landmark), decided once per region`}
      >
        {REVIEW_NAV.total} · ▲ {REVIEW_NAV.flagged} in {RECONCILE.regions.length} regions
      </span>
      <span className="ml-auto flex items-center gap-0.5">
        <IconButton aria-label="Previous region" title="Previous flagged region (⇧N)" icon={<ChevronLeft />} variant="ghost" size="sm" />
        <IconButton aria-label="Next region" title="Next flagged region (N)" icon={<ChevronRight />} variant="ghost" size="sm" />
      </span>
    </div>
  );
}

/** "k 9–11, 14": a region's slices as runs. */
function fmtKs(ks: readonly number[]): string {
  const runs: Array<[number, number]> = [];
  for (const k of ks) {
    const last = runs[runs.length - 1];
    if (last && k === last[1] + 1) last[1] = k;
    else runs.push([k, k]);
  }
  return `k ${runs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ')}`;
}

/**
 * Reconciliation: flagged disagreements grouped by region, each decided once
 * (Keep A, Take B or Edit; keys 1, 2, E), applied across the region's slices
 * and logged. The region being reconciled is open: its slices (visited ones
 * ticked, the one under the cursor marked) and the three actions.
 */
function ReconcileList() {
  const visited = new Set(REVIEW_NAV.visitedIds);
  return (
    <ol className="m-0 flex list-none flex-col p-0" aria-label="Flagged regions" data-testid="reconcile-list">
      {RECONCILE.regions.map((g) => {
        const def = LABEL_BY_ID.get(g.label)!;
        const current = g.key === RECONCILE.current;
        const slices = g.ids.map((id) => DISAGREEMENTS.find((d) => d.id === id)!).sort((a, b) => a.k - b.k);
        return (
          <li key={g.key} aria-current={current ? 'true' : undefined} data-region={g.key} data-decision={g.decision ?? (current ? 'open' : 'todo')}>
            <SelectableRow selected={current} tabIndex={current ? 0 : -1} className={clsx('min-h-6 gap-2 text-bf-xs', current ? 'text-bf-text-primary' : 'text-bf-text-secondary')}>
              <span className="w-3 shrink-0 text-center">{g.decision ? <Check className="h-3 w-3 text-bf-text-secondary" aria-label="decided" /> : null}</span>
              <Swatch color={def.color} size={8} />
              <span className="min-w-0 flex-1 truncate">
                {def.name}
                <span className="text-bf-text-muted"> · {g.landmark ?? `≥ ${FLAG_MIN_VX} vx`}</span>
              </span>
              <span className="shrink-0 font-mono text-bf-2xs tabular-nums text-bf-text-muted">{fmtKs(g.ks)}</span>
              <span className="w-[46px] shrink-0 text-right text-bf-2xs text-bf-text-muted">{g.decision ? RECONCILE_LABEL[g.decision] : `${g.vx} vx`}</span>
            </SelectableRow>
            {current ? (
              <div className="flex flex-col gap-1.5 border-l-2 border-bf-accent py-1.5 pl-[30px] pr-3" data-testid="reconcile-open">
                <span className="flex flex-wrap gap-x-2.5 gap-y-0.5 font-mono text-bf-2xs tabular-nums text-bf-text-muted">
                  {slices.map((d) => (
                    <span key={d.id} className={clsx('flex items-center gap-0.5', d.id === REVIEW_NAV.current && 'text-bf-text-primary')} title={`k ${d.k}: ${d.vx} vx disagree${visited.has(d.id) ? ', visited' : ''}`}>
                      {visited.has(d.id) ? <Check className="h-2.5 w-2.5" aria-label="visited" /> : <span className="inline-block w-2.5" />}k {d.k} · {d.vx}
                    </span>
                  ))}
                </span>
                <span className="flex items-center gap-1">
                  <Button size="sm" variant="secondary" title="Keep rater A's labels across this region's slices (1); logged">
                    Keep A <kbd className="ml-1 font-mono text-bf-2xs text-bf-text-muted">1</kbd>
                  </Button>
                  <Button size="sm" variant="secondary" title="Take rater B's labels across this region's slices (2); logged">
                    Take B <kbd className="ml-1 font-mono text-bf-2xs text-bf-text-muted">2</kbd>
                  </Button>
                  <Button size="sm" variant="ghost" title="Edit this region by hand (E): the brush opens on its first slice; logged as edited">
                    Edit <kbd className="ml-1 font-mono text-bf-2xs text-bf-text-muted">E</kbd>
                  </Button>
                  <span className="ml-auto whitespace-nowrap text-bf-2xs text-bf-text-muted">{g.ks.length} slices</span>
                </span>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Return is the default; Approve waits until every flagged region is decided (counted once, here). */
function ReconcileDecision() {
  const total = RECONCILE.regions.length;
  const decided = RECONCILE.decided.length;
  const approve = canApprove(RECONCILE.decided, total);
  return (
    <div className="flex flex-col gap-2" data-testid="review-decision">
      <TextArea aria-label="Comment for rater B" rows={2} defaultValue="Subiculum medial border stops short of the SRLM tip (rule 2); see pin 1." />
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="primary">Return to rater B</Button>
        <Button variant="secondary" disabled={!approve} title={approve ? undefined : `Decide every flagged region first (${total - decided} left)`}>
          Approve
        </Button>
        {!approve ? (
          <span className="text-bf-2xs text-bf-text-muted" data-testid="decided-count">
            {decided} of {total} regions decided
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Review in the order the decision needs it: the flagged regions (one
 * header, reconciled region by region), then the note and the decision (the
 * only progress count, next to Approve), then agreement as Label · Dice · Δ
 * with HD95, the per-slice rows and the texture legend behind a disclosure.
 */
function ReviewInspector() {
  const unflagged = DISAGREEMENTS.filter((r) => !r.flagged).length;
  return (
    <div className="flex flex-col gap-2.5 py-2.5" data-testid="review-inspector">
      <section className="flex flex-col gap-1" data-review-part="disagreements">
        <DisagreementHeader />
        <ReconcileList />
        <span className="px-3 text-bf-2xs text-bf-text-muted" title="Smaller regions away from the protocol landmarks: listed after the flagged ones, not needed for Approve">
          {unflagged} unflagged below
        </span>
      </section>
      <section className="border-t border-bf-border-subtle px-3 pt-2.5" data-review-part="decision">
        <ReconcileDecision />
      </section>
      <section className="flex flex-col gap-1.5 border-t border-bf-border-subtle px-3 pt-2.5" data-review-part="agreement">
        <div className="flex items-center gap-2">
          <span className="text-bf-xs text-bf-text-secondary">Agreement</span>
          <span className="text-bf-2xs text-bf-text-muted">whole structure</span>
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
            className="ml-auto"
            title={`Show rater A, rater B or both (A / B / ⇧B). ${TEXTURE_LEGEND}`}
          />
        </div>
        <AgreementTable />
        <details className="text-bf-2xs text-bf-text-muted" data-testid="review-details">
          <summary className="cursor-pointer select-none text-bf-text-secondary">Volumes, HD95, by slice and legend</summary>
          <div className="flex flex-col gap-2 pt-1.5">
            <Hd95Table />
            <div className="-mx-3">
              <SliceMatrix
                testId="review-matrix"
                caption="Disagreeing voxels by native slice"
                rows={REVIEW_ROWS.map((r) => ({
                  id: r.label,
                  values: r.bySlice,
                  emphasis: r.dice !== null && r.dice < DICE_THRESHOLD ? 'active' : 'inactive',
                  note: r.volB ? undefined : 'B: none',
                }))}
              />
            </div>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1" data-rater="b">
              <span className="flex items-center gap-1.5">
                <LineSample color={labelColor(CA1)} />A solid
              </span>
              <span className="flex items-center gap-1.5">
                <LineSample dashed muted />B where it departs
              </span>
              <span className="flex items-center gap-1">
                <TextureSwatch kind="a-only" />A only
              </span>
              <span className="flex items-center gap-1">
                <TextureSwatch kind="b-only" />B only
              </span>
              <span className="flex items-center gap-1">
                <TextureSwatch kind="relabelled" />relabelled
              </span>
            </span>
            <span>▲ Dice &lt; {DICE_THRESHOLD.toFixed(2)} · Δ = (B − A) / A · ERC: not traced by B (outlined only)</span>
          </div>
        </details>
      </section>
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

/** The Inspector's frame: the Inspect | Segment tabs over a scrolling body. */
export function InspectorFrame({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <aside aria-label="Inspector" className="flex w-[var(--h-inspector)] shrink-0 flex-col border-l border-bf-border-subtle bg-bf-bg-panel" data-testid={testId}>
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
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}

function Inspector({ state }: { state: DesignState }) {
  return (
    <InspectorFrame>
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
                <StepNext state={state} />
                <LabelsSection state={state} />
              </>
            )}
          </>
        )}
    </InspectorFrame>
  );
}

function Status({ state }: { state: DesignState }) {
  const [x, y, z] = CROSSHAIR_WORLD;
  const editing = state !== 'empty' && state !== 'review';
  return (
    <>
      <StatusItem label="Crosshair" value={`(${fmtMm(x)}, ${fmtMm(y)}, ${fmtMm(z)})`} />
      {editing ? <StatusItem label="Label" value="CA1" mono={false} /> : null}
      {editing ? <StatusItem label="History" value={`${SESSION.historySteps} steps`} /> : null}
    </>
  );
}

/**
 * H's shell: top bar with the mode switcher, the status bar and the mock
 * disclosure, and the rail | main | Inspector row with the panel widths
 * (Inspector 336 px, orthogonal column 240 px; 304 and 220 at 1366 and
 * below). Round 5's workflow states fill the same slots.
 */
export function HShell({
  mode = 'trace',
  status,
  rail,
  inspector,
  children,
  paint,
  simulatedGeometry = NATIVE_GEOMETRY,
  disclosure,
  testState,
}: {
  mode?: string;
  status: React.ReactNode;
  rail: React.ReactNode;
  inspector: React.ReactNode;
  children: React.ReactNode;
  paint?: boolean;
  simulatedGeometry?: string;
  disclosure?: string;
  testState?: string;
}) {
  return (
    <ShellFrame center={<ModeSwitcher value={mode} />} right={<Button variant="ghost">Workspace</Button>} status={status} simulatedGeometry={simulatedGeometry} disclosure={disclosure}>
      <div
        className="relative flex h-full min-h-0 [--h-inspector:336px] [--h-ortho:240px] max-[1366px]:[--h-inspector:304px] max-[1366px]:[--h-ortho:220px]"
        data-direction="h"
        data-paint={paint || undefined}
        data-state={testState}
      >
        {rail}
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        {inspector}
      </div>
    </ShellFrame>
  );
}

export function DirectionH({ state }: { state: DesignState }) {
  return (
    <HShell
      mode={state === 'empty' ? 'orthogonal' : 'trace'}
      status={<Status state={state} />}
      paint={isPaint(state)}
      rail={<ToolRail state={state} />}
      inspector={<Inspector state={state} />}
    >
      {state === 'empty' ? <EmptyLayout /> : <TraceLayout state={state} />}
    </HShell>
  );
}
