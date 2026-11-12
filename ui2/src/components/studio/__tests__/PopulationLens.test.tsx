import { PopulationProbeController } from '@/services/studio/PopulationProbeController';
import { PopulationProbePanel } from '../PopulationProbePanel';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { usePopulationProbeDriver } from '../usePopulationProbeDriver';
import { PopulationLens } from '../PopulationLens';
import { PopulationInspector } from '../PopulationInspector';
import { populationLensMemory } from '../populationLensMemory';
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
    height,
  }: {
    onWorldClick: (world: number[]) => void;
    crosshairStyle: unknown;
    height: number;
  }) => (
    <button
      data-style={JSON.stringify(crosshairStyle)}
      data-height={height}
      onClick={() => onWorldClick([4, 5, 6])}
    >
      Pin image location
    </button>
  ),
  SliceViewerImageSurface: () => null,
  clientPointToWorld: vi.fn(),
}));
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  useSetStudioStore.getState().loadDemoSession();
  populationLensMemory.reset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function setup(probeController?: PopulationProbeController) {
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
    validCounts: Array(2).fill(
      request.aggregation?.groups.length ?? request.workingMemberIds.length,
    ),
    eligibleCount: request.workingMemberIds.length,
    unitCount: request.aggregation?.groups.length ?? request.workingMemberIds.length,
    sources: request.members.map((member) => ({
      memberId: member.memberId,
      revision: { sha256: 'hash', sourceBytes: 400 },
    })),
    cutouts: request.cutouts
      ? {
          plane: {
            origin_mm: request.cutouts.centerMm,
            u_mm: [1, 0, 0] as [number, number, number],
            v_mm: [0, 1, 0] as [number, number, number],
            dim_px: [request.cutouts.dimPx, request.cutouts.dimPx] as [number, number],
          },
          members: request.cutouts.memberIds.map((memberId) => ({
            memberId,
            values: Array(request.cutouts!.dimPx ** 2).fill(1),
            validPixels: request.cutouts!.dimPx ** 2,
          })),
        }
      : null,
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
      <PopulationLens service={service} probeController={probeController} />
      {probeController && <PopulationProbePanel controller={probeController} />}
    </StrictMode>,
  );
  return { evaluate, release, bitmaps, service, ...mounted };
}

/** C′: the Inspector (another GoldenLayout root) holds hold-to-preview and its unit. */
function inspector() {
  return render(<PopulationInspector />, {
    container: document.body.appendChild(document.createElement('div')),
  });
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
  inspector();
  await waitFor(() => expect(service.getSnapshot().displayed).not.toBeNull());
  const before = useSetStudioStore.getState();
  const button = screen.getByRole('button', {
    name: /^Group (mean|summary) without sub\d+ \(hold\)$/,
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
  // The right pane names the one subject it shows, by its ID.
  expect(screen.getByTestId('population-focused-subject')).toHaveTextContent(/^sub006$/);
  unmount();
  expect(release).toHaveBeenCalled();
  expect(bitmaps.every((image) => image.close.mock.calls.length === 1)).toBe(true);
});

it('opens synchronized cutouts at a pinned location and focuses without changing selection', async () => {
  const { service, evaluate } = setup();
  await waitFor(() => expect(service.getSnapshot().displayed).not.toBeNull());
  // C′: no silent pin. Cutouts wait for a pin (round 3: hidden until then,
  // never a disabled button on the row).
  expect(screen.queryByRole('button', { name: 'Cutouts' })).toBeNull();
  expect(useSetStudioStore.getState().population.pinnedProbe).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: 'Pin image location' })[0]);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Cutouts' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Cutouts' }));
  await screen.findByRole('button', { name: 'Focus cutout sub006' });
  // The group mean leads the strip.
  const strip = screen.getByTestId('population-summary-cutouts');
  expect(strip.querySelector('[data-testid="population-cutout-mean"]')).not.toBeNull();
  expect(strip.querySelector('.grid')!.firstElementChild).toHaveAttribute(
    'data-testid',
    'population-cutout-mean',
  );
  const before = useSetStudioStore.getState();
  expect(before.population.pinnedProbe).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Focus cutout sub006' }));
  expect(useSetStudioStore.getState().selection.activeMemberId).toBe('sub006');
  expect(useSetStudioStore.getState().population.working).toBe(before.population.working);
  await waitFor(() => expect(evaluate.mock.calls.at(-1)?.[0].focusMemberId).toBe('sub006'));
  fireEvent.click(screen.getByRole('button', { name: 'Center brain' }));
  await waitFor(() => expect(evaluate.mock.calls.at(-1)?.[0].crosshairMm).toEqual([10, 20, 30]));
  expect(evaluate.mock.calls.at(-1)?.[0].cutouts?.centerMm).toEqual(
    before.population.pinnedProbe!.worldMm,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Focus cutout sub001' }), { shiftKey: true });
  expect(useSetStudioStore.getState().selection.activeMemberId).toBe('sub006');
  fireEvent.click(screen.getByRole('button', { name: 'Cutouts' }));
  expect(screen.queryByRole('button', { name: 'Focus cutout sub006' })).toBeNull();
  expect(useSetStudioStore.getState().population.pinnedProbe).toBe(before.population.pinnedProbe);
});

it('shares regional response sampling between the full plot and the montage\'s value orders', async () => {
  const sample = vi.fn(async (request) => ({
    columns: [
      { name: 'member', role: 'nominal' as const },
      { name: 'value', role: 'quantitative' as const },
    ],
    rows: request.locus.members.map((member: { memberId: string }, i: number) => ({
      member: member.memberId,
      value: i === 1 ? null : 6 - i,
    })),
  }));
  const controller = new PopulationProbeController(sample, 0);
  const { service } = setup(controller);
  await waitFor(() => expect(service.getSnapshot().displayed).not.toBeNull());
  const before = useSetStudioStore.getState().population.working;
  // C′: the Summary cutouts' order buttons are gone; the montage's Sort orders by value.
  expect(screen.queryByRole('button', { name: 'Order by pinned response' })).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: 'Pin image location' })[0]);
  await waitFor(() => expect(sample).toHaveBeenCalledTimes(1));
  act(() =>
    useSetStudioStore.getState().setPopulationPresentation({
      ...useSetStudioStore.getState().population.presentation,
      arrangement: 'montage',
    }),
  );
  const tiles = () =>
    screen
      .getAllByRole('button', { name: /^Focus subject/ })
      .map((b) => b.getAttribute('aria-label')!.slice('Focus subject '.length));
  const sort = () => screen.getByRole('combobox', { name: 'Sort' });
  await waitFor(() => expect(sort().querySelector('option[value="crosshair"]')).not.toBeDisabled());
  fireEvent.change(sort(), { target: { value: 'crosshair' } });
  await waitFor(() =>
    expect(tiles()).toEqual(['sub006', 'sub005', 'sub004', 'sub003', 'sub001', 'sub002']),
  );
  fireEvent.change(sort(), { target: { value: 'witnesses' } });
  await waitFor(() => expect(tiles()).toHaveLength(5));
  fireEvent.click(screen.getByRole('button', { name: 'Focus subject sub006' }));
  expect(useSetStudioStore.getState().selection.activeMemberId).toBe('sub006');
  expect(useSetStudioStore.getState().population.working).toBe(before);
  fireEvent.change(sort(), { target: { value: 'source' } });
  await waitFor(() => expect(tiles()[0]).toBe('sub001'));
  expect(tiles()).toHaveLength(6);
  expect(sample).toHaveBeenCalledTimes(1);
});

it('sorted by value at the probe, the montage follows the probe live once its values settle (B3)', async () => {
  // The values depend on where the probe is: left of x = 40 they fall by
  // subject, right of it they rise.
  const sample = vi.fn(async (request) => ({
    columns: [
      { name: 'member', role: 'nominal' as const },
      { name: 'value', role: 'quantitative' as const },
    ],
    rows: request.locus.members.map((member: { memberId: string }, i: number) => ({
      member: member.memberId,
      value: request.locus.worldMm[0] > 40 ? i : 6 - i,
    })),
  }));
  const controller = new PopulationProbeController(sample, 0);
  const { service } = setup(controller);
  // The Studio samples whatever is pinned (or hovered) as it changes.
  renderHook(() => usePopulationProbeDriver(controller));
  await waitFor(() => expect(service.getSnapshot().displayed).not.toBeNull());
  fireEvent.click(screen.getAllByRole('button', { name: 'Pin image location' })[0]);
  await waitFor(() => expect(sample).toHaveBeenCalled());
  act(() =>
    useSetStudioStore.getState().setPopulationPresentation({
      ...useSetStudioStore.getState().population.presentation,
      arrangement: 'montage',
    }),
  );
  const tiles = () =>
    screen
      .getAllByRole('button', { name: /^Focus subject/ })
      .map((b) => b.getAttribute('aria-label')!.slice('Focus subject '.length));
  const sort = () => screen.getByRole('combobox', { name: 'Sort' });
  await waitFor(() => expect(sort().querySelector('option[value="crosshair"]')).not.toBeDisabled());
  fireEvent.change(sort(), { target: { value: 'crosshair' } });
  // Lowest value first: the subjects whose values fall come last-first.
  const source = ['sub001', 'sub002', 'sub003', 'sub004', 'sub005', 'sub006'];
  const falling = [...source].reverse();
  await waitFor(() => expect(tiles()).toEqual(falling));
  // The probe moves (a new pin; with Follow hover and no pin, the pointer):
  // the order is taken again from the new values, no Sort needed.
  const pinned = useSetStudioStore.getState().population.pinnedProbe!;
  act(() =>
    useSetStudioStore
      .getState()
      .setPopulationProbe({ ...pinned, worldMm: [50, pinned.worldMm[1], pinned.worldMm[2]] }, 'pin'),
  );
  await waitFor(() => expect(tiles()).toEqual(source));
  expect(sort()).toHaveValue('crosshair');
  // Another sort ends the live order: the probe moving changes nothing.
  fireEvent.change(sort(), { target: { value: 'source' } });
  await waitFor(() => expect(tiles()).toEqual(source));
  const calls = sample.mock.calls.length;
  act(() => useSetStudioStore.getState().setPopulationProbe(pinned, 'pin'));
  await waitFor(() => expect(sample.mock.calls.length).toBeGreaterThan(calls));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  expect(tiles()).toEqual(source);
  expect(useSetStudioStore.getState().population.presentation.order).toBeNull();
});

it('previews exclusion of all focused participant rows and restores participant summaries', async () => {
  const state = useSetStudioStore.getState();
  const set = state.sets[state.selection.activeSetId!];
  const people = ['A', 'A', 'A', 'B', 'C', 'C'];
  useSetStudioStore.setState({
    sets: {
      ...state.sets,
      [set.id]: {
        ...set,
        designTablePreview: {
          columns: ['participant'],
          rows: set.memberIds.map((id, i) => ({ id, cells: [people[i]] })),
        },
      },
    },
  });
  useSetStudioStore
    .getState()
    .configurePopulationParticipants({
      setId: set.id,
      identity: { kind: 'column', column: 'participant' },
      reduction: 'mean',
    });
  const { service } = setup();
  inspector();
  await screen.findByText('Group mean · 3 participants');
  const before = useSetStudioStore.getState();
  const button = screen.getByRole('button', {
    name: /^Group (mean|summary) without sub\d+'s participant \(hold\)$/,
  });
  fireEvent.keyDown(button, { key: ' ' });
  await waitFor(() =>
    expect(service.getSnapshot().displayed?.query.request.workingMemberIds).toEqual([
      'sub004',
      'sub005',
      'sub006',
    ]),
  );
  expect(screen.getByText('Group mean · 2 participants')).toBeVisible();
  expect(useSetStudioStore.getState().population.working).toBe(before.population.working);
  expect(useSetStudioStore.getState().selection).toBe(before.selection);
  fireEvent.keyUp(button, { key: ' ' });
  await screen.findByText('Group mean · 3 participants');
  expect(service.getSnapshot().displayed?.query.request.workingMemberIds).toEqual(set.memberIds);
});

it('shows a lens hold-to-preview in a values table mounted in a separate React root', async () => {
  const { service } = setup();
  const controller = new PopulationProbeController(
    vi.fn(async (request) => ({
      columns: [
        { name: 'member', role: 'nominal' as const },
        { name: 'value', role: 'quantitative' as const },
      ],
      rows: request.locus.members.map((member: { memberId: string }, i: number) => ({
        member: member.memberId,
        value: i + 1,
      })),
    })),
    0,
  );
  // GoldenLayout panels have separate roots; render the table into its own.
  const table = render(<PopulationProbePanel controller={controller} />, {
    container: document.body.appendChild(document.createElement('div')),
  });
  inspector();
  await waitFor(() => expect(service.getSnapshot().displayed).not.toBeNull());
  fireEvent.click(table.getByRole('button', { name: 'Pin crosshair' }));
  // C′: the observation table is the Values tab's Table view.
  fireEvent.click(await table.findByRole('radio', { name: 'Table' }));
  await table.findByRole('button', { name: 'sub003' });
  // C6: the hold control's caret chooses what is left out.
  fireEvent.click(screen.getByRole('button', { name: /^Leave out: / }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Set: Young controls' }));
  expect(useSetStudioStore.getState().populationPreview.target).toEqual({
    kind: 'set',
    cohortId: 'young-controls',
  });
  const button = screen.getByRole('button', {
    name: /^Group (mean|summary) without Young controls \(hold\)$/,
  });
  fireEvent.keyDown(button, { key: ' ' });
  await waitFor(() =>
    expect(service.getSnapshot().displayed?.query.request.workingMemberIds).not.toContain(
      'sub001',
    ),
  );
  const marked = () =>
    [...table.container.querySelectorAll('tr[data-preview="without"]')].map(
      (row) => row.querySelector('button')?.textContent,
    );
  expect(marked()).toEqual(['sub001', 'sub003']);
  fireEvent.keyUp(button, { key: ' ' });
  expect(marked()).toEqual([]);
  // Closing the lens while held never leaves a stale preview behind.
  fireEvent.keyDown(button, { key: ' ' });
  expect(useSetStudioStore.getState().populationPreview.holding).toBe(true);
  cleanup();
  expect(useSetStudioStore.getState().populationPreview.holding).toBe(false);
});

it('keeps the chosen summary when the lens is reopened in the same session (F44)', async () => {
  const first = setup();
  await waitFor(() => expect(first.service.getSnapshot().displayed).not.toBeNull());
  fireEvent.change(screen.getByRole('combobox', { name: 'Show' }), {
    target: { value: 'median' },
  });
  expect(screen.getByRole('combobox', { name: 'Show' })).toHaveValue('median');
  first.unmount();
  setup();
  expect(screen.getByRole('combobox', { name: 'Show' })).toHaveValue('median');
  cleanup();
  // A new session starts from the default again.
  useSetStudioStore.getState().loadDemoSession();
  setup();
  expect(screen.getByRole('combobox', { name: 'Show' })).toHaveValue('mean');
});

it('draws one colour bar per distinct scale: the shared bar below, a pane bar only for a scale of its own', async () => {
  const { service } = setup();
  await waitFor(() => expect(service.getSnapshot().displayed).not.toBeNull());
  // The mean and the observation share the scale: the footer's bar states it,
  // no bar inside the images and no range in the pane headers (round 3, C1).
  expect(screen.queryAllByTestId('population-colorbar')).toHaveLength(0);
  expect(screen.getByTestId('montage-scale-bar')).toBeInTheDocument();
  expect(screen.getByTestId('population-scale-summary')).not.toHaveTextContent(/ to /);
  const bars = () => screen.getAllByTestId('population-colorbar');
  fireEvent.change(screen.getByRole('combobox', { name: 'Show' }), {
    target: { value: 'coverage' },
  });
  // Coverage is on a scale of its own: its pane carries that one bar.
  await waitFor(() => expect(bars()).toHaveLength(1));
  expect(bars()[0].dataset.diverging).toBe('false');
  expect(bars()[0].getAttribute('aria-label')).toMatch(/^Colorbar for Coverage: gold, 0 to /);
});

it('swaps the left/right letters of an axial pane under the radiological convention', async () => {
  const { useViewDisplaySettingsStore } = await import('@/stores/viewDisplaySettingsStore');
  const sideLetters = () =>
    Array.from(document.querySelectorAll('span.absolute.top-1\\/2')).map((el) => el.textContent);
  const { service } = setup();
  await waitFor(() => expect(service.getSnapshot().displayed).not.toBeNull());
  // Neurological: the patient's left on the screen's left.
  await waitFor(() => expect(sideLetters().slice(0, 2)).toEqual(['L', 'R']));
  act(() => useViewDisplaySettingsStore.getState().setRadiological(true));
  try {
    await waitFor(() => expect(sideLetters().slice(0, 2)).toEqual(['R', 'L']));
  } finally {
    act(() => useViewDisplaySettingsStore.getState().setRadiological(false));
  }
});

it('↑ over the Mean map steps the population slice, not another workspace (QA N9, F44)', async () => {
  const { getKeyboardShortcutService } = await import('@/services/KeyboardShortcutService');
  const keys = getKeyboardShortcutService();
  keys.init();
  try {
    const { service } = setup();
    await waitFor(() => expect(service.getSnapshot().displayed).not.toBeNull());
    const before = [...useViewStateStore.getState().viewState.crosshair.world_mm];
    const host = screen.getAllByRole('button', { name: 'Pin image location' })[0].closest('.grid')!
      .parentElement!;
    // jsdom has no layout: the maps are on screen.
    vi.spyOn(host as HTMLElement, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    fireEvent.mouseEnter(host);
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    // The fixture plane is u = x, v = y: the population slice axis is z.
    const after = useViewStateStore.getState().viewState.crosshair.world_mm;
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(Math.abs(after[2] - before[2])).toBeCloseTo(2);
  } finally {
    keys.destroy();
  }
});

it('a lens left behind another tab requests nothing and moves no other workspace (F44)', async () => {
  const { useWorkspaceStore } = await import('@/stores/workspaceStore');
  const previous = useWorkspaceStore.getState();
  useWorkspaceStore.setState({
    workspaces: new Map([['studio-tab', { id: 'studio-tab', type: 'set-studio' } as never]]),
    activeWorkspaceId: 'elsewhere',
  } as never);
  try {
    const before = [...useViewStateStore.getState().viewState.crosshair.world_mm];
    const { evaluate } = setup();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(evaluate).not.toHaveBeenCalled();
    expect(useViewStateStore.getState().viewState.crosshair.world_mm).toEqual(before);
  } finally {
    useWorkspaceStore.setState(previous, true);
  }
});

it('puts its controls in the Studio toolbar and fills the visible height, never below 240 px (N13)', async () => {
  const { StudioToolbarSlotContext, StudioViewportHeightContext } = await import('../studioToolbarSlots');
  const slot = document.createElement('div');
  document.body.appendChild(slot);
  const service = new PopulationSliceService(
    { evaluate: vi.fn(() => new Promise(() => {})), release: vi.fn(), bitmap: vi.fn() } as never,
    0,
  );
  const lens = (height: number) => (
    <StudioToolbarSlotContext.Provider value={slot}>
      <StudioViewportHeightContext.Provider value={height}>
        <PopulationLens service={service} />
      </StudioViewportHeightContext.Provider>
    </StudioToolbarSlotContext.Provider>
  );
  const { rerender } = render(lens(500));
  // The summary (Show), plane and Save calculation live in the toolbar row…
  expect(slot.querySelector('[aria-label="Population controls"]')).not.toBeNull();
  expect(slot.textContent).toContain('Save calculation');
  expect(slot.querySelector('select[aria-label="Show"]')).not.toBeNull();
  // …and each map takes the visible height under it, less 100 px of chrome
  // (C′: the one footer line below the maps is part of it).
  const heights = () =>
    screen.getAllByRole('button', { name: 'Pin image location' }).map((b) => b.dataset.height);
  expect(heights()).toEqual(['400', '400']);
  rerender(lens(200));
  expect(heights()).toEqual(['240', '240']);
  slot.remove();
});
