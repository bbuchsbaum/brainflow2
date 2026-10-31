import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const source = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/services/studio/PopulationProbeController', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  buildPopulationSource: () => source.value,
}));

import { StudioDesignPanel } from '../StudioDesignPanel';
import { useSetStudioStore } from '@/stores/setStudioStore';
import {
  DISTANCE_TO_MEAN_SORT,
  getStudioMeanDistanceService,
  meanDistanceKey,
} from '@/services/studio/StudioMeanDistanceService';

beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  useSetStudioStore.getState().loadDemoSession();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('keys the distances by the members actually measured, not by the whole list', () => {
  const state = useSetStudioStore.getState();
  const listed = state.sets[state.selection.activeSetId!].memberIds;
  // Only two listed members have a usable source.
  const sent = listed.slice(0, 2).map((memberId) => ({ memberId, sourcePath: `/m/${memberId}.nii` }));
  source.value = { source: { members: sent, mask: null }, issue: null };
  const request = vi.spyOn(getStudioMeanDistanceService(), 'request').mockImplementation(() => {});
  useSetStudioStore.getState().setSortColumn(DISTANCE_TO_MEAN_SORT);
  render(<StudioDesignPanel />);
  expect(request).toHaveBeenCalledTimes(1);
  const args = request.mock.calls[0][0];
  expect(args.members).toEqual(sent);
  expect(args.key).toBe(
    meanDistanceKey(state.selection.activeSetId, state.selection.activeFeatureId, null, [
      sent[0].memberId,
      sent[1].memberId,
    ]),
  );
  expect(args.listSize).toBeGreaterThan(sent.length);
  expect(args.listKey).not.toBe(args.key);
});
