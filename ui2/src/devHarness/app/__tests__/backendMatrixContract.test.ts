import { describe, expect, it } from 'vitest';
import { createBackend, MNI_PATH } from '../backend';
import type { HarnessFixtures, VolumeFixture } from '../fixtures';
import { isInsideVolume } from '@/hooks/useLayerValueAtWorld';
import { transformWorldToVoxelColumnMajor } from '@/utils/voxelTransform';

/**
 * The harness must emit the GPU-info matrices column-major, like the real
 * backend (core/api_bridge/src/lib.rs flattens world_to_voxel per column),
 * so app code that reads them (value bounds, time-series voxel lookup) is
 * exercised against the real contract.
 */
function fixture(affine: number[][], dims: [number, number, number]): VolumeFixture {
  const data = new Float32Array(dims[0] * dims[1] * dims[2]).fill(1);
  return { dims, affine, data, range: [1, 1] };
}

const voxelToWorld = (affine: number[][], v: number[]) =>
  [0, 1, 2].map((r) => affine[r][0] * v[0] + affine[r][1] * v[1] + affine[r][2] * v[2] + affine[r][3]) as [
    number,
    number,
    number,
  ];

describe('harness backend matrix layout', () => {
  // Axis-swapped (permuted) affine: voxel i → world y, j → z, k → x.
  const dims: [number, number, number] = [20, 30, 40];
  const affine = [
    [0, 0, 2, -40],
    [1.5, 0, 0, -15],
    [0, 3, 0, -45],
    [0, 0, 0, 1],
  ];
  const vol = fixture(affine, dims);
  const fixtures = { mni: vol, stats: vol, surface: null } as unknown as HarnessFixtures;

  // request_layer_gpu_resources is async (round 3 R3-1: the mock simulates a 4D upload's latency).
  const setup = async () => {
    const backend = createBackend(fixtures);
    const info = backend.handlers.load_file({ path: MNI_PATH }) as { id: string };
    const gpu = (await backend.handlers.request_layer_gpu_resources({
      layerSpec: { Volume: { id: 'layer-1', source_resource_id: info.id } },
    })) as { world_to_voxel: number[]; voxel_to_world: number[]; dim: number[] };
    return { backend, gpu };
  };

  it('world_to_voxel is column-major: it maps voxel centres back to their indices', async () => {
    const { gpu } = await setup();
    for (const v of [
      [0, 0, 0],
      [19, 29, 39],
      [7, 3, 22],
    ]) {
      const back = transformWorldToVoxelColumnMajor(gpu.world_to_voxel, voxelToWorld(affine, v));
      back.forEach((c, i) => expect(c).toBeCloseTo(v[i], 4));
    }
    // voxel_to_world: translation in elements 12..14.
    expect(gpu.voxel_to_world.slice(12, 15)).toEqual([-40, -15, -45]);
  });

  it('value bounds from the emitted matrix agree with the backend sample at every face', async () => {
    const { backend, gpu } = await setup();
    const metadata = { dimensions: dims, worldToVoxel: gpu.world_to_voxel };
    let checked = 0;
    for (let axis = 0; axis < 3; axis += 1) {
      const n = dims[axis];
      for (const c of [-0.6, -0.2, -0.01, 0, 0.2, 0.49, n - 1, n - 0.6, n - 0.51, n - 0.5, n - 0.4, n - 0.01]) {
        const v = [dims[0] / 2, dims[1] / 2, dims[2] / 2];
        v[axis] = c;
        const world = voxelToWorld(affine, v);
        const sampled = backend.handlers.sample_layer_value_at_world({
          layerId: 'layer-1',
          worldCoords: world,
        }) as number;
        // The fixture is 1 everywhere; the backend answers 0 out of bounds.
        expect(isInsideVolume(world, metadata), `axis ${axis} v=${c}`).toBe(sampled === 1);
        checked += 1;
      }
    }
    expect(checked).toBe(36);
  });
});
