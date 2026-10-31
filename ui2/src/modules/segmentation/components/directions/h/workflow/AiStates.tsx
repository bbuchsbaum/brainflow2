/**
 * Round 5: AI assist in direction H (states `ai-prompt` and `ai-consent`).
 *
 * `ai-prompt`: the AI tool opens a prompt sub-rail (point +, point −,
 * scribble, box, lasso). Prompts are neutral marks told apart by form (a
 * filled disc with + includes, a hollow ring with − excludes, a solid
 * scribble), never by colour and never dashed. The model's 3D answer is a
 * proposal in the target label's colour, H's proposal grammar (hatch plus a
 * thin solid outline); voxels it wanted that another label holds are not
 * taken and are crossed. "Confirm CA1" applies it; prompt undo is separate
 * from document undo; the provider, model and latency sit quietly in the bar.
 *
 * `ai-consent`: the first-use gate for the provider, as a side sheet over the
 * orthogonal column and Inspector (never over the primary): server, what
 * leaves the app, the weights' licence, what AI assist will and will not do,
 * and the provenance record.
 */

import React from 'react';
import clsx from 'clsx';
import { Box, Check, CircleMinus, CirclePlus, Lasso, Spline, Undo2 } from 'lucide-react';
import { Button, Checkbox, IconButton, Notice, Select, TextField } from '@/components/ui/bf';
import { ProposalPill } from '@/modules/segmentation/components/shared/ProposalParts';
import { SliceView, type Projector } from '@/modules/segmentation/components/shared/SliceView';
import type { LabelVoxel } from '@/modules/segmentation/components/shared/types';
import { DESIGN } from '@/modules/segmentation/__design__/designData';
import { StatusItem, Swatch, ViewportFrame } from '@/modules/segmentation/components/shared/chrome';
import { fmtInt, fmtMm } from '@/modules/segmentation/components/shared/geometry';
import { CA1, LABEL_BY_ID, NATIVE, NATIVE_SLICES_J } from '@/modules/segmentation/components/shared/mockData';
import { CROSSHAIR_WORLD, OVERLAYS, SCENE } from '@/modules/segmentation/components/shared/scenes';
import { zoomFactor } from '@/modules/segmentation/components/shared/views';
import { promptSign, type Prompt } from '@/modules/segmentation/components/shared/workflowRules';
import {
  GeometryTitle,
  HShell,
  InspectorFrame,
  LabelsSection,
  OrthoHeader,
  SessionHeader,
  Sep,
  SliceRuler,
  StepCard,
  StripItem,
  TextToggle,
  ToolRail,
} from '@/modules/segmentation/components/directions/h/DirectionH';
import { SLICE_K, hOrtho, hPrimary, islandOverlay, strokeLabels } from '@/modules/segmentation/components/directions/h/hViews';
import { FilePreview, OrthoColumn, PrimaryPanel, SheetPart, SideSheet, StateChip, TraceGrid } from './parts';
import { AI } from './workflowData';

const CA1_DEF = LABEL_BY_ID.get(CA1)!;

// ------------------------------------------------------------ prompt rail

const PROMPT_TOOLS = [
  { id: 'point+', name: 'Point, include', key: '1', how: 'click', icon: <CirclePlus /> },
  { id: 'point-', name: 'Point, exclude', key: '2', how: 'Alt-click', icon: <CircleMinus /> },
  { id: 'scribble', name: 'Scribble', key: '3', how: 'drag; Alt excludes', icon: <Spline /> },
  { id: 'box', name: 'Box', key: '4', how: 'drag a rectangle on this slice', icon: <Box /> },
  { id: 'lasso', name: 'Lasso', key: '5', how: 'draw a closed loop; the best refinement prompt', icon: <Lasso /> },
] as const;

/** The AI tool's sub-rail: the five prompt kinds, beside the main rail. */
function PromptRail({ active }: { active: string }) {
  return (
    <nav
      aria-label="AI prompts"
      className="flex w-9 shrink-0 flex-col items-center gap-0.5 border-r border-bf-border-subtle bg-bf-bg-panel-sunken py-2"
      data-testid="prompt-rail"
    >
      <span className="pb-1 text-bf-2xs text-bf-text-muted" title="AI prompts for nnInteractive: each is placed on the slice you see; the answer is 3D">
        AI
      </span>
      {PROMPT_TOOLS.map((t) => (
        <IconButton
          key={t.id}
          aria-label={`${t.name} (${t.key})`}
          title={`${t.name} (${t.key}): ${t.how}`}
          icon={t.icon}
          size="sm"
          pressed={t.id === active}
        />
      ))}
    </nav>
  );
}

// ------------------------------------------------------------ prompt marks

/**
 * Prompts on the image, by form: include is a filled neutral disc with a
 * dark +, exclude a hollow ring with −, a scribble a solid neutral line with
 * a dot at its start. All over a dark halo; no colour, no dash.
 */
function PromptMarks({ p, prompts, k }: { p: Projector; prompts: readonly Prompt[]; k: number }) {
  const here = prompts.filter((q) => q.k === k);
  return (
    <svg className="pointer-events-none absolute inset-0" width={p.width} height={p.height} aria-hidden data-testid="prompt-marks">
      {here.map((q) => {
        const pts = q.points.map((pt) => p.project(pt));
        if (q.kind === 'scribble' || q.kind === 'lasso') {
          const d = pts.map((pt, i) => `${i ? 'L' : 'M'}${pt.x} ${pt.y}`).join('') + (q.kind === 'lasso' ? 'Z' : '');
          return (
            <g key={q.id} data-prompt={q.kind}>
              <path d={d} fill="none" className="stroke-bf-bg-canvas" strokeOpacity={0.7} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
              <path d={d} fill="none" className="stroke-bf-text-primary" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
              <circle cx={pts[0].x} cy={pts[0].y} r={2.5} className="fill-bf-text-primary" />
            </g>
          );
        }
        if (q.kind === 'box') {
          const [a, b] = pts;
          return (
            <g key={q.id} data-prompt="box">
              <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill="none" className="stroke-bf-bg-canvas" strokeWidth={3} strokeOpacity={0.6} />
              <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill="none" className="stroke-bf-text-primary" strokeWidth={1} />
            </g>
          );
        }
        const c = pts[0];
        const plus = promptSign(q) === '+';
        return (
          <g key={q.id} data-prompt={q.kind}>
            <circle cx={c.x} cy={c.y} r={7} className="fill-bf-bg-canvas" fillOpacity={0.55} />
            <circle
              cx={c.x}
              cy={c.y}
              r={5.5}
              className={plus ? 'fill-bf-text-primary stroke-bf-text-primary' : 'fill-bf-bg-canvas stroke-bf-text-primary'}
              fillOpacity={plus ? 1 : 0.5}
              strokeWidth={1.25}
            />
            <path
              d={plus ? `M${c.x - 3} ${c.y}h6M${c.x} ${c.y - 3}v6` : `M${c.x - 3} ${c.y}h6`}
              className={plus ? 'stroke-bf-bg-canvas' : 'stroke-bf-text-primary'}
              strokeWidth={1.5}
            />
          </g>
        );
      })}
    </svg>
  );
}

/** The inline key on header line 2: prompt forms and the crossed "kept" mark. */
function PromptKey() {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-2.5 whitespace-nowrap text-bf-2xs text-bf-text-muted" data-testid="prompt-key">
      <span className="flex items-center gap-1">
        <svg width={11} height={11} aria-hidden>
          <circle cx={5.5} cy={5.5} r={4.5} className="fill-bf-text-primary" />
          <path d="M3 5.5h5M5.5 3v5" className="stroke-bf-bg-canvas" strokeWidth={1.25} />
        </svg>
        include
      </span>
      <span className="flex items-center gap-1">
        <svg width={11} height={11} aria-hidden>
          <circle cx={5.5} cy={5.5} r={4.5} fill="none" className="stroke-bf-text-primary" strokeWidth={1} />
          <path d="M3 5.5h5" className="stroke-bf-text-primary" strokeWidth={1.25} />
        </svg>
        exclude
      </span>
      <span className="flex items-center gap-1" title="Voxels the model wanted that another label holds: not taken">
        <svg width={9} height={9} aria-hidden>
          <path d="M2 2L7 7M7 2L2 7" className="stroke-bf-text-primary" strokeWidth={1.25} />
        </svg>
        kept
      </span>
    </span>
  );
}

/** Header line 2 while prompting: target, channel, crop, refine policy (each a control). */
function PromptStrip() {
  return (
    <>
      <span className="flex min-w-0 items-center gap-0.5" data-testid="prompt-strip">
        <StripItem title="Target label: the proposal is drawn and confirmed in its colour. Changing the active label never retargets a pending proposal.">
          <Swatch color={CA1_DEF.color} size={8} />
          <span className="text-bf-text-primary">{CA1_DEF.name}</span>
        </StripItem>
        <Sep />
        <StripItem title="The model takes one channel: the contrast sent with each prompt">channel {AI.channel}</StripItem>
        <Sep />
        <StripItem title="Only a crop around the target is sent (in voxels of the reference grid)">
          crop {AI.cropVx.join('×')} vx
        </StripItem>
        <Sep />
        <StripItem title="Refine existing CA1 (off): the model may only add to empty voxels; turning it on lets it also remove CA1 voxels">
          add only
        </StripItem>
      </span>
      <PromptKey />
    </>
  );
}

/** The proposal bar: what the 3D result does, Confirm (names the label), Discard, prompt undo; the provider quietly on the right. */
function AiBar() {
  const seen = AI.seen.length;
  const total = AI.slices.length;
  const kept = AI.protected.length;
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-bf-border-subtle bg-bf-bg-panel px-2 py-1.5" data-testid="ai-bar">
      <div className="flex min-w-0 items-center gap-2 text-bf-xs">
        <span className="flex items-center gap-0.5" aria-hidden>
          {AI.slices.map((k) => (
            <span key={k} className={clsx('h-1.5 w-4 rounded-[1px]', AI.seen.includes(k) ? 'bg-bf-text-secondary' : 'border border-bf-text-muted')} />
          ))}
        </span>
        <span className="whitespace-nowrap text-bf-text-primary" data-testid="ai-seen">
          {seen} of {total} slices seen
        </span>
        <span className="whitespace-nowrap font-mono text-bf-2xs text-bf-text-muted">
          +{fmtInt(AI.addedTotal)} vx · +{AI.added.length} here
        </span>
        <span
          className="ml-auto whitespace-nowrap font-mono text-bf-2xs text-bf-text-muted"
          title={`Sent: the ${AI.channel} crop and ${AI.prompts.length} prompts to ${AI.server} (this computer). Weights ${AI.licence}.`}
          data-testid="ai-provider"
        >
          {AI.provider} {AI.version} · local · {AI.latencyS.toFixed(2)} s
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          variant="primary"
          icon={<Swatch color={CA1_DEF.color} size={8} />}
          title={`Write the proposal into CA1 on all ${total} slices (Enter). Unseen slices stay "AI, not reviewed" on the ruler and in provenance.`}
          data-testid="ai-confirm"
        >
          Confirm CA1 ↵
        </Button>
        <Button variant="ghost" title="Discard the proposal and keep the prompts (Esc)">
          Discard
        </Button>
        <IconButton
          aria-label="Undo last prompt"
          title={`Undo the last prompt (⌥Z): the model answers again. ${AI.interactionSteps} prompts in this AI session; document undo (⌘Z) is separate and untouched.`}
          icon={<Undo2 />}
          variant="ghost"
          data-testid="prompt-undo"
        />
        <span className="whitespace-nowrap text-bf-2xs text-bf-text-muted">prompt undo · {AI.interactionSteps}</span>
        <span className="ml-auto whitespace-nowrap text-bf-2xs text-bf-text-muted" data-testid="ai-protected" title="The proposal never takes voxels another label holds; locked labels are never touched">
          {kept} vx kept in {AI.protectedBy.map(([id, n]) => `${LABEL_BY_ID.get(id)!.name} ${n}`).join(', ')}
        </span>
      </div>
    </div>
  );
}

const PROMPT_NAME: Record<Prompt['kind'], string> = {
  'point+': 'Point',
  'point-': 'Point',
  scribble: 'Scribble',
  box: 'Box',
  lasso: 'Lasso',
};

/** The AI section of the Inspector: prompts placed (each removable), channel, the opt-in refine, the model line. */
function AiSection() {
  return (
    <section className="flex flex-col gap-1.5 border-b border-bf-border-subtle px-3 py-2" data-testid="ai-section">
      <div className="flex items-center gap-2">
        <span className="text-bf-xs font-medium text-bf-text-primary">AI assist</span>
        <span className="text-bf-2xs text-bf-text-muted">into</span>
        <Swatch color={CA1_DEF.color} size={8} />
        <span className="text-bf-2xs text-bf-text-secondary">CA1</span>
        <Button variant="ghost" size="sm" className="ml-auto" title="Remove every prompt (the proposal goes too)">
          Reset prompts
        </Button>
      </div>
      <ol className="m-0 flex list-none flex-col p-0" aria-label="Prompts" data-testid="prompt-list">
        {AI.prompts.map((q) => (
          <li key={q.id} className="group flex h-5 items-center gap-2 text-bf-xs text-bf-text-secondary" data-prompt-row={q.kind}>
            <span className="w-3 text-right font-mono text-bf-2xs text-bf-text-muted">{q.id}</span>
            <span className="w-4 text-center font-mono text-bf-text-primary">{promptSign(q)}</span>
            <span>{PROMPT_NAME[q.kind]}</span>
            <span className="font-mono text-bf-2xs text-bf-text-muted">k {q.k}</span>
            {q.kind === 'point-' ? <span className="text-bf-2xs text-bf-text-muted">on DG</span> : null}
            <span className="ml-auto text-bf-2xs text-bf-text-faint group-hover:text-bf-text-muted">remove</span>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-2 text-bf-2xs text-bf-text-muted">
        <span className="w-14 shrink-0">Channel</span>
        <Select
          aria-label="Channel sent to the model"
          defaultValue="t2"
          className="w-auto"
          options={[
            { value: 't2', label: 'T2w (reference grid)' },
            { value: 't1', label: 'T1w (resliced)' },
          ]}
        />
        <span className="truncate">one channel only</span>
      </div>
      <span className="font-mono text-bf-2xs text-bf-text-muted" title="Recorded in the provenance sidecar with every confirmed proposal">
        {AI.provider} {AI.version} · {AI.licence} · acknowledged 31 Oct
      </span>
    </section>
  );
}

/** Ruler marks for the AI result: seen slices solid, unseen hollow "AI". */
const AI_MARKS = Object.fromEntries(
  AI.slices.map((k) => [
    k,
    AI.seen.includes(k)
      ? { mark: 'solid' as const, title: `k ${k} · AI proposal, seen` }
      : { mark: 'open' as const, why: 'AI', title: `k ${k} · AI proposal, not seen yet` },
  ]),
);

function AiStatus({ setUp = true }: { setUp?: boolean }) {
  const [x, y, z] = CROSSHAIR_WORLD;
  return (
    <>
      <StatusItem label="Crosshair" value={`(${fmtMm(x)}, ${fmtMm(y)}, ${fmtMm(z)})`} />
      <StatusItem label="Label" value="CA1" mono={false} />
      <StatusItem label="AI" value={setUp ? `${AI.provider} · local` : 'not set up'} mono={false} />
    </>
  );
}

function HeaderRight({ fovMm }: { fovMm: number }) {
  return (
    <>
      <span className="font-mono text-bf-2xs text-bf-text-muted" title="Zoom relative to fitting the slice">
        {zoomFactor(fovMm)}
      </span>
      <TextToggle pressed={false} title="Linked contrasts (C)">
        Contrasts
      </TextToggle>
    </>
  );
}

export function AiPromptState() {
  const base = hPrimary('proposal');
  const labels = OVERLAYS.labels(SCENE.tracing.base, CA1);
  const view = {
    ...base,
    overlays: [
      ...strokeLabels(labels),
      ...OVERLAYS.proposal(AI.added, CA1, AI.protected.map((p) => p.voxel)),
    ],
  };
  return (
    <HShell
      status={<AiStatus />}
      testState="ai-prompt"
      rail={
        <>
          <ToolRail state="tracing" active="ai" ai="on" />
          <PromptRail active="point+" />
        </>
      }
      inspector={
        <InspectorFrame>
          <SessionHeader state="tracing" />
          <StepCard state="tracing" />
          <AiSection />
          <LabelsSection state="tracing" pending={AI.matrix} hover={null} />
        </InspectorFrame>
      }
    >
      <TraceGrid
        primary={
          <PrimaryPanel
            chip={<ProposalPill />}
            title={<GeometryTitle image={view.image} />}
            right={<HeaderRight fovMm={view.fovMm} />}
            line2={<PromptStrip />}
            view={view}
            overlay={(p) => <PromptMarks p={p} prompts={AI.prompts} k={SLICE_K} />}
            ruler={<SliceRuler state="tracing" marks={AI_MARKS} />}
            below={<AiBar />}
          />
        }
        side={<AiOrtho />}
      />
    </HShell>
  );
}

/**
 * The orthogonal views show the 3D answer: CA1 as traced, and the proposed
 * voxels in CA1's proposal hatch, so its extent across k reads at a glance.
 */
function AiOrtho() {
  const o = hOrtho('tracing');
  const added = (all: readonly LabelVoxel[], traced: readonly LabelVoxel[]) => {
    const have = new Set(traced.filter((v) => v[2] === CA1).map(([c, r]) => `${c},${r}`));
    return all.filter((v) => v[2] === CA1 && !have.has(`${v[0]},${v[1]}`)).map(([c, r]) => [c, r] as const);
  };
  const panel = (plane: 'axial' | 'sagittal') => {
    const p = o[plane];
    // Only the slices the result spans (k 5–13): template j of each displayed voxel, from the display row (axial) or column (sagittal).
    const ny = DESIGN.grid.dims[1];
    const js = AI.slices.map((k) => NATIVE_SLICES_J[k - 1]);
    const [j0, j1] = [Math.min(...js), Math.max(...js) + NATIVE.stepJ - 1];
    const inSpan = (v: readonly [number, number]) => {
      const j = ny - 1 - (plane === 'axial' ? v[1] : v[0]);
      return j >= j0 && j <= j1;
    };
    const vs = (plane === 'axial' ? added(DESIGN.labels.axAll, DESIGN.labels.axTraced) : added(DESIGN.labels.sagAll, DESIGN.labels.sagTraced)).filter(inSpan);
    return (
      <ViewportFrame image={p.image} title={<OrthoHeader image={p.image} />}>
        <SliceView {...p} overlays={[...(p.overlays ?? []), ...OVERLAYS.proposal(vs, CA1)]} />
      </ViewportFrame>
    );
  };
  return <OrthoColumn axial={panel('axial')} sagittal={panel('sagittal')} />;
}

// -------------------------------------------------------------- consent

const PROVENANCE_AI = [
  '"ai": {',
  `  "provider": "${AI.provider} ${AI.version}",`,
  `  "server": "http://${AI.server} (this computer)",`,
  `  "weights_licence": "${AI.licence}",`,
  '  "acknowledged_by": "Rater A",',
  '  "acknowledged_at": "2026-10-31T14:02:11Z"',
  '}',
];

function ConsentSheet() {
  return (
    <SideSheet
      title="AI assist · before first use"
      meta="asked once per provider and licence version"
      testId="ai-consent"
      footer={
        <>
          <Button variant="primary" disabled title="Tick the licence acknowledgement first" data-testid="consent-accept">
            Use nnInteractive
          </Button>
          <Button variant="ghost">Not now</Button>
          <span className="ml-auto text-bf-2xs text-bf-text-muted">nothing is sent until you accept</span>
        </>
      }
    >
      <SheetPart n={1} title="Server" meta="nnInteractive server (Docker or pip)">
        <div
          role="radio"
          aria-checked
          tabIndex={0}
          className="flex flex-col gap-1 rounded-sm border border-bf-border-strong bg-bf-bg-active px-2 py-1.5"
          data-testid="server-local"
        >
          <span className="flex items-center gap-2 text-bf-xs text-bf-text-primary">
            <span className="flex h-2.5 w-2.5 items-center justify-center rounded-full border border-bf-text-primary" aria-hidden>
              <span className="h-1 w-1 rounded-full bg-bf-text-primary" />
            </span>
            This computer
            <span className="font-mono text-bf-2xs text-bf-text-secondary">http://{AI.server}</span>
            <span className="ml-auto flex items-center gap-1 text-bf-2xs text-bf-text-secondary">
              <Check className="h-3 w-3" aria-hidden />
              answered · {AI.version}
            </span>
          </span>
          <span className="pl-[18px] text-bf-2xs text-bf-text-secondary" data-testid="leaves-local">
            Nothing leaves this computer. The T2w crop and your prompts go to the server running here.
          </span>
        </div>
        <div role="radio" aria-checked={false} tabIndex={-1} className="flex flex-col gap-1.5 rounded-sm border border-bf-border-subtle px-2 py-1.5" data-testid="server-remote">
          <span className="flex items-center gap-2 text-bf-xs text-bf-text-primary">
            <span className="h-2.5 w-2.5 rounded-full border border-bf-text-muted" aria-hidden />
            Remote server
            <span className="text-bf-2xs text-bf-text-muted">for macOS or machines without a GPU</span>
          </span>
          <div className="flex gap-1.5 pl-[18px]">
            <TextField aria-label="Server URL" defaultValue="https://gpu.lab.example.org:1527" className="min-w-0 flex-1 font-mono" />
            <TextField aria-label="API key" placeholder="API key" className="w-28" />
          </div>
          <Notice severity="warning" role={undefined} className="ml-[18px]" data-testid="leaves-remote">
            <span>
              <span className="text-bf-text-primary">Leaves this computer</span> for gpu.lab.example.org: the T2w crop around the
              target (about {AI.cropVx.join('×')} vx, 0.3 MB per prompt) and your prompts. Not sent: labels, other images, file
              names, header text. Check that your data agreement allows it.
            </span>
          </Notice>
        </div>
      </SheetPart>
      <SheetPart n={2} title="Model weights licence" meta="reported by the server (session.license)">
        <div className="flex items-baseline gap-2 text-bf-xs">
          <span className="font-mono text-bf-text-primary" data-testid="licence-name">
            {AI.licence}
          </span>
          <span className="text-bf-text-secondary">non-commercial · share-alike · attribution</span>
        </div>
        <p className="m-0 text-bf-2xs leading-snug text-bf-text-secondary">
          The weights are not part of Brainflow and Brainflow never downloads them; your server supplies them. Use them only
          for non-commercial work, and release adaptations under the same licence.
        </p>
        <Checkbox data-testid="licence-ack">I have read the licence, and my use is non-commercial</Checkbox>
      </SheetPart>
      <SheetPart n={3} title="What AI assist does">
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-bf-2xs leading-snug text-bf-text-secondary">
          <li>Every answer is a proposal in the target label's colour. Nothing is written until you confirm it.</li>
          <li>A proposal never takes voxels another label holds; locked labels stay exactly as they are.</li>
          <li>Refining an existing label (removing its voxels) is off until you turn it on.</li>
          <li>
            No published accuracy exists for hippocampal subfields. Check every slice; unseen slices stay marked "AI, not
            reviewed".
          </li>
        </ul>
      </SheetPart>
      <SheetPart n={4} title="Recorded in provenance" meta="in the sidecar, with every confirmed proposal">
        <FilePreview lines={PROVENANCE_AI} max={8} testId="consent-provenance" />
      </SheetPart>
    </SideSheet>
  );
}

export function AiConsentState() {
  const base = hPrimary('tracing');
  // The session as it stands (no stroke in progress, no brush: the AI tool was just clicked).
  const view = { ...base, brush: null, overlays: [...strokeLabels(OVERLAYS.labels(SCENE.tracing.base, CA1)), islandOverlay(SCENE.tracing.base)] };
  return (
    <HShell
      status={<AiStatus setUp={false} />}
      testState="ai-consent"
      rail={<ToolRail state="tracing" active="ai" ai="pending" />}
      inspector={<ConsentSheet />}
    >
      <TraceGrid
        primary={
          <PrimaryPanel
            chip={<StateChip>Tracing</StateChip>}
            title={<GeometryTitle image={view.image} />}
            right={<HeaderRight fovMm={view.fovMm} />}
            line2={
              <span className="flex items-center gap-2 px-1 text-bf-xs text-bf-text-muted">
                <Swatch color={CA1_DEF.color} size={8} />
                <span className="text-bf-text-secondary">CA1</span>
                <Sep />
                AI assist waits for the licence on the right
              </span>
            }
            view={view}
            ruler={<SliceRuler state="tracing" />}
          />
        }
      />
    </HShell>
  );
}
