#!/usr/bin/env node
/**
 * Phase 4 fixture truth for the fidelity critic (never hand-edit the output):
 *   node ui2/scripts/build-p4-fixture-truth.mjs
 * writes ui2/src/devHarness/fixtures/app/p4_fixtures.json.
 *
 * Recomputes, independently of the app code, the synthetic FIR study the
 * harness serves (ui2/src/devHarness/app/firStudy.ts states the same model):
 *   v(x; s, c, L) = A_c · g_s · h_c(L) · exp(−|x − centre|² / (2σ²)) + 0.1 · sin(7(s+1) + 3c + L)
 * evaluated at voxel centres of the MNI 2 mm grid (float32 per voxel, means
 * in double), reduced per member over each specimen's locus:
 *   - sphere: voxel centres within 6 mm of the crosshair (−39.5, −19.5, 50.5);
 *   - region: atlas3 label 1 (L_sensorimotor);
 *   - cluster: cluster 1 of the z map at |z| > 3.1, 26-connected;
 *   - voxel: the nearest voxel (the raw 4D layer, subject s01, faces).
 * Per locus × condition × lag: the 6 subject values, mean, SD (n − 1),
 * mean ± 1.96·SD/√n (sem95) and mean ± t(0.975, 5)·SD/√n (ci95), and the
 * paired faces − houses differences (plain, and after a 0–0 TR baseline).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, '../src/devHarness/fixtures/app');
const mni = JSON.parse(fs.readFileSync(path.join(fixtures, 'mni_2mm.json'), 'utf8'));
const [nx, ny, nz] = mni.dims;
const A = mni.affine;

// --- the model (kept in step with firStudy.ts by the series tests) ---------
const SUBJECTS = ['s01', 's02', 's03', 's04', 's05', 's06'];
const CONDITIONS = ['faces', 'houses'];
const LAGS = [0, 1, 2, 3, 4, 5, 6, 7];
const CENTRE = [-40, -20, 50];
const SIGMA = 6;
const AMPLITUDE = { faces: 3, houses: 2 };
const RESPONSE = {
  faces: [0, 0.5, 1, 0.7, 0.35, 0.15, 0.05, 0],
  houses: [0, 0.2, 0.45, 0.8, 1, 0.6, 0.25, 0.05],
};
const GAIN = [0.8, 0.9, 1, 1.1, 1.2, 1];
const value = (w, s, c, L) => {
  const d2 = (w[0] - CENTRE[0]) ** 2 + (w[1] - CENTRE[1]) ** 2 + (w[2] - CENTRE[2]) ** 2;
  return (
    AMPLITUDE[c] * GAIN[s] * RESPONSE[c][L] * Math.exp(-d2 / (2 * SIGMA ** 2)) +
    0.1 * Math.sin(7 * (s + 1) + 3 * CONDITIONS.indexOf(c) + L)
  );
};
const world = (i, j, k) => [0, 1, 2].map((r) => A[r][0] * i + A[r][1] * j + A[r][2] * k + A[r][3]);

// --- loci --------------------------------------------------------------------
const CROSSHAIR = [-39.5, -19.5, 50.5];
const sphere = [];
for (let k = 0; k < nz; k++)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const w = world(i, j, k);
      if (Math.hypot(w[0] - CROSSHAIR[0], w[1] - CROSSHAIR[1], w[2] - CROSSHAIR[2]) <= 6)
        sphere.push(w);
    }
const read = (file) => zlib.gunzipSync(fs.readFileSync(path.join(fixtures, file)));
const atlas = read('atlas3_2mm.u8.gz');
const region = [];
for (let n = 0; n < atlas.length; n++)
  if (atlas[n] === 1)
    region.push(world(n % nx, Math.floor(n / nx) % ny, Math.floor(n / (nx * ny))));
const zbytes = read('zmap_2mm.f32.gz');
const z = new Float32Array(
  zbytes.buffer.slice(zbytes.byteOffset, zbytes.byteOffset + zbytes.byteLength),
);
// Cluster 1 = the component holding the largest |z| (the positive blob's peak), 26-connected, |z| > 3.1.
const t = Math.fround(3.1);
let peak = 0;
for (let n = 1; n < z.length; n++) if (Math.abs(z[n]) > Math.abs(z[peak])) peak = n;
const inCluster = new Uint8Array(z.length);
const stack = [peak];
inCluster[peak] = 1;
const sign = Math.sign(z[peak]);
while (stack.length) {
  const n = stack.pop();
  const i = n % nx,
    j = Math.floor(n / nx) % ny,
    k = Math.floor(n / (nx * ny));
  for (let dk = -1; dk <= 1; dk++)
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const a = i + di,
          b = j + dj,
          c = k + dk;
        if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
        const m = a + nx * (b + ny * c);
        if (!inCluster[m] && z[m] * sign > t) {
          inCluster[m] = 1;
          stack.push(m);
        }
      }
}
const cluster = [];
for (let n = 0; n < z.length; n++)
  if (inCluster[n]) cluster.push(world(n % nx, Math.floor(n / nx) % ny, Math.floor(n / (nx * ny))));
const nearest = [
  world(...[0, 1, 2].map((r) => Math.floor((CROSSHAIR[r] - A[r][3]) / A[r][r] + 0.5))),
];

// --- statistics -------------------------------------------------------------
function lnGamma(x) {
  const c = [
    0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531,
    -176.6150291621406, 12.507343278686905, -0.13857109526572012, 9.984369578019572e-6,
    1.5056327351493116e-7,
  ];
  const y = x - 1;
  let a = c[0];
  const tt = y + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (y + i);
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(tt) - tt + Math.log(a);
}
function betaCf(a, b, x) {
  let c = 1,
    d = 1 - ((a + b) * x) / (a + 1);
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a - 1 + m2) * (a + m2));
    d = 1 / (1 + aa * d);
    c = 1 + aa / c;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2));
    d = 1 / (1 + aa * d);
    c = 1 + aa / c;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}
const ibeta = (a, b, x) => {
  const front = Math.exp(
    lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (front * betaCf(a, b, x)) / a
    : 1 - (front * betaCf(b, a, 1 - x)) / b;
};
const tTail = (tv, df) => 0.5 * ibeta(df / 2, 0.5, df / (df + tv * tv));
function tq975(df) {
  let lo = 0,
    hi = 100;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tTail(mid, df) > 0.025) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
const T5 = tq975(5);
const summarise = (values) => {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  const se = sd / Math.sqrt(n);
  return {
    n,
    mean,
    sd,
    sem95: [mean - 1.96 * se, mean + 1.96 * se],
    ci95: [mean - T5 * se, mean + T5 * se],
  };
};
const memberValue = (voxels, s, c, L) =>
  voxels.reduce((sum, w) => sum + Math.fround(value(w, s, c, L)), 0) / voxels.length;

function series(voxels) {
  const perSubject = (c, L) => SUBJECTS.map((_, s) => memberValue(voxels, s, c, L));
  const byCondition = Object.fromEntries(
    CONDITIONS.map((c) => [
      c,
      LAGS.map((L) => ({ lag: L, values: perSubject(c, L), ...summarise(perSubject(c, L)) })),
    ]),
  );
  const diff = (baseline) =>
    LAGS.map((L) => {
      const values = SUBJECTS.map((_, s) => {
        const at = (c, lag) =>
          memberValue(voxels, s, c, lag) - (baseline ? memberValue(voxels, s, c, 0) : 0);
        return at('faces', L) - at('houses', L);
      });
      return { lag: L, values, ...summarise(values) };
    });
  return { byCondition, facesMinusHouses: diff(false), facesMinusHousesBaseline0: diff(true) };
}

// --- multipeak z map clusters, sub-peaks and RFT extent p (cluster-subpeaks-rft) ---
// The map: zmap + two Gaussian blobs inside the brain (MNI u8 > 0), added
// where ≥ 0.05, float32 (ui2/src/devHarness/app/fixtures.ts MULTIPEAK_BLOBS).
const MULTIPEAK_BLOBS = [
  { c: [-40, -2, 50], amp: 4.5, sd: 5 },
  { c: [-30, -28, 42], amp: 4, sd: 4 },
];
const brain = fs.readFileSync(path.join(fixtures, 'mni_2mm.u8'));
const mp = new Float32Array(z);
for (let k = 0; k < nz; k++)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const n = i + nx * (j + ny * k);
      if (!(brain[n] > 0)) continue;
      const w = world(i, j, k);
      let add = 0;
      for (const b of MULTIPEAK_BLOBS) {
        const d2 = (w[0] - b.c[0]) ** 2 + (w[1] - b.c[1]) ** 2 + (w[2] - b.c[2]) ** 2;
        add += b.amp * Math.exp(-d2 / (2 * b.sd * b.sd));
      }
      if (add >= 0.05) mp[n] = Math.fround(mp[n] + add);
    }
const ijkOf = (n) => [n % nx, Math.floor(n / nx) % ny, Math.floor(n / (nx * ny))];
const neighbours = [];
for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (di || dj || dk) neighbours.push([di, dj, dk]);
const label = new Int32Array(mp.length);
const comps = [];
for (let seed = 0; seed < mp.length; seed++) {
  const v = mp[seed];
  const pol = v > t ? 1 : v < -t ? -1 : 0;
  if (!pol || label[seed]) continue;
  const id = comps.length + 1;
  const members = [];
  const st = [seed];
  label[seed] = id;
  while (st.length) {
    const n = st.pop();
    members.push(n);
    const [i, j, k] = ijkOf(n);
    for (const [di, dj, dk] of neighbours) {
      const a = i + di, b = j + dj, c = k + dk;
      if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
      const m = a + nx * (b + ny * c);
      if (!label[m] && mp[m] * pol > t) {
        label[m] = id;
        st.push(m);
      }
    }
  }
  let peak = members[0];
  for (const m of members) if (Math.abs(mp[m]) > Math.abs(mp[peak]) || (Math.abs(mp[m]) === Math.abs(mp[peak]) && m < peak)) peak = m;
  comps.push({ id, pol, members, peak, first: seed });
}
comps.sort((a, b) => Math.abs(mp[b.peak]) - Math.abs(mp[a.peak]) || b.members.length - a.members.length || a.first - b.first);
const subPeaks = (comp) => {
  const maxima = comp.members.filter((n) => {
    const s0 = mp[n] * comp.pol;
    const [i, j, k] = ijkOf(n);
    return neighbours.every(([di, dj, dk]) => {
      const a = i + di, b = j + dj, c = k + dk;
      if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) return true;
      const m = a + nx * (b + ny * c);
      if (label[m] !== comp.id) return true;
      const sm = mp[m] * comp.pol;
      return sm < s0 || (sm === s0 && n < m);
    });
  });
  maxima.sort((a, b) => mp[b] * comp.pol - mp[a] * comp.pol || a - b);
  const accepted = [];
  for (const n of maxima) {
    if (accepted.length >= 3) break;
    const w = world(...ijkOf(n));
    if (accepted.every((o) => Math.hypot(w[0] - o.w[0], w[1] - o.w[1], w[2] - o.w[2]) >= 8)) accepted.push({ n, w });
  }
  return accepted.slice(1).map(({ n, w }) => ({ value: mp[n], ijk: ijkOf(n), mm: w }));
};
// RFT (SPM spm_P_RF, D = 3, z field): resels of the map's finite non-zero voxels.
const FWHM = 8;
/** Both signs of a z map are two tails: p(FWE) = 1 − (1 − p_tail)², i.e. twice E[m]. */
const TAILS = 2;
const r = 2 / FWHM; // voxel size in FWHM units, each axis
const inMask = (i, j, k) => i < nx && j < ny && k < nz && Number.isFinite(mp[i + nx * (j + ny * k)]) && mp[i + nx * (j + ny * k)] !== 0;
let P = 0, E = 0, F = 0, C = 0, search = 0;
for (let k = 0; k < nz; k++)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      if (!inMask(i, j, k)) continue;
      search++;
      P++;
      const x = inMask(i + 1, j, k), y = inMask(i, j + 1, k), zz = inMask(i, j, k + 1);
      const xy = x && y && inMask(i + 1, j + 1, k), xz = x && zz && inMask(i + 1, j, k + 1), yz = y && zz && inMask(i, j + 1, k + 1);
      E += +x + +y + +zz;
      F += +xy + +xz + +yz;
      C += +(xy && xz && yz && inMask(i + 1, j + 1, k + 1));
    }
// Isotropic: R1..R3 from the summed edge / face / cube counts.
const R = [P - E + F - C, (E - 2 * F + 3 * C) * r, (F - 3 * C) * r * r, C * r ** 3];
const erfcNum = (xv) => {
  // erfc by continued fraction for x > 0 (Lentz), adequate to 1e-14 at x ≈ 2.2.
  let f = xv, C0 = xv, D = 0;
  for (let n = 1; n < 400; n++) {
    const an = n / 2;
    D = 1 / (xv + an * D);
    C0 = xv + an / C0;
    const del = C0 * D;
    f *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(-xv * xv) / Math.sqrt(Math.PI) / f;
};
const u = 3.1;
const a4 = 4 * Math.LN2, tp = 2 * Math.PI, bu = Math.exp((-u * u) / 2);
const ec = [0.5 * erfcNum(u / Math.SQRT2), (Math.sqrt(a4) / tp) * bu, (a4 / tp ** 1.5) * bu * u, (a4 ** 1.5 / tp ** 2) * bu * (u * u - 1)];
const Em = R.reduce((sum, Rd, d) => sum + Rd * ec[d], 0);
const Ek = ec[0] / ec[3];
const beta = (Math.exp(lnGamma(2.5)) / Ek) ** (2 / 3);
const reselsPerVoxel = r ** 3;
const atlasAt = (n) => atlas[n] || null;
const clusters = comps.map((comp, rank) => {
  const k = comp.members.length * reselsPerVoxel;
  const pUnc = Math.exp(-beta * k ** (2 / 3));
  return {
    id: rank + 1,
    sign: comp.pol > 0 ? 'positive' : 'negative',
    voxels: comp.members.length,
    peakValue: mp[comp.peak],
    peakIjk: ijkOf(comp.peak),
    peakMm: world(...ijkOf(comp.peak)),
    peakAtlasLabel: atlasAt(comp.peak),
    subPeaks: subPeaks(comp),
    pUncorrectedExtent: pUnc,
    // Per tail, then family-wise over the TAILS searched (both signs: 2).
    pFweExtentPerTail: 1 - Math.exp(-(Em + Number.EPSILON) * pUnc),
    pFweExtent: 1 - Math.exp(-(Em + Number.EPSILON) * pUnc * TAILS),
  };
});

// --- masked search (round 3 T2 / S7): the same map searched inside a brain
// mask = the MNI brain (mni_2mm.u8 > 0, i.e. MNI152_T1_2mm_brain_mask). The
// backend searches mask ∩ finite map voxels (zeros included); clusters can
// only form inside the mask (all multipeak clusters are inside the brain).
function latticeStats(inside) {
  let P2 = 0, E2 = 0, F2 = 0, C2 = 0;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (!inside(i, j, k)) continue;
        P2++;
        const x = inside(i + 1, j, k), y = inside(i, j + 1, k), zz = inside(i, j, k + 1);
        const xy = x && y && inside(i + 1, j + 1, k), xz = x && zz && inside(i + 1, j, k + 1), yz = y && zz && inside(i, j + 1, k + 1);
        E2 += +x + +y + +zz;
        F2 += +xy + +xz + +yz;
        C2 += +(xy && xz && yz && inside(i + 1, j + 1, k + 1));
      }
  return { voxels: P2, resels: [P2 - E2 + F2 - C2, (E2 - 2 * F2 + 3 * C2) * r, (F2 - 3 * C2) * r * r, C2 * r ** 3] };
}
const inBrainMask = (i, j, k) =>
  i < nx && j < ny && k < nz && brain[i + nx * (j + ny * k)] > 0 && Number.isFinite(mp[i + nx * (j + ny * k)]);
const masked = latticeStats(inBrainMask);
let maskOutsideMap = 0;
for (let n = 0; n < mp.length; n++) if (brain[n] > 0 && !(Number.isFinite(mp[n]) && mp[n] !== 0)) maskOutsideMap++;
const EmMasked = masked.resels.reduce((sum, Rd, d) => sum + Rd * ec[d], 0);
const rftBrainMask = {
  mask: 'mni_2mm.u8 > 0 (the MNI brain; MNI152_T1_2mm_brain_mask)',
  searchVoxels: masked.voxels,
  maskVoxelsOutsideMap: maskOutsideMap,
  resels: masked.resels,
  expectedClusters: EmMasked,
  clusters: comps
    .filter((comp) => comp.members.every((n) => brain[n] > 0))
    .map((comp, rank) => {
      const pUnc = Math.exp(-beta * (comp.members.length * reselsPerVoxel) ** (2 / 3));
      return { id: rank + 1, voxels: comp.members.length, pUncorrectedExtent: pUnc, pFweExtent: 1 - Math.exp(-(EmMasked + Number.EPSILON) * pUnc * TAILS) };
    }),
};

// --- multirun (E5b): one subject's three BOLD runs, mirroring
// ui2/src/devHarness/app/multirun.ts and the native d2_multirun truth.
const MR_DIMS = [41, 49, 40];
const MR_ORIGIN = [-80, -112, -72];
const MR_VOXEL = 4;
const MR_TR = 2;
const MR_IJK = [10, 23, 30];
const MR_RUNS = [
  { run: 1, frames: 20, baseline: 100, amplitude: 10, centre: 5 },
  { run: 2, frames: 24, baseline: 102, amplitude: 20, centre: 12 },
  { run: 3, frames: 18, baseline: 98, amplitude: 15, centre: 9 },
];
const mrCourse = (R, t) => R.baseline + R.amplitude * Math.exp(-(((t - R.centre) / 2) ** 2));
// Round 3 C1: an anatomy-like, time-constant texture so the EPI view has structure
// (baseline ± 18 inside the brain; the block keeps its known course).
const mrTexture = (i, j, k) => 18 * Math.sin(0.45 * i) * Math.cos(0.35 * j) * Math.cos(0.3 * k);
const [mx, my, mz] = MR_DIMS;
let brainVox = 0;
let blockVox = 0;
const textureVoxels = []; // [i, j, k] of brain voxels outside the block
for (let k = 0; k < mz; k++)
  for (let j = 0; j < my; j++)
    for (let i = 0; i < mx; i++) {
      const inBrain = ((i - mx / 2) / (mx / 2.2)) ** 2 + ((j - my / 2) / (my / 2.2)) ** 2 + ((k - mz / 2) / (mz / 2.2)) ** 2 <= 1;
      if (!inBrain) continue;
      brainVox++;
      if (Math.abs(i - MR_IJK[0]) <= 1 && Math.abs(j - MR_IJK[1]) <= 1 && Math.abs(k - MR_IJK[2]) <= 1) blockVox++;
      else textureVoxels.push([i, j, k]);
    }
// All-frame non-zero values of one run (float32, as the fixture stores them):
// (brain − block) voxels at the baseline, the block at the course.
const percentileOf = (pairs, q) => {
  // pairs: [value, count], sorted by value; nearest-rank percentile.
  const total = pairs.reduce((n, [, c]) => n + c, 0);
  const rank = Math.ceil((q / 100) * total);
  let seen = 0;
  for (const [v, c] of pairs) {
    seen += c;
    if (seen >= rank) return v;
  }
  return pairs[pairs.length - 1][0];
};
let concatFrame = 0;
const multirunRuns = MR_RUNS.map((R) => {
  const course = Array.from({ length: R.frames }, (_, t) => Math.fround(mrCourse(R, t)));
  const counts = new Map();
  const add = (v, c) => counts.set(v, (counts.get(v) ?? 0) + c);
  for (const [i, j, k] of textureVoxels) add(Math.fround(R.baseline + mrTexture(i, j, k)), R.frames);
  for (const v of course) add(v, blockVox);
  const pairs = [...counts].sort((a, b) => a[0] - b[0]);
  // The EPI window counts the background zeros too.
  const withZeros = [[0, (mx * my * mz - brainVox) * R.frames], ...pairs].sort((a, b) => a[0] - b[0]);
  const peakFrame = course.indexOf(Math.max(...course));
  const out = {
    label: `run-${R.run}`,
    file: `/harness/multirun/sub-01_task-faces_run-${R.run}_bold.nii`,
    frames: R.frames,
    trS: MR_TR,
    baseline: R.baseline,
    courseFormula: `${R.baseline} + ${R.amplitude} * exp(-((t - ${R.centre}) / 2)^2), t = 0-based frame in the run`,
    course,
    peak: { frameWithin: peakFrame, tWithinS: peakFrame * MR_TR, value: course[peakFrame], concatFrame: concatFrame + peakFrame, concatTS: (concatFrame + peakFrame) * MR_TR },
    concatFirstFrame: concatFrame,
    concatFirstTS: concatFrame * MR_TR,
    allFrameNonZero: { p2: percentileOf(pairs, 2), p90: percentileOf(pairs, 90), p98: percentileOf(pairs, 98), p999: percentileOf(pairs, 99.9), max: pairs[pairs.length - 1][0] },
    allFrameWithZeros: { p2: percentileOf(withZeros, 2), p98: percentileOf(withZeros, 98) },
  };
  concatFrame += R.frames;
  return out;
});
const multirun = {
  source: 'ui2/src/devHarness/app/multirun.ts (mirrors .hillclimb/native-check/p4/truth.json d2_multirun)',
  grid: { dims: MR_DIMS, voxelMm: MR_VOXEL, originMm: MR_ORIGIN },
  trS: MR_TR,
  voxelIjk: MR_IJK,
  voxelMm: MR_IJK.map((v, a) => MR_ORIGIN[a] + MR_VOXEL * v),
  block: '3x3x3 voxels around voxelIjk carry each run course; the rest of the brain ellipsoid is baseline + texture (time-constant); zero outside',
  texture: '18 * sin(0.45 i) * cos(0.35 j) * cos(0.3 k)',
  brainVoxels: brainVox,
  blockVoxels: blockVox,
  runs: multirunRuns,
  percentiles: 'nearest-rank over every non-zero voxel of every frame of the run',
};

const truth = {
  generatedBy: 'ui2/scripts/build-p4-fixture-truth.mjs',
  model: {
    subjects: SUBJECTS,
    conditions: CONDITIONS,
    lagsTR: LAGS,
    centreMm: CENTRE,
    sigmaMm: SIGMA,
    amplitude: AMPLITUDE,
    response: RESPONSE,
    gain: GAIN,
    offset: '0.1·sin(7(s+1) + 3c + L), s and c zero-based',
  },
  tQuantile975df5: T5,
  loci: {
    sphere6mm: { crosshairMm: CROSSHAIR, voxels: sphere.length, series: series(sphere) },
    regionLSensorimotor: {
      atlas: 'atlas3_2mm label 1',
      voxels: region.length,
      series: series(region),
    },
    cluster1Zmap: {
      rule: '|z| > 3.1, 26-connected, the component of the largest |z|',
      voxels: cluster.length,
      series: series(cluster),
    },
  },
  clustersMultipeak: {
    map: 'zmap_2mm + MULTIPEAK_BLOBS inside the brain (add ≥ 0.05, float32)',
    rule: '|z| > 3.1, both signs, 26-connected, ≤ 3 peaks per cluster ≥ 8 mm apart',
    rft: {
      method: 'SPM spm_P_RF, z field, D = 3; p(FWE) over both tails (sign both): 1 − (1 − p_tail)^2',
      tails: TAILS,
      fwhmMm: FWHM,
      searchVoxels: search,
      resels: R,
      ecDensities: ec,
      expectedClusters: Em,
      expectedReselsPerCluster: Ek,
      expectedVoxelsPerCluster: Ek / reselsPerVoxel,
      beta,
    },
    clusters,
    rftBrainMask,
  },
  raw4dVoxel: {
    member: 's01 faces',
    voxelMm: nearest[0],
    values: LAGS.map((L) => Math.fround(value(nearest[0], 0, 'faces', L))),
  },
  multirun,
};

const out = path.join(fixtures, 'p4_fixtures.json');
fs.writeFileSync(out, JSON.stringify(truth, null, 2) + '\n');
console.log(
  `wrote ${out}: sphere ${sphere.length} vox, region ${region.length} vox, cluster ${cluster.length} vox, t(0.975, 5) = ${T5}`,
);
