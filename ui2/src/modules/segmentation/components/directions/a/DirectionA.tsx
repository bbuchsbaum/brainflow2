/**
 * Direction A, "Workstation": dense and keyboard-first. A vertical tool rail
 * on the left (every tool shows its key), the Trace layout in the centre
 * (primary tracing panel, two orthogonal panels, a linked contrast strip),
 * the constraint strip in the primary viewport's header, and the label list
 * in the right Inspector under a Segment mode. ITK-SNAP's efficiency with the
 * state it hides made visible.
 */

import React from 'react';
import clsx from 'clsx';
import {
  Brush,
  Eraser,
  History,
  Layers3,
  MousePointer2,
  PaintBucket,
  PenTool,
  Plus,
  Search,
  Sprout,
} from 'lucide-react';
import {
  Button,
  IconButton,
  Section,
  SegmentedControl,
  Select,
  Slider,
  Switch,
  Tabs,
  TextField,
  Chip,
  Notice,
} from '@/components/ui/bf';
import { ConstraintStrip } from '@/modules/segmentation/components/shared/ConstraintStrip';
import { LabelList } from '@/modules/segmentation/components/shared/LabelList';
import {
  DiceTable,
  DisagreementNav,
  KeyframeList,
  ProposalActions,
  ProposalPill,
  ProposalSummary,
  ReviewDecision,
  ReviewLegend,
} from '@/modules/segmentation/components/shared/ProposalParts';
import { SliceView } from '@/modules/segmentation/components/shared/SliceView';
import {
  Kbd,
  LensBadge,
  ModeSwitcher,
  ShellFrame,
  StatusItem,
  ViewportFrame,
} from '@/modules/segmentation/components/shared/chrome';
import { fmtMm } from '@/modules/segmentation/components/shared/geometry';
import {
  BRUSH,
  CA1,
  CONTRASTS,
  DG,
  SESSION,
  TOOLS,
  sessionLabels,
} from '@/modules/segmentation/components/shared/mockData';
import { CROSSHAIR_WORLD, SCENE } from '@/modules/segmentation/components/shared/scenes';
import { blockedCopy } from '@/modules/segmentation/components/shared/copy';
import { orthoViews, primaryView, stripViews, zoomFactor } from '@/modules/segmentation/components/shared/views';
import type { DesignState, ToolId } from '@/modules/segmentation/components/shared/types';
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

function activeTool(state: DesignState): ToolId {
  if (state === 'empty' || state === 'review') return 'navigate';
  if (state === 'proposal') return 'interpolate';
  return 'brush';
}

function ToolRail({ state }: { state: DesignState }) {
  const disabled = state === 'empty' || state === 'review';
  const active = activeTool(state);
  return (
    <nav
      aria-label="Segmentation tools"
      className="flex w-12 shrink-0 flex-col items-center gap-0.5 border-r border-bf-border-subtle bg-bf-bg-shell py-2"
    >
      {TOOLS.map((t) => (
        <div key={t.id} className="relative flex flex-col items-center">
          <IconButton
            aria-label={`${t.name} (${t.key})`}
            title={t.phase > 2 ? `${t.name}: later phase` : t.name}
            icon={TOOL_ICON[t.id]}
            size="sm"
            pressed={t.id === active}
            disabled={(disabled && t.id !== 'navigate') || t.phase > 2}
          />
          <span className="pointer-events-none absolute bottom-0 right-0 font-mono text-bf-2xs leading-none text-bf-text-faint">
            {t.key}
          </span>
        </div>
      ))}
      <div className="my-2 h-px w-6 bg-bf-border-subtle" />
      {!disabled ? (
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="font-mono text-bf-xs text-bf-text-primary">{(BRUSH.radiusMm * 2).toFixed(1)}</span>
          <span className="text-bf-2xs text-bf-text-muted">mm</span>
          <span className="mt-1 flex gap-0.5">
            <Kbd>[</Kbd>
            <Kbd>]</Kbd>
          </span>
        </div>
      ) : null}
    </nav>
  );
}

function PrimaryHeader({ state }: { state: DesignState }) {
  const blocked = state === 'blocked';
  if (state === 'empty') return null;
  if (state === 'review') {
    return (
      <span className="flex items-center gap-2">
        <Chip>Review · read only</Chip>
      </span>
    );
  }
  if (state === 'proposal') {
    return (
      <span className="flex items-center gap-2">
        <ProposalPill />
        <span className="font-mono text-bf-xs text-bf-text-secondary">fill between · CA1 · y −26 → −18</span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-3">
      <ConstraintStrip
        label={CA1}
        blocked={
          blocked
            ? (() => {
                const c = blockedCopy();
                return { reason: c.reason, detail: c.detail, action: c.action };
              })()
            : null
        }
      />
    </span>
  );
}

function TraceLayout({ state }: { state: DesignState }) {
  const multi = state === 'multi-contrast';
  const primary = primaryView(state);
  const ortho = orthoViews(state);
  const strip = stripViews(state);
  return (
    <div
      className={clsx(
        'grid h-full min-h-0 gap-px bg-bf-border-subtle',
        multi ? 'grid-cols-[minmax(0,1fr)_248px] grid-rows-[minmax(0,1fr)_272px]' : 'grid-cols-[minmax(0,1fr)_248px] grid-rows-[minmax(0,1fr)_150px]',
      )}
    >
      <ViewportFrame image={primary.image} headerRight={<PrimaryHeader state={state} />} active className="row-span-1">
        <SliceView
          {...primary}
          zoomLabel={zoomFactor(primary.fovMm)}
          aria-label="Primary tracing view, coronal T2w"
          overlay={(p) => (
            <>
              {state === 'blocked' ? <BlockedCallout p={p} /> : null}
              {state === 'proposal' ? (
                <div className="absolute bottom-3 left-3 right-3 flex items-center gap-3 rounded-sm border border-bf-border bg-bf-bg-panel/95 px-2 py-1.5">
                  <ProposalPill />
                  <span className="text-bf-xs text-bf-text-secondary">
                    Fill between slices proposes CA1 on 7 slices. Locked labels are not touched.
                  </span>
                  <ProposalActions className="ml-auto" />
                </div>
              ) : null}
              {state === 'zoom' ? <ZoomCallout p={p} /> : null}
            </>
          )}
        />
      </ViewportFrame>
      <div className="grid min-h-0 grid-rows-2 gap-px">
        <ViewportFrame image={ortho.axial.image}>
          <SliceView {...ortho.axial} />
        </ViewportFrame>
        <ViewportFrame image={ortho.sagittal.image}>
          <SliceView {...ortho.sagittal} />
        </ViewportFrame>
      </div>
      <div className="col-span-2 grid min-h-0 grid-cols-3 gap-px">
        {strip.map((v, i) => (
          <ViewportFrame
            key={v.image.key}
            image={v.image}
            title={
              <span className="flex items-center gap-2 text-bf-xs">
                <Kbd>{i + 1}</Kbd>
                <span className="text-bf-text-primary">{v.image.contrast}</span>
                <span className="text-bf-text-muted">{CONTRASTS[i].role}</span>
              </span>
            }
            headerRight={
              i === 0 ? <span className="text-bf-2xs text-bf-text-muted">tracing</span> : null
            }
          >
            <SliceView
              {...v}
              letters={false}
              overlay={() => (v.image.viewOnly ? <span className="absolute right-1.5 top-1.5"><LensBadge /></span> : null)}
            />
          </ViewportFrame>
        ))}
      </div>
    </div>
  );
}

function BlockedCallout({ p }: { p: { project: (pt: readonly [number, number]) => { x: number; y: number } } }) {
  const at = p.project(SCENE.blocked.brush);
  const copy = blockedCopy();
  return (
    <div className="absolute" style={{ left: at.x + 70, top: at.y - 24 }}>
      <Notice severity="warning" surface="canvas" role={null} className="max-w-[260px]">
        <span className="flex flex-col gap-0.5">
          <span className="text-bf-text-primary">Nothing painted</span>
          <span>{copy.explain}</span>
        </span>
      </Notice>
    </div>
  );
}

function ZoomCallout({ p }: { p: { project: (pt: readonly [number, number]) => { x: number; y: number }; scale: number } }) {
  const at = p.project(SCENE.zoom.brush);
  return (
    <div className="absolute flex flex-col gap-0.5 rounded-sm bg-bf-bg-canvas/80 px-1.5 py-1 font-mono text-bf-2xs text-bf-text-secondary" style={{ left: at.x + BRUSH.radiusMm * p.scale + 16, top: at.y - 10 }}>
      <span className="text-bf-text-primary">⌀ {(BRUSH.radiusMm * 2).toFixed(1)} mm · {SCENE.zoom.footprint} voxels</span>
      <span>centre inside disc, 1.0 mm grid</span>
    </div>
  );
}

function OrthogonalLayout() {
  const primary = primaryView('empty');
  const ortho = orthoViews('empty');
  return (
    <div className="grid h-full min-h-0 grid-cols-2 grid-rows-2 gap-px bg-bf-border-subtle">
      <ViewportFrame image={primary.image} header="overlay" className="row-span-2">
        <SliceView {...primary} />
      </ViewportFrame>
      <ViewportFrame image={ortho.axial.image} header="overlay">
        <SliceView {...ortho.axial} />
      </ViewportFrame>
      <ViewportFrame image={ortho.sagittal.image} header="overlay">
        <SliceView {...ortho.sagittal} />
      </ViewportFrame>
    </div>
  );
}

function SessionHeader({ state }: { state: DesignState }) {
  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="truncate text-bf-sm font-medium text-bf-text-primary">{SESSION.shortFile}</span>
        {state === 'review' ? <Chip>Rater B · submitted</Chip> : <Chip>Unsaved</Chip>}
        <span className="ml-auto text-bf-2xs text-bf-text-muted">{SESSION.rater}</span>
      </div>
      <div className="font-mono text-bf-2xs text-bf-text-muted">
        grid {SESSION.referenceGrid} · {SESSION.gridDims.join(' × ')} · {SESSION.spacingMm.toFixed(1)} mm
      </div>
    </div>
  );
}

function SegmentEmpty() {
  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <div className="flex flex-col gap-1">
        <h3 className="m-0 text-bf-md font-semibold text-bf-text-primary">No segmentation on this image</h3>
        <p className="m-0 text-bf-xs text-bf-text-secondary">
          A segmentation is bound to one reference grid when you create it. Other images reslice to that grid for
          display; it is never resampled.
        </p>
      </div>
      <div className="flex flex-col gap-2 rounded-sm border border-bf-border-subtle bg-bf-bg-panel-sunken p-2">
        <label className="flex flex-col gap-1 text-bf-xs text-bf-text-muted">
          Reference grid
          <Select
            defaultValue="t2"
            options={[
              { value: 't2', label: 'T2w · 193 × 229 × 193 · 1.0 mm' },
              { value: 't1', label: 'T1w · 193 × 229 × 193 · 1.0 mm' },
            ]}
          />
        </label>
        <label className="flex flex-col gap-1 text-bf-xs text-bf-text-muted">
          Labels
          <Select
            defaultValue="subfields"
            options={[
              { value: 'empty', label: 'Empty table' },
              { value: 'subfields', label: 'Hippocampal subfields (6 labels, example pack)' },
              { value: 'file', label: 'From a label file…' },
            ]}
          />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />}>New segmentation on T2w</Button>
        <Kbd>⇧S</Kbd>
      </div>
      <Button variant="secondary" className="self-start">Open label file…</Button>
      <div className="mt-2 flex flex-col gap-1 border-t border-bf-border-subtle pt-3">
        <span className="text-bf-xs font-medium text-bf-text-secondary">Loaded images</span>
        {CONTRASTS.slice(0, 2).map((c, i) => (
          <div key={c.key} className="grid grid-cols-[40px_1fr] gap-x-2 text-bf-xs">
            <span className="text-bf-text-primary">{c.name}</span>
            <span className="truncate font-mono text-bf-2xs leading-4 text-bf-text-muted">{c.detail}</span>
            <span />
            <span className="text-bf-2xs text-bf-text-muted">{i === 0 ? 'Acquisition plane coronal · suggested reference' : 'Reslices to the reference for display'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SegmentInspector({ state }: { state: DesignState }) {
  if (state === 'empty') return <SegmentEmpty />;
  const labels = sessionLabels(state === 'proposal' ? { [CA1]: { status: 'proposal' } } : {});
  return (
    <div className="flex flex-col">
      <SessionHeader state={state} />
      {state === 'review' ? (
        <Section title="Review" meta="rater B vs A" variant="static">
          <div className="flex flex-col gap-3">
            <ReviewLegend vertical />
            <DisagreementNav />
            <DiceTable />
            <ReviewDecision />
          </div>
        </Section>
      ) : null}
      {state === 'proposal' ? (
        <Section title="Proposal · CA1" meta="fill between" variant="static">
          <div className="flex flex-col gap-2">
            <ProposalSummary />
            <KeyframeList />
            <span className="text-bf-2xs text-bf-text-muted">Confirm or discard in the view. Undo inside the proposal does not touch document history.</span>
          </div>
        </Section>
      ) : null}
      <Section
        title="Labels"
        meta="6"
        variant="static"
        actions={<IconButton aria-label="New label" icon={<Plus />} />}
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
            notes={state === 'blocked' ? { [DG]: 'blocked' } : {}}
          />
          <div className="flex items-center gap-2 px-3 pt-1 text-bf-2xs text-bf-text-muted">
            <Kbd>&lt;</Kbd>
            <Kbd>&gt;</Kbd>
            <span>label</span>
            <Kbd>L</Kbd>
            <span>lock</span>
            <Kbd>⌥</Kbd>
            <span>eyedropper</span>
          </div>
        </div>
      </Section>
      {state !== 'review' ? (
        <Section title="Brush" meta={`⌀ ${(BRUSH.radiusMm * 2).toFixed(1)} mm`} variant="static">
          <div className="flex flex-col gap-2 text-bf-xs">
            <Slider label="Brush diameter" min={0.5} max={10} step={0.5} value={3} onValueChange={() => undefined} showValue format={(v) => `${v.toFixed(1)} mm`} valueWidth="6ch" />
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
      ) : null}
      <Section title="History" meta={`${SESSION.historySteps} steps · ${SESSION.historyBytes}`} icon={<History className="h-3.5 w-3.5" />} defaultOpen={false} />
    </div>
  );
}

function Inspector({ state }: { state: DesignState }) {
  return (
    <aside aria-label="Inspector" className="flex w-[340px] shrink-0 flex-col border-l border-bf-border-subtle bg-bf-bg-panel">
      <div className="flex h-8 items-center border-b border-bf-border-subtle px-2">
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
        <SegmentInspector state={state} />
      </div>
    </aside>
  );
}

function Status({ state }: { state: DesignState }) {
  const [x, y, z] = CROSSHAIR_WORLD;
  return (
    <>
      <StatusItem label="Crosshair" value={`(${fmtMm(x)}, ${fmtMm(y)}, ${fmtMm(z)})`} />
      <StatusItem label="ijk" value={`${DESIGN.sagittalI} ${DESIGN.primaryJ} ${DESIGN.axialK}`} />
      {state !== 'empty' ? <StatusItem label="Label" value={state === 'blocked' ? 'DG (locked)' : 'CA1'} mono={false} /> : null}
      <StatusItem label="T2w" value="0.62" />
      {state !== 'empty' && state !== 'review' ? (
        <span className="flex items-center gap-1.5 text-bf-text-muted">
          <Kbd>⌘Z</Kbd> undo stroke
          <Kbd>B</Kbd> brush
          <Kbd>Space</Kbd> flicker
        </span>
      ) : null}
    </>
  );
}

export function DirectionA({ state }: { state: DesignState }) {
  return (
    <ShellFrame
      center={<ModeSwitcher value={state === 'empty' ? 'orthogonal' : 'trace'} />}
      right={
        <Button variant="ghost">Workspace</Button>
      }
      status={<Status state={state} />}
    >
      <div className="flex h-full min-h-0">
        <ToolRail state={state} />
        <div className="flex min-w-0 flex-1 flex-col">
          {state === 'empty' ? <OrthogonalLayout /> : <TraceLayout state={state} />}
        </div>
        <Inspector state={state} />
      </div>
    </ShellFrame>
  );
}

