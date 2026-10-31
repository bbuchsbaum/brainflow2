/**
 * Round 5: AI assist in direction H (states `ai-prompt` and `ai-consent`).
 *
 * `ai-prompt`: the AI tool opens a prompt sub-rail (point +, point −,
 * scribble, box, lasso). Prompts are neutral marks told apart by form (a
 * filled disc with + includes, a hollow ring with − excludes, a solid
 * scribble), never by colour and never dashed. The model's 3D answer is a
 * proposal in the target label's colour, H's proposal grammar (hatch plus a
 * thin solid outline); voxels it wanted that another label holds are not
 * taken and are crossed. Round 6: "Accept CA1 here ↵" writes the slice under
 * review and steps to the next unseen slice (as fill between does); "Confirm
 * all…" is secondary and asks once more; voxels that border a label not yet
 * complete get a neutral over-reach outline. Prompt undo is separate from
 * document undo; the provider, model and latency sit once, in the bar.
 *
 * `ai-consent`: the first-use gate for the provider, as a side sheet over the
 * orthogonal column and Inspector (never over the primary): server, what
 * leaves the app, the weights' licence, what AI assist will and will not do,
 * and one sentence of what is recorded (the record itself behind "Show
 * record"). The session is shown as it was before AI was first used.
 */

import React from 'react';
import clsx from 'clsx';
import { AlertTriangle, Box, Check, CircleMinus, CirclePlus, Lasso, Spline, Undo2 } from 'lucide-react';
import { Button, Checkbox, IconButton } from '@/components/ui/bf';
import { ProposalPill } from '@/modules/segmentation/components/shared/ProposalParts';
import { SliceView, type Overlay, type Projector } from '@/modules/segmentation/components/shared/SliceView';
import { DESIGN } from '@/modules/segmentation/__design__/designData';
import { BEFORE_AI, sessionSliceStatus } from '@/modules/segmentation/components/shared/session';
import { StatusItem, Swatch, ViewportFrame } from '@/modules/segmentation/components/shared/chrome';
import { fmtInt, fmtMm, worldToDisplay } from '@/modules/segmentation/components/shared/geometry';
import { CA1, LABEL_BY_ID, LABEL_VOLUMES, NATIVE, NATIVE_SLICES_J, labelColor, yOfJ } from '@/modules/segmentation/components/shared/mockData';
import { CROSSHAIR_WORLD, OVERLAYS, SCENE } from '@/modules/segmentation/components/shared/scenes';
import { zoomFactor } from '@/modules/segmentation/components/shared/views';
import { promptSign, type Prompt } from '@/modules/segmentation/components/shared/workflowRules';
import {
  GeometryTitle,
  HShell,
  InspectorFrame,
  LabelsSection,
  NeighbourKey,
  OrthoHeader,
  SessionHeader,
  Sep,
  SliceRuler,
  StepCard,
  StripItem,
  TextToggle,
  ToolRail,
} from '@/modules/segmentation/components/directions/h/DirectionH';
import { ISLANDS_HERE, SLICE_K, STRUCTURE_BOX, hOrtho, hPrimary, islandOverlay, sliceDir, strokeLabels } from '@/modules/segmentation/components/directions/h/hViews';
import { FilePreview, OrthoColumn, PrimaryPanel, SheetPart, SideSheet, StateChip, TraceGrid } from './parts';
import { AI, BODY_K } from './workflowData';

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
      aria-label="Prompts: each is placed on the slice you see; the answer is 3D"
      className="flex w-9 shrink-0 flex-col items-center gap-0.5 border-r border-bf-border-subtle bg-bf-bg-panel-sunken py-2"
      data-testid="prompt-rail"
    >
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
      <span
        className="flex items-center gap-1"
        title={`Voxels the model wanted that another label holds: not taken. Here ${AI.protected.length} vx kept in ${AI.protectedBy.map(([id, n]) => `${LABEL_BY_ID.get(id)!.name} ${n}`).join(', ')}.`}
        data-testid="ai-protected"
      >
        <svg width={9} height={9} aria-hidden>
          <path d="M2 2L7 7M7 2L2 7" className="stroke-bf-text-primary" strokeWidth={1.25} />
        </svg>
        kept
      </span>
      <span className="flex items-center gap-1" title="Proposed voxels that border a label not complete yet, or sit where the prior puts a label still empty; slices outside the step's range are marked check on the ruler. Look before accepting">
        <svg width={11} height={9} aria-hidden>
          <rect x={1} y={1} width={9} height={7} fill="none" className="stroke-bf-text-primary" strokeWidth={1.25} />
        </svg>
        check
      </span>
      {ISLANDS_HERE ? (
        <span className="flex items-center gap-1" title="A ring marks an island: a piece of CA1 not connected to the rest on this slice" data-testid="island-key">
          <svg width={9} height={9} aria-hidden>
            <circle cx={4.5} cy={4.5} r={3.5} fill="none" strokeWidth={1} className="stroke-bf-text-primary" />
          </svg>
          island
        </span>
      ) : null}
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

/**
 * The proposal bar, as fill between's. Round 7 (trimmed): one progress line
 * (per-slice pips, "3 of 9 seen · next k 9", the voxel count, the provider
 * once at the right) and one action line: Accept and Discard on the left,
 * prompt undo as an icon (⌥Z, its count in the tooltip), and the quiet
 * "Confirm all…" alone on the right. The over-reach count is on the slice
 * (halo tag beside its outline), the kept count in the key's tooltip.
 */
function AiBar() {
  const seen = AI.seen.length;
  const total = AI.slices.length;
  const unseen = total - seen;
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-bf-border-subtle bg-bf-bg-panel px-2 py-1.5" data-testid="ai-bar">
      <div className="flex min-w-0 items-center gap-2 text-bf-xs">
        <span className="flex items-center gap-0.5" aria-hidden>
          {[...AI.slices].sort((a, b) => b - a).map((k) => (
            <span key={k} className={clsx('h-1.5 w-3 rounded-[1px]', AI.seen.includes(k) ? 'bg-bf-text-secondary' : 'border border-bf-text-muted', k === AI.current && 'outline outline-1 outline-offset-1 outline-bf-text-primary')} />
          ))}
        </span>
        <span className="whitespace-nowrap text-bf-text-primary" data-testid="ai-seen">
          {seen} of {total} slices seen
        </span>
        {AI.next ? (
          <span className="whitespace-nowrap font-mono text-bf-2xs text-bf-text-muted" data-testid="ai-next" title="Enter accepts this slice and goes there">
            then k {AI.next}
          </span>
        ) : null}
        <span className="whitespace-nowrap font-mono text-bf-2xs text-bf-text-muted">+{fmtInt(AI.addedTotal)} vx</span>
        <span
          className="ml-auto whitespace-nowrap font-mono text-bf-2xs text-bf-text-muted"
          title={`Sent: the ${AI.channel} crop and ${AI.prompts.length} prompts to ${AI.server} (this computer). Weights ${AI.licence}, acknowledged 31 Oct.`}
          data-testid="ai-provider"
        >
          {AI.provider} {AI.version} · local · {AI.latencyS.toFixed(2)} s
        </span>
      </div>
      <div className="flex items-center gap-1.5" data-testid="ai-actions">
        <Button
          variant="primary"
          icon={<Swatch color={CA1_DEF.color} size={8} />}
          title={`Write the proposal into CA1 on k ${AI.current} only (Enter), then go to the next unseen slice${AI.next ? `, k ${AI.next}` : ''}. Logged "AI, reviewed".`}
          data-testid="ai-accept"
        >
          Accept CA1 here ↵
        </Button>
        <Button variant="ghost" title="Discard the proposal and keep the prompts (Esc)">
          Discard
        </Button>
        <IconButton
          aria-label="Undo last prompt (⌥Z)"
          title={`Undo the last prompt (⌥Z): the model answers again. ${AI.interactionSteps} prompts so far; document undo (⌘Z) is separate and untouched.`}
          icon={<Undo2 />}
          variant="ghost"
          size="sm"
          data-testid="prompt-undo"
        />
        <Button
          variant="ghost"
          className="ml-auto text-bf-text-muted"
          title={`Write all ${total} slices now. ${unseen} slices you have not looked at are written as "AI, not reviewed": hollow on the ruler, warned at save, and they block Mark CA1 complete. Asks once more.`}
          data-testid="ai-confirm-all"
        >
          Confirm all {total}…
        </Button>
      </div>
    </div>
  );
}

/**
 * Over-reach counts on the slice: one halo tag per label beside its flagged
 * voxels ("check 3 · Subiculum"), as the "last edit" tag; no chip, no colour.
 */
function OverreachTags({ p }: { p: Projector }) {
  // One tag below the structure's extent, under the flagged voxels, with a hairline leader.
  const vs = AI.overreach.voxels.filter((_, i) => AI.overreach.labels[i] !== 0);
  if (!vs.length) return null;
  const col = vs.reduce((sum, v) => sum + v[0], 0) / vs.length + 0.5;
  const bottom = Math.max(...vs.map((v) => v[1])) + 1;
  const from = p.project([col, bottom + 0.2]);
  const to = p.project([col, Math.max(bottom + 2, STRUCTURE_BOX.y1 + 0.5)]);
  const parts = AI.overreach.byLabel.map(([id, n]) => `${LABEL_BY_ID.get(id)!.name} ${n}${(LABEL_VOLUMES[id]?.now ?? 0) === 0 ? ', empty' : ''}`);
  return (
    <span data-testid="ai-overreach" title="Proposed voxels next to a label that is not complete yet, or near where the pack's prior puts a label still empty: the model may have run into its territory. Look before accepting; nothing is refused.">
      <svg className="pointer-events-none absolute inset-0" width={p.width} height={p.height} aria-hidden>
        <path d={`M${from.x} ${from.y}V${to.y}`} className="stroke-bf-bg-canvas" strokeWidth={3} strokeOpacity={0.6} />
        <path d={`M${from.x} ${from.y}V${to.y}`} className="stroke-bf-text-primary" strokeWidth={1} />
      </svg>
      <span
        className="pointer-events-none absolute whitespace-nowrap font-mono text-bf-2xs leading-4 text-bf-text-primary [text-shadow:0_0_2px_var(--bf-bg-canvas),0_0_3px_var(--bf-bg-canvas),0_0_4px_var(--bf-bg-canvas)]"
        style={{ left: to.x - 6, top: to.y + 1 }}
      >
        check {vs.length} vx · {parts.join(' · ')}
      </span>
    </span>
  );
}

const PROMPT_NAME: Record<Prompt['kind'], string> = {
  'point+': 'Point',
  'point-': 'Point',
  scribble: 'Scribble',
  box: 'Box',
  lasso: 'Lasso',
};

/** The Inspector's AI line: how many prompts, on which slices, and Reset (the marks are on the slice, the provider in the bar). */
function AiSection() {
  const byK = new Map<number, number>();
  for (const q of AI.prompts) byK.set(q.k, (byK.get(q.k) ?? 0) + 1);
  return (
    <section className="flex items-center gap-2 border-b border-bf-border-subtle px-3 py-1.5 text-bf-xs" data-testid="ai-section">
      <span className="text-bf-text-primary" data-testid="prompt-count">
        {AI.prompts.length} prompts
      </span>
      <span className="font-mono text-bf-2xs text-bf-text-muted" title={AI.prompts.map((q) => `${q.id}. ${promptSign(q)} ${PROMPT_NAME[q.kind]} on k ${q.k}`).join('\n')}>
        {[...byK].map(([k, n]) => `k ${k} (${n})`).join(' · ')}
      </span>
      <Button variant="ghost" size="sm" className="ml-auto" title="Remove every prompt (the proposal goes too)">
        Reset
      </Button>
    </section>
  );
}

/**
 * Ruler marks for the pending answer: seen slices solid, unseen hollow
 * ("review"), and answer slices outside the body slab hollow with their own
 * caption ("check"), so the run reads apart.
 */
const AI_MARKS = Object.fromEntries(
  AI.slices.map((k) => {
    const out = AI.outside.find((o) => o.k === k);
    if (out) return [k, { mark: 'open' as const, why: 'check', title: `k ${k} · proposed, outside the body slab k ${BODY_K[0]}–${BODY_K[1]}: ${out.vx} vx to check` }];
    return [
      k,
      AI.seen.includes(k)
        ? { mark: 'solid' as const, title: `k ${k} · AI proposal, seen` }
        : { mark: 'open' as const, why: 'review', title: `k ${k} · proposed, not seen yet` },
    ];
  }),
);

function AiStatus({ setUp = true }: { setUp?: boolean }) {
  const [x, y, z] = CROSSHAIR_WORLD;
  return (
    <>
      <StatusItem label="Crosshair" value={`(${fmtMm(x)}, ${fmtMm(y)}, ${fmtMm(z)})`} />
      <StatusItem label="Label" value="CA1" mono={false} />
      {setUp ? (
        <StatusItem label="Proposal" value={`${AI.seen.length} of ${AI.slices.length} slices seen`} mono={false} />
      ) : (
        <StatusItem label="AI assist" value="not set up" mono={false} />
      )}
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
      islandOverlay(SCENE.tracing.base),
      // Over-reach: a neutral outline over a halo (points at voxels, changes none), never a colour.
      { kind: 'voxels' as const, voxels: AI.overreach.voxels, color: 'var(--bf-text-primary)', outline: true, width: 1.25 },
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
            overlay={(p) => (
              <>
                <PromptMarks p={p} prompts={AI.prompts} k={SLICE_K} />
                <OverreachTags p={p} />
              </>
            )}
            ruler={<SliceRuler state="tracing" marks={AI_MARKS} asOf={AI.asOf} />}
            below={<AiBar />}
          />
        }
        side={<AiOrtho />}
      />
    </HShell>
  );
}

/**
 * The orthogonal views show the 3D answer: CA1 as traced (fill and outline),
 * and past it the proposed voxels in a coarser, bolder CA1 hatch (round 7: the
 * default pitch collapsed to an outline at this scale) with one thin outline
 * around the whole answer, so its reach across k reads at a glance. The
 * axial view also marks the proposed slab (k 5–13) as a faint band between
 * two hairlines, the slab's tilt with it.
 */
export const ORTHO_HATCH_PITCH = 6.5;

function AiOrtho() {
  const o = hOrtho('tracing');
  const ny = DESIGN.grid.dims[1];
  const js = AI.slices.map((k) => NATIVE_SLICES_J[k - 1]);
  // Native slice k of a template j (each k spans NATIVE.stepJ template slices).
  const kOfTemplateJ = (j: number) => NATIVE_SLICES_J.findIndex((j0) => j >= j0 && j < j0 + NATIVE.stepJ) + 1;
  const panel = (plane: 'axial' | 'sagittal') => {
    const p = o[plane];
    // CA1 as the session had it at the AI moment (slices first written later are empty), and the answer on the empty slices it spans.
    const kOf = (v: readonly [number, number]) => kOfTemplateJ(ny - 1 - (plane === 'axial' ? v[1] : v[0]));
    const all = (plane === 'axial' ? DESIGN.labels.axAll : DESIGN.labels.sagAll).filter((v) => v[2] === CA1).map(([c, r]) => [c, r] as const);
    const emptyThen = (k: number) => k > 0 && sessionSliceStatus(NATIVE_SLICES_J[k - 1], AI.asOf) === 'empty';
    const traced = all.filter((v) => !emptyThen(kOf(v)));
    const vs = all.filter((v) => emptyThen(kOf(v)) && AI.slices.includes(kOf(v)));
    const colour = labelColor(CA1);
    const slab: Overlay[] = [];
    if (plane === 'axial') {
      // The proposed slab: from the front of k 13 to the back of k 5, tilted with the native slices.
      const [x0, , z0] = CROSSHAIR_WORLD;
      const yA = yOfJ(Math.max(...js) + NATIVE.stepJ - 1) + 0.5;
      const yP = yOfJ(Math.min(...js)) - 0.5;
      const mid = worldToDisplay('axial', [x0, (yA + yP) / 2, z0]);
      slab.push({ kind: 'band', through: mid, dir: sliceDir('axial'), widthMm: Math.abs(yA - yP), alpha: 0.05, edges: true, lengthMm: 60 });
    }
    return (
      <ViewportFrame image={p.image} title={<OrthoHeader image={p.image} />}>
        <SliceView
          {...p}
          overlays={[
            ...slab,
            ...(p.overlays ?? []).filter((ov) => ov.kind !== 'labels'),
            { kind: 'labels', voxels: traced.map(([c, r]) => [c, r, CA1] as const), fill: true, active: [CA1] },
            { kind: 'voxels', voxels: vs, color: colour, hatch: true, hatchPitch: ORTHO_HATCH_PITCH, opacity: 0.95 },
            { kind: 'voxels', voxels: [...traced, ...vs], color: colour, outline: true, width: 1 },
          ]}
          overlay={plane === 'axial' ? (pr) => <SlabCaption p={pr} /> : undefined}
        />
      </ViewportFrame>
    );
  };
  return <OrthoColumn axial={panel('axial')} sagittal={panel('sagittal')} />;
}

/** A halo caption at the proposed slab's edge in the axial view ("proposed k 5–13"). */
function SlabCaption({ p }: { p: Projector }) {
  const [x0, , z0] = CROSSHAIR_WORLD;
  const kHi = Math.max(...AI.slices);
  const kLo = Math.min(...AI.slices);
  const at = p.project(worldToDisplay('axial', [x0 + 6, yOfJ(NATIVE_SLICES_J[kHi - 1] + NATIVE.stepJ - 1) + 0.5, z0]));
  return (
    <span
      className="pointer-events-none absolute whitespace-nowrap font-mono text-bf-2xs leading-4 text-bf-text-secondary [text-shadow:0_0_2px_var(--bf-bg-canvas),0_0_3px_var(--bf-bg-canvas),0_0_4px_var(--bf-bg-canvas)]"
      style={{ left: Math.max(4, at.x), top: at.y - 16 }}
      data-testid="ai-slab-caption"
      title={`The answer's slab: native slices k ${kLo}–${kHi}, tilted with the native plane`}
    >
      proposed k {kLo}–{kHi}
    </span>
  );
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
        {/* Not selected: one line with its warning; selecting it opens the URL, key and what leaves. */}
        <div
          role="radio"
          aria-checked={false}
          aria-expanded={false}
          tabIndex={-1}
          className="flex items-center gap-2 rounded-sm border border-bf-border-subtle px-2 py-1 text-bf-xs text-bf-text-secondary hover:bg-bf-bg-hover"
          data-testid="server-remote"
          title={`Leaves this computer for the remote server: the T2w crop around the target (about ${AI.cropVx.join('×')} vx, 0.3 MB per prompt) and your prompts. Not sent: labels, other images, file names, header text. Check that your data agreement allows it.`}
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-bf-text-muted" aria-hidden />
          Remote server
          <span className="flex min-w-0 items-center gap-1 truncate text-bf-2xs text-bf-text-muted" data-testid="leaves-remote">
            <AlertTriangle className="h-3 w-3 shrink-0 text-bf-warning" aria-hidden />
            Leaves this computer: the crop and your prompts
          </span>
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
        <span className="text-bf-2xs text-bf-text-muted">
          A lab policy can acknowledge once for every rater; each record then says "via lab policy". A new licence version opens this
          sheet again and pauses prompts; confirmed work stays.
        </span>
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
      <SheetPart n={4} title="Recorded" testId="consent-recorded">
        <p className="m-0 text-bf-xs leading-snug text-bf-text-secondary" data-testid="consent-sentence">
          Each accepted slice is logged as AI in the session's provenance, with {AI.provider} {AI.version}, this computer's
          server, the {AI.licence} licence and your acknowledgement today.
        </p>
        <details className="text-bf-2xs text-bf-text-muted" data-testid="consent-record">
          <summary className="cursor-pointer select-none text-bf-text-secondary">Show record</summary>
          <div className="mt-1">
            <FilePreview lines={PROVENANCE_AI} max={8} testId="consent-provenance" />
          </div>
        </details>
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
              <span className="flex min-w-0 flex-1 items-center gap-2 px-1 text-bf-xs text-bf-text-muted">
                <Swatch color={CA1_DEF.color} size={8} />
                <span className="text-bf-text-secondary">CA1</span>
                <Sep />
                AI assist waits for the licence on the right
                <span className="ml-auto">
                  <NeighbourKey neighbour={false} island={ISLANDS_HERE > 0} />
                </span>
              </span>
            }
            view={view}
            ruler={<SliceRuler state="tracing" asOf={BEFORE_AI} />}
          />
        }
      />
    </HShell>
  );
}
