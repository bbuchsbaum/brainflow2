/**
 * Round 6: one mock session model, the single source for every session fact
 * the direction H screens show: the journal (named steps, the kept branch,
 * the last save), how each CA1 slice got its voxels (manual, interpolated or
 * AI, reviewed or not), the slice ruler's marks, the slice matrix's hollow
 * bars, the provenance code table, the history list and the recovered-step
 * count. Like `LABEL_VOLUMES` for volumes: the screens read from here and
 * never restate a number.
 *
 * A state can show the session at an earlier moment (`asOf` a step id): the
 * AI licence gate is shown just after step 31, before AI was ever used, so
 * nothing on it can carry an AI mark.
 *
 * Whole-slice writes (a keyframe contour, an accepted interpolation or AI
 * slice) take their voxel count from the area table (`areaByNativeSlice`),
 * the same numbers the slice matrix draws.
 */

import { CA1, CA23, DG, LABEL_DEFS, LABEL_VOLUMES, NATIVE_SLICES_J, SRLM, areaByNativeSlice } from './mockData';

/** How a voxel got its label (the per-voxel provenance volume's codes). */
export type Provenance = 'manual' | 'interp-reviewed' | 'interp-unreviewed' | 'ai-reviewed' | 'ai-unreviewed';

export const PROVENANCE_CODES: ReadonlyArray<{ code: number; id: Provenance; name: string }> = [
  { code: 1, id: 'manual', name: 'manual' },
  { code: 2, id: 'interp-reviewed', name: 'interpolated, reviewed' },
  { code: 3, id: 'interp-unreviewed', name: 'interpolated, not reviewed' },
  { code: 4, id: 'ai-reviewed', name: 'AI, reviewed' },
  { code: 5, id: 'ai-unreviewed', name: 'AI, not reviewed' },
];

export type JournalTool = 'brush' | 'eraser' | 'contour' | 'interpolate' | 'ai' | 'lock' | 'fill';

export interface JournalStep {
  id: number;
  /** Display number of a kept-branch step ("32′"). */
  alias?: string;
  time: string;
  tool: JournalTool;
  op: string;
  label: number;
  /** Signed voxel change (whole-slice writes: the slice areas). */
  delta: number;
  /** Native slices touched. */
  ks: readonly number[];
  secs?: number;
  /** On the kept branch (undone, then replaced; restorable). */
  branch?: true;
  /** Whole-slice writes: the provenance of each slice written. */
  writes?: ReadonlyArray<{ k: number; prov: Provenance }>;
  /** A step the rater did not look at slice by slice (Confirm all). */
  unreviewed?: number;
}

const area = (label: number, k: number) => areaByNativeSlice(label, 'all')[k - 1] ?? 0;

/** A step that writes whole slices: its delta is the slice areas. */
function slices(
  s: Omit<JournalStep, 'delta' | 'ks' | 'writes' | 'unreviewed'>,
  writes: ReadonlyArray<{ k: number; prov: Provenance }>,
): JournalStep {
  const ks = writes.map((w) => w.k).sort((a, b) => a - b);
  const unreviewed = writes.filter((w) => w.prov.endsWith('unreviewed')).length;
  return { ...s, ks, writes, delta: writes.reduce((sum, w) => sum + area(s.label, w.k), 0), ...(unreviewed ? { unreviewed } : {}) };
}

/** The last save: step 21 at 14:02 (before the session shown). */
export const LAST_SAVE = { step: 21, time: '14:02' } as const;

/** Before the last save, the one step whose provenance is not manual: DG's fill between, accepted slice by slice. */
const BEFORE_SAVE: readonly JournalStep[] = [
  slices({ id: 12, time: '13:31:05', tool: 'interpolate', op: 'Fill between, per slice', label: DG, secs: 19 }, [
    { k: 15, prov: 'interp-reviewed' },
    { k: 16, prov: 'interp-reviewed' },
    { k: 17, prov: 'interp-reviewed' },
  ]),
];

/**
 * The journal since the last save, oldest first. Step 32′ (AI, all nine
 * slices confirmed with six unseen) and 33′ were undone at 14:25:31 and
 * replaced by 32–38: a kept branch. The active line then used AI slice by
 * slice (k 10, k 8 accepted after a look) and confirmed the last slice
 * (k 9) unseen; fill between was confirmed on k 12–13 unseen.
 */
const SINCE_SAVE: readonly JournalStep[] = [
  { id: 22, time: '14:04:12', tool: 'brush', op: 'Brush', label: CA23, delta: 24, ks: [12], secs: 9 },
  { id: 23, time: '14:06:40', tool: 'brush', op: 'Brush', label: CA23, delta: 17, ks: [10], secs: 8 },
  { id: 24, time: '14:09:05', tool: 'eraser', op: 'Eraser', label: CA23, delta: -5, ks: [10], secs: 3 },
  { id: 25, time: '14:12:31', tool: 'brush', op: 'Brush', label: CA23, delta: 31, ks: [14], secs: 12 },
  { id: 26, time: '14:15:02', tool: 'contour', op: 'Contour', label: CA23, delta: 29, ks: [13], secs: 22 },
  { id: 27, time: '14:18:20', tool: 'brush', op: 'Brush', label: CA23, delta: 16, ks: [9], secs: 6 },
  slices({ id: 28, time: '14:19:02', tool: 'contour', op: 'Contour, keyframe', label: CA1, secs: 30 }, [{ k: 6, prov: 'manual' }]),
  { id: 29, time: '14:20:44', tool: 'eraser', op: 'Eraser', label: SRLM, delta: -3, ks: [10], secs: 4 },
  { id: 30, time: '14:22:10', tool: 'brush', op: 'Brush', label: CA23, delta: 18, ks: [11], secs: 7 },
  { id: 31, time: '14:24:31', tool: 'lock', op: 'Mark complete, lock', label: CA23, delta: 0, ks: [] },
  {
    // The answer added empty voxels only (212 vx over nine slices), so its delta is not the slice areas.
    ...slices({ id: 301, alias: '32′', time: '14:24:50', tool: 'ai', op: 'AI, confirm all', label: CA1, secs: 41, branch: true }, [
      ...[5, 6, 7, 8, 9, 13].map((k) => ({ k, prov: 'ai-unreviewed' as const })),
      ...[10, 11, 12].map((k) => ({ k, prov: 'ai-reviewed' as const })),
    ]),
    delta: 212,
  },
  { id: 302, alias: '33′', time: '14:25:12', tool: 'eraser', op: 'Eraser', label: CA1, delta: -40, ks: [9], secs: 9, branch: true },
  slices({ id: 32, time: '14:25:58', tool: 'ai', op: 'AI, accept slice', label: CA1, secs: 5 }, [{ k: 10, prov: 'ai-reviewed' }]),
  slices({ id: 33, time: '14:26:20', tool: 'ai', op: 'AI, accept slice', label: CA1, secs: 4 }, [{ k: 8, prov: 'ai-reviewed' }]),
  slices({ id: 34, time: '14:26:41', tool: 'ai', op: 'AI, confirm all', label: CA1, secs: 3 }, [{ k: 9, prov: 'ai-unreviewed' }]),
  slices({ id: 35, time: '14:28:40', tool: 'contour', op: 'Contour, keyframe', label: CA1, secs: 34 }, [{ k: 14, prov: 'manual' }]),
  slices({ id: 36, time: '14:30:02', tool: 'interpolate', op: 'Fill between, confirm all', label: CA1, secs: 21 }, [
    { k: 12, prov: 'interp-unreviewed' },
    { k: 13, prov: 'interp-unreviewed' },
  ]),
  { id: 37, time: '14:31:20', tool: 'eraser', op: 'Eraser', label: CA1, delta: -6, ks: [11], secs: 3 },
  // Step 38's delta is the last stroke's voxel count (set by `withLastStroke`).
  { id: 38, time: '14:31:48', tool: 'brush', op: 'Brush', label: CA1, delta: 0, ks: [11], secs: 6 },
];

/** The kept branch: where it left the active line and when it was undone. */
export const BRANCH = { from: 31, steps: [301, 302] as const, undoneAt: '14:25:31' };

const ACTIVE = [...BEFORE_SAVE, ...SINCE_SAVE].filter((s) => !s.branch);

/** The newest step on the active line (the journal's head). */
export const JOURNAL_STEP = SINCE_SAVE[SINCE_SAVE.length - 1].id;

/** Steps on the active line since the last save: what history calls unsaved and resume recovers. */
export const STEPS_SINCE_SAVE = JOURNAL_STEP - LAST_SAVE.step;

/** The session journal, newest first, with step 38's delta from the last stroke. */
export function journal(lastStrokeVx: number): JournalStep[] {
  return [...SINCE_SAVE].reverse().map((s) => (s.id === JOURNAL_STEP ? { ...s, delta: lastStrokeVx } : s));
}

/** The step order along the active line (branch steps sort by their branch point). */
const order = (s: JournalStep) => (s.branch ? BRANCH.from + 0.5 : s.id);

/** Was the step done at or before `asOf` on the active line? */
const doneBy = (s: JournalStep, asOf: number) => !s.branch && order(s) <= asOf;

/**
 * Provenance of each slice of a label written whole by a step, as of a step
 * (default: now). Slices never written whole were traced by hand before the
 * last save (manual).
 */
export function sliceProvenance(label: number, asOf = JOURNAL_STEP): Map<number, Provenance> {
  const out = new Map<number, Provenance>();
  for (const s of ACTIVE) if (s.label === label && doneBy(s, asOf)) for (const w of s.writes ?? []) out.set(w.k, w.prov);
  return out;
}

/** The step that first wrote a slice whole (null: traced before the session shown). */
function firstWrite(label: number, k: number): number | null {
  const s = ACTIVE.find((x) => x.label === label && x.writes?.some((w) => w.k === k));
  return s ? s.id : null;
}

export type SliceStatus = 'traced' | 'interpolated' | 'ai' | 'empty';

/**
 * The slice ruler's status for the active label (CA1) on a native slice j,
 * as of a step: empty where nothing was traced yet, "interpolated" or "ai"
 * where a slice was confirmed without a look, traced otherwise. Solid on
 * the ruler is traced; hollow (needs review) is interpolated or AI.
 */
export function sessionSliceStatus(j: number, asOf = JOURNAL_STEP, label = CA1): SliceStatus {
  const k = NATIVE_SLICES_J.indexOf(j) + 1;
  if (k < 1 || (areaByNativeSlice(label)[k - 1] ?? 0) === 0) return 'empty';
  const first = firstWrite(label, k);
  if (first !== null && first > asOf) return 'empty';
  const p = sliceProvenance(label, asOf).get(k);
  return p === 'interp-unreviewed' ? 'interpolated' : p === 'ai-unreviewed' ? 'ai' : 'traced';
}

/** Slices of a label still to review (hollow on the ruler and in the matrix), as of now. */
export function unreviewedSlices(label = CA1, asOf = JOURNAL_STEP): Array<{ k: number; prov: Provenance }> {
  return [...sliceProvenance(label, asOf)]
    .filter(([, p]) => p.endsWith('unreviewed'))
    .map(([k, prov]) => ({ k, prov }))
    .sort((a, b) => a.k - b.k);
}

/** Was AI used on the active line by this step? */
export function aiUsed(asOf = JOURNAL_STEP): boolean {
  return ACTIVE.some((s) => s.tool === 'ai' && doneBy(s, asOf));
}

/** The first AI step ever (the branch counts: AI was used, then undone). */
export const FIRST_AI_STEP = Math.min(...SINCE_SAVE.filter((s) => s.tool === 'ai').map(order));

/** The moment the AI licence gate is shown: just after step 31, before AI was first used. */
export const BEFORE_AI = Math.floor(FIRST_AI_STEP);

/** Every labelled voxel now (the label volume). */
export const LABEL_VOXELS = LABEL_DEFS.reduce((s, d) => s + (LABEL_VOLUMES[d.id]?.now ?? 0), 0);

/**
 * The provenance volume's code table now: voxel counts per code, summing to
 * the labelled voxels. Slices written whole carry their step's code (the
 * slice area); every other labelled voxel is manual.
 */
export function provenanceTable(asOf = JOURNAL_STEP): Array<{ code: number; id: Provenance; name: string; vx: number }> {
  const counts = new Map<Provenance, number>();
  for (const d of LABEL_DEFS) for (const [k, p] of sliceProvenance(d.id, asOf)) if (p !== 'manual') counts.set(p, (counts.get(p) ?? 0) + area(d.id, k));
  const nonManual = [...counts.values()].reduce((s, v) => s + v, 0);
  counts.set('manual', LABEL_VOXELS - nonManual);
  return PROVENANCE_CODES.map((c) => ({ ...c, vx: counts.get(c.id) ?? 0 }));
}

/** Branch steps that confirmed slices unseen: a restore would bring them back (warned). */
export function branchUnreviewed(): number {
  return SINCE_SAVE.filter((s) => s.branch).reduce((n, s) => n + (s.unreviewed ?? 0), 0);
}

/** The recovered journal (resume): the steps since the last save, and where it stopped. */
export const RECOVERY = {
  crashedAt: '14:31:52',
  steps: STEPS_SINCE_SAVE,
  lastSave: LAST_SAVE,
  head: JOURNAL_STEP,
  lastEdit: SINCE_SAVE[SINCE_SAVE.length - 1].time,
};

/**
 * The quiet save (⌘S) after the recovered work was kept: written to the
 * remembered path without a sheet; the header shows "Saved" until the next
 * edit. The contrast-aids state is that moment.
 */
export const QUIET_SAVE = { time: '14:33:04', step: JOURNAL_STEP, files: 4 } as const;
