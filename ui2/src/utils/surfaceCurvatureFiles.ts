/**
 * Folding files next to a surface mesh (phase 4, D2): FreeSurfer `lh.sulc` /
 * `lh.curv` (binary) and GIfTI `*.sulc.shape.gii` / `*.curv.shape.gii`
 * (HCP / fs_LR naming), found by putting "sulc" (then "curv") where the
 * mesh's surface-type token is.
 */

const SURFACE_TYPE_TOKEN =
  /(^|[._])(very_inflated|veryinflated|inflated|midthickness|pial|white|smoothwm|sphere|orig|graymid)(?=[._]|$)/i;

/** Sidecar candidates for a mesh path, most specific first. */
export function curvatureSidecarCandidates(meshPath: string): string[] {
  const slash = Math.max(meshPath.lastIndexOf('/'), meshPath.lastIndexOf('\\'));
  const dir = slash >= 0 ? meshPath.slice(0, slash + 1) : '';
  const name = meshPath.slice(slash + 1);
  const stem = name.replace(/\.surf\.gii$/i, '').replace(/\.gii$/i, '');
  if (!SURFACE_TYPE_TOKEN.test(stem)) return [];
  const out: string[] = [];
  for (const kind of ['sulc', 'curv']) {
    const replaced = stem.replace(SURFACE_TYPE_TOKEN, `$1${kind}`);
    // GIfTI shape files (HCP, fs_LR), then FreeSurfer binary (lh.sulc).
    out.push(`${dir}${replaced}.shape.gii`, `${dir}${replaced}.gii`, `${dir}${replaced}`);
  }
  return [...new Set(out)].filter((p) => p !== meshPath);
}

/**
 * FreeSurfer "new" curv format: 0xFFFFFF magic, int32 vertex count, int32
 * face count, int32 values per vertex (1), then big-endian float32 values.
 * Null when the bytes are not that format (or values per vertex is not 1).
 */
export function parseFreeSurferCurv(bytes: Uint8Array): Float32Array | null {
  if (bytes.length < 15 || bytes[0] !== 0xff || bytes[1] !== 0xff || bytes[2] !== 0xff) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vertexCount = view.getInt32(3, false);
  const perVertex = view.getInt32(11, false);
  if (!(vertexCount > 0) || perVertex !== 1 || bytes.length < 15 + vertexCount * 4) return null;
  const values = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i += 1) values[i] = view.getFloat32(15 + i * 4, false);
  return values;
}
