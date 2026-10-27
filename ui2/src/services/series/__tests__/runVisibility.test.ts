import { beforeEach, describe, expect, it, vi } from 'vitest';

const toggle = vi.fn();
vi.mock('@/services/LayerService', () => ({
  getLayerService: () => ({ toggleVisibility: toggle }),
}));

import { useLayerStore } from '@/stores/layerStore';
import { activateRun, formRunGroup, resetRunVisibility, restoreRunGroup } from '../runVisibility';
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

const visible = (id: string) => useLayerStore.getState().layers.find((l) => l.id === id)!.visible;
const setVisible = (id: string, v: boolean) =>
  useLayerStore.setState({
    layers: useLayerStore.getState().layers.map((l) => (l.id === id ? { ...l, visible: v } : l)),
  });

describe('run visibility (round 3 C3)', () => {
  beforeEach(() => {
    resetRunVisibility();
    toggle.mockReset();
    // The service applies a toggle to the store, as LayerService does.
    toggle.mockImplementation((id: string, v: boolean) => setVisible(id, v));
    useLayerStore.setState({
      layers: [
        { id: 't1', name: 'T1', volumeId: 't1', type: 'anatomical', visible: true, order: 0 },
        { id: 'r1', name: 'run 1', volumeId: 'r1', type: 'functional', visible: true, order: 1 },
        { id: 'r2', name: 'run 2', volumeId: 'r2', type: 'functional', visible: true, order: 2 },
        { id: 'r3', name: 'run 3', volumeId: 'r3', type: 'functional', visible: true, order: 3 },
      ],
    } as never);
  });

  it('forms once: the focused run only, the anatomy under it hidden; a second call changes nothing', () => {
    formRunGroup(group, 'r2');
    expect(['t1', 'r1', 'r2', 'r3'].map(visible)).toEqual([false, false, true, false]);
    toggle.mockClear();
    formRunGroup(group, 'r2');
    expect(toggle).not.toHaveBeenCalled();
    // Two views hold the group: the first to leave restores nothing.
    restoreRunGroup(group.key);
    expect(toggle).not.toHaveBeenCalled();
    restoreRunGroup(group.key);
    expect(['t1', 'r1', 'r2', 'r3'].map(visible)).toEqual([true, true, true, true]);
  });

  it('activating another run shows it and hides the previous one', () => {
    formRunGroup(group, 'r2');
    activateRun(group, 'r3', 'r2');
    expect(['r1', 'r2', 'r3'].map(visible)).toEqual([false, false, true]);
  });

  it('never re-hides a run the user turned on; a user-hidden focused run leaves the others alone', () => {
    formRunGroup(group, 'r2');
    setVisible('r1', true); // the user shows run 1 by hand
    activateRun(group, 'r3', 'r2');
    activateRun(group, 'r2', 'r3');
    expect(visible('r1')).toBe(true);
    setVisible('r2', false); // the user hides the focused run
    toggle.mockClear();
    activateRun(group, 'r2', 'r2');
    expect(toggle).not.toHaveBeenCalled();
  });

  it('a T1 the user showed is not hidden again by the next group (REVIEW m4)', () => {
    formRunGroup(group, 'r2');
    setVisible('t1', true); // the user shows the anatomy
    restoreRunGroup(group.key);
    formRunGroup({ ...group, key: 'manual:r1,r2,r3', source: 'manual' }, 'r2');
    expect(visible('t1')).toBe(true);
  });

  it('"This layer only" restores what the view changed and the user did not', () => {
    formRunGroup(group, 'r2');
    setVisible('r3', true); // the user's own choice stays
    restoreRunGroup(group.key);
    expect(['t1', 'r1', 'r2', 'r3'].map(visible)).toEqual([true, true, true, true]);
  });
});
