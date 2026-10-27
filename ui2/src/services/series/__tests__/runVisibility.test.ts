import { beforeEach, describe, expect, it, vi } from 'vitest';

const toggle = vi.fn();
vi.mock('@/services/LayerService', () => ({
  getLayerService: () => ({ toggleVisibility: toggle }),
}));

import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { activateRun, formRunGroup, resetRunVisibility, restoreRunGroup } from '../runVisibility';
import { noteUserVisibility } from '../visibilityIntent';
import type { SegmentGroup } from '../seriesSegments';

const group: SegmentGroup = {
  key: 'layers:r1,r2,r3',
  title: 'Runs of sub-01 task-faces',
  factor: 'run',
  source: 'layers',
  segments: ['r1', 'r2', 'r3'].map((id, i) => ({
    id: `run-${i + 1}`,
    label: `run ${i + 1}`,
    layerId: id,
    frameStart: 0,
    frames: 20,
    tr: 2,
  })),
};
const IDS = ['t1', 'r1', 'r2', 'r3'];

/** What is drawn (the view state). */
const drawn = (id: string) =>
  !!useViewStateStore.getState().viewState.layers.find((l) => l.id === id)?.visible;
/** Both stores, as LayerService.toggleVisibility writes them. */
const write = (id: string, v: boolean) => {
  useLayerStore.setState({
    layers: useLayerStore.getState().layers.map((l) => (l.id === id ? { ...l, visible: v } : l)),
  });
  useViewStateStore.getState().setViewState((state) => {
    const layer = state.layers.find((l) => l.id === id);
    if (layer) layer.visible = v;
  });
};
/** A user toggle (the layer list / Visible switch path). */
const userSets = (id: string, v: boolean) => {
  noteUserVisibility(id);
  write(id, v);
};

describe('run visibility (round 3 C3, native R3-1)', () => {
  beforeEach(() => {
    resetRunVisibility();
    toggle.mockReset();
    toggle.mockImplementation((id: string, v: boolean) => write(id, v));
    useLayerStore.setState({
      layers: IDS.map((id, order) => ({
        id,
        name: id,
        volumeId: id,
        type: order ? 'functional' : 'anatomical',
        visible: true,
        order,
      })),
    } as never);
    useViewStateStore.getState().setViewState((state) => {
      state.layers = IDS.map((id) => ({
        id,
        name: id,
        volumeId: id,
        visible: true,
        opacity: 1,
        colormap: 'gray',
        intensity: [0, 1],
        threshold: [0, 0],
      })) as never;
    });
  });

  it('forms once: the focused run only, the anatomy under it hidden; two views hold it, the last to leave restores', () => {
    formRunGroup(group, 'r2');
    expect(IDS.map(drawn)).toEqual([false, false, true, false]);
    toggle.mockClear();
    formRunGroup(group, 'r2');
    expect(toggle).not.toHaveBeenCalled();
    restoreRunGroup(group.key);
    expect(toggle).not.toHaveBeenCalled();
    restoreRunGroup(group.key);
    expect(IDS.map(drawn)).toEqual([true, true, true, true]);
  });

  it('activating another run shows it and hides the previous one', () => {
    formRunGroup(group, 'r2');
    activateRun(group, 'r3', 'r2');
    expect(['r1', 'r2', 'r3'].map(drawn)).toEqual([false, false, true]);
  });

  it('a run re-shown by something other than the user (its load completing) is hidden again (native R3-1)', () => {
    formRunGroup(group, 'r1');
    write('r2', true); // e.g. run 2's load or GPU promotion finishing after the view hid it
    expect(drawn('r2')).toBe(false);
    activateRun(group, 'r3', 'r1');
    expect(['r1', 'r2', 'r3'].map(drawn)).toEqual([false, false, true]);
  });

  it('a run the user shows stays shown; a user-hidden focused run leaves the others alone', () => {
    formRunGroup(group, 'r2');
    userSets('r1', true);
    activateRun(group, 'r3', 'r2');
    activateRun(group, 'r2', 'r3');
    expect(drawn('r1')).toBe(true);
    userSets('r2', false);
    toggle.mockClear();
    activateRun(group, 'r2', 'r2');
    expect(toggle).not.toHaveBeenCalled();
  });

  it('a T1 the user showed is not hidden again by the next group (REVIEW m4)', () => {
    formRunGroup(group, 'r2');
    userSets('t1', true);
    restoreRunGroup(group.key);
    formRunGroup({ ...group, key: 'manual:r1,r2,r3', source: 'manual' }, 'r2');
    expect(drawn('t1')).toBe(true);
  });

  it('"This layer only" restores what the view changed and the user did not', () => {
    formRunGroup(group, 'r2');
    userSets('r3', true);
    restoreRunGroup(group.key);
    expect(IDS.map(drawn)).toEqual([true, true, true, true]);
  });
});
