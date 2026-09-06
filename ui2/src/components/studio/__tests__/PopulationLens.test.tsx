import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PopulationLens } from '../PopulationLens';
import {
  PopulationSliceService,
  type PopulationSliceRequest,
} from '@/services/studio/PopulationSliceService';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useViewStateStore } from '@/stores/viewStateStore';

vi.mock('@/components/views/sliceViewer', () => ({
  ReusableSliceViewport: ({
    onWorldClick,
    crosshairStyle,
  }: {
    onWorldClick: (world: number[]) => void;
    crosshairStyle: unknown;
  }) => (
    <button data-style={JSON.stringify(crosshairStyle)} onClick={() => onWorldClick([4, 5, 6])}>
      Pin image location
    </button>
  ),
  SliceViewerImageSurface: () => null,
  clientPointToWorld: vi.fn(),
}));
beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  useSetStudioStore.getState().loadDemoSession();
});
afterEach(cleanup);
function setup() {
  const bitmaps: { close: ReturnType<typeof vi.fn> }[] = [];
  const evaluate = vi.fn(async (request: PopulationSliceRequest) => ({
    plane: {
      origin_mm: [0, 0, 0] as [number, number, number],
      u_mm: [1, 0, 0] as [number, number, number],
      v_mm: [0, 1, 0] as [number, number, number],
      dim_px: [2, 1] as [number, number],
    },
    centerWorld: [10, 20, 30] as [number, number, number],
    contextRange: [-2, 4] as [number, number],
    summary: [1, 2],
    focused: [2, 3],
    validCounts: [request.workingMemberIds.length, request.workingMemberIds.length],
    eligibleCount: request.workingMemberIds.length,
    sources: request.members.map((member) => ({
      memberId: member.memberId,
      revision: { sha256: 'hash', sourceBytes: 400 },
    })),
    sourceCacheHit: true,
    cachedBytes: 120,
    sampling: 'nearest' as const,
  }));
  const release = vi.fn().mockResolvedValue(undefined);
  const service = new PopulationSliceService(
    {
      evaluate,
      release,
      bitmap: async () => {
        const image = { width: 2, height: 1, close: vi.fn() };
        bitmaps.push(image);
        return image as unknown as ImageBitmap;
      },
    },
    0,
  );
  const mounted = render(
    <StrictMode>
      <PopulationLens service={service} />
    </StrictMode>,
  );
  return { evaluate, release, bitmaps, service, ...mounted };
}

it('links both views to the canonical crosshair and probe without changing membership', async () => {
  const { service } = setup();
  await waitFor(() => expect(service.getSnapshot().displayed).not.toBeNull());
  const working = useSetStudioStore.getState().population.working;
  fireEvent.click(screen.getAllByRole('button', { name: 'Pin image location' })[1]);
  expect(useViewStateStore.getState().viewState.crosshair.world_mm).toEqual([4, 5, 6]);
  expect(useSetStudioStore.getState().population.pinnedProbe?.worldMm).toEqual([4, 5, 6]);
  expect(useSetStudioStore.getState().population.working).toBe(working);
  await waitFor(() =>
    expect(service.getSnapshot().displayed?.query.request.crosshairMm).toEqual([4, 5, 6]),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Center brain' }));
  expect(useViewStateStore.getState().viewState.crosshair.world_mm).toEqual([10, 20, 30]);
  expect(useSetStudioStore.getState().population.pinnedProbe?.worldMm).toEqual([4, 5, 6]);
});

it('temporarily removes the focused observation and restores the original selection on release', async () => {
  const { service, evaluate } = setup();
  await waitFor(() => expect(service.getSnapshot().displayed).not.toBeNull());
  const before = useSetStudioStore.getState();
  const button = screen.getByRole('button', {
    name: 'Hold to preview without focused observation',
  });
  fireEvent.keyDown(button, { key: ' ' });
  await waitFor(() =>
    expect(evaluate.mock.calls.at(-1)?.[0].workingMemberIds).not.toContain(
      before.selection.activeMemberId,
    ),
  );
  expect(useSetStudioStore.getState().population.working).toBe(before.population.working);
  fireEvent.keyUp(button, { key: ' ' });
  await waitFor(() =>
    expect(evaluate.mock.calls.at(-1)?.[0].workingMemberIds).toContain(
      before.selection.activeMemberId,
    ),
  );
  expect(useSetStudioStore.getState().population.working).toBe(before.population.working);
});

it('updates focused source from shared state and releases images when closed', async () => {
  const { service, bitmaps, unmount, release } = setup();
  await waitFor(() => expect(service.getSnapshot().displayed).not.toBeNull());
  act(() => useSetStudioStore.getState().setActiveMember('sub006'));
  await waitFor(() =>
    expect(service.getSnapshot().displayed?.query.request.focusMemberId).toBe('sub006'),
  );
  expect(screen.getByText('Actual observation · sub006')).toBeInTheDocument();
  unmount();
  expect(release).toHaveBeenCalled();
  expect(bitmaps.every((image) => image.close.mock.calls.length === 1)).toBe(true);
});
