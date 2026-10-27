/**
 * Pane matte for figure exports on a light (or transparent) page.
 *
 * Problem: a rendered slice has no data outside the head, and that region
 * comes back black — either transparent (outside the volume grid, where the
 * pass clears to transparent) or opaque black (voxels of value 0, or a pass
 * that clears to opaque black). On a white page it showed as black corners
 * and strips. Compositing the raw alpha onto white is not enough either: the
 * alpha is binary at voxel resolution and the colour under a partial alpha
 * may be premultiplied, which left a dark, stair-stepped rim (v3 critic).
 *
 * Why this approach (and not only the backend alpha): the alpha channel
 * covers only "outside the volume grid", not the zero-valued voxels around
 * a skull-stripped brain, and whether the pass clears to transparent or to
 * opaque black differs between paths. A matte built from what the pixel
 * LOOKS like on black covers both cases with one rule and needs no second
 * render per pane:
 *
 * 1. Background = pixels that are (near) black on black — transparent, or
 *    opaque with every channel ≤ `fadeLevel` — AND 4-connected to the image
 *    border through such pixels (a flood fill). Dark data inside the head
 *    (black ventricles, a dark colormap end) is not border-connected and is
 *    kept; bright overlay voxels outside the brain stop the flood and stay.
 * 2. Coverage: 0 for background at or below `blackLevel`, ramping linearly to
 *    1 at `fadeLevel` (the interpolated fade-out at the brain's edge goes to
 *    the page instead of drawing a dark outline); elsewhere the pixel alpha.
 * 3. Colour bleed: a background pixel takes the colour of the nearest
 *    non-background pixel (BFS), so every partly covered pixel is a mix of an
 *    INSIDE colour and the page — never of black and the page. That is what
 *    removes the dark rim.
 * 4. Feather: across the background boundary coverage is the 3×3 mean
 *    (≈1 px), smoothing the voxel stair-steps.
 *
 * Pure: RGBA in, RGBA out (straight alpha), so it is unit-tested on
 * synthetic arrays (jsdom has no real canvas).
 */

export interface MatteOptions {
  /** Page colour (0–255 RGB) to composite onto, or null to keep a transparent page. */
  page: readonly [number, number, number] | null;
  /** Brightness on black (max channel × alpha) at or below which a background pixel is fully page. */
  blackLevel?: number;
  /** Brightness on black up to which a border-connected pixel is background (fades in to here). */
  fadeLevel?: number;
}

export const MATTE_BLACK_LEVEL = 6;
export const MATTE_FADE_LEVEL = 40;

export function matteOntoPage(
  src: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: MatteOptions,
): Uint8ClampedArray {
  const n = width * height;
  const out = new Uint8ClampedArray(n * 4);
  if (n === 0 || src.length < n * 4) return out;
  const black = options.blackLevel ?? MATTE_BLACK_LEVEL;
  const fade = Math.max(black + 1, options.fadeLevel ?? MATTE_FADE_LEVEL);

  // Brightness of each pixel as drawn on black (0–255).
  const onBlack = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    onBlack[i] = (Math.max(src[o], src[o + 1], src[o + 2]) * src[o + 3]) / 255;
  }

  // 1. Border-connected near-black pixels (flood fill, 4-connected).
  const background = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const seed = (i: number) => {
    if (!background[i] && onBlack[i] <= fade) {
      background[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < width; x += 1) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    if (x > 0) seed(i - 1);
    if (x < width - 1) seed(i + 1);
    if (i >= width) seed(i - width);
    if (i < n - width) seed(i + width);
  }

  // 2. Coverage.
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    alpha[i] = background[i]
      ? Math.min(1, Math.max(0, (onBlack[i] - black) / (fade - black)))
      : src[i * 4 + 3] / 255;
  }

  // 3. Colour: own colour inside; bled from the nearest inside pixel in the
  // background (multi-source BFS outward from the boundary).
  const colourOf = new Int32Array(n).fill(-1);
  head = 0;
  tail = 0;
  for (let i = 0; i < n; i += 1) {
    if (!background[i]) {
      colourOf[i] = i;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    const from = colourOf[i];
    const visit = (j: number) => {
      if (colourOf[j] === -1) {
        colourOf[j] = from;
        queue[tail++] = j;
      }
    };
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i < n - width) visit(i + width);
  }

  // 4. Feather across the boundary, then composite.
  const page = options.page;
  for (let i = 0; i < n; i += 1) {
    const x = i % width;
    const y = (i - x) / width;
    let a = alpha[i];
    let edge = false;
    let sum = 0;
    let count = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        const xx = x + dx;
        if (xx < 0 || xx >= width) continue;
        const j = yy * width + xx;
        if (background[j] !== background[i]) edge = true;
        sum += alpha[j];
        count += 1;
      }
    }
    if (edge) a = sum / count;
    // A partly transparent inside pixel on the edge takes the colour of its
    // most opaque inside neighbour: if the renderer premultiplied it, its own
    // colour is darkened by its alpha (the old dark rim).
    let source = colourOf[i];
    if (edge && !background[i] && src[i * 4 + 3] < 255) {
      let best = src[i * 4 + 3];
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const j = yy * width + xx;
          if (!background[j] && src[j * 4 + 3] > best) {
            best = src[j * 4 + 3];
            source = j;
          }
        }
      }
    }
    const c = source >= 0 ? source * 4 : -1;
    const r = c >= 0 ? src[c] : 0;
    const g = c >= 0 ? src[c + 1] : 0;
    const b = c >= 0 ? src[c + 2] : 0;
    const o = i * 4;
    if (page) {
      out[o] = Math.round(a * r + (1 - a) * page[0]);
      out[o + 1] = Math.round(a * g + (1 - a) * page[1]);
      out[o + 2] = Math.round(a * b + (1 - a) * page[2]);
      out[o + 3] = 255;
    } else {
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = Math.round(a * 255);
    }
  }
  return out;
}
