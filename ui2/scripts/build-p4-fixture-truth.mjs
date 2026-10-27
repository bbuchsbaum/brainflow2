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
  raw4dVoxel: {
    member: 's01 faces',
    voxelMm: nearest[0],
    values: LAGS.map((L) => Math.fround(value(nearest[0], 0, 'faces', L))),
  },
};

const out = path.join(fixtures, 'p4_fixtures.json');
fs.writeFileSync(out, JSON.stringify(truth, null, 2) + '\n');
console.log(
  `wrote ${out}: sphere ${sphere.length} vox, region ${region.length} vox, cluster ${cluster.length} vox, t(0.975, 5) = ${T5}`,
);
