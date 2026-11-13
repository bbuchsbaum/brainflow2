import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { PopulationLens, MONTAGE_LIVE_ORDER_SETTLE_MS } from '../PopulationLens';
import { populationLensMemory } from '../populationLensMemory';
import { usePopulationProbeDriver } from '../usePopulationProbeDriver';
import {
  PopulationSliceService,
  type PopulationSliceRequest,
} from '@/services/studio/PopulationSliceService';
import {
  PopulationProbeController,
  populationSupportKey,
} from '@/services/studio/PopulationProbeController';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { usePopulationViewStore } from '@/stores/populationViewStore';

/**
 * B3, "sort by what's here": sorted by the value at the pin, with nothing
 * pinned and Follow hover on, the montage follows the pointer's values.
 */

vi.mock('@/components/views/sliceViewer', () => ({
  ReusableSliceViewport: () => null,
  SliceViewerImageSurface: () => null,
  clientPointToWorld: vi.fn(),
  sliceImagePointToWorld: () => [0, 0, 0],
}));

const IDS = ['sub001', 'sub002', 'sub003', 'sub004', 'sub005', 'sub006'];
const REVERSED = [...IDS].reverse();
/** The image's own in-plane resolution the sampler reports (undefined: unknown). */
const native: { dim: number | undefined } = { dim: undefined };

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  useSetStudioStore.getState().loadDemoSession();
  populationLensMemory.reset();
  usePopulationViewStore.getState().setFollowHover(true);
  native.dim = undefined;
  const state = useSetStudioStore.getState();
  state.setPopulationPresentation({ ...state.population.presentation, arrangement: 'montage' });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function sampledDim(cutouts: { dimPx: number; memberIds: string[] }) {
  if (cutouts.dimPx > 0) return cutouts.dimPx;
  const fits = Math.floor(Math.sqrt((1 << 20) / Math.max(1, cutouts.memberIds.length)));
  return Math.max(1, Math.min(native.dim ?? 64, 256, fits));
}

function setup() {
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
    validCounts: Array(2).fill(request.workingMemberIds.length),
    eligibleCount: request.workingMemberIds.length,
    unitCount: request.workingMemberIds.length,
    sources: request.members.map((member) => ({
      memberId: member.memberId,
      revision: { sha256: 'hash', sourceBytes: 400 },
    })),
    reference: null,
    cutouts: request.cutouts
      ? {
          nativeDimPx: native.dim,
          plane: {
            origin_mm: request.cutouts.centerMm,
            u_mm: [1, 0, 0] as [number, number, number],
            v_mm: [0, 1, 0] as [number, number, number],
            dim_px: [sampledDim(request.cutouts), sampledDim(request.cutouts)] as [number, number],
          },
          members: request.cutouts.memberIds.map((memberId) => ({
            memberId,
            values: Array(sampledDim(request.cutouts!) ** 2).fill(1),
            validPixels: sampledDim(request.cutouts!) ** 2,
          })),
        }
      : null,
    sourceCacheHit: true,
    cachedBytes: 120,
    sampling: 'nearest' as const,
  }));
  const service = new PopulationSliceService(
    {
      evaluate,
      release: vi.fn().mockResolvedValue(undefined),
      bitmap: async () => ({ width: 2, height: 1, close: vi.fn() }) as unknown as ImageBitmap,
    },
    0,
  );
  // Left of x = 40 the values rise with the subject's place in the set; right
  // of it they fall.
  const sample = vi.fn(async (request) => ({
    columns: [
      { name: 'member', role: 'nominal' as const },
      { name: 'value', role: 'quantitative' as const },
    ],
    rows: request.locus.members.map((member: { memberId: string }, i: number) => ({
      member: member.memberId,
      value: request.locus.worldMm[0] > 40 ? -i : i,
    })),
  }));
  const controller = new PopulationProbeController(sample, 0);
  render(<PopulationLens service={service} probeController={controller} />);
  // The Studio samples whatever is pinned (or hovered) as it changes.
  renderHook(() => usePopulationProbeDriver(controller));
  return { evaluate, service, controller, sample };
}

const tiles = () =>
  screen.getAllByRole('button', { name: /^Focus subject/ }).map((b) => b.dataset.datumId);
const sort = () => screen.getByRole('combobox', { name: 'Sort' });
const montage = () => screen.getByRole('region', { name: 'Montage of subjects' });
const sentTiles = (evaluate: ReturnType<typeof setup>['evaluate']) =>
  evaluate.mock.calls.filter(([request]) => request.cutouts?.memberIds.length);
const rest = (ms = 300) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

function probeAt(x: number) {
  const state = useSetStudioStore.getState();
  return {
    supportKey: populationSupportKey(state, useViewStateStore.getState().activeWorkspaceKey),
    worldMm: [x, 0, 0] as [number, number, number],
    radiusMm: 0,
    reduce: 'mean' as const,
  };
}
/** The pointer over a map elsewhere (Summary, the similarity map, the Deck). */
const hoverAt = (x: number) =>
  act(() => {
    useSetStudioStore.getState().setPopulationProbe(probeAt(x), 'hover');
  });
const valuesShownAt = async (controller: PopulationProbeController, x: number) =>
  waitFor(() => {
    const snapshot = controller.getSnapshot();
    expect(snapshot.pending).toBe(false);
    expect(snapshot.displayed?.query.probe.worldMm[0]).toBe(x);
  });

/** Sort = Value at pin while the pointer (nothing pinned) is at `x`. */
async function sortAtPointer(x: number) {
  hoverAt(x);
  await waitFor(() => expect(sort().querySelector('option[value="crosshair"]')).not.toBeDisabled());
  fireEvent.change(sort(), { target: { value: 'crosshair' } });
}

it('with nothing pinned, Value at pin orders by the pointer\'s values and never waits for a pin', async () => {
  const { controller } = setup();
  await waitFor(() => expect(tiles()).toEqual(IDS));
  expect(useSetStudioStore.getState().population.pinnedProbe).toBeNull();
  await sortAtPointer(50);
  // The choice is taken as soon as the pointer's values are in: no pending state.
  await waitFor(() => expect(tiles()).toEqual(REVERSED));
  expect(sort()).toHaveValue('crosshair');
  expect(within(montage()).getByRole('status')).not.toHaveTextContent(/computing/);
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  expect(useSetStudioStore.getState().population.presentation.order?.probe?.worldMm[0]).toBe(50);
  // The pointer moves: once the new values are in and have rested, the tiles
  // follow them; until then they hold still.
  hoverAt(10);
  await valuesShownAt(controller, 10);
  expect(tiles()).toEqual(REVERSED);
  await waitFor(() => expect(tiles()).toEqual(IDS));
  expect(sort()).toHaveValue('crosshair');
  expect(within(montage()).getByRole('status')).toHaveTextContent(/follows the pointer/);
  // The pointer's order is the screen's, not a saved one.
  expect(useSetStudioStore.getState().population.presentation.order?.probe?.worldMm[0]).toBe(50);
  expect(usePopulationViewStore.getState().lensOrder?.ids).toEqual(IDS);
  // Another sort ends it: the pointer moving changes nothing.
  fireEvent.change(sort(), { target: { value: 'source' } });
  await waitFor(() => expect(tiles()).toEqual(IDS));
  hoverAt(60);
  await valuesShownAt(controller, 60);
  await rest();
  expect(tiles()).toEqual(IDS);
});

it('never reorders while the pointer is over the tiles', async () => {
  const { controller } = setup();
  await waitFor(() => expect(tiles()).toEqual(IDS));
  await sortAtPointer(50);
  await waitFor(() => expect(tiles()).toEqual(REVERSED));
  const area = screen.getByTestId('montage-tiles-area');
  // Values for a point elsewhere that settle once the pointer is over the
  // tiles reorder nothing: tiles never move under the pointer.
  hoverAt(10);
  fireEvent.pointerEnter(area);
  await valuesShownAt(controller, 10);
  await rest();
  expect(tiles()).toEqual(REVERSED);
  // Over the tiles, a tile hovered moves the probe: the values follow, the tiles do not.
  hoverAt(12);
  await valuesShownAt(controller, 12);
  await rest();
  expect(tiles()).toEqual(REVERSED);
  // A point hovered on the tiles whose values settle only after the pointer
  // has left them is still the tiles' own: it reorders nothing either…
  hoverAt(14);
  fireEvent.pointerLeave(area);
  await valuesShownAt(controller, 14);
  await rest();
  expect(tiles()).toEqual(REVERSED);
  // …the next point the pointer reaches elsewhere does.
  await rest(MONTAGE_LIVE_ORDER_SETTLE_MS);
  hoverAt(16);
  await valuesShownAt(controller, 16);
  await waitFor(() => expect(tiles()).toEqual(IDS));
});

it('a pin wins: the pointer reorders nothing while a point is pinned', async () => {
  const { controller } = setup();
  await waitFor(() => expect(tiles()).toEqual(IDS));
  await sortAtPointer(50);
  await waitFor(() => expect(tiles()).toEqual(REVERSED));
  // A pin re-sorts the whole set at the pin, and saves that order.
  act(() => {
    useSetStudioStore.getState().setPopulationProbe(probeAt(10), 'pin');
  });
  await waitFor(() => expect(tiles()).toEqual(IDS));
  await waitFor(() =>
    expect(useSetStudioStore.getState().population.presentation.order?.probe?.worldMm[0]).toBe(10),
  );
  // The pointer moving under a pin changes nothing.
  hoverAt(50);
  await rest();
  expect(tiles()).toEqual(IDS);
  expect(controller.getSnapshot().displayed?.query.probe.worldMm[0]).toBe(10);
  // Unpinned, the pointer is the probe again: the tiles follow it, unsaved.
  act(() => {
    useSetStudioStore.getState().setPopulationProbe(null, 'pin');
  });
  await valuesShownAt(controller, 50);
  await waitFor(() => expect(tiles()).toEqual(REVERSED));
  expect(useSetStudioStore.getState().population.presentation.order?.probe?.worldMm[0]).toBe(10);
});

it('across pages, the pointer reorders only the page on screen and asks for no images', async () => {
  // A 1 mm slice: pages of 16 subjects.
  native.dim = 256;
  const ids = Array.from({ length: 40 }, (_, i) => `s${String(i + 1).padStart(3, '0')}`);
  const state = useSetStudioStore.getState();
  const set = state.sets[state.selection.activeSetId!];
  useSetStudioStore.setState({
    sets: {
      ...state.sets,
      [set.id]: {
        ...set,
        memberIds: ids,
        memberCount: ids.length,
        memberSummaries: ids.map((id) => ({ id, sourcePath: `/demo/${id}.nii.gz` })),
        designTablePreview: undefined,
      } as typeof set,
    },
    selection: { ...state.selection, activeMemberId: ids[0] },
  });
  const { evaluate, controller } = setup();
  await waitFor(() => expect(tiles()).toEqual(ids.slice(0, 16)), { timeout: 8000 });
  await sortAtPointer(10);
  await waitFor(() =>
    expect(useSetStudioStore.getState().population.presentation.order?.rule).toBe('response'),
  );
  await waitFor(() => expect(tiles()).toEqual(ids.slice(0, 16)));
  await rest();
  const sent = sentTiles(evaluate).length;
  hoverAt(50);
  await valuesShownAt(controller, 50);
  // Page 1 in falling order: its own subjects, not the set's highest.
  await waitFor(() => expect(tiles()).toEqual(ids.slice(0, 16).reverse()));
  expect(within(montage()).getByRole('status')).toHaveTextContent(/this page follows the pointer/);
  await rest();
  expect(sentTiles(evaluate)).toHaveLength(sent);
  expect(evaluate.mock.calls.at(-1)?.[0].cutouts?.memberIds).toEqual(ids.slice(0, 16));
  // The next page is in the pointer's order as it opens.
  fireEvent.click(within(montage()).getByRole('button', { name: 'Next page' }));
  await waitFor(() => expect(tiles()).toEqual(ids.slice(16, 32).reverse()), { timeout: 8000 });
}, 30000);
