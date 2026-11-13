import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { PopulationProbePanel } from '../PopulationProbePanel';
import { PopulationProbeController } from '@/services/studio/PopulationProbeController';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { usePopulationViewStore } from '@/stores/populationViewStore';
import { useMouseCoordinateStore } from '@/stores/mouseCoordinateStore';
import { setVoxelGridReferenceProvider } from '@/utils/voxelSnap';
import type { SampleFrame, SampleRequest } from '@/plotting';

vi.mock('@/services/SampleProvider', () => ({ sampleProvider: { sample: vi.fn() } }));
vi.mock('@/services/transport', () => ({ getTransport: () => ({ invoke: vi.fn() }) }));

/** A 2 mm grid whose voxel centres are the even millimetres (column-major 4×4). */
const GRID = {
  layerId: 'grid',
  name: 'grid',
  voxelToWorld: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1],
  worldToVoxel: [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1],
  dims: null,
};

beforeEach(() => {
  setVoxelGridReferenceProvider(() => GRID);
  useMouseCoordinateStore.getState().clearMousePosition();
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  useSetStudioStore.getState().loadDemoSession();
  useSetStudioStore.getState().setActiveLens('population');
  usePopulationViewStore.setState({ followHover: true, lensOrder: null, valuesDockHeight: null });
});
afterEach(() => {
  cleanup();
  setVoxelGridReferenceProvider(null);
});

it('at the pointer, the Values title reads the status bar\'s coordinates while the pointer is in the sampled voxel', async () => {
  const sample = vi.fn(
    async (request: SampleRequest): Promise<SampleFrame> => ({
      columns: [
        { name: 'member', role: 'nominal' },
        { name: 'value', role: 'quantitative' },
      ],
      rows:
        request.locus.kind === 'set'
          ? request.locus.members.map((member, i) => ({ member: member.memberId, value: i + 1 }))
          : [],
    }),
  );
  render(<PopulationProbePanel controller={new PopulationProbeController(sample, 0)} />);
  act(() => useMouseCoordinateStore.getState().setMousePosition([14.4, -69.1, -6.5], 'axial'));
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
  const title = await screen.findByText(/ · pointer · /, { selector: '[data-testid="population-plot-title"]' });
  // The probe sampled the voxel centred at (14, −70, −6); the title says where the pointer is, as the status bar does.
  expect(screen.getByTestId('values-pointer-coordinates')).toHaveTextContent('14.4, −69.1, −6.5');
  // Screen readers hear the sampled voxel.
  expect(title.querySelector('.sr-only')).toHaveTextContent('14.0, −70.0, −6.0');
});
