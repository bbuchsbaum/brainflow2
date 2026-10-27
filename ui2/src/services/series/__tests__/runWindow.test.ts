import { beforeEach, describe, expect, it } from 'vitest';
import { useLayerStore } from '@/stores/layerStore';
import { resetRunWindows, shareRunWindow } from '../runWindow';

const run = (n: number, frames: number) => ({
  id: `r${n}`,
  name: `Faces BOLD (sub-01, run-${n})`,
  volumeId: `v${n}`,
  type: 'functional',
  visible: true,
  order: n,
  sourcePath: `/m/sub-01_task-faces_run-${n}_bold.nii`,
  volumeType: 'TimeSeries4D',
  timeSeriesInfo: { num_timepoints: frames, tr: 2 },
});
const meta = { dimensions: [41, 49, 40], voxelToWorld: [4, 0, 0, 0, 0, 4, 0, 0, 0, 0, 4, 0, -80, -112, -72, 1] };

describe('pooled EPI window across runs (native R2-1)', () => {
  beforeEach(() => resetRunWindows());

  it('runs loaded one at a time end on one window; a f32 round trip still counts as the auto window', () => {
    const view = new Map<string, [number, number]>();
    const current = (id: string) => view.get(id);
    const apply = (id: string, w: [number, number]) => view.set(id, [Math.fround(w[0]), Math.fround(w[1])]);
    // Run 1 alone.
    useLayerStore.setState({ layers: [run(1, 20)], layerMetadata: new Map([['r1', meta]]) } as never);
    apply('r1', shareRunWindow('r1', [0, 112.57], current, apply));
    // Run 2 arrives.
    useLayerStore.setState({ layers: [run(1, 20), run(2, 24)], layerMetadata: new Map([['r1', meta], ['r2', meta]]) } as never);
    apply('r2', shareRunWindow('r2', [0, 112.9], current, apply));
    expect(view.get('r1')).toEqual([0, Math.fround(112.9)]);
    expect(view.get('r2')).toEqual([0, Math.fround(112.9)]);
  });

  it('a window the user set is left alone', () => {
    const view = new Map<string, [number, number]>();
    const current = (id: string) => view.get(id);
    const apply = (id: string, w: [number, number]) => view.set(id, w);
    useLayerStore.setState({ layers: [run(1, 20)], layerMetadata: new Map([['r1', meta]]) } as never);
    apply('r1', shareRunWindow('r1', [0, 112.57], current, apply));
    view.set('r1', [10, 90]); // the user's window
    useLayerStore.setState({ layers: [run(1, 20), run(2, 24)], layerMetadata: new Map([['r1', meta], ['r2', meta]]) } as never);
    shareRunWindow('r2', [0, 112.9], current, apply);
    expect(view.get('r1')).toEqual([10, 90]);
  });
});
