/**
 * Round 5 (direction H workflow states): the rules behind AI proposals, the
 * lesion range brush and its partial-volume rule, lesion components, view-only
 * filters, per-label undo, label colour candidates and the label-volume
 * writer. Pure functions, shared by the mocks and their tests; the real
 * module should keep the same rules (one rasterizer, one gate).
 */

import { deltaE76, mutedColor, MUTED_MIN_DELTA_E, parseRgb } from './colour';
import type { Point, SliceImage, Voxel } from './types';

const key = (c: number, r: number) => `${c},${r}`;

// ------------------------------------------------------------- AI proposals

export interface ProposalGate {
  /** Voxels the proposal adds to the target label. */
  added: Voxel[];
  /** Voxels the model returned that already hold the target (no-ops). */
  already: number;
  /** Voxels the model wanted but another label holds: never taken. */
  protected: Array<{ voxel: Voxel; label: number; locked: boolean }>;
}

/**
 * An AI result becomes a proposal through the same gate as every tool, but
 * stricter: it never takes a voxel another label holds (locked or not), so a
 * proposal cannot overwrite locked labels or other objects (the ITK-SNAP
 * #217 failure). Only empty voxels are added; the rest are reported.
 */
export function gateProposal(
  raw: readonly Voxel[],
  labelsAt: ReadonlyMap<string, number>,
  target: number,
  locked: ReadonlySet<number>,
): ProposalGate {
  const added: Voxel[] = [];
  const prot: ProposalGate['protected'] = [];
  let already = 0;
  const seen = new Set<string>();
  for (const v of raw) {
    const k = key(v[0], v[1]);
    if (seen.has(k)) continue;
    seen.add(k);
    const cur = labelsAt.get(k) ?? 0;
    if (cur === target) already++;
    else if (cur !== 0) prot.push({ voxel: v, label: cur, locked: locked.has(cur) });
    else added.push(v);
  }
  return { added, already, protected: prot };
}

export type PromptKind = 'point+' | 'point-' | 'scribble' | 'box' | 'lasso';

export interface Prompt {
  id: number;
  kind: PromptKind;
  /** Display coordinates: one point, a polyline (scribble, lasso) or two corners (box). */
  points: readonly Point[];
  /** Native slice the prompt was placed on. */
  k: number;
}

/** Positive prompts include, negative exclude; a scribble or lasso is positive unless drawn with Alt. */
export function promptSign(p: Prompt): '+' | '−' {
  return p.kind === 'point-' ? '−' : '+';
}

// -------------------------------------------------------- range brush (WMH)

/** Fraction of a voxel's square inside a disc (n × n subsamples). */
export function voxelCoverage(center: Point, radiusMm: number, v: Voxel, n = 8): number {
  let inside = 0;
  const r2 = radiusMm * radiusMm;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const dx = v[0] + (i + 0.5) / n - center[0];
      const dy = v[1] + (j + 0.5) / n - center[1];
      if (dx * dx + dy * dy <= r2) inside++;
    }
  return inside / (n * n);
}

/** Lesion protocols count a voxel when more than half of it is inside (the WMH challenge rule). */
export const PARTIAL_VOLUME_RULE = 0.5;

export interface RangeFootprint {
  /** Voxels the brush writes: in range and more than half inside the disc. */
  taken: Voxel[];
  /** Inside by more than half but outside the intensity range. */
  outOfRange: Voxel[];
  /** In range, touched by the disc, but half or less inside: left out by the partial-volume rule. */
  partial: Voxel[];
}

/**
 * The range brush on FLAIR: a voxel is written when its intensity is within
 * [lo, hi] AND more than half of its square lies inside the brush disc. The
 * preview draws exactly `taken`; the readout counts the rest.
 */
export function rangeFootprint(
  center: Point,
  radiusMm: number,
  intensity: (v: Voxel) => number | null,
  range: readonly [number, number],
): RangeFootprint {
  const out: RangeFootprint = { taken: [], outOfRange: [], partial: [] };
  for (let r = Math.floor(center[1] - radiusMm) - 1; r <= Math.ceil(center[1] + radiusMm); r++)
    for (let c = Math.floor(center[0] - radiusMm) - 1; c <= Math.ceil(center[0] + radiusMm); c++) {
      const v: Voxel = [c, r];
      const cov = voxelCoverage(center, radiusMm, v);
      if (cov === 0) continue;
      const val = intensity(v);
      const inRange = val !== null && val >= range[0] && val <= range[1];
      if (cov > PARTIAL_VOLUME_RULE) (inRange ? out.taken : out.outOfRange).push(v);
      else if (inRange) out.partial.push(v);
    }
  return out;
}

// ---------------------------------------------------------- lesion components

export type Voxel3 = readonly [number, number, number];

/** 3D connected components (26-connectivity), largest first: one lesion each. */
export function components26(voxels: readonly Voxel3[]): Voxel3[][] {
  const k3 = (v: Voxel3) => `${v[0]},${v[1]},${v[2]}`;
  const left = new Map(voxels.map((v) => [k3(v), v]));
  const out: Voxel3[][] = [];
  for (const start of voxels) {
    if (!left.has(k3(start))) continue;
    left.delete(k3(start));
    const group: Voxel3[] = [];
    const stack: Voxel3[] = [start];
    while (stack.length) {
      const v = stack.pop()!;
      group.push(v);
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++)
          for (let c = -1; c <= 1; c++) {
            if (!a && !b && !c) continue;
            const kk = `${v[0] + a},${v[1] + b},${v[2] + c}`;
            const n = left.get(kk);
            if (n) {
              left.delete(kk);
              stack.push(n);
            }
          }
    }
    out.push(group);
  }
  return out.sort((x, y) => y.length - x.length);
}

export interface LesionRow {
  id: number;
  voxels: number;
  mm3: number;
  /** Axial slice span (grid k, inclusive). */
  k: readonly [number, number];
  centre: readonly [number, number, number];
}

/** One row per connected lesion (volume, slice span, centre on the grid). */
export function lesionRows(mask: readonly Voxel3[], voxelMm3 = 1): LesionRow[] {
  return rowsOfComponents(components26(mask), voxelMm3);
}

/** Rows for already-computed components (in their order). */
export function rowsOfComponents(comps: readonly (readonly Voxel3[])[], voxelMm3 = 1): LesionRow[] {
  return comps.map((g, i) => {
    const ks = g.map((v) => v[2]);
    const mean = (a: number) => g.reduce((s, v) => s + v[a], 0) / g.length;
    return {
      id: i + 1,
      voxels: g.length,
      mm3: g.length * voxelMm3,
      k: [Math.min(...ks), Math.max(...ks)] as const,
      centre: [mean(0), mean(1), mean(2)] as const,
    };
  });
}

// ------------------------------------------------------- view-only filters

/**
 * The badge a view must carry while it shows a filtered (view-only) image.
 * Derived from the image itself, so a filter can never be on without it.
 */
export function filterBadge(image: Pick<SliceImage, 'viewOnly' | 'contrast'>): string | null {
  if (!image.viewOnly) return null;
  const name = image.contrast.split('·').slice(1).join('·').trim() || 'filter';
  return `${name} · view only`;
}

// ------------------------------------------------------------- history

export interface HistoryStepVoxels {
  id: number;
  label: number;
  /** Voxels the step changed ("c,r,k"). */
  voxels: ReadonlySet<string>;
}

/**
 * Undo per label: revert the label's latest step, but only on voxels no
 * later step changed (of any label); those are kept and reported, so a
 * per-label undo never silently undoes someone else's later edit.
 */
export function undoForLabel(steps: readonly HistoryStepVoxels[], label: number): { stepId: number; revert: string[]; kept: string[] } | null {
  const i = steps.map((s) => s.label).lastIndexOf(label);
  if (i < 0) return null;
  const later = new Set(steps.slice(i + 1).flatMap((s) => [...s.voxels]));
  const revert: string[] = [];
  const kept: string[] = [];
  for (const v of steps[i].voxels) (later.has(v) ? kept : revert).push(v);
  return { stepId: steps[i].id, revert, kept };
}

// ------------------------------------------------------- label colours

export interface ColourCandidate {
  color: string;
  ok: boolean;
  /** Why a candidate is refused ("ΔE 9 from SRLM"). */
  reason?: string;
}

/** Minimum ΔE*ab of a new label colour from the crosshair and the warning colour. */
export const RESERVED_MIN_DELTA_E = 25;

/**
 * A new label's colour must stay distinguishable: its full colour and both
 * muted tints at least `MUTED_MIN_DELTA_E` from every existing label's, and
 * at least `RESERVED_MIN_DELTA_E` from the colours with fixed meanings (the
 * crosshair, the warning). The picker offers only candidates that pass.
 */
export function colourCandidates(
  palette: readonly string[],
  existing: ReadonlyArray<{ name: string; color: string }>,
  reserved: ReadonlyArray<{ name: string; color: string }>,
): ColourCandidate[] {
  const forms = (c: string) => [c, mutedColor(c, 'inactive'), mutedColor(c, 'quiet')].map(parseRgb);
  return palette.map((color) => {
    const mine = forms(color);
    for (const r of reserved) {
      const d = deltaE76(mine[0], parseRgb(r.color));
      if (d < RESERVED_MIN_DELTA_E) return { color, ok: false, reason: `reads as the ${r.name} (ΔE ${d.toFixed(0)})` };
    }
    let worst: { name: string; d: number } | null = null;
    for (const e of existing) {
      const theirs = forms(e.color);
      for (let i = 0; i < 3; i++) {
        const d = deltaE76(mine[i], theirs[i]);
        if (!worst || d < worst.d) worst = { name: e.name, d };
      }
    }
    if (worst && worst.d < MUTED_MIN_DELTA_E) return { color, ok: false, reason: `too close to ${worst.name} (ΔE ${worst.d.toFixed(0)})` };
    return { color, ok: true };
  });
}

// --------------------------------------------------------- label volume

/** NIfTI-1 intent code for a label volume (NIFTI_INTENT_LABEL). */
export const NIFTI_INTENT_LABEL = 1002;

/** The label volume's header: smallest unsigned type that holds every id, intent 1002, the reference grid's affine kept. */
export function labelVolumeHeader(maxId: number): { datatype: 'uint8' | 'uint16'; intentCode: number; keeps: string } {
  if (maxId > 65535) throw new Error('label ids above 65535 need remapping');
  return { datatype: maxId <= 255 ? 'uint8' : 'uint16', intentCode: NIFTI_INTENT_LABEL, keeps: 'sform and qform of the reference image' };
}

export interface TableLabel {
  id: number;
  name: string;
  abbreviation?: string;
  color: string;
  parent?: string;
}

const hex = (color: string) =>
  `#${parseRgb(color)
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;

/** BIDS dseg.tsv: index and name required; colour, abbreviation and a parent column as extras. */
export function dsegTsv(labels: readonly TableLabel[]): string[] {
  return ['index\tname\tabbreviation\tcolor\tparent', ...labels.map((l) => `${l.id}\t${l.name}\t${l.abbreviation ?? l.name}\t${hex(l.color)}\t${l.parent ?? 'n/a'}`)];
}

/** ITK-SNAP label description: IDX R G B A VIS MSH "LABEL". */
export function itksnapTxt(labels: readonly TableLabel[]): string[] {
  const row = (id: number, [r, g, b]: readonly number[], a: number, vis: number, name: string) =>
    `${String(id).padStart(5)} ${String(r).padStart(5)} ${String(g).padStart(5)} ${String(b).padStart(5)} ${String(a).padStart(8)} ${vis}  ${vis}    "${name}"`;
  return [row(0, [0, 0, 0], 0, 0, 'Clear Label'), ...labels.map((l) => row(l.id, parseRgb(l.color), 1, 1, l.name))];
}

/** FreeSurfer colour LUT: #No. Label Name: R G B A (A = 0, opaque in FreeSurfer's convention). */
export function freesurferLut(labels: readonly TableLabel[]): string[] {
  return [
    '#No. Label Name:                R   G   B   A',
    ...labels.map((l) => {
      const [r, g, b] = parseRgb(l.color);
      return `${String(l.id).padEnd(4)}${l.name.replace(/[^A-Za-z0-9_-]+/g, '_').padEnd(28)}${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}   0`;
    }),
  ];
}
