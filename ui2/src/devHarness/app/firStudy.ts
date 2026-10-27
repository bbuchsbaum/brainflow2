/**
 * Synthetic FIR study with known answers (phase 4 E6): 6 subjects × 2
 * conditions × 8 lags (TR), two peak latencies (faces at lag 2, houses at
 * lag 4), one Gaussian response blob at the L_sensorimotor region of the
 * harness atlas. The same study is offered two ways:
 * - `fir-3d`: one 3D map per subject × condition × lag (design columns
 *   subject / condition / lag; a NeuroTabs lag axis on the `lag` column);
 * - `fir-4d`: one 4D map per subject × condition, lag along the 4th axis
 *   (a feature-axis lag series, start 0, step 1, count 8).
 * Values are analytic (firValue), so every sampled number is recomputable:
 *   v(x; s, c, L) = A_c · g_s · h_c(L) · exp(−|x − centre|² / (2σ²)) + e(s, c, L).
 * The harness backend evaluates them at voxel centres of the MNI 2 mm grid.
 */
import type { SpatialFieldSetSummary } from '@/types/studio';
import type { SeriesAxis } from '@brainflow/api';

export const FIR_ROOT = '/harness/study/fir';
export const FIR_SUBJECTS = ['s01', 's02', 's03', 's04', 's05', 's06'] as const;
export const FIR_CONDITIONS = ['faces', 'houses'] as const;
export const FIR_LAGS = [0, 1, 2, 3, 4, 5, 6, 7] as const;
/** Response blob centre (world mm) and width (σ, mm). */
export const FIR_CENTRE: readonly [number, number, number] = [-40, -20, 50];
export const FIR_SIGMA_MM = 6;
/** Condition amplitude A_c and response shape h_c(L) (peak 1). */
export const FIR_AMPLITUDE = { faces: 3, houses: 2 } as const;
export const FIR_RESPONSE = {
  faces: [0, 0.5, 1, 0.7, 0.35, 0.15, 0.05, 0],
  houses: [0, 0.2, 0.45, 0.8, 1, 0.6, 0.25, 0.05],
} as const;
/** Subject gain g_s. */
export const FIR_GAIN = [0.8, 0.9, 1, 1.1, 1.2, 1] as const;

type Condition = (typeof FIR_CONDITIONS)[number];

/** Subject × condition × lag offset e (spatially constant): deterministic noise. */
export function firOffset(subject: number, condition: Condition, lag: number): number {
  return 0.1 * Math.sin(7 * (subject + 1) + 3 * FIR_CONDITIONS.indexOf(condition) + lag);
}

export function firValue(
  world: readonly number[],
  subject: number,
  condition: Condition,
  lag: number,
): number {
  const d2 =
    (world[0] - FIR_CENTRE[0]) ** 2 +
    (world[1] - FIR_CENTRE[1]) ** 2 +
    (world[2] - FIR_CENTRE[2]) ** 2;
  return (
    FIR_AMPLITUDE[condition] *
      FIR_GAIN[subject] *
      FIR_RESPONSE[condition][lag] *
      Math.exp(-d2 / (2 * FIR_SIGMA_MM ** 2)) +
    firOffset(subject, condition, lag)
  );
}

export const fir3dPath = (s: string, c: string, lag: number) =>
  `${FIR_ROOT}/sub-${s}_cond-${c}_lag-${lag}_beta.nii.gz`;
export const fir4dPath = (s: string, c: string) => `${FIR_ROOT}/sub-${s}_cond-${c}_fir.nii.gz`;

/** Subject index, condition and lag of a FIR member path (lag from `stackIndex` for 4D members). */
export function parseFirPath(
  path: string,
  stackIndex: number | null | undefined,
): { subject: number; condition: Condition; lag: number } | null {
  const m = /sub-(s\d\d)_cond-(faces|houses)(?:_lag-(\d+))?_(beta|fir)\.nii\.gz$/.exec(path);
  if (!m) return null;
  const subject = FIR_SUBJECTS.indexOf(m[1] as (typeof FIR_SUBJECTS)[number]);
  const lag = m[4] === 'beta' ? Number(m[3]) : (stackIndex ?? 0);
  if (subject < 0 || !(lag >= 0 && lag < FIR_LAGS.length)) return null;
  return { subject, condition: m[2] as Condition, lag };
}

const contract = {
  readiness: 'compare_ready',
  provenanceKind: 'demo',
  provenanceLabel: 'Synthetic FIR study (harness)',
  canImport: true,
  capabilities: ['import', 'deck', 'compare'],
  reason: 'Synthetic known-answer FIR study on the MNI 2 mm grid.',
} as const;

const audit = (count: number) => ({
  sourceLabel: 'Synthetic FIR study',
  join: {
    matchedRows: count,
    unmatchedRows: 0,
    duplicateKeys: 0,
    severity: 'ok',
    issueDetails: [],
  },
  support: {
    supportLabel: 'MNI152 2mm',
    alignmentClass: 'same-grid',
    readyForCompare: true,
    severity: 'ok',
  },
  notes: [],
});

/** The study as a Set Studio dataset: `3d` (one member per lag) or `4d` (lag along the 4th axis). */
export function firSet(variant: '3d' | '4d'): SpatialFieldSetSummary {
  const members =
    variant === '3d'
      ? FIR_SUBJECTS.flatMap((s) =>
          FIR_CONDITIONS.flatMap((c) =>
            FIR_LAGS.map((lag) => ({
              id: `${s}_${c}_l${lag}`,
              sourcePath: fir3dPath(s, c, lag),
              designValues: { subject: s, condition: c, lag: String(lag) },
            })),
          ),
        )
      : FIR_SUBJECTS.flatMap((s) =>
          FIR_CONDITIONS.map((c) => ({
            id: `${s}_${c}`,
            sourcePath: fir4dPath(s, c),
            designValues: { subject: s, condition: c },
          })),
        );
  const axis: SeriesAxis =
    variant === '3d'
      ? {
          kind: 'lag',
          source: { type: 'observation_column', column: 'lag' },
          unit: 'TR',
          start: null,
          step: null,
          count: null,
          alignment: 'observation_values',
        }
      : {
          kind: 'lag',
          source: { type: 'feature_axis', feature: 'fir', axis: 'lag', position: 3 },
          unit: 'TR',
          start: 0,
          step: 1,
          count: FIR_LAGS.length,
          alignment: 'declared_common_axis',
        };
  const designColumns =
    variant === '3d' ? ['subject', 'condition', 'lag'] : ['subject', 'condition'];
  return {
    id: `fir-${variant}`,
    name: variant === '3d' ? 'FIR study (3D lag maps)' : 'FIR study (4D lag series)',
    sourceKind: 'demo',
    importContract: { ...contract, capabilities: [...contract.capabilities] },
    memberCount: members.length,
    primaryFeatureId: 'fir',
    supportKind: 'volume',
    supportLabel: 'MNI152 2mm',
    alignmentClass: 'same-grid',
    designColumns,
    designTablePreview: null,
    memberSummaries: members,
    memberIds: members.map((m) => m.id),
    savedCohortIds: [],
    ingestAudit: audit(members.length),
    seriesAxes: [axis],
  } as SpatialFieldSetSummary;
}

/** Voxel centres of a grid (row-major 4×4 affine) within `radiusMm` of `world`; the nearest one at radius 0. */
export function locusVoxels(
  grid: { dims: readonly number[]; affine: number[][] },
  world: readonly number[],
  radiusMm: number,
): number[][] {
  const a = grid.affine;
  const toWorld = (i: number, j: number, k: number) =>
    [0, 1, 2].map((r) => a[r][0] * i + a[r][1] * j + a[r][2] * k + a[r][3]);
  // Axis-aligned grids only (the harness MNI grid): invert per axis.
  const ijk = [0, 1, 2].map((r) => (world[r] - a[r][3]) / a[r][r]);
  if (radiusMm <= 0) {
    const v = ijk.map((x) => Math.floor(x + 0.5));
    if (v.some((x, r) => x < 0 || x >= grid.dims[r])) return [];
    return [toWorld(v[0], v[1], v[2])];
  }
  const out: number[][] = [];
  const reach = [0, 1, 2].map((r) => Math.ceil(radiusMm / Math.abs(a[r][r])) + 1);
  for (let k = Math.floor(ijk[2]) - reach[2]; k <= Math.ceil(ijk[2]) + reach[2]; k += 1)
    for (let j = Math.floor(ijk[1]) - reach[1]; j <= Math.ceil(ijk[1]) + reach[1]; j += 1)
      for (let i = Math.floor(ijk[0]) - reach[0]; i <= Math.ceil(ijk[0]) + reach[0]; i += 1) {
        if (i < 0 || j < 0 || k < 0 || i >= grid.dims[0] || j >= grid.dims[1] || k >= grid.dims[2]) continue;
        const w = toWorld(i, j, k);
        if (Math.hypot(w[0] - world[0], w[1] - world[1], w[2] - world[2]) <= radiusMm) out.push(w);
      }
  return out;
}

/** A FIR member's value at a locus: the mean (or median) over the locus voxels. */
export function sampleFirMember(
  grid: { dims: readonly number[]; affine: number[][] },
  path: string,
  stackIndex: number | null | undefined,
  world: readonly number[],
  radiusMm: number,
  reduce: 'mean' | 'median' = 'mean',
): { value: number | null; count: number } | null {
  return sampleFirVoxels(path, stackIndex, locusVoxels(grid, world, radiusMm), reduce);
}

/** A FIR member reduced over given voxel centres (a region locus). */
export function sampleFirVoxels(
  path: string,
  stackIndex: number | null | undefined,
  voxels: readonly (readonly number[])[],
  reduce: 'mean' | 'median' = 'mean',
): { value: number | null; count: number } | null {
  const id = parseFirPath(path, stackIndex);
  if (!id) return null;
  const values = voxels.map((w) => Math.fround(firValue(w, id.subject, id.condition, id.lag)));
  if (!values.length) return { value: null, count: 0 };
  if (reduce === 'median') {
    const s = [...values].sort((x, y) => x - y);
    const m = s.length >> 1;
    return { value: s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2, count: s.length };
  }
  return { value: values.reduce((sum, v) => sum + v, 0) / values.length, count: values.length };
}

/** A stable 64-hex "source revision" per member path (FNV-1a, repeated). */
export function firRevision(path: string): string {
  let h = 0x811c9dc5;
  for (const ch of path) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0').repeat(8);
}
