/**
 * Harness mirror of the backend's cluster-extent inference
 * (core/neuro-inference: rft.rs, resels.rs, distributions.rs, and
 * api_bridge clusters.rs `apply_extent_inference`), z and t fields only:
 * SPM's spm_P_RF for a 3D field (Friston et al. 1994; Worsley et al. 1996).
 * The fixtures are z and t maps; an F request fails like a header without df.
 */
import type { ClusterExtentInference, ClusterTable, ExtentStatistic, FwhmMm } from '@brainflow/api';
import type { VolumeFixture } from './fixtures';

/** ln Γ(x), Lanczos (g = 7, n = 9): ~1e-15 relative for x > 0. */
export function lnGamma(x: number): number {
  const c = [
    0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531,
    -176.6150291621406, 12.507343278686905, -0.13857109526572012, 0.000009984369578019572,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
  const z = x - 1;
  let a = c[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i += 1) a += c[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** erfc(x), W. J. Cody's rational approximations (~1e-15 relative). */
export function erfc(x: number): number {
  const ax = Math.abs(x);
  let r: number;
  if (ax < 0.5) {
    const t = x * x;
    const p = [
      3.1611237438705655, 113.86415415105016, 377.485237685302, 3209.3775891384694,
      0.18577770618460315,
    ];
    const q = [23.601290952344122, 244.02463793444417, 1282.6165260773723, 2844.236833439171];
    const num = (((p[4] * t + p[0]) * t + p[1]) * t + p[2]) * t + p[3];
    const den = (((t + q[0]) * t + q[1]) * t + q[2]) * t + q[3];
    return 1 - (x * num) / den;
  }
  if (ax < 4) {
    const p = [
      0.5641884969886701, 8.883149794388375, 66.11919063714163, 298.6351381974001,
      881.952221241769, 1712.0476126340707, 2051.0783778260716, 1230.339354797997,
      2.1531153547440383e-8,
    ];
    const q = [
      15.744926110709835, 117.6939508913125, 537.1811018620099, 1621.3895745666903,
      3290.7992357334847, 4362.619090143247, 3439.3676741437216, 1230.3393548037495,
    ];
    let num = p[8] * ax;
    let den = ax;
    for (let i = 0; i < 7; i += 1) {
      num = (num + p[i]) * ax;
      den = (den + q[i]) * ax;
    }
    r = (num + p[7]) / (den + q[7]);
  } else {
    const p = [
      0.30532663496123236, 0.36034489994980445, 0.12578172611122926, 0.016083785148742275,
      0.0006587491615298367, 0.016315387137302097,
    ];
    const q = [
      2.5685201922898684, 1.8729528499234604, 0.5279051029514221, 0.060518341312441,
      0.0023352049762686918,
    ];
    const z = 1 / (ax * ax);
    let num = p[5] * z;
    let den = z;
    for (let i = 0; i < 4; i += 1) {
      num = (num + p[i]) * z;
      den = (den + q[i]) * z;
    }
    r = (z * (num + p[4])) / (den + q[4]);
    r = (1 / Math.sqrt(Math.PI) - r) / ax;
  }
  // exp(-x²) split to keep precision (Cody).
  const xs = Math.trunc(ax * 16) / 16;
  r *= Math.exp(-xs * xs) * Math.exp(-(ax - xs) * (ax + xs));
  return x < 0 ? 2 - r : r;
}

export const normalSf = (u: number) => 0.5 * erfc(u / Math.SQRT2);

function betaContinuedFraction(a: number, b: number, x: number): number {
  const TINY = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 500; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return h;
}

export function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

export function tSf(t: number, df: number): number {
  const tail = 0.5 * incompleteBeta(df / 2, 0.5, df / (df + t * t));
  return t >= 0 ? tail : 1 - tail;
}

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
  for (const c of table.clusters) {
    const k = c.voxelCount * reselsPerVoxel;
    c.pUncorrectedExtent = model.pUncorrected(k);
    c.pFweExtent = model.pFwe(k);
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
    searchVoxels,
    resels,
    voxelsPerResel: 1 / reselsPerVoxel,
    expectedClusters,
    expectedVoxelsPerCluster: ek / reselsPerVoxel,
    assumption: assumptions.join(' '),
  };
  table.extentInference = inference;
}
