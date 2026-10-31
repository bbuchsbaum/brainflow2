/**
 * The seven design states as data, shared by every direction: which slices
 * are shown, where the brush is, what the stroke wrote or was refused, and
 * which overlays each panel draws. Directions only decide layout and chrome.
 */

import { DESIGN } from '@/modules/segmentation/__design__/designData';
import {
  disagreement,
  discFootprint,
  gateStroke,
  labelIndex,
  strokeFootprint,
  voxelsOf,
  worldToDisplay,
  components,
  centreOf,
  paintInto,
} from './geometry';
import { BRUSH, CA1, CA23, DG, QUIET_LABELS, REVIEW_ROWS, SRLM, labelColor } from './mockData';
import type { Overlay } from './SliceView';
import type { LabelVoxel, Point, Voxel } from './types';

/** The crosshair (world mm): left hippocampal body. */
export const CROSSHAIR_WORLD = [-26, -22, -16] as const;

export const CROSSHAIR = {
  coronal: worldToDisplay('coronal', CROSSHAIR_WORLD),
  axial: worldToDisplay('axial', CROSSHAIR_WORLD),
  sagittal: worldToDisplay('sagittal', CROSSHAIR_WORLD),
};

/** Field of view (mm across the shorter side) at "fit" and for tracing. */
export const FOV = { fit: 193, trace: 64, ortho: 96, strip: 60, zoom: 193 / 6 };

const LOCKED = new Set([CA23, DG, SRLM]);

const A = DESIGN.labels.cor(DESIGN.primaryJ);
const B = DESIGN.labels.raterB;
const hippoCentre = DESIGN.hippoCentre as Point;

/** Rater A's slice with CA1 only partly traced (upper half done). */
function withPartialCa1(labels: readonly LabelVoxel[]): LabelVoxel[] {
  return labels.filter((v) => v[2] !== CA1 || v[1] < hippoCentre[1] - 1);
}

const tracingBase = withPartialCa1(A);

// Mid-stroke: the first 60% of a stroke along CA1's lateral arc.
const strokeAll = DESIGN.strokeCa1;
const strokeSoFar = strokeAll.slice(0, Math.max(2, Math.round(strokeAll.length * 0.6)));
const brushAt = strokeSoFar[strokeSoFar.length - 1];
const strokeGate = gateStroke(
  strokeFootprint(strokeSoFar, BRUSH.radiusMm),
  labelIndex(tracingBase),
  CA1,
  LOCKED,
  'unlocked',
);

// Blocked: a short CA1 stroke inside the dentate gyrus (locked). The path
// runs through DG voxel centres whose brush disc touches only locked labels
// (or CA1 itself), so the gate writes nothing.
const tracingIndex = labelIndex(tracingBase);
const dgInterior = voxelsOf(tracingBase, DG)
  .map(([c, r]) => [c + 0.5, r + 0.5] as Point)
  .filter((p) => gateStroke(strokeFootprint([p], BRUSH.radiusMm), tracingIndex, CA1, LOCKED, 'unlocked').written.length === 0)
  .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const blockedPath: Point[] =
  dgInterior.length >= 2
    ? dgInterior.filter((p) => p[1] === dgInterior[Math.floor(dgInterior.length / 2)][1]).slice(0, 4)
    : DESIGN.strokeDg.slice(0, 3);
if (blockedPath.length < 2 && dgInterior.length >= 2) blockedPath.push(dgInterior[dgInterior.length - 1]);
const blockedFootprint = strokeFootprint(blockedPath, BRUSH.radiusMm);
const blockedGate = gateStroke(blockedFootprint, labelIndex(tracingBase), CA1, LOCKED, 'unlocked');
const blockedByLabel = new Map<number, number>();
for (const b of blockedGate.blocked) blockedByLabel.set(b.label, (blockedByLabel.get(b.label) ?? 0) + 1);

// Proposal: fill-between adds the CA1 voxels this slice does not have yet;
// the CA1 already traced here stays solid. Locked voxels next to the added
// region are where the interpolated contour reached a locked label: skipped.
const tracedCa1 = new Set(voxelsOf(tracingBase, CA1).map(([c, r]) => `${c},${r}`));
const proposalVoxels = voxelsOf(A, CA1).filter(([c, r]) => !tracedCa1.has(`${c},${r}`));
const proposalBase = tracingBase;
const proposedSet = new Set(proposalVoxels.map(([c, r]) => `${c},${r}`));
const proposalSkipped = tracingBase
  .filter(
    ([c, r, l]) =>
      LOCKED.has(l) &&
      [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => proposedSet.has(`${c + dc},${r + dr}`)),
  )
  .map(([c, r]) => [c, r] as Voxel)
  .slice(0, 6);

// Review: rater A against rater B.
const disagree = disagreement(A, B);
const disagreeGroups = components(disagree);

// Zoomed: brush hovering on CA1's lateral border, footprint shown.
const zoomBrush: Point = [strokeAll[Math.round(strokeAll.length * 0.75)][0], strokeAll[Math.round(strokeAll.length * 0.75)][1]];

export const SCENE = {
  hippoCentre,
  labelsA: A,
  labelsB: B,
  tracing: {
    base: tracingBase,
    stroke: strokeSoFar,
    brush: brushAt,
    wet: strokeGate.written as Voxel[],
  },
  blocked: {
    base: tracingBase,
    path: blockedPath,
    brush: blockedPath[blockedPath.length - 1],
    footprint: blockedFootprint,
    written: blockedGate.written.length,
    blocked: blockedGate.blocked.length,
    byLabel: [...blockedByLabel.entries()].sort((a, b) => b[1] - a[1]),
  },
  proposal: { base: proposalBase, voxels: proposalVoxels, skipped: proposalSkipped },
  review: {
    disagree,
    groups: disagreeGroups,
    focus: disagreeGroups.length ? centreOf(disagreeGroups[0]) : hippoCentre,
  },
  zoom: { brush: zoomBrush, base: tracingBase, footprint: discFootprint(zoomBrush, BRUSH.radiusMm).length },
};

/** Labels rater B did not trace at all. */
export const B_NONE: readonly number[] = REVIEW_ROWS.filter((r) => r.volB === 0).map((r) => r.label);

/** Standard overlay stacks. */
export const OVERLAYS = {
  /**
   * Labels as an exclusive partition: one colour per voxel at the constant
   * fill alpha, each label stroked on the inner edge of its own voxels; the
   * active label 1.5 px full colour, the others 1 px at 55%, complete and
   * locked labels quieter. `fill: false` is outline mode; `fillActive`
   * adds the active label's faint inset fill.
   */
  labels(
    voxels: readonly LabelVoxel[],
    active = CA1,
    opts: { fill?: boolean; emphasis?: readonly number[]; fillActive?: boolean } = {},
  ): Overlay[] {
    const act = opts.emphasis ?? [active];
    return [
      {
        kind: 'labels',
        voxels,
        fill: opts.fill ?? true,
        width: 1,
        active: act,
        quiet: QUIET_LABELS.filter((id) => !act.includes(id)),
        fillActive: opts.fillActive ? [active] : undefined,
      },
    ];
  },
  /** Outline echo (small views): inner-edge strokes, the active label strong, the rest muted. */
  echo(voxels: readonly LabelVoxel[], active = CA1): Overlay[] {
    return [{ kind: 'labels', voxels, fill: false, active: [active], quiet: QUIET_LABELS.filter((id) => id !== active) }];
  },
  /** The voxels a stroke has written so far join the partition as the label. */
  withStroke(voxels: readonly LabelVoxel[], written: readonly Voxel[], label = CA1): LabelVoxel[] {
    return paintInto(voxels, written, label);
  },
  /**
   * Proposal: added voxels only, hatched in the target colour with a thin
   * solid outline (the hatch says "proposed"; dashes belong to rater B);
   * locked voxels the contour skipped are marked.
   */
  proposal(voxels: readonly Voxel[], label = CA1, skipped: readonly Voxel[] = []): Overlay[] {
    return [
      { kind: 'voxels', voxels, color: labelColor(label), hatch: true, opacity: 0.85 },
      { kind: 'voxels', voxels, color: labelColor(label), outline: true, width: 1 },
      ...(skipped.length ? [{ kind: 'marks', voxels: skipped } as Overlay] : []),
    ];
  },
  /** Review: A solid once, B only where it departs, achromatic disagreement textures. */
  review(show: 'a' | 'b' | 'both' = 'both'): Overlay[] {
    // Labels rater B never traced are outlined only (no "A only" texture); the table says "B: none".
    return [{ kind: 'review', a: A, b: B, show, bNone: B_NONE }];
  },
};

/** Orthogonal views: traced extent echoes the active label. */
export const ORTHO = {
  axial: { image: DESIGN.images.axT2, labels: DESIGN.labels.axTraced, crosshair: CROSSHAIR.axial },
  sagittal: { image: DESIGN.images.sagT2, labels: DESIGN.labels.sagTraced, crosshair: CROSSHAIR.sagittal },
  /** Centre of the orthogonal views, on the hippocampus. */
  axialCentre: [CROSSHAIR.axial[0], CROSSHAIR.axial[1] + 6] as Point,
  sagittalCentre: [CROSSHAIR.sagittal[0] + 4, CROSSHAIR.sagittal[1] - 4] as Point,
};

/** The body slab (protocol landmark) in the sagittal and axial views: y −32 to −16 mm. */
export function slabRows(fromY: number, toY: number): { axial: [number, number]; sagittal: [number, number] } {
  const a1 = worldToDisplay('axial', [0, fromY, 0])[1];
  const a2 = worldToDisplay('axial', [0, toY, 0])[1];
  const s1 = worldToDisplay('sagittal', [0, fromY, 0])[0];
  const s2 = worldToDisplay('sagittal', [0, toY, 0])[0];
  return { axial: [a1 + 0.5, a2 - 0.5], sagittal: [s1 + 0.5, s2 - 0.5] };
}
