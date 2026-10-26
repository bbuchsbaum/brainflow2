#!/usr/bin/env node
// Builds the binary fixtures used by the dev-only app harness (app-harness.html).
// Sources are repository test data; outputs are small, deterministic and committed.
//
//   node ui2/scripts/build-app-harness-fixtures.mjs
//
// Outputs (ui2/src/devHarness/fixtures/app/):
//   mni_2mm.u8          MNI152NLin2009cAsym brain T1, 2 mm block-mean, uint8 (x fastest)
//   mni_2mm.json        dims, 4x4 voxel->world affine, original intensity range
//   lh_inflated.f32     fsLR 32k left inflated vertices (xyz float32)
//   lh_inflated.i32     triangle indices (int32)
//   lh_sensorimotor.f32 sensorimotor-association axis, one float32 per vertex
//   surface.json        counts and value range
//
// Phase 3 synthetic statistics (no source data; same 2 mm MNI grid, see buildP3()):
//   zmap_2mm.f32.gz     z-score map (NIfTI intent 5), three Gaussian blobs, float32 gzip
//   tmap_2mm.f32.gz     t map (intent 3, df = 24), same blob geometry, float32 gzip
//   atlas3_2mm.u8.gz    3-region label volume (spheres), uint8 gzip
//   atlas3_dseg.tsv     BIDS-style LUT sidecar for the label volume
//   p3_fixtures.json    header metadata per volume plus known answers (peaks,
//                       clusters, region at crosshair) for the fidelity checks
//
//   node ui2/scripts/build-app-harness-fixtures.mjs --p3-only   (skip the source-data fixtures)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const outDir = path.join(repo, 'ui2/src/devHarness/fixtures/app');
fs.mkdirSync(outDir, { recursive: true });

function buildVolume() {
  const src = path.join(repo, 'test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii');
  const buf = fs.readFileSync(src);
  const dim = [1, 2, 3].map((i) => buf.readInt16LE(40 + 2 * i));
  const datatype = buf.readInt16LE(70);
  const voxOffset = buf.readFloatLE(108);
  const srow = [0, 1, 2].map((r) => [0, 1, 2, 3].map((c) => buf.readFloatLE(280 + 16 * r + 4 * c)));
  if (datatype !== 16) throw new Error(`expected float32 NIfTI, got datatype ${datatype}`);
  const [nx, ny, nz] = dim;
  const src32 = new Float32Array(
    buf.buffer.slice(buf.byteOffset + voxOffset, buf.byteOffset + voxOffset + nx * ny * nz * 4),
  );

  const [ox, oy, oz] = dim.map((d) => Math.floor(d / 2));
  const mean = new Float32Array(ox * oy * oz);
  for (let z = 0; z < oz; z++)
    for (let y = 0; y < oy; y++)
      for (let x = 0; x < ox; x++) {
        let s = 0;
        for (let dz = 0; dz < 2; dz++)
          for (let dy = 0; dy < 2; dy++)
            for (let dx = 0; dx < 2; dx++)
              s += src32[2 * x + dx + nx * (2 * y + dy + ny * (2 * z + dz))];
        mean[x + ox * (y + oy * z)] = s / 8;
      }

  const nonzero = Array.from(mean)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const hi = nonzero[Math.floor(nonzero.length * 0.995)];
  const u8 = new Uint8Array(mean.length);
  for (let i = 0; i < mean.length; i++)
    u8[i] = Math.max(0, Math.min(255, Math.round((mean[i] / hi) * 255)));

  // Block (i,j,k) covers source voxels 2i..2i+1, so its centre sits at source index 2i+0.5.
  const affine = srow.map((row) => [
    row[0] * 2,
    row[1] * 2,
    row[2] * 2,
    row[3] + 0.5 * (row[0] + row[1] + row[2]),
  ]);
  affine.push([0, 0, 0, 1]);
  fs.writeFileSync(path.join(outDir, 'mni_2mm.u8'), u8);
  fs.writeFileSync(
    path.join(outDir, 'mni_2mm.json'),
    JSON.stringify(
      {
        source: path.basename(src),
        dims: [ox, oy, oz],
        affine,
        intensityMax: hi,
        encoding: 'uint8, x fastest',
      },
      null,
      2,
    ) + '\n',
  );
  return { dims: [ox, oy, oz], bytes: u8.length };
}

function giftiArrays(file) {
  const xml = fs.readFileSync(file, 'utf8');
  const arrays = [];
  const re = /<DataArray([^>]*)>[\s\S]*?<Data>([\s\S]*?)<\/Data>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = Object.fromEntries(
      [...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]]),
    );
    if (attrs.Encoding !== 'GZipBase64Binary')
      throw new Error(`unsupported GIfTI encoding ${attrs.Encoding}`);
    const raw = zlib.inflateSync(Buffer.from(m[2].trim(), 'base64'));
    arrays.push({ attrs, raw });
  }
  return arrays;
}

function buildSurface() {
  const dir = path.join(repo, 'test-data/surfaces/fslr32k');
  const [pts, tris] = giftiArrays(path.join(dir, 'fs_LR.32k.L.inflated.surf.gii'));
  const [overlay] = giftiArrays(path.join(dir, 'SensorimotorAssociation_Axis_LH.fslr32k.func.gii'));
  fs.writeFileSync(path.join(outDir, 'lh_inflated.f32'), pts.raw);
  fs.writeFileSync(path.join(outDir, 'lh_inflated.i32'), tris.raw);
  fs.writeFileSync(path.join(outDir, 'lh_sensorimotor.f32'), overlay.raw);
  const values = new Float32Array(
    overlay.raw.buffer,
    overlay.raw.byteOffset,
    overlay.raw.length / 4,
  );
  let lo = Infinity,
    hi = -Infinity;
  for (const v of values)
    if (Number.isFinite(v)) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  const info = {
    vertices: Number(pts.attrs.Dim0),
    faces: Number(tris.attrs.Dim0),
    overlayRange: [lo, hi],
  };
  fs.writeFileSync(path.join(outDir, 'surface.json'), JSON.stringify(info, null, 2) + '\n');
  return info;
}

/**
 * Synthetic statistics on the harness grid (dims/affine of mni_2mm.json). The
 * geometry follows the 1 mm reference z map used for Phase 3 review: positive
 * blobs at (-40,-20,50) and (42,-60,-10), a negative one at (0,40,10) mm.
 * Values are quantised to 0.001 and |v| < 0.005 is stored as 0, so the known
 * answers below are exact for the stored data.
 */
const P3_BLOBS = {
  z: [
    { c: [-40, -20, 50], amp: 6, sd: 8 },
    { c: [42, -60, -10], amp: 4.5, sd: 7 },
    { c: [0, 40, 10], amp: -5, sd: 9 },
  ],
  t: [
    { c: [-40, -20, 50], amp: 6.8, sd: 8 },
    { c: [42, -60, -10], amp: 5.1, sd: 7 },
    { c: [0, 40, 10], amp: -5.7, sd: 9 },
  ],
};
/**
 * Two corner-touching single voxels in the z map (ijk): one cluster under
 * 26-connectivity, two under 6-connectivity, so the cluster table's
 * connectivity option is checkable.
 */
const P3_Z_SPIKES = [
  { ijk: [20, 80, 60], value: 3.6 },
  { ijk: [21, 81, 61], value: 3.5 },
];
const P3_REGIONS = [
  { index: 1, name: 'L_sensorimotor', abbr: 'L SM', hemisphere: 'left', c: [-40, -20, 50], r: 14, color: '#4682b4' },
  { index: 2, name: 'R_occipitotemporal', abbr: 'R OT', hemisphere: 'right', c: [42, -60, -10], r: 14, color: '#dcb43c' },
  { index: 3, name: 'Medial_prefrontal', abbr: 'mPFC', hemisphere: 'bilateral', c: [0, 40, 10], r: 16, color: '#b45a8c' },
];
/** Crosshair (mm) used by the region-at-crosshair scenario: inside region 2. */
const P3_REGION_CROSSHAIR = [42, -60, -10];

function worldOf(affine, i, j, k) {
  return [0, 1, 2].map((r) => affine[r][0] * i + affine[r][1] * j + affine[r][2] * k + affine[r][3]);
}

function synthStat(dims, affine, blobs, spikes = []) {
  const [nx, ny, nz] = dims;
  const data = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const [x, y, z] = worldOf(affine, i, j, k);
        let v = 0;
        for (const b of blobs) {
          const d2 = (x - b.c[0]) ** 2 + (y - b.c[1]) ** 2 + (z - b.c[2]) ** 2;
          v += b.amp * Math.exp(-d2 / (2 * b.sd * b.sd));
        }
        data[i + nx * (j + ny * k)] = Math.abs(v) < 0.005 ? 0 : Math.round(v * 1000) / 1000;
      }
  for (const s of spikes) data[s.ijk[0] + nx * (s.ijk[1] + ny * s.ijk[2])] = s.value;
  return data;
}

function synthAtlas(dims, affine) {
  const [nx, ny, nz] = dims;
  const data = new Uint8Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const [x, y, z] = worldOf(affine, i, j, k);
        for (const r of P3_REGIONS) {
          if ((x - r.c[0]) ** 2 + (y - r.c[1]) ** 2 + (z - r.c[2]) ** 2 <= r.r * r.r) {
            data[i + nx * (j + ny * k)] = r.index;
            break;
          }
        }
      }
  return data;
}

const round3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Reference connected components (the fidelity check for the cluster table):
 * voxels with sign*v > threshold, 6- or 26-connectivity, per sign. Peak is the
 * max |v| voxel (lowest linear index on ties); centre of mass is unweighted.
 */
function clusters(data, dims, affine, atlas, threshold, sign, conn) {
  const [nx, ny, nz] = dims;
  const offsets = [];
  for (let dk = -1; dk <= 1; dk++)
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const n = Math.abs(di) + Math.abs(dj) + Math.abs(dk);
        if (n === 0 || (conn === 6 && n > 1)) continue;
        offsets.push([di, dj, dk]);
      }
  const seen = new Uint8Array(data.length);
  const out = [];
  for (let idx = 0; idx < data.length; idx++) {
    if (seen[idx] || !(sign * data[idx] > threshold)) continue;
    const stack = [idx];
    seen[idx] = 1;
    let size = 0;
    let peak = idx;
    const sum = [0, 0, 0];
    while (stack.length) {
      const cur = stack.pop();
      const i = cur % nx;
      const j = Math.floor(cur / nx) % ny;
      const k = Math.floor(cur / (nx * ny));
      size += 1;
      sum[0] += i;
      sum[1] += j;
      sum[2] += k;
      const better = sign * data[cur] > sign * data[peak];
      if (better || (sign * data[cur] === sign * data[peak] && cur < peak)) peak = cur;
      for (const [di, dj, dk] of offsets) {
        const a = i + di;
        const b = j + dj;
        const c = k + dk;
        if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
        const nb = a + nx * (b + ny * c);
        if (!seen[nb] && sign * data[nb] > threshold) {
          seen[nb] = 1;
          stack.push(nb);
        }
      }
    }
    const pi = peak % nx;
    const pj = Math.floor(peak / nx) % ny;
    const pk = Math.floor(peak / (nx * ny));
    const com = sum.map((s) => s / size);
    const region = P3_REGIONS.find((r) => r.index === atlas[peak]);
    out.push({
      sign: sign > 0 ? 'positive' : 'negative',
      size_vox: size,
      size_mm3: size * 8,
      peak_value: round3(data[peak]),
      peak_ijk: [pi, pj, pk],
      peak_mm: worldOf(affine, pi, pj, pk).map(round3),
      com_ijk: com.map(round3),
      com_mm: worldOf(affine, ...com).map(round3),
      peak_region: region ? region.name : null,
    });
  }
  return out.sort((a, b) => b.size_vox - a.size_vox);
}

function gz(file, bytes) {
  fs.writeFileSync(path.join(outDir, file), zlib.gzipSync(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { level: 9 }));
}

function buildP3() {
  const grid = JSON.parse(fs.readFileSync(path.join(outDir, 'mni_2mm.json'), 'utf8'));
  const { dims, affine } = grid;
  const zmap = synthStat(dims, affine, P3_BLOBS.z, P3_Z_SPIKES);
  const tmap = synthStat(dims, affine, P3_BLOBS.t);
  const atlas = synthAtlas(dims, affine);
  gz('zmap_2mm.f32.gz', zmap);
  gz('tmap_2mm.f32.gz', tmap);
  gz('atlas3_2mm.u8.gz', atlas);
  const tsv = ['index\tname\tabbreviation\themisphere\tcolor']
    .concat(P3_REGIONS.map((r) => [r.index, r.name, r.abbr, r.hemisphere, r.color].join('\t')))
    .join('\n');
  fs.writeFileSync(path.join(outDir, 'atlas3_dseg.tsv'), tsv + '\n');

  const toWorldInv = (w) => {
    // Diagonal affine (harness grid): voxel = (world - origin) / spacing.
    return [0, 1, 2].map((a) => (w[a] - affine[a][3]) / affine[a][a]);
  };
  const nearest = (w) => toWorldInv(w).map((v) => Math.round(v));
  const at = (data, ijk) => data[ijk[0] + dims[0] * (ijk[1] + dims[1] * ijk[2])];
  const known = (data) => {
    const result = {};
    for (const thr of [2.3, 3.1]) {
      for (const conn of [6, 26]) {
        result[`abs>${thr},conn${conn}`] = [
          ...clusters(data, dims, affine, atlas, thr, 1, conn),
          ...clusters(data, dims, affine, atlas, thr, -1, conn),
        ];
      }
    }
    let lo = 0;
    let hi = 0;
    for (const v of data) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return { range: [round3(lo), round3(hi)], clusters: result };
  };
  const regionIjk = nearest(P3_REGION_CROSSHAIR);
  const meta = {
    grid: { dims, affine, voxel_size_mm: [2, 2, 2], note: 'Same grid as mni_2mm.json; diagonal affine, voxel centres at odd half-mm' },
    volumes: {
      zmap: {
        file: 'zmap_2mm.f32.gz',
        harness_path: '/harness/study/stats/zmap_synthetic.nii.gz',
        datatype: 'FLOAT32',
        intent_code: 5,
        intent_name: 'z-score',
        intent_p1: 0,
        intent_p2: 0,
        intent_p3: 0,
        description: 'synthetic z map',
        blobs: P3_BLOBS.z,
        spikes: P3_Z_SPIKES,
        ...known(zmap),
      },
      tmap: {
        file: 'tmap_2mm.f32.gz',
        harness_path: '/harness/study/stats/tmap_synthetic_df24.nii.gz',
        datatype: 'FLOAT32',
        intent_code: 3,
        intent_name: 't-stat',
        intent_p1: 24,
        intent_p2: 0,
        intent_p3: 0,
        description: 'synthetic t map, df=24',
        blobs: P3_BLOBS.t,
        ...known(tmap),
      },
      atlas: {
        file: 'atlas3_2mm.u8.gz',
        harness_path: '/harness/study/stats/atlas-synth3_dseg.nii.gz',
        lut: 'atlas3_dseg.tsv',
        lut_harness_path: '/harness/study/stats/atlas-synth3_dseg.tsv',
        datatype: 'UINT8',
        intent_code: 1002,
        intent_name: 'label',
        intent_p1: 0,
        intent_p2: 0,
        intent_p3: 0,
        description: 'synthetic 3-region atlas',
        regions: P3_REGIONS,
        voxels_per_region: Object.fromEntries(
          P3_REGIONS.map((r) => [r.index, atlas.reduce((n, v) => n + (v === r.index ? 1 : 0), 0)]),
        ),
      },
    },
    region_at_crosshair: {
      world_mm: P3_REGION_CROSSHAIR,
      nearest_ijk: regionIjk,
      label: at(atlas, regionIjk),
      region: P3_REGIONS.find((r) => r.index === at(atlas, regionIjk))?.name ?? null,
      zmap_value: round3(at(zmap, regionIjk)),
      tmap_value: round3(at(tmap, regionIjk)),
    },
  };
  fs.writeFileSync(path.join(outDir, 'p3_fixtures.json'), JSON.stringify(meta, null, 2) + '\n');
  return {
    zmap: meta.volumes.zmap.range,
    tmap: meta.volumes.tmap.range,
    atlas: meta.volumes.atlas.voxels_per_region,
    region: meta.region_at_crosshair,
  };
}

if (!process.argv.includes('--p3-only')) {
  console.log('volume', buildVolume());
  console.log('surface', buildSurface());
}
console.log('p3', buildP3());
