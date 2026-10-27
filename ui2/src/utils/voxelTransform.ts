export type WorldCoord3 = [number, number, number];

/**
 * Transform world coordinates with a column-major 4x4 homogeneous matrix.
 *
 * Backend matrices are flattened in column-major order for WGSL, so callers
 * must not interpret them as row-major.
 */
export function transformWorldToVoxelColumnMajor(
  matrix: number[],
  world: WorldCoord3
): WorldCoord3 {
  return applyColumnMajor4x4(matrix, world);
}

/**
 * Voxel index (i, j, k) -> world mm through the backend's column-major
 * `voxel_to_world` (the GPU info / `VolumeMetadata.voxelToWorld` layout).
 * Fractional indices are allowed (voxel centres are integers).
 */
export function transformVoxelToWorldColumnMajor(
  matrix: number[],
  voxel: WorldCoord3
): WorldCoord3 {
  return applyColumnMajor4x4(matrix, voxel);
}

/** True when `matrix` is a usable flattened 4x4 (16 finite numbers). */
export function isAffine4x4(matrix: unknown): matrix is number[] {
  return (
    Array.isArray(matrix) &&
    matrix.length >= 16 &&
    matrix.slice(0, 16).every((v) => typeof v === 'number' && Number.isFinite(v))
  );
}

function applyColumnMajor4x4(matrix: number[], world: WorldCoord3): WorldCoord3 {
  if (matrix.length < 16) {
    throw new Error(`Expected 16 matrix elements, received ${matrix.length}`);
  }

  const [wx, wy, wz] = world;
  const vx = matrix[0] * wx + matrix[4] * wy + matrix[8] * wz + matrix[12];
  const vy = matrix[1] * wx + matrix[5] * wy + matrix[9] * wz + matrix[13];
  const vz = matrix[2] * wx + matrix[6] * wy + matrix[10] * wz + matrix[14];
  const vw = matrix[3] * wx + matrix[7] * wy + matrix[11] * wz + matrix[15];

  if (Math.abs(vw) > Number.EPSILON && !Object.is(vw, 1)) {
    return [vx / vw, vy / vw, vz / vw];
  }

  return [vx, vy, vz];
}
