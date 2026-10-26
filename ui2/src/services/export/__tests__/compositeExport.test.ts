import { describe, expect, it } from 'vitest';
import {
  EXPORT_PRESETS,
  outputSizeText,
  presetOf,
  printWidthPx,
  chromeUnit,
  ptToPx,
  TEXT_PT,
  scaleBarPx,
  withJpegMetadata,
  withPngMetadata,
} from '../compositeExport';
import {
  boundedProvenance,
  clampMosaicRange,
  defaultMosaicColumns,
  defaultMosaicRange,
  mosaicRangePositions,
  paneRect,
  rectPlane,
  solveMmPerPx,
} from '../compositeCapture';

/** A minimal PNG: signature + IHDR + IEND (CRCs are not checked here). */
function tinyPng(): Uint8Array {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  const ihdr = [0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0, 0, 0, 0];
  const iend = [0, 0, 0, 0, 73, 69, 78, 68, 0xae, 0x42, 0x60, 0x82];
  return Uint8Array.from([...sig, ...ihdr, ...iend]);
}

function chunks(png: Uint8Array): Array<{ type: string; data: Uint8Array }> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: Array<{ type: string; data: Uint8Array }> = [];
  for (let o = 8; o < png.length; ) {
    const n = view.getUint32(o);
    out.push({
      type: String.fromCharCode(...png.subarray(o + 4, o + 8)),
      data: png.subarray(o + 8, o + 8 + n),
    });
    o += 12 + n;
  }
  return out;
}

describe('composited export (P3.8)', () => {
  it('recognises the presets and a custom mix', () => {
    expect(presetOf(EXPORT_PRESETS.shown)).toBe('shown');
    expect(presetOf(EXPORT_PRESETS.figure)).toBe('figure');
    expect(presetOf({ ...EXPORT_PRESETS.figure, background: 'transparent' })).toBeNull();
  });

  it('"Figure" keeps everything but the crosshair, on white', () => {
    expect(EXPORT_PRESETS.figure).toEqual({
      crosshair: false,
      header: true,
      orientation: true,
      colorbar: true,
      scaleBar: true,
      background: 'white',
    });
  });

  it('sizes a print width at a resolution', () => {
    expect(printWidthPx({ kind: 'print', widthMm: 89, dpi: 300 })).toBe(1051);
    expect(printWidthPx({ kind: 'print', widthMm: 183, dpi: 600 })).toBe(4323);
    expect(printWidthPx({ kind: 'screen', scale: 2 })).toBeNull();
    expect(outputSizeText(1051, 840, 300)).toBe('1051 × 840 px · 89 × 71 mm at 300 dpi');
  });

  it('draws the 10 mm scale bar at the pane’s own mm per pixel', () => {
    // 0.6746 mm per CSS px at 1×; refitted to 2× -> 0.3373 mm per device px.
    expect(scaleBarPx({ u_mm: [0.674626886844635, 0, 0] })).toBeCloseTo(14.823, 3);
    expect(scaleBarPx({ u_mm: [0.3373134434223175, 0, 0] })).toBeCloseTo(29.646, 3);
    expect(scaleBarPx({ u_mm: [0, 0.5, 0] }, 20)).toBe(40);
  });

  it('writes the resolution (pHYs) and provenance (iTXt) into a PNG', () => {
    const png = withPngMetadata(tinyPng(), { dpi: 300, provenance: '{"app":"Brainflow"}' });
    const list = chunks(png);
    expect(list.map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'iTXt', 'IEND']);
    const phys = new DataView(list[1].data.buffer, list[1].data.byteOffset);
    expect(phys.getUint32(0)).toBe(11811); // 300 dpi in pixels per metre
    expect(phys.getUint32(4)).toBe(11811);
    expect(list[1].data[8]).toBe(1);
    const text = new TextDecoder().decode(list[2].data);
    expect(text.startsWith('brainflow:provenance')).toBe(true);
    expect(text.endsWith('{"app":"Brainflow"}')).toBe(true);
    // Unchanged without metadata.
    expect(withPngMetadata(tinyPng(), {})).toEqual(tinyPng());
  });

  it('writes the resolution into a JFIF header and provenance as a comment', () => {
    const jfif = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9,
    ]);
    const out = withJpegMetadata(jfif, { dpi: 600, provenance: 'x' });
    // APP0 JFIF stays right after SOI; the comment follows it (JFIF order).
    expect([out[2], out[3]]).toEqual([0xff, 0xe0]);
    expect(out[13]).toBe(1);
    expect((out[14] << 8) | out[15]).toBe(600);
    expect([out[20], out[21]]).toEqual([0xff, 0xfe]);
  });

  it('lists a mosaic range on the reference grid, every n-th slice', () => {
    const sampling = { min: -71.5, step: 2, first: 3, last: 80 };
    const positions = mosaicRangePositions(sampling, {
      kind: 'range',
      fromMm: 24.5,
      toMm: 30.5,
      every: 1,
    });
    expect(positions).toEqual([24.5, 26.5, 28.5, 30.5]);
    // Reversed bounds, every 3rd, clipped to the brain's slices.
    const clipped = mosaicRangePositions(sampling, {
      kind: 'range',
      fromMm: 200,
      toMm: -200,
      every: 3,
    });
    expect(clipped[0]).toBe(-71.5 + 3 * 2);
    expect(clipped[clipped.length - 1]).toBeLessThanOrEqual(-71.5 + 80 * 2);
    expect(clipped[1] - clipped[0]).toBe(6);
  });

  it('sizes figure text in points of the output, independent of the source pane (v3 user)', () => {
    // 8 pt labels and 7 pt ticks at 300 dpi: 33.3 and 29.2 px, whatever the pane.
    const u300 = chromeUnit({ kind: 'print', widthMm: 89, dpi: 300 });
    expect(ptToPx(TEXT_PT.label, u300)).toBeCloseTo((8 / 72) * 300, 6);
    expect(ptToPx(TEXT_PT.tick, u300)).toBeCloseTo((7 / 72) * 300, 6);
    // 600 dpi doubles the pixels, the point size is unchanged.
    const u600 = chromeUnit({ kind: 'print', widthMm: 183, dpi: 600 });
    expect(ptToPx(TEXT_PT.label, u600) / ptToPx(TEXT_PT.label, u300)).toBeCloseTo(2, 6);
    // Screen multiples: 8 pt at 96 dpi x scale.
    expect(ptToPx(8, chromeUnit({ kind: 'screen', scale: 2 }))).toBeCloseTo((8 / 72) * 96 * 2, 6);
  });

  it('crops a pane to the brain box plus 6% and keeps one mm/px across panes', () => {
    const axial = { origin_mm: [-95.5, 94.5, 50.5], u_mm: [0.5, 0, 0], v_mm: [0, -0.5, 0], dim_px: [400, 460] } as never;
    const coronal = { origin_mm: [-95.5, -19.5, 112.5], u_mm: [0.6, 0, 0], v_mm: [0, 0, -0.6], dim_px: [320, 320] } as never;
    const bbox = { worldMinMm: [-70, -100, -40], worldMaxMm: [70, 70, 80] };
    const r = paneRect(axial, bbox);
    // x: 140 mm + 6% each side; from the origin at x -95.5.
    expect(r.u0).toBeCloseTo(-70 + 95.5 - 140 * 0.06, 6);
    expect(r.u1 - r.u0).toBeCloseTo(140 * 1.12, 6);
    // One mm/px for a row fitted to 183 mm at 300 dpi.
    const rc = paneRect(coronal, bbox);
    const p = solveMmPerPx([[{ plane: axial, rect: r }, { plane: coronal, rect: rc }]], { kind: 'print', widthMm: 183, dpi: 300 }, { unit: 3.125, paneGap: 4, sideW: 0 });
    const a = rectPlane(axial, r, p);
    const c = rectPlane(coronal, rc, p);
    expect(Math.hypot(...(a.u_mm as number[]))).toBeCloseTo(Math.hypot(...(c.u_mm as number[])), 9);
    // The row fills the width (minus one gap): 2161 px at 183 mm / 300 dpi.
    expect(a.dim_px[0] + c.dim_px[0]).toBeGreaterThanOrEqual(2161 - 13 - 2);
    expect(a.dim_px[0] + c.dim_px[0]).toBeLessThanOrEqual(2161 - 12 + 2);
  });

  it('clamps a mosaic range to the brain slices and snaps it to the grid', () => {
    const sampling = { min: -71.5, step: 2, first: 3, last: 80 };
    expect(clampMosaicRange(sampling, { kind: 'range', fromMm: -500, toMm: 30.2, every: 0 })).toEqual({
      kind: 'range',
      fromMm: -65.5,
      toMm: 30.5,
      every: 1,
    });
    // "To" is the last slice taken: every 3rd 2 mm slice from -65.5.
    expect(clampMosaicRange(sampling, { kind: 'range', fromMm: -65.5, toMm: 28.5, every: 3 }).toMm).toBeCloseTo(24.5, 9);
    // Default: the whole cropped brain, about 24 tiles.
    const def = defaultMosaicRange(sampling);
    expect(def.fromMm).toBe(-65.5);
    expect(def.every).toBe(Math.ceil(78 / 24));
    expect(Math.round((def.toMm - def.fromMm) / (2 * def.every)) + 1).toBeLessThanOrEqual(24);
    expect(defaultMosaicColumns({ kind: 'print', widthMm: 183, dpi: 300 }, 4)).toBe(6);
    expect(defaultMosaicColumns({ kind: 'screen', scale: 2 }, 5)).toBe(5);
  });

  it('bounds provenance by structure, never by bytes', () => {
    const big = { app: 'Brainflow', layers: Array.from({ length: 5000 }, (_, i) => ({ name: `layer ${i}` })) };
    const text = boundedProvenance(big, 2000);
    expect(text.length).toBeLessThanOrEqual(2000);
    const parsed = JSON.parse(text);
    expect(parsed.app).toBe('Brainflow');
    expect(parsed.layers).toMatchObject({ truncated: true, count: 5000 });
  });
});
