/**
 * Label colour arithmetic for the design mocks (round 4). Inactive labels
 * are muted toward their own lighter, less saturated tint in CIELAB (LCh),
 * never by alpha: an alpha-blended stroke takes the colour of the tissue
 * under it, so two warm labels at 46% both turned tan on mid-grey T2w. A
 * tint keeps the hue and stays opaque, so muted pairs remain separable
 * (`deltaE76` between every pair of muted label colours is at least
 * `MUTED_MIN_DELTA_E`, tested).
 */

export type Rgb = readonly [number, number, number];
export type Lab = readonly [number, number, number];

/** "rgb(232 108 92)" or "rgb(232, 108, 92)" or "#e86c5c" to [r, g, b]. */
export function parseRgb(color: string): Rgb {
  const hex = color.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = color.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (!m) throw new Error(`colour: cannot parse "${color}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function formatRgb([r, g, b]: Rgb): string {
  return `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;
}

const WHITE = [0.95047, 1, 1.08883] as const;

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB (D65) to CIELAB. */
export function rgbToLab(rgb: Rgb): Lab {
  const [r, g, b] = rgb.map(toLinear);
  const x = 0.4124 * r + 0.3576 * g + 0.1805 * b;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x / WHITE[0]), f(y / WHITE[1]), f(z / WHITE[2])];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIELAB to sRGB, clamped to the gamut. */
export function labToRgb([L, a, b]: Lab): Rgb {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const [x, y, z] = [WHITE[0] * inv(fx), WHITE[1] * inv(fy), WHITE[2] * inv(fz)];
  const lin = [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ];
  return lin.map((c) => Math.max(0, Math.min(255, Math.round(fromLinear(c))))) as unknown as Rgb;
}

/** CIE 1976 colour difference (Euclidean distance in CIELAB). */
export function deltaE76(p: Rgb, q: Rgb): number {
  const [a, b] = [rgbToLab(p), rgbToLab(q)];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Mute levels: the lightness moves `toward` of the way to `MUTE_TARGET_L`, chroma is scaled by `chroma`. */
export const MUTE = {
  inactive: { toward: 0.3, chroma: 0.7 },
  quiet: { toward: 0.4, chroma: 0.6 },
} as const;

/** Lightness the tints move toward (a light tint, so a muted line stays lighter than its halo). */
export const MUTE_TARGET_L = 86;

/** Every pair of muted label colours (either level) differs by at least this ΔE*ab (1976). */
export const MUTED_MIN_DELTA_E = 15;

/** A label colour muted toward its own lighter, less saturated tint (same hue, opaque). */
export function mutedColor(color: string, level: keyof typeof MUTE): string {
  const [L, a, b] = rgbToLab(parseRgb(color));
  const { toward, chroma } = MUTE[level];
  const L2 = L + (MUTE_TARGET_L - L) * toward;
  return formatRgb(labToRgb([L2, a * chroma, b * chroma]));
}
