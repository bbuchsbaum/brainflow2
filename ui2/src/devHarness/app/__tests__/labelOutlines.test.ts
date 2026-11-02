import { describe, expect, it } from 'vitest';
import { createBackend, MNI_PATH, STATS_PATH } from '../backend';
import type { HarnessFixtures, VolumeFixture } from '../fixtures';

// QA run 5, N20: with two atlases in Outline mode only the first drew its
// outline. The harness mirrors the renderer, so every outlined label layer
// draws its own outline in its own colour.
const dims: [number, number, number] = [8, 8, 1];
const affine = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
];
const labels = (labelAt: (x: number, y: number) => number): VolumeFixture => {
  const data = new Float32Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) data[x + 8 * y] = labelAt(x, y);
  return { dims, affine, data, range: [1, 2] } as VolumeFixture;
};
const fixtures = {
  mni: labels((x) => (x < 4 ? 1 : 2)),
  stats: labels((_, y) => (y < 4 ? 1 : 2)),
  surface: null,
} as unknown as HarnessFixtures;

const view = {
  type: 'axial',
  origin_mm: [-0.5, 7.5, 0],
  u_mm: [8, 0, 0],
  v_mm: [0, -8, 0],
  width: 32,
  height: 32,
};

const outlineLayer = (id: string, volumeId: string, color: number[], thicknessPx: number) => ({
  id,
  volumeId,
  visible: true,
  opacity: 1e-3,
  intensity: [1, 2],
  threshold: [0, 0],
  colormap: 'gray',
  layerMode: 'label',
  outline: { enabled: true, selectedLabelId: 0, color, thicknessPx },
});

function countColour(rgba: Uint8Array, [r, g, b]: number[]): number {
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i] === r * 255 && rgba[i + 1] === g * 255 && rgba[i + 2] === b * 255) n++;
  }
  return n;
}

describe('label outlines (N20)', () => {
  it('draws an outline for every outlined label layer, not only the first', () => {
    const backend = createBackend(fixtures);
    const columns = backend.handlers.load_file({ path: MNI_PATH }) as { id: string };
    const rows = backend.handlers.load_file({ path: STATS_PATH }) as { id: string };
    const render = (layers: unknown[]) =>
      backend.handlers.render_view({
        stateJson: JSON.stringify({
          layers,
          requestedView: view,
          timepoint: 0,
          crosshair: { world_mm: [0, 0, 0], visible: false },
        }),
      }) as Uint8Array;

    const green = [0, 1, 0, 1];
    const red = [1, 0, 0, 1];
    const both = render([
      outlineLayer('glasser', columns.id, green, 1),
      outlineLayer('aseg', rows.id, red, 2),
    ]);
    expect(countColour(both, green)).toBeGreaterThan(0);
    expect(countColour(both, red)).toBeGreaterThan(0);

    const asegOnly = render([outlineLayer('aseg', rows.id, red, 2)]);
    expect(countColour(asegOnly, green)).toBe(0);
    expect(countColour(asegOnly, red)).toBeGreaterThan(0);
  });
});
