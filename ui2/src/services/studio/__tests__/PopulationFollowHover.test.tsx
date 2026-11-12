import { afterEach, beforeEach, expect, it } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { populationProbeActions } from '../PopulationProbeActions';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useSetStudioState } from '@/stores/setStudio/useSetStudioState';
import { useMouseCoordinateStore } from '@/stores/mouseCoordinateStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { setVoxelGridReferenceProvider } from '@/utils/voxelSnap';
import { useInferenceDraft } from '@/components/studio/inferenceDraft';

// A 2 mm grid: voxel i is centred on 2i mm.
const GRID = {
  layerId: 'grid',
  name: 'grid',
  voxelToWorld: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1],
  worldToVoxel: [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1],
  dims: [64, 64, 64] as [number, number, number],
};
const frame = () =>
  act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
const move = (x: number, y = 20.2, z = 30.1) =>
  act(() => useMouseCoordinateStore.getState().setMousePosition([x, y, z], 'axial'));

let stop: (() => void) | null = null;
let writes = 0;
let unsubscribe: (() => void) | null = null;
beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  useSetStudioStore.getState().loadDemoSession();
  setVoxelGridReferenceProvider(() => GRID);
  writes = 0;
  unsubscribe = useSetStudioStore.subscribe((now, before) => {
    if (now.population.hoverProbe !== before.population.hoverProbe) writes += 1;
  });
  stop = populationProbeActions.followHover(0, useViewStateStore.getState().activeWorkspaceKey);
});
afterEach(() => {
  stop?.();
  unsubscribe?.();
  setVoxelGridReferenceProvider(null);
  useMouseCoordinateStore.getState().clearMousePosition();
  cleanup();
});

it('Follow hover writes the probe once per voxel, at the voxel centre', async () => {
  // 40 sub-voxel moves inside voxel (5, 10, 15), spread over many frames.
  for (let i = 0; i < 40; i++) {
    move(9.1 + i * 0.04);
    if (i % 4 === 0) await frame();
  }
  await frame();
  expect(writes).toBe(1);
  expect(useSetStudioStore.getState().population.hoverProbe?.worldMm).toEqual([10, 20, 30]);
  // Into the next voxel: one more write.
  move(11.2);
  await frame();
  expect(writes).toBe(2);
  expect(useSetStudioStore.getState().population.hoverProbe?.worldMm).toEqual([12, 20, 30]);
});

it('Follow hover writes at most once per frame plus the last move of that frame', async () => {
  await frame();
  // Eight voxels crossed within one frame: the first at once, the last when the frame comes.
  for (let i = 0; i < 8; i++) move(2 * i);
  expect(writes).toBe(1);
  expect(useSetStudioStore.getState().population.hoverProbe?.worldMm).toEqual([0, 20, 30]);
  await frame();
  expect(writes).toBe(2);
  expect(useSetStudioStore.getState().population.hoverProbe?.worldMm).toEqual([14, 20, 30]);
  // A quiet frame later, the next move is written at once again; once
  // disposed, a pending move is dropped and nothing more is written.
  await frame();
  move(40);
  move(42);
  stop?.();
  stop = null;
  await frame();
  expect(useSetStudioStore.getState().population.hoverProbe?.worldMm).toEqual([40, 20, 30]);
});

it('wide readers and the inference draft do not re-render for a hover probe moving under a pin', async () => {
  move(4);
  await frame();
  act(() => {
    populationProbeActions.pin(0, false);
  });
  expect(useSetStudioStore.getState().population.pinnedProbe).not.toBeNull();
  let wide = 0;
  function Wide() {
    useSetStudioState();
    wide += 1;
    return null;
  }
  render(<Wide />);
  let drafts = 0;
  renderHook(() => {
    drafts += 1;
    return useInferenceDraft();
  });
  const [wideBefore, draftsBefore, writesBefore] = [wide, drafts, writes];
  // Twelve voxels crossed, a frame apart: twelve hover writes.
  for (let i = 0; i < 12; i++) {
    move(20 + 2 * i);
    await frame();
  }
  expect(writes - writesBefore).toBe(12);
  expect(wide).toBe(wideBefore);
  expect(drafts).toBe(draftsBefore);
  // Anything else still re-renders the wide reader; unpinned, the hover is the probe.
  act(() => populationProbeActions.unpin());
  expect(wide).toBeGreaterThan(wideBefore);
  const unpinned = wide;
  move(80);
  await frame();
  expect(wide).toBeGreaterThan(unpinned);
  expect(drafts).toBe(draftsBefore);
});
