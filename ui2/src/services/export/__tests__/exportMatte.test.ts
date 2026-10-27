/**
 * Pane matte (native check: black corners and strips on a White background).
 * Synthetic RGBA images: outside the head must become the page, with no dark
 * rim at the edge (no pixel darker than both its inside neighbour and the
 * page), and dark data inside the head must survive.
 */
import { describe, expect, it } from 'vitest';
import { matteOntoPage } from '@/utils/exportMatte';

const W = 40;
const H = 40;
const WHITE = [255, 255, 255] as const;
const lum = (d: ArrayLike<number>, i: number) =>
  0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];

/** A disc of `inside` colour (radius 14) on `outside`, with a one-pixel antialiased ring. */
function disc(
  inside: [number, number, number],
  outside: [number, number, number, number],
  ring: 'straight' | 'premultiplied' | 'none',
): { data: Uint8ClampedArray; insideMask: Uint8Array } {
  const data = new Uint8ClampedArray(W * H * 4);
  const insideMask = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      const r = Math.hypot(x - 19.5, y - 19.5);
      let px: number[];
      if (r < 14) {
        px = [...inside, 255];
        insideMask[i] = 1;
      } else if (r < 15 && ring !== 'none') {
        const a = 0.5;
        px =
          ring === 'straight'
            ? [...inside, Math.round(a * 255)]
            : [...inside.map((c) => Math.round(c * a)), Math.round(a * 255)];
      } else px = [...outside];
      data.set(px, i * 4);
    }
  }
  return { data, insideMask };
}

function expectNoDarkRim(out: Uint8ClampedArray, insideMask: Uint8Array, page: readonly number[]) {
  const pageLum = 0.2126 * page[0] + 0.7152 * page[1] + 0.0722 * page[2];
  for (let y = 1; y < H - 1; y += 1) {
    for (let x = 1; x < W - 1; x += 1) {
      const i = y * W + x;
      if (insideMask[i]) continue;
      for (const j of [i - 1, i + 1, i - W, i + W]) {
        if (!insideMask[j]) continue;
        // Darker than BOTH its inside neighbour and the page = a dark rim.
        expect(lum(out, i), `rim at ${x},${y}`).toBeGreaterThanOrEqual(
          Math.min(lum(out, j), pageLum) - 1,
        );
      }
    }
  }
}

describe('pane matte onto the page (P3 native check)', () => {
  it('turns a transparent outside into page white, with a feathered edge and no dark rim', () => {
    for (const ring of ['straight', 'premultiplied', 'none'] as const) {
      const { data, insideMask } = disc([200, 120, 80], [0, 0, 0, 0], ring);
      const out = matteOntoPage(data, W, H, { page: WHITE });
      // Corners and the whole border: page white, opaque.
      for (const i of [0, W - 1, (H - 1) * W, H * W - 1, 5 * W + 2]) {
        expect([...out.subarray(i * 4, i * 4 + 4)]).toEqual([255, 255, 255, 255]);
      }
      // The centre keeps its colour.
      const c = 20 * W + 20;
      expect([...out.subarray(c * 4, c * 4 + 3)]).toEqual([200, 120, 80]);
      expectNoDarkRim(out, insideMask, WHITE);
      // The edge is feathered: some pixels between inside and page.
      let partial = 0;
      for (let i = 0; i < W * H; i += 1) {
        const l = lum(out, i);
        if (l > lum([200, 120, 80], 0) + 2 && l < 253) partial += 1;
      }
      expect(partial, `feathered edge (${ring})`).toBeGreaterThan(20);
    }
  });

  it('turns an opaque black outside (a pass that clears to black, zero voxels) into page white', () => {
    const { data, insideMask } = disc([150, 150, 150], [0, 0, 0, 255], 'none');
    const out = matteOntoPage(data, W, H, { page: WHITE });
    for (let x = 0; x < W; x += 1) {
      expect(out[x * 4]).toBe(255);
      expect(out[((H - 1) * W + x) * 4]).toBe(255);
    }
    expectNoDarkRim(out, insideMask, WHITE);
    // No output pixel anywhere is darker than the darkest inside pixel.
    let min = 255;
    for (let i = 0; i < W * H; i += 1) min = Math.min(min, lum(out, i));
    expect(min).toBeGreaterThanOrEqual(150 - 1);
  });

  it('fades the interpolated dark fade-out at the brain edge to the page instead of outlining it', () => {
    // A row profile: tissue 180, then the edge ramp 30 → 15 → 5, then 0.
    const width = 12;
    const height = 3;
    const profile = [0, 0, 5, 15, 30, 180, 180, 30, 15, 5, 0, 0];
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1)
      profile.forEach((v, x) => data.set([v, v, v, 255], (y * width + x) * 4));
    const out = matteOntoPage(data, width, height, { page: WHITE });
    const row = profile.map((_, x) => out[(1 * width + x) * 4]);
    // The pure-black outside is page; the near-black ramp is mostly page.
    expect(row[0]).toBe(255);
    expect(row[2]).toBeGreaterThan(200);
    expect(row[3]).toBeGreaterThan(100);
    // Tissue keeps its value.
    expect(row[5]).toBeGreaterThanOrEqual(179);
  });

  it('keeps dark data inside the head (a black ventricle, a dark overlay) and bright voxels outside it', () => {
    const { data } = disc([160, 160, 160], [0, 0, 0, 255], 'none');
    // A black "ventricle" in the middle, not connected to the border.
    for (let y = 17; y < 23; y += 1)
      for (let x = 17; x < 23; x += 1) data.set([0, 0, 0, 255], (y * W + x) * 4);
    // A bright overlay blob outside the brain.
    for (let y = 1; y < 5; y += 1) for (let x = 1; x < 5; x += 1) data.set([255, 40, 20, 255], (y * W + x) * 4);
    const out = matteOntoPage(data, W, H, { page: WHITE });
    const v = 20 * W + 20;
    expect([...out.subarray(v * 4, v * 4 + 3)]).toEqual([0, 0, 0]);
    const o = 2 * W + 2; // inside the 4×4 blob (its edge is feathered)
    expect(out[o * 4]).toBeGreaterThan(200);
    expect(out[o * 4 + 1]).toBeLessThan(150);
  });

  it('keeps the outside transparent for a transparent page (colour bled from inside, no black fringe)', () => {
    const { data, insideMask } = disc([200, 120, 80], [0, 0, 0, 255], 'none');
    const out = matteOntoPage(data, W, H, { page: null });
    expect(out[3]).toBe(0);
    const c = 20 * W + 20;
    expect(out[c * 4 + 3]).toBe(255);
    // Every partly covered pixel carries the inside colour, never black.
    for (let i = 0; i < W * H; i += 1) {
      if (insideMask[i]) continue;
      if (out[i * 4 + 3] > 0) expect([...out.subarray(i * 4, i * 4 + 3)]).toEqual([200, 120, 80]);
    }
  });
});
