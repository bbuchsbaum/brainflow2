/**
 * Phase 4 E5b fixture: one subject's three runs of one task, 4D BOLD on a
 * 4 mm grid, mirroring the native multirun fixture
 * (`.hillclimb/native-check/p4/truth.json` d2_multirun; truth also in
 * p4_fixtures.json `multirun`). The 3×3×3 block around voxel (10, 23, 30)
 * (−40, −20, 48 mm) carries each run's course
 * `baseline + amplitude · exp(−((t − centre) / 2)²)` (t = 0-based frame in the
 * run); elsewhere in the brain each run is its baseline plus a time-constant texture (± 18).
 */
import type { VolumeFixture } from './fixtures';

export const MULTIRUN_ROOT = '/harness/multirun';
export const MULTIRUN_VOXEL_MM = [-40, -20, 48] as const;
const VOXEL_IJK = [10, 23, 30] as const;
const DIMS: [number, number, number] = [41, 49, 40];
const ORIGIN = [-80, -112, -72];
const VOXEL = 4;
export const MULTIRUN_TR = 2;

export const MULTIRUN_RUNS = [
  { run: 1, frames: 20, baseline: 100, amplitude: 10, centre: 5 },
  { run: 2, frames: 24, baseline: 102, amplitude: 20, centre: 12 },
  { run: 3, frames: 18, baseline: 98, amplitude: 15, centre: 9 },
] as const;

export const multirunPath = (run: number) =>
  `${MULTIRUN_ROOT}/sub-01_task-faces_run-${run}_bold.nii`;

export function parseMultirunPath(path: string): number | null {
  const m = /^\/harness\/multirun\/sub-01_task-faces_run-(\d+)_bold\.nii$/.exec(path);
  const run = m ? Number(m[1]) : null;
  return run !== null && MULTIRUN_RUNS.some((r) => r.run === run) ? run : null;
}

/**
 * A time-constant, anatomy-like texture inside the brain (round 3 C1: the EPI
 * view needs structure), baseline ± 18; the block keeps its known course.
 */
export const multirunTexture = (i: number, j: number, k: number) =>
  18 * Math.sin(0.45 * i) * Math.cos(0.35 * j) * Math.cos(0.3 * k);

/** The run's value at frame t inside the block. */
export const multirunCourse = (run: number, t: number) => {
  const r = MULTIRUN_RUNS.find((x) => x.run === run)!;
  return r.baseline + r.amplitude * Math.exp(-(((t - r.centre) / 2) ** 2));
};

const built = new Map<number, VolumeFixture>();

/** The run's 4D fixture, built once. */
export function multirunFixture(run: number): VolumeFixture {
  let fixture = built.get(run);
  if (!fixture) {
    fixture = buildRun(run);
    built.set(run, fixture);
  }
  return fixture;
}

function buildRun(run: number): VolumeFixture {
  const r = MULTIRUN_RUNS.find((x) => x.run === run)!;
  const [nx, ny, nz] = DIMS;
  const affine = [
    [VOXEL, 0, 0, ORIGIN[0]],
    [0, VOXEL, 0, ORIGIN[1]],
    [0, 0, VOXEL, ORIGIN[2]],
    [0, 0, 0, 1],
  ];
  // "The brain": an ellipsoid filling the grid; zero outside, as a real BOLD image.
  const inBrain = (i: number, j: number, k: number) =>
    ((i - nx / 2) / (nx / 2.2)) ** 2 +
      ((j - ny / 2) / (ny / 2.2)) ** 2 +
      ((k - nz / 2) / (nz / 2.2)) ** 2 <=
    1;
  const inBlock = (i: number, j: number, k: number) =>
    Math.abs(i - VOXEL_IJK[0]) <= 1 &&
    Math.abs(j - VOXEL_IJK[1]) <= 1 &&
    Math.abs(k - VOXEL_IJK[2]) <= 1;
  const frames = Array.from({ length: r.frames }, (_, t) => {
    const data = new Float32Array(nx * ny * nz);
    const course = multirunCourse(run, t);
    for (let k = 0; k < nz; k += 1)
      for (let j = 0; j < ny; j += 1)
        for (let i = 0; i < nx; i += 1) {
          if (!inBrain(i, j, k)) continue;
          data[i + nx * (j + ny * k)] = inBlock(i, j, k) ? course : r.baseline + multirunTexture(i, j, k);
        }
    return data;
  });
  let lo = Infinity;
  let hi = -Infinity;
  for (const f of frames)
    for (const v of f) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  return { dims: DIMS, affine, data: frames[0], frames, range: [lo, hi], tr: MULTIRUN_TR };
}
