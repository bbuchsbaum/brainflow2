/**
 * Direction B, "Reading room": image-maximal. The primary slice fills the
 * workspace; chrome recedes to the edges. Tools live in a slim palette that
 * follows the cursor, the label list is a collapsible overlay on the left
 * edge, the orthogonal views are small insets, linked contrasts are a film
 * strip along the bottom, and fill-between keyframes sit on a slice rail at
 * the right edge. The quietest chrome that still shows every constraint.
 */

import React from 'react';
import clsx from 'clsx';
import {
  Brush,
  ChevronDown,
  ChevronLeft,
  Eraser,
  Layers3,
  LogOut,
  MousePointer2,
  PaintBucket,
  PenTool,
  Plus,
  Undo2,
} from 'lucide-react';
import { Button, IconButton, Notice } from '@/components/ui/bf';
import { ConstraintStrip } from '@/modules/segmentation/components/shared/ConstraintStrip';
import { LabelList } from '@/modules/segmentation/components/shared/LabelList';
import {
  DisagreementNav,
  ProposalPill,
  ProposalSummary,
  ReviewDecision,
  ReviewLegend,
} from '@/modules/segmentation/components/shared/ProposalParts';
import { SliceView, type Projector } from '@/modules/segmentation/components/shared/SliceView';
import { Kbd, LensBadge, ShellFrame, SliceTitle, StatusItem, Swatch } from '@/modules/segmentation/components/shared/chrome';
import { blockedCopy } from '@/modules/segmentation/components/shared/copy';
import { fmtMm } from '@/modules/segmentation/components/shared/geometry';
import {
  BRUSH,
  CA1,
  CONTRASTS,
  DG,
  KEYFRAMES,
  LABEL_BY_ID,
  PROPOSAL,
  SESSION,
  labelColor,
  sessionLabels,
} from '@/modules/segmentation/components/shared/mockData';
import { CROSSHAIR_WORLD, FOV, SCENE } from '@/modules/segmentation/components/shared/scenes';
import { orthoViews, primaryView, stripViews, zoomFactor, type PanelProps } from '@/modules/segmentation/components/shared/views';
import type { DesignState } from '@/modules/segmentation/components/shared/types';
import { DESIGN } from '@/modules/segmentation/__design__/designData';

const floating = 'rounded-sm border border-bf-border-subtle bg-bf-bg-panel-raised/95 shadow-bf-panel';

/** The palette that follows the cursor: tools, size, active label. */
function CursorPalette({ p, at, state }: { p: Projector; at: readonly [number, number]; state: DesignState }) {
  const pos = p.project(at);
  const tool = state === 'proposal' ? 'interpolate' : 'brush';
  const tools = [
    { id: 'navigate', icon: <MousePointer2 />, name: 'Navigate', key: 'V' },
    { id: 'brush', icon: <Brush />, name: 'Brush', key: 'B' },
    { id: 'eraser', icon: <Eraser />, name: 'Eraser', key: 'E' },
    { id: 'contour', icon: <PenTool />, name: 'Contour', key: 'P' },
    { id: 'fill', icon: <PaintBucket />, name: 'Fill', key: 'F' },
    { id: 'interpolate', icon: <Layers3 />, name: 'Fill between slices', key: 'I' },
  ];
  const def = LABEL_BY_ID.get(CA1)!;
  return (
    <div
      role="toolbar"
      aria-label="Tools"
      className={clsx('absolute flex items-center gap-0.5 p-0.5', floating)}
      style={{ left: pos.x - 24, top: pos.y + BRUSH.radiusMm * p.scale + 14 }}
    >
      {tools.map((t) => (
        <IconButton key={t.id} aria-label={`${t.name} (${t.key})`} icon={t.icon} pressed={t.id === tool} />
      ))}
      <span className="mx-1 h-4 w-px bg-bf-border-subtle" />
      <span className="px-1 font-mono text-bf-xs text-bf-text-primary">⌀ {(BRUSH.radiusMm * 2).toFixed(1)}</span>
      <span className="mx-1 h-4 w-px bg-bf-border-subtle" />
      <Button variant="ghost" aria-label="Active label CA1" icon={<Swatch color={def.color} size={9} />}>
        {def.name}
        <ChevronDown className="h-3 w-3 text-bf-text-muted" aria-hidden />
      </Button>
    </div>
  );
}

/** Labels: an overlay on the left edge, or a column of swatches when collapsed. */
function LabelOverlay({ state, collapsed }: { state: DesignState; collapsed: boolean }) {
  const labels = sessionLabels(state === 'proposal' ? { [CA1]: { status: 'proposal' } } : {});
  if (collapsed) {
    return (
      <div className={clsx('absolute left-3 top-14 flex flex-col items-center gap-1 p-1', floating)} aria-label="Labels (collapsed)">
        {labels.map((l) => (
          <span
            key={l.id}
            title={l.name}
            className={clsx(
              'flex h-6 w-6 items-center justify-center rounded-sm',
              l.id === CA1 && 'bg-bf-bg-active shadow-[inset_2px_0_0_var(--bf-border-focus)]',
            )}
          >
            <Swatch color={l.color} size={10} />
          </span>
        ))}
        <span className="mt-1 font-mono text-bf-2xs text-bf-text-muted">L</span>
      </div>
    );
  }
  return (
    <div className={clsx('absolute left-3 top-14 w-[248px]', floating)} aria-label="Labels">
      <div className="flex h-7 items-center gap-2 border-b border-bf-border-subtle px-2">
        <span className="text-bf-xs font-medium text-bf-text-primary">Labels</span>
        <span className="font-mono text-bf-2xs text-bf-text-muted">{SESSION.shortFile}</span>
        <IconButton aria-label="Collapse labels" icon={<ChevronLeft />} className="ml-auto" />
      </div>
      <LabelList
        labels={labels}
        activeId={CA1}
        density="compact"
        hoveredId={state === 'tracing' ? DG : undefined}
        alertId={state === 'blocked' ? DG : undefined}
        showStatus={false}
        className="py-0.5"
      />
      <div className="flex items-center gap-1.5 border-t border-bf-border-subtle px-2 py-1 text-bf-2xs text-bf-text-muted">
        <Kbd>&lt;</Kbd>
        <Kbd>&gt;</Kbd>
        label
        <Kbd>L</Kbd>
        lock
        <span className="ml-auto">{labels.filter((l) => l.locked).length} locked</span>
      </div>
    </div>
  );
}

function Inset({ view, title }: { view: PanelProps; title: string }) {
  return (
    <div className="relative h-[184px] w-[220px] overflow-hidden rounded-sm border border-bf-border bg-bf-bg-canvas">
      <SliceView {...view} letters={false} />
      <span className="pointer-events-none absolute left-1 top-1 rounded-sm bg-bf-bg-canvas/80 px-1 font-mono text-bf-2xs text-bf-text-secondary">
        {title}
      </span>
    </div>
  );
}

function FilmStrip({ state }: { state: DesignState }) {
  const big = state === 'multi-contrast';
  const views = state === 'empty' ? stripViews('empty').slice(0, 2) : stripViews(state);
  return (
    <div
      className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-end gap-2 rounded-sm bg-bf-bg-canvas/85 p-1.5"
      aria-label="Linked contrasts"
    >
      {views.map((v, i) => {
        const current = i === 0;
        const contrast = CONTRASTS[i];
        return (
          <figure key={v.image.key} className="m-0 flex flex-col gap-1">
            <div
              className={clsx(
                'relative overflow-hidden rounded-sm bg-bf-bg-canvas',
                big ? 'h-[236px] w-[300px]' : 'h-[92px] w-[124px]',
                current ? 'border border-bf-text-primary' : 'border border-bf-border',
              )}
            >
              <SliceView
                {...v}
                {...(state === 'empty' ? { overlays: [], center: [96.5, 110] as const, fovMm: 170 } : {})}
                letters={false}
              />
              {v.image.viewOnly ? (
                <span className="absolute right-1 top-1">
                  <LensBadge />
                </span>
              ) : null}
            </div>
            <figcaption className="flex items-center gap-1.5 px-0.5 text-bf-2xs">
              <Kbd>{i + 1}</Kbd>
              <span className={current ? 'text-bf-text-primary' : 'text-bf-text-secondary'}>{v.image.contrast}</span>
              {big ? <span className="text-bf-text-muted">{contrast.role}</span> : null}
            </figcaption>
          </figure>
        );
      })}
      {big ? (
        <div className={clsx('mb-5 ml-2 flex w-[200px] flex-col gap-1 px-2 py-1.5 text-bf-2xs text-bf-text-secondary', floating)}>
          <span className="text-bf-text-primary">Linked plane, slice, zoom and pan</span>
          <span>The CA1 outline echoes on every contrast.</span>
          <span className="flex flex-wrap items-center gap-1">
            <Kbd>Space</Kbd> hold to flicker T2w and T1w
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Slice rail on the right edge: keyframes, proposal gaps, current slice. */
function SliceRail({ state }: { state: DesignState }) {
  const ys = Array.from({ length: 21 }, (_, i) => -12 - i); // y −12 … −32
  const [a, b] = KEYFRAMES;
  const traced = (y: number) => y <= -16 && y >= -32;
  return (
    <div className={clsx('absolute right-3 top-1/2 flex -translate-y-1/2 flex-col items-end gap-0 px-1.5 py-2', floating)} aria-label="Slices">
      {ys.map((y) => {
        const key = y === a.y || y === b.y;
        const gap = state === 'proposal' && y < b.y && y > a.y;
        const current = y === -22;
        return (
          <div key={y} className="flex h-[13px] items-center gap-1.5">
            {key || current || y % 4 === 0 ? (
              <span className={clsx('font-mono text-bf-2xs', current ? 'text-bf-text-primary' : 'text-bf-text-muted')}>{fmtMm(y, 0)}</span>
            ) : null}
            {key && state === 'proposal' ? (
              <span aria-label={`keyframe y ${y}`} className="inline-block h-2 w-2 rotate-45 bg-bf-text-primary" />
            ) : gap ? (
              <span className="inline-block h-2 w-3.5 border border-dashed" style={{ borderColor: labelColor(CA1) }} />
            ) : (
              <span className={clsx('inline-block h-px', current ? 'w-4 bg-bf-text-primary' : traced(y) ? 'w-3 bg-bf-text-secondary' : 'w-2 bg-bf-text-faint')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function TopLine({ state, fovMm }: { state: DesignState; fovMm: number }) {
  const c = blockedCopy();
  return (
    <div className="absolute left-3 top-3 flex items-center gap-2">
      <span className="flex h-6 items-center gap-2 rounded-sm bg-bf-bg-canvas/80 px-2">
        <SliceTitle image={DESIGN.images.corT2} />
        <span className="font-mono text-bf-2xs text-bf-text-muted">{zoomFactor(fovMm)}</span>
      </span>
      {state === 'empty' ? null : state === 'review' ? (
        <span className="flex h-6 items-center rounded-sm bg-bf-bg-canvas/80 px-2 text-bf-xs text-bf-text-secondary">Review · read only</span>
      ) : state === 'proposal' ? (
        <span className="flex h-6 items-center gap-2 rounded-sm bg-bf-bg-canvas/80 px-1.5">
          <ProposalPill />
          <span className="font-mono text-bf-xs text-bf-text-secondary">fill between · y −26 → −18</span>
        </span>
      ) : (
        <ConstraintStrip
          label={CA1}
          variant="float"
          blocked={state === 'blocked' ? { reason: c.reason, detail: c.detail } : null}
        />
      )}
    </div>
  );
}

function EmptyCard() {
  return (
    <div className={clsx('absolute left-1/2 top-1/2 flex w-[420px] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 p-4', floating)}>
      <div className="flex flex-col gap-1">
        <h3 className="m-0 text-bf-md font-semibold text-bf-text-primary">Segment this image</h3>
        <p className="m-0 text-bf-xs text-bf-text-secondary">
          Labels are drawn on the T2w grid (193 × 229 × 193, 1.0 mm) and never resampled. T1w reslices to it for display.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />}>
          New segmentation on T2w
        </Button>
        <Button variant="secondary">Open label file…</Button>
      </div>
      <div className="flex items-center gap-1.5 text-bf-2xs text-bf-text-muted">
        <Kbd>S</Kbd> new on the image under the cursor <span className="text-bf-text-faint">·</span> <Kbd>⇧G</Kbd> choose another grid
      </div>
    </div>
  );
}

function Stage({ state }: { state: DesignState }) {
  const primary = primaryView(state);
  const ortho = orthoViews(state);
  const brushAt =
    state === 'tracing' || state === 'multi-contrast'
      ? SCENE.tracing.brush
      : state === 'blocked'
        ? SCENE.blocked.brush
        : state === 'zoom'
          ? SCENE.zoom.brush
          : null;
  const copy = blockedCopy();
  // Image-maximal: the whole workspace is the slice, so trace at a wider field
  // of view than the panel layouts (the voxels are still 8+ px).
  const wide = primary.fovMm === FOV.trace ? 96 : state === 'blocked' ? 60 : primary.fovMm;
  const view: PanelProps =
    state === 'empty'
      ? { ...primary, fovMm: 200, center: [96.5, 104] }
      : state === 'multi-contrast'
        ? { ...primary, fovMm: wide, center: [SCENE.hippoCentre[0], SCENE.hippoCentre[1] + 18] }
        : { ...primary, fovMm: wide };
  return (
    <div className="absolute inset-0">
      <SliceView
        {...view}
        dim={state === 'empty'}
        aria-label="Primary view, coronal T2w"
        overlay={(p) => (
          <>
            {brushAt ? <CursorPalette p={p} at={brushAt} state={state} /> : null}
            {state === 'blocked' ? (
              <div
                className="absolute"
                style={{ left: p.project(SCENE.blocked.brush).x - 24, top: p.project(SCENE.blocked.brush).y + BRUSH.radiusMm * p.scale + 54 }}
              >
                <Notice severity="warning" surface="canvas" role={null} className="w-[280px]">
                  <span className="flex flex-col items-start gap-0.5">
                    <span className="text-bf-text-primary">Nothing painted · {copy.detail}</span>
                    <span>{copy.explain}</span>
                    <Button variant="link">{copy.action}</Button>
                  </span>
                </Notice>
              </div>
            ) : null}
            {state === 'proposal' ? (
              <div
                className={clsx('absolute flex w-[300px] flex-col gap-2 p-2', floating)}
                style={{ left: p.project(SCENE.hippoCentre).x + 120, top: p.project(SCENE.hippoCentre).y - 40 }}
              >
                <div className="flex items-center gap-2">
                  <ProposalPill />
                  <span className="text-bf-xs text-bf-text-secondary">{PROPOSAL.method}</span>
                </div>
                <ProposalSummary />
                <div className="flex items-center gap-1.5">
                  <Button variant="primary" icon={<Swatch color={labelColor(CA1)} size={8} />}>
                    Confirm CA1
                  </Button>
                  <Button variant="secondary">Discard</Button>
                  <IconButton aria-label="Undo in proposal" title="Undo inside the proposal; document undo is separate" icon={<Undo2 />} className="ml-auto" />
                  <span className="font-mono text-bf-2xs text-bf-text-muted">{PROPOSAL.proposalUndo}</span>
                </div>
              </div>
            ) : null}
            {state === 'zoom' ? (
              <div
                className="absolute rounded-sm bg-bf-bg-canvas/80 px-1.5 py-0.5 font-mono text-bf-2xs text-bf-text-secondary"
                style={{ left: p.project(SCENE.zoom.brush).x - BRUSH.radiusMm * p.scale - 190, top: p.project(SCENE.zoom.brush).y - 9 }}
              >
                <span className="text-bf-text-primary">{SCENE.zoom.footprint} voxels</span> under ⌀ {(BRUSH.radiusMm * 2).toFixed(1)} mm
              </div>
            ) : null}
          </>
        )}
      />
      <TopLine state={state} fovMm={view.fovMm} />
      {state !== 'empty' ? <LabelOverlay state={state} collapsed={state === 'zoom' || state === 'review'} /> : null}
      <div className="absolute right-3 top-3 flex flex-col gap-2">
        {state === 'review' ? (
          <div className={clsx('flex w-[220px] flex-col gap-2 p-2', floating)}>
            <ReviewLegend vertical />
          </div>
        ) : null}
        {state !== 'proposal' ? (
          <>
            <Inset view={ortho.axial} title={`Axial z ${fmtMm(CROSSHAIR_WORLD[2])}`} />
            <Inset view={ortho.sagittal} title={`Sagittal x ${fmtMm(CROSSHAIR_WORLD[0])}`} />
          </>
        ) : null}
      </div>
      {state === 'proposal' ? <SliceRail state={state} /> : null}
      {state === 'review' ? (
        <div className={clsx('absolute bottom-[140px] left-1/2 flex -translate-x-1/2 items-center gap-3 px-2 py-1.5', floating)}>
          <DisagreementNav />
          <span className="h-4 w-px bg-bf-border-subtle" />
          <ReviewDecision />
        </div>
      ) : null}
      <FilmStrip state={state} />
      {state === 'empty' ? <EmptyCard /> : null}
    </div>
  );
}

export function DirectionB({ state }: { state: DesignState }) {
  const [x, y, z] = CROSSHAIR_WORLD;
  return (
    <ShellFrame
      topBar="quiet"
      center={
        <span className="flex items-center gap-2 text-bf-xs text-bf-text-secondary">
          {state === 'empty' ? (
            <span>Orthogonal · T2w</span>
          ) : (
            <>
              <span className="text-bf-text-primary">Segment</span>
              <span className="text-bf-text-faint">/</span>
              <span>{SESSION.shortFile}</span>
              <span className="text-bf-text-faint">/</span>
              <span>{state === 'review' ? 'Review' : 'Trace'}</span>
            </>
          )}
        </span>
      }
      right={
        state === 'empty' ? null : (
          <Button variant="ghost" icon={<LogOut className="h-3.5 w-3.5" />}>
            Exit segment
          </Button>
        )
      }
      status={
        <>
          <StatusItem label="Crosshair" value={`(${fmtMm(x)}, ${fmtMm(y)}, ${fmtMm(z)})`} />
          {state !== 'empty' ? <StatusItem label="Under cursor" value={state === 'blocked' ? 'DG · locked' : 'CA1'} mono={false} /> : null}
          {state !== 'empty' ? <StatusItem label="History" value={`${SESSION.historySteps} · ${SESSION.historyBytes}`} /> : null}
        </>
      }
    >
      <Stage state={state} />
    </ShellFrame>
  );
}
