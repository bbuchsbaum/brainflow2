import { PopulationProbeController } from '@/services/studio/PopulationProbeController';
import { PopulationProbePanel } from '../PopulationProbePanel';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PopulationLens } from '../PopulationLens';
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

it('opens synchronized cutouts at a pinned location and focuses without changing selection', async () => {
  const { service, evaluate } = setup();
  await waitFor(() => expect(service.getSnapshot().displayed).not.toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Show individual cutouts' }));
  await screen.findByRole('button', { name: 'Focus cutout sub006' });
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
  fireEvent.click(screen.getByRole('button', { name: 'Hide individual cutouts' }));
  expect(screen.queryByRole('button', { name: 'Focus cutout sub006' })).toBeNull();
  expect(useSetStudioStore.getState().population.pinnedProbe).toBe(before.population.pinnedProbe);
});

it('shares regional response sampling between the full plot and reversible witness gallery', async () => {
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
  fireEvent.click(screen.getByRole('button', { name: 'Show individual cutouts' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Order by pinned response' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Order by pinned response' }));
  await waitFor(() =>
    expect(
      screen
        .getAllByRole('button', { name: /^Focus cutout/ })
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(
      ['sub006', 'sub005', 'sub004', 'sub003', 'sub001', 'sub002'].map(
        (id) => `Focus cutout ${id}`,
      ),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Show 12 response witnesses' }));
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: /^Focus cutout/ })).toHaveLength(5),
  );
  expect(screen.getByText(/plot shows every observation/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Focus cutout sub006' }));
  expect(useSetStudioStore.getState().selection.activeMemberId).toBe('sub006');
  expect(useSetStudioStore.getState().population.working).toBe(before);
  fireEvent.click(screen.getByRole('button', { name: 'Show all observations' }));
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: /^Focus cutout/ })).toHaveLength(6),
  );
  expect(sample).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Use source order' }));
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: /^Focus cutout/ })[0]).toHaveAttribute(
      'aria-label',
      'Focus cutout sub001',
    ),
  );
  expect(sample).toHaveBeenCalledTimes(1);
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
  await screen.findByText('Mean · 3 participants');
  const before = useSetStudioStore.getState();
  const button = screen.getByRole('button', {
    name: 'Hold to preview without focused participant',
  });
  fireEvent.keyDown(button, { key: ' ' });
  await waitFor(() =>
    expect(service.getSnapshot().displayed?.query.request.workingMemberIds).toEqual([
      'sub004',
      'sub005',
      'sub006',
    ]),
  );
  expect(screen.getByText('Mean · 2 participants')).toBeVisible();
  expect(useSetStudioStore.getState().population.working).toBe(before.population.working);
  expect(useSetStudioStore.getState().selection).toBe(before.selection);
  fireEvent.keyUp(button, { key: ' ' });
  await screen.findByText('Mean · 3 participants');
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
  await waitFor(() => expect(service.getSnapshot().displayed).not.toBeNull());
  fireEvent.click(table.getByRole('button', { name: 'Pin crosshair' }));
  await table.findByRole('button', { name: 'sub003' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Preview exclusion unit' }), {
    target: { value: 'set:young-controls' },
  });
  expect(useSetStudioStore.getState().populationPreview.target).toEqual({
    kind: 'set',
    cohortId: 'young-controls',
  });
  const button = screen.getByRole('button', {
    name: 'Hold to preview without Young controls (2 observations)',
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
  fireEvent.change(screen.getByRole('combobox', { name: 'Summary' }), {
    target: { value: 'median' },
  });
  expect(screen.getByRole('combobox', { name: 'Summary' })).toHaveValue('median');
  first.unmount();
  setup();
  expect(screen.getByRole('combobox', { name: 'Summary' })).toHaveValue('median');
  cleanup();
  // A new session starts from the default again.
  useSetStudioStore.getState().loadDemoSession();
  setup();
  expect(screen.getByRole('combobox', { name: 'Summary' })).toHaveValue('mean');
});

it('draws a colourbar per map: diverging for the mean and the observation, gold for coverage (F12/F20)', async () => {
  const { service } = setup();
  await waitFor(() => expect(service.getSnapshot().displayed).not.toBeNull());
  await waitFor(() => expect(screen.getAllByTestId('population-colorbar')).toHaveLength(2));
  const bars = () => screen.getAllByTestId('population-colorbar');
  expect(bars().map((bar) => bar.dataset.diverging)).toEqual(['true', 'true']);
  expect(bars()[0].getAttribute('aria-label')).toMatch(/^Colorbar for Mean: blue–white–red/);
  fireEvent.change(screen.getByRole('combobox', { name: 'Summary' }), {
    target: { value: 'coverage' },
  });
  await waitFor(() => expect(bars()[0].dataset.diverging).toBe('false'));
  expect(bars()[0].getAttribute('aria-label')).toMatch(/^Colorbar for Coverage: gold, 0 to /);
  expect(bars()[1].dataset.diverging).toBe('true');
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
  const { StudioToolbarSlotContext, StudioViewportHeightContext } = await import('../StudioToolbarSlot');
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
  // The summary, plane and Save calculation live in the toolbar row…
  expect(slot.querySelector('[aria-label="Population controls"]')).not.toBeNull();
  expect(slot.textContent).toContain('Save calculation');
  expect(slot.querySelector('select[aria-label="Summary"]')).not.toBeNull();
  // …and each map takes the visible height under it (500 − 60 px of chrome).
  const heights = () =>
    screen.getAllByRole('button', { name: 'Pin image location' }).map((b) => b.dataset.height);
  expect(heights()).toEqual(['440', '440']);
  rerender(lens(200));
  expect(heights()).toEqual(['240', '240']);
  slot.remove();
});
