import { afterEach, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/services/transport', () => ({ getTransport: () => transport }));

import {
  POPULATION_SLICES_UNAVAILABLE,
  PopulationSliceService,
  type PopulationSliceQuery,
} from '../PopulationSliceService';

afterEach(() => vi.useRealTimers());

const query: PopulationSliceQuery = {
  key: 'q',
  datasetKey: 'd',
  request: {
    contextKey: 'd',
    members: [
      { memberId: 'a', sourcePath: '/a.nii' },
      { memberId: 'b', sourcePath: '/b.nii' },
    ],
    workingMemberIds: ['a', 'b'],
    focusMemberId: 'a',
    crosshairMm: [0, 0, 0],
    orientation: 'axial',
    dimPx: [2, 1],
    zoom: 1,
    summary: 'mean',
  },
};

it('the native dependency turns a null evaluate answer into "unavailable" (review M4)', async () => {
  vi.useFakeTimers();
  transport.invoke.mockResolvedValue(null);
  const service = new PopulationSliceService(undefined, 0);
  service.start();
  service.request(query);
  await vi.runAllTimersAsync();
  expect(transport.invoke).toHaveBeenCalledWith('evaluate_population_slice', expect.anything());
  expect(service.getSnapshot().error).toBe(POPULATION_SLICES_UNAVAILABLE);
  service.stop();
});
