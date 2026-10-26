import { describe, expect, it } from 'vitest';
import {
  EXPORT_PRESETS,
  outputSizeText,
  presetOf,
  printWidthPx,
  resolveScale,
  scaleBarPx,
  withJpegMetadata,
  withPngMetadata,
} from '../compositeExport';
import { mosaicRangePositions } from '../compositeCapture';

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
    expect(resolveScale({ kind: 'screen', scale: 3 }, 500)).toBe(3);
    expect(resolveScale({ kind: 'print', widthMm: 89, dpi: 300 }, 525.5)).toBeCloseTo(2, 6);
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
    expect([out[2], out[3]]).toEqual([0xff, 0xfe]); // COM first
    // The 5-byte comment segment shifts the original bytes by 5.
    const app0 = out.subarray(5);
    expect(app0[13]).toBe(1);
    expect((app0[14] << 8) | app0[15]).toBe(600);
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
});
