/**
 * Direction C, "Protocol-guided": a protocol pack leads the work. The left
 * panel holds the ordered steps; the current step shows its rule text, a
 * reference thumbnail, the landmark slab and a checklist. Tools and labels
 * are scoped to the step: the active label is the step's label, earlier
 * labels are locked by the protocol (and say so), later ones wait. The
 * orthogonal views shade the step's landmark slab. Strongest on correctness
 * and training; the cost is a third column of chrome.
 */

import React from 'react';
import clsx from 'clsx';
import { Check, ChevronRight, Circle, Lock, Plus } from 'lucide-react';
import { Button, Checkbox, Chip, IconButton, Notice, SelectableRow, Select, StatusPill } from '@/components/ui/bf';
import { ConstraintStrip } from '@/modules/segmentation/components/shared/ConstraintStrip';
import { LabelRow } from '@/modules/segmentation/components/shared/LabelList';
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
import { Kbd, LensBadge, ShellFrame, StatusItem, Swatch, ViewportFrame } from '@/modules/segmentation/components/shared/chrome';
import { blockedCopy } from '@/modules/segmentation/components/shared/copy';
import { fmtMm } from '@/modules/segmentation/components/shared/geometry';
import {
  BRUSH,
  CA1,
  CA23,
  DG,
  ERC,
  LABEL_DEFS,
  PROTOCOL,
  SESSION,
  SRLM,
  SUB,
  sessionLabels,
} from '@/modules/segmentation/components/shared/mockData';
import { CROSSHAIR_WORLD, OVERLAYS, SCENE } from '@/modules/segmentation/components/shared/scenes';
import { orthoViews, primaryView, stripViews, zoomFactor } from '@/modules/segmentation/components/shared/views';
import type { DesignState } from '@/modules/segmentation/components/shared/types';
import { DESIGN } from '@/modules/segmentation/__design__/designData';

const SLAB: [number, number] = [PROTOCOL.slab.fromY, PROTOCOL.slab.toY];

function currentStepIndex(state: DesignState): number {
  return state === 'review' ? PROTOCOL.steps.length - 1 : PROTOCOL.currentStep;
}

function ProgressBar({ state }: { state: DesignState }) {
  const cur = currentStepIndex(state);
  const step = PROTOCOL.steps[cur];
  return (
    <span className="flex items-center gap-3 text-bf-xs">
      <span className="text-bf-text-secondary">{PROTOCOL.name}</span>
      <span className="flex items-center gap-0.5" aria-label={`Step ${cur + 1} of ${PROTOCOL.steps.length}`}>
        {PROTOCOL.steps.map((s, i) => (
          <span
            key={s.id}
            className={clsx(
              'h-1.5 w-5 rounded-sm',
              i < cur ? 'bg-bf-text-secondary' : i === cur ? 'bg-bf-text-primary' : 'bg-bf-bg-active',
            )}
          />
        ))}
      </span>
      <span className="text-bf-text-primary">
        Step {cur + 1} of {PROTOCOL.steps.length} · {step.title}
      </span>
    </span>
  );
}

function ReferenceThumb({ state }: { state: DesignState }) {
  const j = 106;
  return (
    <figure className="m-0 flex flex-col gap-1">
      <div className="relative h-[132px] overflow-hidden rounded-sm border border-bf-border-subtle bg-bf-bg-canvas">
        <SliceView
          image={DESIGN.images.cor(j)}
          center={SCENE.hippoCentre}
          fovMm={34}
          letters={false}
          overlays={
            state === 'review'
              ? OVERLAYS.echo(DESIGN.labels.cor(j))
              : [
                  { kind: 'labels', voxels: DESIGN.labels.cor(j), outline: true, width: 1, opacity: 0.7 },
                  { kind: 'labels', voxels: DESIGN.labels.cor(j), fill: 0.55, only: [CA1] },
                  { kind: 'labels', voxels: DESIGN.labels.cor(j), outline: true, width: 2, only: [CA1] },
                ]
          }
          aria-label="Reference example, coronal y −26 mm"
        />
        <span className="absolute left-1 top-1 rounded-sm bg-bf-bg-canvas/80 px-1 text-bf-2xs text-bf-text-secondary">Reference</span>
      </div>
      <figcaption className="text-bf-2xs text-bf-text-muted">
        Example tracing, body, y −26 mm (pack example, mock labels)
      </figcaption>
    </figure>
  );
}

function StepCard({ state }: { state: DesignState }) {
  if (state === 'review') {
    return (
      <div className="flex flex-col gap-2.5 border-l-2 border-bf-text-primary bg-bf-bg-panel-raised px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-bf-sm font-semibold text-bf-text-primary">Review against rater B</span>
          <span className="ml-auto font-mono text-bf-2xs text-bf-text-muted">step 9</span>
        </div>
        <p className="m-0 text-bf-xs text-bf-text-secondary">
          Check disagreements at landmarks first: the CA1/subiculum line and the SRLM ends. Return the case with a
          comment when a border breaks a rule.
        </p>
        <ReviewLegend vertical />
        <DisagreementNav />
        <DiceTable />
        <ReviewDecision />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2.5 border-l-2 border-bf-text-primary bg-bf-bg-panel-raised px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Swatch color={LABEL_DEFS[0].color} size={10} />
        <span className="text-bf-sm font-semibold text-bf-text-primary">Trace CA1</span>
        <span className="ml-auto font-mono text-bf-2xs text-bf-text-muted">step 6 of 9</span>
      </div>
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0 text-bf-xs text-bf-text-secondary">
        {PROTOCOL.ca1Rules.map((r, i) => (
          <li key={r} className={clsx('flex gap-2', state === 'zoom' && i === 0 && 'text-bf-text-primary')}>
            <span className="w-3 shrink-0 font-mono text-bf-2xs text-bf-text-muted">{i + 1}</span>
            <span>{r}</span>
          </li>
        ))}
      </ol>
      {state === 'multi-contrast' ? (
        <Notice severity="info" role={null}>
          Trace on raw T2w. The unsharp lens is a hint; check the CA1/WM border on T1w before you commit.
        </Notice>
      ) : null}
      {state === 'proposal' ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-bf-xs text-bf-text-secondary">
            The pack allows fill between keyframes at most 8 mm apart. Check every proposed slice before confirming.
          </span>
          <div className="rounded-sm border border-bf-border-subtle bg-bf-bg-panel-sunken py-1">
            <KeyframeList dense />
          </div>
        </div>
      ) : (
        <ReferenceThumb state={state} />
      )}
      <div className="flex items-center gap-1.5 text-bf-2xs text-bf-text-secondary">
        <Check className="h-3 w-3 text-bf-success" aria-hidden />
        <span>
          Body slab y {fmtMm(SLAB[0], 0)} to {fmtMm(SLAB[1], 0)} mm · you are at y {fmtMm(CROSSHAIR_WORLD[1], 0)}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {PROTOCOL.ca1Checks.map((c) => (
          <Checkbox key={c.text} checked={c.done} onCheckedChange={() => undefined}>
            <span className="text-bf-xs">{c.text}</span>
          </Checkbox>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <Button variant="primary" disabled>
          Mark CA1 complete
        </Button>
        <span className="text-bf-2xs text-bf-text-muted">2 checks left</span>
      </div>
    </div>
  );
}

function StepRow({ i, state }: { i: number; state: DesignState }) {
  const s = PROTOCOL.steps[i];
  const cur = currentStepIndex(state);
  const done = (s.done || state === 'review') && i !== cur;
  return (
    <SelectableRow role="option" selected={false} className={clsx('min-h-6', i > cur && 'opacity-60')} tabIndex={-1}>
      <span className="flex w-4 justify-center">
        {done ? <Check className="h-3.5 w-3.5 text-bf-text-secondary" aria-hidden /> : <Circle className="h-2.5 w-2.5 text-bf-text-faint" aria-hidden />}
      </span>
      <span className="w-4 font-mono text-bf-2xs text-bf-text-faint">{i + 1}</span>
      <span className={clsx('flex-1 truncate', done ? 'text-bf-text-secondary' : 'text-bf-text-primary')}>{s.title}</span>
      {'label' in s && s.label ? <Swatch color={LABEL_DEFS[s.label - 1].color} size={8} /> : null}
    </SelectableRow>
  );
}

function ProtocolPanel({ state }: { state: DesignState }) {
  const cur = currentStepIndex(state);
  return (
    <aside aria-label="Protocol" className="flex w-[320px] shrink-0 flex-col border-r border-bf-border-subtle bg-bf-bg-panel">
      <div className="flex flex-col gap-0.5 border-b border-bf-border-subtle px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-bf-2xs text-bf-text-muted">Protocol</span>
          <Chip mono className="ml-auto">
            {PROTOCOL.version}
          </Chip>
        </div>
        <span className="truncate text-bf-sm font-semibold text-bf-text-primary">{PROTOCOL.name}</span>
        <span className="text-bf-2xs text-bf-text-muted">{PROTOCOL.plane}</span>
        <span className="text-bf-2xs text-bf-text-muted">{PROTOCOL.contrast}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1" role="listbox" aria-label="Protocol steps">
        {PROTOCOL.steps.map((s, i) =>
          i === cur ? (
            <div key={s.id} className="my-1">
              <StepCard state={state} />
            </div>
          ) : (
            <StepRow key={s.id} i={i} state={state} />
          ),
        )}
      </div>
    </aside>
  );
}

function LabelColumn({ state }: { state: DesignState }) {
  const review = state === 'review';
  const full = (id: number) => DESIGN.counts[String(id)] ?? 0;
  const labels = sessionLabels(
    review
      ? Object.fromEntries(LABEL_DEFS.map((l) => [l.id, { status: 'complete', locked: true, voxels: full(l.id), mm3: full(l.id) }]))
      : {
          [CA1]: state === 'proposal' ? { status: 'proposal' } : {},
          [SUB]: { status: 'not-started', voxels: 0, mm3: 0 },
        },
  );
  const by = (id: number) => labels.find((l) => l.id === id)!;
  const context = [SRLM, DG, CA23].map((id) => ({ ...by(id), lockReason: 'Locked by protocol (done)' }));
  const later = [SUB, ERC].map(by);
  return (
    <aside aria-label="Labels for this step" className="flex w-[268px] shrink-0 flex-col border-l border-bf-border-subtle bg-bf-bg-panel">
      <div className="flex h-8 items-center border-b border-bf-border-subtle px-3 text-bf-sm font-semibold">
        Labels
        <span className="ml-2 font-mono text-bf-2xs font-normal text-bf-text-muted">{SESSION.shortFile}</span>
      </div>
      <div className="flex flex-col py-1" role="grid" aria-label="Labels">
        {review ? null : (
          <>
            <GroupTitle>This step</GroupTitle>
            <LabelRow label={by(CA1)} active showStatus={false} />
          </>
        )}
        <GroupTitle>{review ? 'Rater A · submitted, read only' : 'Context · locked by protocol'}</GroupTitle>
        {(review ? [by(CA1), ...context, ...later] : context).map((l) => (
          <LabelRow
            key={l.id}
            label={l}
            showStatus={false}
            alert={state === 'blocked' && l.id === DG}
            note={review ? undefined : state === 'blocked' && l.id === DG ? 'blocked' : `step ${l.id === SRLM ? 3 : l.id === DG ? 4 : 5}`}
          />
        ))}
        {review ? null : (
          <>
            <GroupTitle>Later steps</GroupTitle>
            {later.map((l) => (
              <LabelRow key={l.id} label={l} showStatus={false} muted note={`step ${l.id === SUB ? 7 : 8}`} />
            ))}
          </>
        )}
      </div>
      {!review ? (
        <div className="mt-auto flex flex-col gap-2 border-t border-bf-border-subtle px-3 py-2 text-bf-xs">
          <span className="font-medium text-bf-text-secondary">Tools in this step</span>
          <div className="flex flex-wrap gap-1">
            <Chip>Brush · B</Chip>
            <Chip>Contour · P</Chip>
            <Chip>Fill between · I</Chip>
          </div>
          <span className="text-bf-2xs text-bf-text-muted">Grow and threshold tools are off for CA1 in this pack.</span>
          <div className="flex items-center gap-2">
            <span className="text-bf-text-muted">Brush</span>
            <span className="font-mono text-bf-text-primary">⌀ {(BRUSH.radiusMm * 2).toFixed(1)} mm · 2D</span>
            <span className="ml-auto flex gap-0.5">
              <Kbd>[</Kbd>
              <Kbd>]</Kbd>
            </span>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function GroupTitle({ children }: { children: React.ReactNode }) {
  return <div className="px-3 pb-0.5 pt-2 text-bf-2xs text-bf-text-muted">{children}</div>;
}

function PrimaryHeader({ state }: { state: DesignState }) {
  const c = blockedCopy();
  if (state === 'review')
    return (
      <span className="flex items-center gap-2">
        <Chip>Review · read only</Chip>
      </span>
    );
  if (state === 'proposal')
    return (
      <span className="flex items-center gap-2">
        <ProposalPill />
        <span className="font-mono text-bf-xs text-bf-text-secondary">fill between · CA1 · y −26 → −18</span>
      </span>
    );
  return (
    <span className="flex min-w-0 items-center gap-3">
      <ConstraintStrip
        label={CA1}
        hideLabel
        dense
        blocked={state === 'blocked' ? { reason: 'DG locked by protocol', detail: c.detail } : null}
      />
    </span>
  );
}

function StepBadge({ state }: { state: DesignState }) {
  if (state === 'review') return <span className="text-bf-xs text-bf-text-primary">Step 9 · Review</span>;
  return (
    <span className="flex items-center gap-1.5 text-bf-xs text-bf-text-primary">
      <Swatch color={LABEL_DEFS[0].color} size={8} />
      Step 6 · CA1
    </span>
  );
}

function TraceCenter({ state }: { state: DesignState }) {
  const multi = state === 'multi-contrast';
  const primary = primaryView(state);
  const ortho = orthoViews(state, { slab: SLAB });
  const strip = stripViews(state);
  const c = blockedCopy();
  return (
    <div
      className={clsx(
        'grid h-full min-h-0 gap-px bg-bf-border-subtle',
        multi ? 'grid-cols-[minmax(0,1fr)_220px] grid-rows-[minmax(0,1fr)_250px]' : 'grid-cols-[minmax(0,1fr)_220px] grid-rows-[minmax(0,1fr)_0px]',
      )}
    >
      <ViewportFrame
        image={primary.image}
        active
        title={
          <span className="flex items-center gap-3">
            <StepBadge state={state} />
            <span className="font-mono text-bf-xs text-bf-text-secondary">y {fmtMm(CROSSHAIR_WORLD[1])} · T2w</span>
          </span>
        }
        headerRight={<PrimaryHeader state={state} />}
      >
        <SliceView
          {...primary}
          zoomLabel={zoomFactor(primary.fovMm)}
          aria-label="Primary tracing view, coronal T2w"
          overlay={(p) => (
            <>
              {state === 'blocked' ? (
                <div className="absolute" style={{ left: p.project(SCENE.blocked.brush).x + 64, top: p.project(SCENE.blocked.brush).y - 20 }}>
                  <Notice severity="warning" surface="canvas" role={null} className="w-[280px]">
                    <span className="flex flex-col items-start gap-0.5">
                      <span className="text-bf-text-primary">Nothing painted · {c.detail}</span>
                      <span>DG was completed in step 4, so the protocol locks it while you trace CA1.</span>
                      <Button variant="link">Reopen step 4 to edit DG</Button>
                    </span>
                  </Notice>
                </div>
              ) : null}
              {state === 'proposal' ? (
                <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border border-bf-border bg-bf-bg-panel/95 px-2 py-1.5">
                  <ProposalPill />
                  <ProposalSummary />
                  <ProposalActions className="ml-auto" />
                </div>
              ) : null}
              {state === 'zoom' ? (
                <div
                  className="absolute rounded-sm bg-bf-bg-canvas/80 px-1.5 py-0.5 font-mono text-bf-2xs text-bf-text-secondary"
                  style={{ left: p.project(SCENE.zoom.brush).x + BRUSH.radiusMm * p.scale + 14, top: p.project(SCENE.zoom.brush).y - 8 }}
                >
                  <span className="text-bf-text-primary">{SCENE.zoom.footprint} voxels</span> · rule 1: lateral border
                </div>
              ) : null}
            </>
          )}
        />
      </ViewportFrame>
      <div className="row-span-2 grid min-h-0 grid-rows-2 gap-px">
        <ViewportFrame image={ortho.axial.image} headerRight={<span className="text-bf-2xs text-bf-text-muted">body slab</span>}>
          <SliceView {...ortho.axial} />
        </ViewportFrame>
        <ViewportFrame image={ortho.sagittal.image} headerRight={<span className="text-bf-2xs text-bf-text-muted">body slab</span>}>
          <SliceView {...ortho.sagittal} />
        </ViewportFrame>
      </div>
      {multi ? (
        <div className="grid min-h-0 grid-cols-3 gap-px">
          {strip.map((v, i) => (
            <ViewportFrame
              key={v.image.key}
              image={v.image}
              title={
                <span className="flex items-center gap-2 text-bf-xs">
                  <Kbd>{i + 1}</Kbd>
                  <span className="text-bf-text-primary">{v.image.contrast}</span>
                  {i === 0 ? <span className="text-bf-2xs text-bf-text-muted">protocol contrast</span> : null}
                </span>
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
      ) : (
        <div />
      )}
    </div>
  );
}

const PACKS = [
  { id: 'subfields', name: 'Hippocampal subfields · body', meta: 'T2w coronal · 6 labels · 9 steps', note: 'Example pack v0.3' },
  { id: 'whole', name: 'Whole hippocampus', meta: 'T1w coronal · 1 label · 5 steps', note: 'Example pack, HarP-style landmarks' },
  { id: 'lesion', name: 'White-matter lesions', meta: 'FLAIR axial · 1 label · 3 steps', note: 'Example pack' },
  { id: 'free', name: 'No protocol', meta: 'Free tracing · any labels', note: 'Labels and tools unscoped' },
];

function EmptyC() {
  const ortho = orthoViews('empty');
  const primary = primaryView('empty');
  return (
    <div className="flex h-full min-h-0">
      <aside aria-label="Protocols" className="flex w-[320px] shrink-0 flex-col gap-2 border-r border-bf-border-subtle bg-bf-bg-panel p-3">
        <div className="flex flex-col gap-1">
          <h3 className="m-0 text-bf-md font-semibold text-bf-text-primary">Start a segmentation</h3>
          <p className="m-0 text-bf-xs text-bf-text-secondary">
            A protocol pack sets the labels, the tracing plane and contrast, the steps and their rules. Outputs record the
            pack version.
          </p>
        </div>
        <div className="flex flex-col gap-1.5" role="listbox" aria-label="Protocol packs">
          {PACKS.map((p, i) => (
            <SelectableRow key={p.id} variant="card" selected={i === 0} tabIndex={i === 0 ? 0 : -1}>
              <span className="flex items-center gap-2">
                <span className="text-bf-sm text-bf-text-primary">{p.name}</span>
                {i === 0 ? <StatusPill status="neutral" icon={false} className="ml-auto">Suggested</StatusPill> : null}
              </span>
              <span className="font-mono text-bf-2xs text-bf-text-muted">{p.meta}</span>
              <span className="text-bf-2xs text-bf-text-muted">{p.note}</span>
            </SelectableRow>
          ))}
        </div>
        <Button variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} className="self-start">
          Import a pack…
        </Button>
      </aside>
      <div className="grid min-w-0 flex-1 grid-cols-2 grid-rows-2 gap-px bg-bf-border-subtle">
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
      <aside aria-label="Pack preview" className="flex w-[268px] shrink-0 flex-col gap-3 border-l border-bf-border-subtle bg-bf-bg-panel p-3">
        <span className="text-bf-sm font-semibold text-bf-text-primary">{PACKS[0].name}</span>
        <dl className="m-0 grid grid-cols-[84px_1fr] gap-x-2 gap-y-1 text-bf-xs">
          <dt className="text-bf-text-muted">Plane</dt>
          <dd className="m-0 text-bf-text-primary">Coronal, ⟂ long axis</dd>
          <dt className="text-bf-text-muted">Trace on</dt>
          <dd className="m-0 text-bf-text-primary">T2w (loaded)</dd>
          <dt className="text-bf-text-muted">Check on</dt>
          <dd className="m-0 text-bf-text-primary">T1w (loaded)</dd>
          <dt className="text-bf-text-muted">Steps</dt>
          <dd className="m-0 text-bf-text-primary">9, with landmark slabs</dd>
        </dl>
        <div className="flex flex-col gap-1">
          <span className="text-bf-2xs text-bf-text-muted">Labels</span>
          {LABEL_DEFS.map((l) => (
            <span key={l.id} className="flex items-center gap-2 text-bf-xs text-bf-text-secondary">
              <Swatch color={l.color} size={9} />
              <span className="w-4 font-mono text-bf-2xs text-bf-text-faint">{l.id}</span>
              {l.name}
            </span>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-bf-xs text-bf-text-muted">
          Reference grid
          <Select defaultValue="t2" options={[{ value: 't2', label: 'T2w · 1.0 mm (pack default)' }, { value: 't1', label: 'T1w · 1.0 mm' }]} />
        </label>
        <Button variant="primary" className="self-start">
          Start step 1
        </Button>
        <span className="flex items-center gap-1 text-bf-2xs text-bf-text-muted">
          <Lock className="h-3 w-3" aria-hidden /> Completed steps lock their labels
        </span>
        <span className="mt-auto flex items-center gap-1 text-bf-2xs text-bf-text-muted">
          Practice against the pack reference
          <IconButton aria-label="Open practice mode" icon={<ChevronRight />} className="ml-auto" />
        </span>
      </aside>
    </div>
  );
}

export function DirectionC({ state }: { state: DesignState }) {
  const [x, y, z] = CROSSHAIR_WORLD;
  return (
    <ShellFrame
      center={state === 'empty' ? <span className="text-bf-xs text-bf-text-secondary">Orthogonal · T2w, T1w</span> : <ProgressBar state={state} />}
      right={state === 'empty' ? null : <Button variant="ghost">Exit protocol</Button>}
      status={
        <>
          <StatusItem label="Crosshair" value={`(${fmtMm(x)}, ${fmtMm(y)}, ${fmtMm(z)})`} />
          {state !== 'empty' ? <StatusItem label="Slab" value="body" mono={false} /> : null}
          {state !== 'empty' ? <StatusItem label="Pack" value={PROTOCOL.version} /> : null}
          <StatusItem label="T2w" value="0.62" />
        </>
      }
    >
      {state === 'empty' ? (
        <EmptyC />
      ) : (
        <div className="flex h-full min-h-0">
          <ProtocolPanel state={state} />
          <div className="min-w-0 flex-1">
            <TraceCenter state={state} />
          </div>
          <LabelColumn state={state} />
        </div>
      )}
    </ShellFrame>
  );
}

