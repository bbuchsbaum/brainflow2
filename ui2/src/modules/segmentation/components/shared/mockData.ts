/**
 * Mock session data for the segmentation design directions. Editing is
 * simulated: nothing here talks to the bridge. Voxel counts come from the
 * generated label volume (`__design__/assets/slices.json`) on the 1 mm grid,
 * so a voxel is 1 mm³.
 */

import { DESIGN } from '@/modules/segmentation/__design__/designData';
import type { LabelDef, LabelState, ToolDef } from './types';

/**
 * Label colours are data (swatches, fills, outlines), never chrome. None is a
 * saturated green, so no label can be confused with the crosshair.
 */
export const LABEL_DEFS: readonly LabelDef[] = [
  { id: 1, name: 'CA1', long: 'Cornu ammonis 1', color: 'rgb(232 108 92)' },
  { id: 2, name: 'CA2/3', long: 'Cornu ammonis 2 and 3', color: 'rgb(92 178 222)' },
  { id: 3, name: 'DG', long: 'Dentate gyrus', color: 'rgb(232 200 84)' },
  { id: 4, name: 'Subiculum', long: 'Subiculum', color: 'rgb(150 128 236)' },
  { id: 5, name: 'ERC', long: 'Entorhinal cortex', color: 'rgb(222 134 206)' },
  { id: 6, name: 'SRLM', long: 'Stratum radiatum, lacunosum and moleculare', color: 'rgb(200 146 98)' },
];

export const LABEL_BY_ID = new Map(LABEL_DEFS.map((l) => [l.id, l]));

export const CA1 = 1;
export const CA23 = 2;
export const DG = 3;
export const SUB = 4;
export const ERC = 5;
export const SRLM = 6;

export function labelColor(id: number): string {
  return LABEL_BY_ID.get(id)?.color ?? 'rgb(255 255 255)';
}

/**
 * Label volumes, one source of truth (vx on the reference grid). `final` is
 * rater A's submitted version (every label complete), the one review
 * compares against rater B; `now` is the mid-session state the tracing
 * screens show. Labels already complete mid-session have `now === final`,
 * so the label list and the review table never disagree about them.
 */
export const LABEL_VOLUMES: Readonly<Record<number, { now: number; final: number; complete: boolean }>> = Object.fromEntries(
  [CA1, CA23, DG, SUB, ERC, SRLM].map((id) => {
    const final = DESIGN.review.labels[String(id)]?.volA ?? 0;
    const complete = id === CA23 || id === DG || id === SRLM;
    const now = complete ? final : id === ERC ? 0 : (DESIGN.counts[String(id)] ?? 0);
    return [id, { now, final, complete }];
  }),
);

/** The label table mid-session: DG, SRLM and CA2/3 done and locked, CA1 active. */
export function sessionLabels(overrides: Partial<Record<number, Partial<LabelState>>> = {}): LabelState[] {
  const base: Record<number, Partial<LabelState>> = {
    [CA1]: { status: 'in-progress', locked: false },
    [CA23]: { status: 'complete', locked: true, lockReason: 'Marked complete' },
    [DG]: { status: 'complete', locked: true, lockReason: 'Marked complete' },
    [SUB]: { status: 'in-progress', locked: false },
    [ERC]: { status: 'not-started', locked: false },
    [SRLM]: { status: 'complete', locked: true, lockReason: 'Marked complete' },
  };
  return LABEL_DEFS.map((def) => {
    const voxels = LABEL_VOLUMES[def.id]?.now ?? 0;
    return {
      ...def,
      voxels,
      mm3: voxels,
      visible: true,
      locked: false,
      status: 'not-started',
      ...base[def.id],
      ...overrides[def.id],
    } as LabelState;
  });
}

export const TOOLS: readonly ToolDef[] = [
  { id: 'navigate', name: 'Navigate', key: 'V', phase: 1 },
  { id: 'brush', name: 'Brush', key: 'B', phase: 1 },
  { id: 'eraser', name: 'Eraser', key: 'E', phase: 1 },
  { id: 'contour', name: 'Contour', key: 'P', phase: 1 },
  { id: 'fill', name: 'Fill', key: 'F', phase: 1 },
  { id: 'interpolate', name: 'Fill between slices', key: 'I', phase: 1 },
  { id: 'grow', name: 'Grow from seeds', key: 'G', phase: 3 },
];

export const SESSION = {
  file: 'sub-mock_hemi-L_desc-subfields_dseg.nii.gz',
  shortFile: 'hemi-L subfields',
  referenceGrid: 'T2w',
  gridDims: DESIGN.grid.dims as number[],
  spacingMm: 1.0,
  rater: 'Rater A',
  /** Undo history: steps and bytes (sparse, capped by bytes). */
  historySteps: 38,
  historyBytes: '1.2 MB',
  unsaved: true,
};

/** Loaded contrasts, resliced to the reference grid for display. */
export const CONTRASTS = [
  { key: 't2', name: 'T2w', detail: 'tpl-MNI152NLin2009cAsym · 1.0 mm', role: 'Reference grid' },
  { key: 't1', name: 'T1w', detail: 'tpl-MNI152NLin2009cAsym · 1.0 mm', role: 'Linked contrast' },
  { key: 't2u', name: 'T2w · unsharp', detail: 'View only · σ 1.5 mm · amount 1.2', role: 'View-only lens' },
] as const;

/** The brush as the constraint strip shows it. */
export const BRUSH = { radiusMm: 1.5, shape: '2D' as '2D' | '3D', paintOver: 'unlocked' as const };

/** Keyframes of the CA1 fill-between proposal (y in mm). */
export const KEYFRAMES = [
  { y: -26, j: 106, kind: 'keyframe' as const, voxels: 41 },
  { y: -18, j: 114, kind: 'keyframe' as const, voxels: 38 },
];
export const PROPOSAL = {
  label: CA1,
  method: 'Morphological contour interpolation',
  gapSlices: 7,
  addVoxels: 268,
  changedVoxels: 0,
  protectedSkipped: 12,
  proposalUndo: 2,
};

/** Review: two raters on the same image. */
export const REVIEW = {
  raterA: 'Rater A (you)',
  raterB: 'Rater B',
  disagreements: 14,
  current: 3,
  dice: [
    { label: CA1, dice: 0.81 },
    { label: CA23, dice: 0.77 },
    { label: DG, dice: 0.84 },
    { label: SUB, dice: 0.62 },
    { label: SRLM, dice: 0.58 },
  ],
};

/** An example protocol pack (direction C). Mock text, not a published protocol. */
export const PROTOCOL = {
  name: 'Hippocampal subfields · body',
  version: 'example pack v0.3',
  plane: 'Coronal, perpendicular to the long axis',
  contrast: 'T2w (trace raw; filters are hints)',
  slab: { name: 'Body', fromY: -32, toY: -16 },
  steps: [
    { id: 'plane', title: 'Set the tracing plane', done: true },
    { id: 'slab', title: 'Place head, body and tail limits', done: true },
    { id: 'srlm', title: 'Trace the SRLM', done: true, label: SRLM },
    { id: 'dg', title: 'Dentate gyrus', done: true, label: DG },
    { id: 'ca23', title: 'CA2/3', done: true, label: CA23 },
    { id: 'ca1', title: 'CA1', done: false, label: CA1 },
    { id: 'sub', title: 'Subiculum', done: false, label: SUB },
    { id: 'erc', title: 'Entorhinal cortex', done: false, label: ERC },
    { id: 'review', title: 'Review against rater B', done: false },
  ],
  currentStep: 5,
  ca1Rules: [
    'Lateral border: the grey/white boundary of the lateral ventricle wall.',
    'Medial border with subiculum: a line from the medial tip of the SRLM straight down to the white matter.',
    'Superior border with CA2/3: the end of the thick, dark CA layer.',
  ],
  ca1Checks: [
    { text: 'Lateral border on the ventricle wall', done: true },
    { text: 'CA1/subiculum line drawn', done: false },
    { text: 'Every body slice from y −32 to −16', done: false },
  ],
};

// ---------------------------------------------------------------------------
// Round 1 (direction H): simulated native geometry, slice status, review
// statistics. The imagery stays the 1 mm template; the native acquisition
// geometry below is SIMULATED (stated in the mock disclosure) so headers,
// readouts and slice counts show what a 0.4 x 0.4 x 2.0 mm T2 TSE would.

/** Simulated native T2 geometry: 0.40 x 0.40 mm in-plane, 2.0 mm slices. */
export const NATIVE = {
  simulated: true,
  spacing: [0.4, 0.4, 2.0] as const,
  plane: 'native oblique ⊥ long axis',
  /** One native slice spans two template slices (j step). */
  stepJ: 2,
  /**
   * Simulated obliquity of the native slices against the world axes, as the
   * orthogonal (world-frame) views see them: in the sagittal view the slice
   * leans ⊥ the hippocampal long axis; in the axial view it yaws slightly.
   */
  tiltDeg: { sagittal: 30, axial: 12 },
  voxelMm3: 0.4 * 0.4 * 2.0,
};

/** "0.40×0.40 / 2.0 mm" */
export const NATIVE_GEOMETRY = `${NATIVE.spacing[0].toFixed(2)}×${NATIVE.spacing[1].toFixed(2)} / ${NATIVE.spacing[2].toFixed(1)} mm`;

const [J0, J1] = DESIGN.area.j;

/** Native slices over the hippocampus (template j of each, every 2nd). */
export const NATIVE_SLICES_J: readonly number[] = Array.from(
  { length: Math.floor((J1 - J0) / NATIVE.stepJ) + 1 },
  (_, i) => J0 + i * NATIVE.stepJ,
);

/** y (mm) of a template slice index. */
export const yOfJ = (j: number) => DESIGN.grid.origin[1] + j;

export type SliceStatus = 'traced' | 'interpolated' | 'ai' | 'empty' | 'reviewed' | 'keyframe';

/** Per-slice status while tracing (mock): what the slice ruler shows. */
export function tracingSliceStatus(j: number): SliceStatus {
  if (j < 100 || j > 116) return 'empty';
  if (j === 106) return 'ai';
  if (j === 112 || j === 114) return 'interpolated';
  return 'traced';
}

/** Fill-between proposal reviewed slice by slice (mock). */
export const INTERP = {
  label: 1,
  keyframesJ: [98, 118] as const,
  /** Interpolated slices, in review order (from the anterior keyframe). */
  orderJ: [116, 114, 112, 110, 108, 106, 104, 102, 100] as const,
  reviewed: 3,
  currentJ: 110,
};

export function proposalSliceStatus(j: number): SliceStatus {
  if ((INTERP.keyframesJ as readonly number[]).includes(j)) return 'keyframe';
  const i = (INTERP.orderJ as readonly number[]).indexOf(j);
  if (i < 0) return 'empty';
  return i < INTERP.reviewed ? 'reviewed' : 'interpolated';
}

/**
 * Area by native slice for one label. `now` follows `LABEL_VOLUMES` (complete
 * labels over their whole extent, labels in progress where traced so far);
 * `all` is rater A's final version.
 */
export function areaByNativeSlice(label: number, source: 'now' | 'traced' | 'all' = 'now'): number[] {
  const src = source === 'now' ? (LABEL_VOLUMES[label]?.complete ? 'all' : 'traced') : source;
  const rows = label === ERC && source === 'now' ? [] : (DESIGN.area[src][String(label)] ?? []);
  return NATIVE_SLICES_J.map((j) => rows[j - J0] ?? 0);
}

export interface ReviewRow {
  label: number;
  dice: number | null;
  volA: number;
  volB: number;
  /** Signed (B − A) / A, percent; null when A is empty. */
  deltaPct: number | null;
  hd95: number | null;
  /** HD95 split by direction (mm): in-plane, and through-plane in whole 2.0 mm slices (mock). */
  hd95InPlane: number | null;
  hd95Through: number | null;
  /** Disagreeing voxels by native slice (navigation sparkline). */
  bySlice: number[];
  /** Why the row has no Dice. */
  note?: string;
}

/** Dice below this is flagged. Stated in the table. */
export const DICE_THRESHOLD = 0.7;

export const REVIEW_ROWS: readonly ReviewRow[] = LABEL_DEFS.map((def) => {
  const r = DESIGN.review.labels[String(def.id)];
  const rows = r?.disagreeBySlice ?? [];
  return {
    label: def.id,
    dice: r?.dice ?? null,
    volA: r?.volA ?? 0,
    volB: r?.volB ?? 0,
    deltaPct: r && r.volA > 0 ? ((r.volB - r.volA) / r.volA) * 100 : null,
    hd95: r?.hd95 ?? null,
    hd95InPlane: r?.hd95 ?? null,
    hd95Through: r?.hd95 == null ? null : Math.ceil(r.hd95 / NATIVE.spacing[2] - 1e-9) * NATIVE.spacing[2],
    bySlice: NATIVE_SLICES_J.map((j) => rows[j - DESIGN.review.j[0]] ?? 0),
    note: r && r.volB === 0 ? 'not traced by B' : undefined,
  };
});

export interface DisagreementRegion {
  id: number;
  /** Native slice index (1-based, k). */
  k: number;
  label: number;
  vx: number;
  /** A protocol landmark the region touches (flagged regardless of size). */
  landmark?: string;
  flagged: boolean;
}

/** Regions of at least this many voxels are flagged for review (stated in the list). */
export const FLAG_MIN_VX = 15;

const LANDMARK: Partial<Record<number, string>> = { [SUB]: 'CA1/subiculum line', [SRLM]: 'medial end' };

/**
 * Disagreement regions on native slices (mock, derived from the review
 * statistics): one region per label that disagrees on a slice, up to the
 * slice's region count. Flagged = touches a protocol landmark or is at least
 * `FLAG_MIN_VX`; landmarks first, then size-only flags, then the rest, each
 * by size. Approve waits for the flagged.
 */
export const DISAGREEMENTS: readonly DisagreementRegion[] = (() => {
  const out: Omit<DisagreementRegion, 'id'>[] = [];
  NATIVE_SLICES_J.forEach((j, i) => {
    const n = DESIGN.review.regionsBySlice[String(j)] ?? 0;
    const cands = LABEL_DEFS.map((d) => ({ label: d.id, vx: DESIGN.review.labels[String(d.id)]?.disagreeBySlice[j - DESIGN.review.j[0]] ?? 0 }))
      .filter((c) => c.vx > 0 && (DESIGN.review.labels[String(c.label)]?.volB ?? 0) > 0)
      .sort((a, b) => b.vx - a.vx || a.label - b.label)
      .slice(0, n);
    for (const c of cands) {
      const landmark = j >= 104 && j <= 116 ? LANDMARK[c.label] : undefined;
      out.push({ k: i + 1, label: c.label, vx: c.vx, landmark, flagged: !!landmark || c.vx >= FLAG_MIN_VX });
    }
  });
  // Flagged first (landmarks before size-only), then by size.
  const rank = (r: Omit<DisagreementRegion, 'id'>) => (r.landmark ? 2 : r.flagged ? 1 : 0);
  return out
    .sort((a, b) => rank(b) - rank(a) || b.vx - a.vx || a.k - b.k)
    .map((r, i) => ({ ...r, id: i + 1 }));
})();

/**
 * Review position: the region under the cursor is the flagged one on the
 * primary slice; the gate counts flagged regions only, and every counter
 * (inspector, ruler, list) reads from here.
 */
export const REVIEW_NAV = (() => {
  const flaggedIds = DISAGREEMENTS.filter((r) => r.flagged).map((r) => r.id);
  const primaryK = NATIVE_SLICES_J.indexOf(DESIGN.primaryJ) + 1;
  const here = DISAGREEMENTS.find((r) => r.flagged && r.k === primaryK) ?? DISAGREEMENTS[0];
  const visitedIds = [...new Set([flaggedIds[0], flaggedIds[1], here.id])];
  return {
    total: DISAGREEMENTS.length,
    flagged: flaggedIds.length,
    visited: visitedIds.length,
    visitedIds,
    current: here.id,
    /** Position of the current region in the flagged order (1-based). */
    currentFlagged: flaggedIds.indexOf(here.id) + 1,
  };
})();
