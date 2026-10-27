/**
 * Harness mirror of the backend's cluster-extent inference
 * (core/neuro-inference: rft.rs, resels.rs, distributions.rs, and
 * api_bridge clusters.rs `apply_extent_inference`), z and t fields only:
 * SPM's spm_P_RF for a 3D field (Friston et al. 1994; Worsley et al. 1996).
 * The fixtures are z and t maps; an F request fails like a header without df.
 */
import type { ClusterExtentInference, ClusterTable, ExtentStatistic, FwhmMm } from '@brainflow/api';
import type { VolumeFixture } from './fixtures';
import { lnGamma, normalSf, tSf } from '@/utils/distributions';

export type Field = { kind: 'z' } | { kind: 't'; df: number };

/** Euler characteristic densities EC_0..EC_3 at u (spm_ECdensity). */
export function ecDensities(field: Field, u: number): [number, number, number, number] {
  const a = 4 * Math.LN2;
  const twoPi = 2 * Math.PI;
  if (field.kind === 'z') {
    const b = Math.exp((-u * u) / 2);
    return [
      normalSf(u),
      (Math.sqrt(a) / twoPi) * b,
      (a / twoPi ** 1.5) * b * u,
      (a ** 1.5 / twoPi ** 2) * b * (u * u - 1),
    ];
  }
  const v = field.df;
  const b = Math.exp(lnGamma((v + 1) / 2) - lnGamma(v / 2));
  const c = (1 + (u * u) / v) ** ((1 - v) / 2);
  return [
    tSf(u, v),
    (Math.sqrt(a) / twoPi) * c,
    (((a / twoPi ** 1.5) * c * u) / Math.sqrt(v / 2)) * b,
    (a ** 1.5 / twoPi ** 2) * c * (((v - 1) * u * u) / v - 1),
  ];
}

/** Resel counts [R0..R3] of a lattice mask (spm_resels_vol; resels.rs). */
export function latticeResels(
  mask: Uint8Array,
  dims: readonly number[],
  voxelFwhm: readonly number[],
): [number, number, number, number] {
  const [nx, ny, nz] = dims;
  const at = (i: number, j: number, k: number) =>
    i < nx && j < ny && k < nz && mask[i + nx * (j + ny * k)] === 1;
  let p = 0,
    ex = 0,
    ey = 0,
    ez = 0,
    fxy = 0,
    fxz = 0,
    fyz = 0,
    cubes = 0;
  for (let k = 0; k < nz; k += 1)
    for (let j = 0; j < ny; j += 1)
      for (let i = 0; i < nx; i += 1) {
        if (!at(i, j, k)) continue;
        p += 1;
        const x = at(i + 1, j, k);
        const y = at(i, j + 1, k);
        const z = at(i, j, k + 1);
        const xy = x && y && at(i + 1, j + 1, k);
        const xz = x && z && at(i + 1, j, k + 1);
        const yz = y && z && at(i, j + 1, k + 1);
        ex += +x;
        ey += +y;
        ez += +z;
        fxy += +xy;
        fxz += +xz;
        fyz += +yz;
        cubes += +(xy && xz && yz && at(i + 1, j + 1, k + 1));
      }
  const [rx, ry, rz] = voxelFwhm;
  const c = cubes;
  return [
    p - (ex + ey + ez) + (fxy + fxz + fyz) - c,
    (ex - fxy - fxz + c) * rx + (ey - fxy - fyz + c) * ry + (ez - fxz - fyz + c) * rz,
    (fxy - c) * rx * ry + (fxz - c) * rx * rz + (fyz - c) * ry * rz,
    c * rx * ry * rz,
  ];
}

/** spm_P_RF(1, k, u, df, STAT, R, 1) for D = 3 (rft.rs ExtentModel). */
export function extentModel(field: Field, u: number, resels: readonly number[]) {
  const ec = ecDensities(field, u).map((d) => Math.max(d, Number.EPSILON));
  const expectedClusters = resels.reduce((sum, r, i) => sum + r * ec[i], 0);
  const expectedReselsPerCluster = ec[0] / ec[3];
  const beta = (Math.exp(lnGamma(2.5)) / expectedReselsPerCluster) ** (2 / 3);
  const pUncorrected = (k: number) => (k <= 0 ? 1 : Math.exp(-beta * k ** (2 / 3)));
  return {
    expectedClusters,
    expectedReselsPerCluster,
    pUncorrected,
    pFwe: (k: number) => 1 - Math.exp(-(expectedClusters + Number.EPSILON) * pUncorrected(k)),
  };
}

/** Like Rust's f64 Display for the assumption text ("8", "6.5"). */
const num = (v: number) => String(v);

export interface ExtentRequest {
  method?: string;
  fwhmMm: FwhmMm;
  statistic?: ExtentStatistic | null;
  df?: number | null;
  df2?: number | null;
}

/** Adds p values and the inference record to `table` (clusters formed at its threshold). */
export function applyExtentInference(
  table: ClusterTable,
  vol: VolumeFixture,
  request: ExtentRequest,
): void {
  const fail = (message: string): never => {
    throw Object.assign(new Error(message), { code: 4080 });
  };
  const fwhm: [number, number, number] =
    typeof request.fwhmMm === 'number'
      ? [request.fwhmMm, request.fwhmMm, request.fwhmMm]
      : request.fwhmMm;
  if (!fwhm.every((v) => Number.isFinite(v) && v > 0)) fail('Smoothness must be finite and > 0.');
  const header = vol.header;
  const headerKind = header?.intentCode === 5 ? 'z' : header?.intentCode === 3 ? 't' : null;
  const statistic = request.statistic ?? headerKind;
  if (!statistic)
    fail(
      'Cluster-extent p needs a z, t or F map; the header declares no statistic. Declare the statistic (and df) in the request.',
    );
  let field: Field;
  if (statistic === 'z') field = { kind: 'z' };
  else if (statistic === 't') {
    const df = request.df ?? (headerKind === 't' ? header!.intentP1 : null);
    if (!(df && df > 0)) fail('A t field needs degrees of freedom (df > 0).');
    field = { kind: 't', df: df! };
  } else {
    fail('harness: F fields are not mirrored');
  }
  const u = table.threshold;
  if (!(u > 0)) fail('The cluster-forming threshold must be finite and > 0.');
  const a = vol.affine;
  const voxelSize = [0, 1, 2].map((col) => Math.hypot(a[0][col], a[1][col], a[2][col]));
  const voxelFwhm = voxelSize.map((s, i) => s / fwhm[i]);
  const mask = new Uint8Array(vol.data.length);
  let searchVoxels = 0;
  vol.data.forEach((v, i) => {
    if (Number.isFinite(v) && v !== 0) {
      mask[i] = 1;
      searchVoxels += 1;
    }
  });
  const resels = latticeResels(mask, vol.dims, voxelFwhm);
  if (!(resels[3] > 0)) fail('No resel volume (needs at least one 2x2x2 block of search voxels).');
  const reselsPerVoxel = voxelFwhm[0] * voxelFwhm[1] * voxelFwhm[2];
  const model = extentModel(field!, u, resels);
  // Mirrors neuro-inference: both signs of a z/t map are two tails, and the
  // family-wise p is 1 - (1 - p)^tails (expected clusters stay per tail).
  const tails: 1 | 2 = table.sign === 'both' ? 2 : 1;
  for (const c of table.clusters) {
    const k = c.voxelCount * reselsPerVoxel;
    c.pUncorrectedExtent = model.pUncorrected(k);
    c.pFweExtent = 1 - (1 - model.pFwe(k)) ** tails;
  }
  const expectedClusters = model.expectedClusters;
  const ek = model.expectedReselsPerCluster;
  const describe =
    fwhm[0] === fwhm[1] && fwhm[1] === fwhm[2]
      ? `${num(fwhm[0])} mm FWHM`
      : `${fwhm.map(num).join(' x ')} mm FWHM`;
  const assumptions = [
    `Assumes stationary smoothness of ${describe} (user-supplied).`,
    'Gaussian random field theory (SPM spm_P_RF); approximate unless the cluster-forming threshold is high (e.g. z >= 3.1) and the image is smooth relative to the voxel size.',
    tails === 2
      ? 'Both tails searched; p(FWE) is corrected over both tails (1 - (1 - p)^2, i.e. twice the expected cluster count).'
      : 'One tail searched; p(FWE) covers that tail.',
    `Search volume: ${searchVoxels} voxels, ${resels[3].toFixed(1)} resels; ${model.expectedClusters.toFixed(2)} clusters expected per tail.`,
  ];
  const minFwhmVoxels = Math.min(...fwhm.map((f, i) => f / voxelSize[i]));
  if (minFwhmVoxels < 3) {
    assumptions.push(
      `Smoothness is only ${minFwhmVoxels.toFixed(1)} voxels FWHM: p values are likely conservative and unstable (RFT assumes smooth fields).`,
    );
  }
  const inference: ClusterExtentInference = {
    method: 'rft-extent',
    fwhmMm: fwhm,
    statistic: field!.kind,
    df: field!.kind === 't' ? field!.df : null,
    df2: null,
    statisticSource: request.statistic ? 'request' : 'header',
    clusterFormingThreshold: u,
    tails,
    searchVoxels,
    resels,
    voxelsPerResel: 1 / reselsPerVoxel,
    expectedClusters,
    expectedVoxelsPerCluster: ek / reselsPerVoxel,
    assumption: assumptions.join(' '),
  };
  table.extentInference = inference;
}
