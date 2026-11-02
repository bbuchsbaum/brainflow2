/**
 * Round 5 mock data for direction H's workflow states: the AI prompts and
 * the gated 3D result, the lesion range brush, history steps, the save
 * bundle, the recovered journal and the setup choices. Every count shown in
 * the states is derived here (one source), from the same scenes as rounds
 * 0 to 4. Editing is simulated; nothing talks to a provider or a bridge.
 */

import {
  bboxOf,
  centreOf,
  components,
  labelIndex,
  voxelsOf,
} from '@/modules/segmentation/components/shared/geometry';
import {
  CA1,
  CA23,
  DG,
  EXTRA_LABEL_DEFS,
  LABEL_BY_ID,
  LABEL_DEFS,
  NATIVE,
  NATIVE_SLICES_J,
  NEW_LABEL,
  PROTOCOL,
  ERC,
  SRLM,
  SUB,
  WMH,
  areaByNativeSlice,
  yOfJ,
} from '@/modules/segmentation/components/shared/mockData';
import { SCENE } from '@/modules/segmentation/components/shared/scenes';
import type { Point, Voxel } from '@/modules/segmentation/components/shared/types';
import {
  colourCandidates,
  defaultConnectivity,
  dsegTsv,
  freesurferLut,
  gateProposal,
  nextUnseen,
  overreach,
  saveCheck,
  slicesOutside,
  itksnapTxt,
  labelVolumeHeader,
  rangeFootprint,
  undoForLabel,
  type Prompt,
  type TableLabel,
} from '@/modules/segmentation/components/shared/workflowRules';
import {
  BEFORE_AI,
  BRANCH as SESSION_BRANCH,
  JOURNAL_STEP,
  LABEL_VOXELS,
  LAST_SAVE,
  STEPS_SINCE_SAVE,
  branchUnreviewed,
  journal,
  provenanceTable,
  sessionSliceStatus,
  unreviewedSlices,
  type JournalStep,
  type JournalTool,
} from '@/modules/segmentation/components/shared/session';
import { DESIGN } from '@/modules/segmentation/__design__/designData';
import { LESION, flairAt } from '@/modules/segmentation/__design__/lesionData';

const key = (v: Voxel) => `${v[0]},${v[1]}`;
const N4: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Locked labels mid-session (complete): CA2/3, DG, SRLM. */
export const LOCKED_IDS: ReadonlySet<number> = new Set([CA23, DG, SRLM]);

// ---------------------------------------------------------------- AI assist

const kOfJ = (j: number) => NATIVE_SLICES_J.indexOf(j) + 1;
const PRIMARY_K = kOfJ(DESIGN.primaryJ);

/**
 * The model's raw answer on this slice: the CA1 still to trace plus a one
 * voxel rim, the over-reach a single-channel model makes at a low-contrast
 * border. The gate turns it into a proposal that adds empty voxels only.
 */
const missing = SCENE.proposal.voxels;
const missingSet = new Set(missing.map(key));
const rim: Voxel[] = [];
for (const v of missing)
  for (const [dc, dr] of N4) {
    const n: Voxel = [v[0] + dc, v[1] + dr];
    if (!missingSet.has(key(n)) && !rim.some((r) => r[0] === n[0] && r[1] === n[1])) rim.push(n);
  }
const rawMask: Voxel[] = [...missing, ...rim];
const gate = gateProposal(rawMask, labelIndex(SCENE.tracing.base), CA1, LOCKED_IDS);

const protectedBy = new Map<number, number>();
for (const p of gate.protected) protectedBy.set(p.label, (protectedBy.get(p.label) ?? 0) + 1);

const dg = voxelsOf(SCENE.tracing.base, DG);
const missingMain = components(missing)[0] ?? missing;
const mBox = bboxOf(missingMain);
/** A DG voxel near DG's middle (the exclude point sits on DG itself). */
const dgMid = (() => {
  const c = centreOf(dg);
  return [...dg].sort((a, b) => Math.hypot(a[0] + 0.5 - c[0], a[1] + 0.5 - c[1]) - Math.hypot(b[0] + 0.5 - c[0], b[1] + 0.5 - c[1]))[0];
})();
/** The scribble runs along the middle of the region still to trace, column by column. */
const scribble: Point[] = (() => {
  const cols = new Map<number, number[]>();
  for (const [c, r] of missingMain) cols.set(c, [...(cols.get(c) ?? []), r]);
  const xs = [...cols.keys()].sort((a, b) => a - b).slice(1, -1);
  return xs
    .filter((_, i) => i % 2 === 0)
    .map((c) => {
      const rs = cols.get(c)!;
      return [c + 0.5, rs.reduce((s, r) => s + r, 0) / rs.length + 0.5] as Point;
    });
})();

/** Prompts placed so far (display coordinates on the primary, k 11 unless stated). */
export const AI_PROMPTS: readonly Prompt[] = [
  { id: 1, kind: 'point+', points: [[mBox.x0 + 2.5, mBox.y0 + 1.5]], k: PRIMARY_K },
  { id: 2, kind: 'scribble', points: scribble, k: PRIMARY_K },
  { id: 3, kind: 'point-', points: [dgMid ? [dgMid[0] + 0.5, dgMid[1] + 0.5] : [mBox.x1, mBox.y0]], k: PRIMARY_K },
  { id: 4, kind: 'point+', points: [centreOf(missingMain)], k: PRIMARY_K - 2 },
];

/**
 * Round 7: the AI state is one moment of the session model, just after step
 * 31 (`BEFORE_AI`, as the licence gate), with the first answer pending. The
 * journal's next step (32′, later undone and kept as a branch) is exactly
 * this answer: nine slices, k 5–13, three of them (k 11, 10, 12) looked at.
 */
export const AI_AS_OF = BEFORE_AI;
const branchAnswer = SESSION_BRANCH.steps[0];
const aiSlices = (() => {
  const step = journal(0).find((s) => s.id === branchAnswer)!;
  return [...step.ks].sort((a, b) => b - a);
})();
const finalCa1 = areaByNativeSlice(CA1, 'all');
/** CA1 as traced at that moment: slices first written later are still empty. */
const tracedCa1 = areaByNativeSlice(CA1).map((v, i) => (sessionSliceStatus(NATIVE_SLICES_J[i], AI_AS_OF) === 'empty' ? 0 : v));

/** Review order of the answer's slices: outward from the prompted slice (k 11, 10, 12, 9, 13, …). */
const aiOrder = [...aiSlices].sort((a, b) => Math.abs(a - PRIMARY_K) - Math.abs(b - PRIMARY_K) || a - b);
/** The slices the branch step later logged "AI, reviewed": the ones looked at before Confirm all. */
const aiSeen = aiOrder.filter((k) => journal(0).find((s) => s.id === branchAnswer)!.writes!.some((w) => w.k === k && w.prov === 'ai-reviewed'));

/** The step's expected k-range: the body slab between the head | body and body | tail limits (k 6–14). */
export const BODY_K: readonly [number, number] = (() => {
  const ks = NATIVE_SLICES_J.map((j, i) => ({ k: i + 1, y: yOfJ(j) })).filter((x) => x.y >= PROTOCOL.slab.fromY && x.y <= PROTOCOL.slab.toY).map((x) => x.k);
  return [Math.min(...ks), Math.max(...ks)];
})();

/**
 * Over-reach: proposal voxels on this slice that border a label not yet
 * complete (Subiculum in progress), sit near where the pack's prior puts a
 * label still empty (ERC, 0 vx), or that the prior gives to one; and whole
 * slices of the answer outside the body slab (k 5).
 */
const INCOMPLETE = new Set([SUB, ERC]);
const reach = overreach(gate.added, labelIndex(SCENE.tracing.base), labelIndex(DESIGN.labels.cor(DESIGN.primaryJ)), CA1, INCOMPLETE, {
  k: PRIMARY_K,
  expected: BODY_K,
});
const outside = slicesOutside(aiSlices, BODY_K);

export const AI = {
  provider: 'nnInteractive',
  version: 'v2.5.0',
  server: '127.0.0.1:1527',
  licence: 'CC BY-NC-SA 4.0',
  channel: 'T2w',
  latencyS: 0.84,
  cropVx: [96, 96, 9] as const,
  target: CA1,
  raw: rawMask,
  added: gate.added,
  already: gate.already,
  protected: gate.protected,
  protectedBy: [...protectedBy.entries()].sort((a, b) => b[1] - a[1]),
  prompts: AI_PROMPTS,
  /** Interaction undo: prompts placed in this AI session (separate from document undo). */
  interactionSteps: AI_PROMPTS.length,
  slices: aiSlices,
  /** Slices of the result in review order, the ones looked at, and where Enter goes next. */
  order: aiOrder,
  seen: aiSeen,
  current: PRIMARY_K,
  next: nextUnseen(aiOrder, aiSeen, PRIMARY_K),
  /** Proposal voxels in territory of a label not yet complete (a separate review mark). */
  overreach: reach,
  /** Answer slices outside the body slab, with the voxels proposed on each (a "check" on the ruler). */
  outside: outside.map((k) => ({ k, vx: Math.max(0, finalCa1[k - 1] - tracedCa1[k - 1]) })),
  /** The step the answer becomes if confirmed whole: the kept branch's first step (32′). */
  asOf: AI_AS_OF,
  /** Per-slice values for the CA1 row while the result is pending: traced + proposed. */
  matrix: {
    values: finalCa1.map((v, i) => (aiSlices.includes(i + 1) ? Math.max(v, tracedCa1[i]) : tracedCa1[i])),
    hollow: aiSlices.filter((k) => !aiSeen.includes(k)),
  },
  /** Voxels the whole 3D result adds (this slice from the gate, the others from the mock area). */
  addedTotal:
    gate.added.length +
    aiSlices.filter((k) => k !== PRIMARY_K).reduce((s, k) => s + Math.max(0, finalCa1[k - 1] - tracedCa1[k - 1]), 0),
};

// ------------------------------------------------------------------ lesion

/** The range brush on FLAIR: intensities 168–255 (8-bit display units of the mock), ⌀ 4 mm. */
export const RANGE = { lo: 168, hi: 255, radiusMm: 2.6 } as const;

const axLabels = LESION.labels.ax;
const current = axLabels.filter((v) => v[2] === LESION.current);
const curBox = bboxOf(current.map(([c, r]) => [c, r] as Voxel));
/** The brush hovers at the lesion's lateral edge, over voxels not traced yet. */
const brushAt: Point = (() => {
  const edge = current.filter(([c]) => c === curBox.x0 || c === curBox.x0 + 1);
  const mid = edge[Math.floor(edge.length / 2)] ?? current[0];
  return [mid[0] + 1.0, mid[1] + 0.5];
})();
/** The current lesion is traced except near the brush. */
const tracedCurrent = current.filter(([c, r]) => Math.hypot(c + 0.5 - brushAt[0], r + 0.5 - brushAt[1]) > RANGE.radiusMm + 1.6);
const tracedSet = new Set(tracedCurrent.map(([c, r]) => `${c},${r}`));
const range = rangeFootprint(brushAt, RANGE.radiusMm, (v) => flairAt(v[0], v[1]), [RANGE.lo, RANGE.hi]);

export const LESION_SCENE = {
  brush: brushAt,
  /** Every lesion voxel on the slice as label WMH, with the current lesion partly traced. */
  byLesion: LESION.rows.map((r) => ({
    id: r.id,
    voxels: (r.id === LESION.current ? tracedCurrent : axLabels.filter((v) => v[2] === r.id)).map(([c, r2]) => [c, r2, WMH] as const),
  })),
  /** What the brush writes now: in range and more than half inside, not already WMH. */
  taken: range.taken.filter((v) => !tracedSet.has(key(v))),
  outOfRange: range.outOfRange,
  partial: range.partial,
  current,
};

// ----------------------------------------------------------------- history

/** The last stroke (step 38): the voxels the stroke wrote near where it ended. */
export const LAST_STROKE: readonly Voxel[] = SCENE.tracing.wet.filter(
  ([c, r]) => Math.hypot(c + 0.5 - SCENE.tracing.brush[0], r + 0.5 - SCENE.tracing.brush[1]) <= 3.2,
);

export type HistoryTool = JournalTool;
export type HistoryStep = JournalStep;

/** The journal since the last save, newest first (the session model; step 38 is the last stroke). */
export const HISTORY: readonly HistoryStep[] = journal(LAST_STROKE.length);

/** The branch: where it left the active line, when it was undone, and what a restore would bring back unreviewed. */
export const BRANCH = { ...SESSION_BRANCH, unreviewed: branchUnreviewed() };

export const JOURNAL = {
  writtenAgoS: 4,
  step: JOURNAL_STEP,
  path: 'app data/recovery/hemi-L-subfields.journal',
  sizeMb: 1.2,
  budgetMb: 64,
  minDepth: 50,
  lastSave: LAST_SAVE,
  sinceSave: STEPS_SINCE_SAVE,
};

/** Voxel sets per step (mock) for per-label undo: #37 (CA1) erased voxels #30 (CA2/3) had written. */
const stepVoxels = (id: number, label: number, vs: string[]) => ({ id, label, voxels: new Set(vs) });
const vs = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const HISTORY_VOXELS = [
  stepVoxels(29, SRLM, vs('s', 3)),
  stepVoxels(30, CA23, [...vs('c', 15), 'x0', 'x1', 'x2']),
  stepVoxels(32, CA1, vs('a', 61)),
  stepVoxels(36, CA1, vs('b', 58)),
  stepVoxels(37, CA1, ['x0', 'x1', 'x2', ...vs('e', 3)]),
  stepVoxels(38, CA1, vs('w', LAST_STROKE.length)),
];

/** Per-label undo, one row per label with history: the step it would undo and what it keeps. */
export const PER_LABEL_UNDO = [CA1, CA23, SRLM].map((label) => {
  const u = undoForLabel(HISTORY_VOXELS, label)!;
  const step = HISTORY.find((h) => h.id === u.stepId)!;
  return { label, step, revert: u.revert.length, kept: u.kept.length };
});

// -------------------------------------------------------------------- save

const tableLabels: TableLabel[] = LABEL_DEFS.map((d) => ({
  id: d.id,
  name: d.name,
  abbreviation: d.name.replace('/', ''),
  color: d.color,
  parent: 'Hippocampus',
}));

const UNREVIEWED = unreviewedSlices(CA1);

/**
 * The save bundle. BIDS derivatives: ses and a rater desc so two raters
 * cannot collide; no space entity (the grid is the T2w's own, named by a
 * SpatialReference in the sidecar); the provenance volume has its own
 * suffix so `*_dseg.nii.gz` globs never pick it up.
 */
export const SAVE = {
  folder: 'derivatives/brainflow/sub-01/ses-01/anat',
  base: 'sub-01_ses-01_hemi-L_desc-subfieldsRaterA',
  header: labelVolumeHeader(Math.max(...LABEL_DEFS.map((d) => d.id))),
  tables: {
    dseg: dsegTsv(tableLabels),
    itk: itksnapTxt(tableLabels),
    fs: freesurferLut(tableLabels),
  },
  provenanceCodes: provenanceTable(),
  unreviewed: UNREVIEWED,
  check: saveCheck({ unreviewed: UNREVIEWED.length, incomplete: ['CA1'] }),
  timeOnTask: { total: '1 h 52 min', navigation: '38 min', drawing: '51 min', correction: '23 min' },
  stepsUnsaved: STEPS_SINCE_SAVE,
  labelVoxels: LABEL_VOXELS,
  voxelMm3: NATIVE.voxelMm3,
};

/** Lesion protocol's connectivity on the 1.0 mm isotropic FLAIR grid (a pack setting, recorded in provenance). */
export const LESION_CONNECTIVITY = defaultConnectivity([1, 1, 1]);

// -------------------------------------------------------------------- setup

/**
 * Colour candidates for a new label: a fixed, ordered set of hues at two
 * lightnesses; the picker greys out every candidate that fails
 * `workflowRules.colourCandidates` against the six labels, the crosshair
 * and the warning colour.
 */
export const PALETTE: readonly string[] = [
  'rgb(232 108 92)',
  'rgb(244 160 80)',
  'rgb(214 190 70)',
  'rgb(160 200 80)',
  'rgb(90 210 140)',
  'rgb(80 200 190)',
  'rgb(92 178 222)',
  'rgb(110 140 250)',
  'rgb(176 160 252)',
  'rgb(222 134 206)',
  'rgb(240 120 160)',
  'rgb(190 150 120)',
  'rgb(176 70 60)',
  'rgb(180 120 30)',
  'rgb(130 140 40)',
  'rgb(60 140 90)',
  'rgb(40 130 150)',
  'rgb(60 100 190)',
  'rgb(120 80 200)',
  'rgb(170 70 150)',
  'rgb(200 200 200)',
  'rgb(130 130 130)',
];

export const CROSSHAIR_COLOUR = 'rgb(95 224 160)';
export const WARNING_COLOUR = 'rgb(242 138 90)';

export const CANDIDATES = colourCandidates(
  PALETTE,
  LABEL_DEFS.map((d) => ({ name: d.name, color: d.color })),
  [
    { name: 'crosshair', color: CROSSHAIR_COLOUR },
    { name: 'warning colour', color: WARNING_COLOUR },
  ],
);

export const NEW_LABEL_DEF = EXTRA_LABEL_DEFS.find((d) => d.id === NEW_LABEL)!;

/** Who confirms the registration check (recorded in provenance with the time, the transform's hash and the view used). */
export const REGISTRATION_CONFIRMER = 'Rater A';

export { LABEL_BY_ID, SUB };
