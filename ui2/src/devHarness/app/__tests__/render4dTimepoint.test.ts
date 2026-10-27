import { describe, expect, it } from 'vitest';
import { createBackend, MNI_PATH } from '../backend';
import type { HarnessFixtures, VolumeFixture } from '../fixtures';
import { useViewStateStore } from '@/stores/viewStateStore';

// Native R2-3: a 4D layer rendered from a view state without a timepoint is
// refused by the backend (resolve_requested_render_timepoint, error 4103) and
// the slices stay black until the first frame change. The harness now refuses
// it too, and a view state always carries a timepoint.
const dims: [number, number, number] = [4, 4, 4];
const affine = [
  [2, 0, 0, -4],
  [0, 2, 0, -4],
  [0, 0, 2, -4],
  [0, 0, 0, 1],
];
const frames = [new Float32Array(64).fill(1), new Float32Array(64).fill(2)];
const vol4d: VolumeFixture = { dims, affine, data: frames[0], frames, range: [1, 2] };
const fixtures = { mni: vol4d, stats: vol4d, surface: null } as unknown as HarnessFixtures;

const view = { type: 'axial', origin_mm: [-4, 4, 0], u_mm: [1, 0, 0], v_mm: [0, -1, 0], width: 8, height: 8 };

describe('4D render needs a timepoint (R2-3)', () => {
  it('the harness, like the backend, refuses a 4D render without one and renders with one', () => {
    const backend = createBackend(fixtures);
    const info = backend.handlers.load_file({ path: MNI_PATH }) as { id: string };
    const layers = [{ id: 'run', volumeId: info.id, visible: true, opacity: 1, intensity: [1, 2], threshold: [0, 0], colormap: 'gray' }];
    const render = (state: Record<string, unknown>) =>
      backend.handlers.render_view({ stateJson: JSON.stringify({ ...state, layers, requestedView: view, crosshair: { world_mm: [0, 0, 0], visible: false } }) });
    expect(() => render({})).toThrow(/must include a timepoint/);
    expect(render({ timepoint: 0 })).toBeInstanceOf(Uint8Array);
  });

  it('a fresh view state carries timepoint 0', () => {
    useViewStateStore.getState().resetToDefaults();
    expect(useViewStateStore.getState().viewState.timepoint).toBe(0);
  });
});
