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

console.log('volume', buildVolume());
console.log('surface', buildSurface());
