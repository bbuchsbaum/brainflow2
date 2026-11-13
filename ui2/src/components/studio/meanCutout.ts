type Vec = readonly number[];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/**
 * The rectangle of the summary raster that covers the cutout window: both
 * planes share their axes, so the window's corner and extent map straight
 * into summary pixels. Null when the planes do not share axes.
 */
export function meanCutoutSource(
  summary: { origin_mm: Vec; u_mm: Vec; v_mm: Vec },
  cutout: { origin_mm: Vec; u_mm: Vec; v_mm: Vec; dim_px: readonly [number, number] },
): [number, number, number, number] | null {
  const uu = dot(summary.u_mm, summary.u_mm),
    vv = dot(summary.v_mm, summary.v_mm);
  if (!uu || !vv) return null;
  const parallel = (a: Vec, b: Vec) => {
    const na = Math.sqrt(dot(a, a)),
      nb = Math.sqrt(dot(b, b));
    return na > 0 && nb > 0 && Math.abs(dot(a, b) / (na * nb) - 1) < 1e-6;
  };
  if (!parallel(summary.u_mm, cutout.u_mm) || !parallel(summary.v_mm, cutout.v_mm)) return null;
  const d = [0, 1, 2].map((i) => cutout.origin_mm[i] - summary.origin_mm[i]);
  const x = dot(d, summary.u_mm) / uu,
    y = dot(d, summary.v_mm) / vv;
  const w = (cutout.dim_px[0] * Math.sqrt(dot(cutout.u_mm, cutout.u_mm))) / Math.sqrt(uu),
    h = (cutout.dim_px[1] * Math.sqrt(dot(cutout.v_mm, cutout.v_mm))) / Math.sqrt(vv);
  return [x, y, w, h];
}

