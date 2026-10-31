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
    const voxels = def.id === ERC ? 0 : (DESIGN.counts[String(def.id)] ?? 0);
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
