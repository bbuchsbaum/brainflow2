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
} from './geometry';
import { BRUSH, CA1, CA23, DG, SRLM, labelColor } from './mockData';
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

// Proposal: CA1 on this slice comes from fill-between (keyframes y −26, −18).
const proposalVoxels = voxelsOf(A, CA1);
const proposalBase = A.filter((v) => v[2] !== CA1);

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
  proposal: { base: proposalBase, voxels: proposalVoxels },
  review: {
    disagree,
    groups: disagreeGroups,
    focus: disagreeGroups.length ? centreOf(disagreeGroups[0]) : hippoCentre,
  },
  zoom: { brush: zoomBrush, base: tracingBase, footprint: discFootprint(zoomBrush, BRUSH.radiusMm).length },
};

/** Standard overlay stacks. */
export const OVERLAYS = {
  /** Labels as filled voxels with outlines; the active label's outline is heavier. */
  labels(voxels: readonly LabelVoxel[], active = CA1, fill = 0.38): Overlay[] {
    return [
      { kind: 'labels', voxels, fill, outline: false },
      { kind: 'labels', voxels, outline: true, width: 1, opacity: 0.85 },
      { kind: 'labels', voxels, outline: true, width: 2, only: [active] },
    ];
  },
  /** Outline echo: every label faint, the active label strong. */
  echo(voxels: readonly LabelVoxel[], active = CA1): Overlay[] {
    return [
      { kind: 'labels', voxels, outline: true, width: 1, opacity: 0.45 },
      { kind: 'labels', voxels, outline: true, width: 2, only: [active] },
    ];
  },
  /** Wet ink: the stroke in progress, brighter than committed labels. */
  wetInk(voxels: readonly Voxel[], label = CA1): Overlay {
    return { kind: 'voxels', voxels, color: labelColor(label), fill: 0.85 };
  },
  proposal(voxels: readonly Voxel[], label = CA1): Overlay[] {
    return [
      { kind: 'voxels', voxels, color: labelColor(label), hatch: true, opacity: 0.85 },
      { kind: 'voxels', voxels, color: labelColor(label), outline: true, dashed: true, width: 1.75 },
    ];
  },
  review(): Overlay[] {
    return [
      { kind: 'voxels', voxels: disagree, color: 'var(--bf-warning)', hatch: true, opacity: 0.9 },
      { kind: 'labels', voxels: A, outline: true, width: 1.75 },
      { kind: 'labels', voxels: B, outline: true, width: 1.5, dashed: true },
    ];
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
