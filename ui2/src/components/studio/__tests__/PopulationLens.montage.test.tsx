import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PopulationLens } from '../PopulationLens';
import { populationLensMemory } from '../populationLensMemory';
import {
  PopulationSliceService,
  type PopulationSliceRequest,
} from '@/services/studio/PopulationSliceService';
import { populationRelationshipService } from '@/services/studio/PopulationRelationshipService';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { PopulationProbeController } from '@/services/studio/PopulationProbeController';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';

vi.mock('@/components/views/sliceViewer', () => ({
  ReusableSliceViewport: () => null,
  SliceViewerImageSurface: () => null,
  clientPointToWorld: vi.fn(),
  sliceImagePointToWorld: () => [0, 0, 0],
}));

// Every sprite set made, with the crop memory it was made with (the real
// function runs): the lens and the montage must share one crop.
const spriteCalls = vi.hoisted(() => [] as { memory: unknown; crop: unknown }[]);
vi.mock('../montageTileSupport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../montageTileSupport')>();
  return {
    ...actual,
    montageSprites: (...args: Parameters<typeof actual.montageSprites>) => {
      const sprites = actual.montageSprites(...args);
      if (sprites) spriteCalls.push({ memory: args[3], crop: sprites.crop });
      return sprites;
    },
  };
});

const IDS = ['sub001', 'sub002', 'sub003', 'sub004', 'sub005', 'sub006'];
/** The image's own in-plane resolution the sampler reports (undefined: an older sampler). */
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
  native.dim = undefined;
  const state = useSetStudioStore.getState();
  const set = state.sets[state.selection.activeSetId!];
  useSetStudioStore.setState({
    sets: {
      ...state.sets,
      [set.id]: {
        ...set,
        designTablePreview: {
          columns: ['site'],
          rows: set.memberIds.map((id, i) => ({ id, cells: [i < 5 ? 'X' : 'Y'] })),
        },
      },
    },
  });
  state.setPopulationPresentation({ ...state.population.presentation, arrangement: 'montage' });
});
afterEach(() => {
  cleanup();
  delete (window.navigator as { platform?: string }).platform;
  vi.restoreAllMocks();
});

/**
 * The edge the sampler answers at: what was asked, or (0) the image's own
 * resolution, lowered only as far as 2^20 values for the page requires.
 */
function sampledDim(cutouts: { dimPx: number; memberIds: string[] }) {
  if (cutouts.dimPx > 0) return cutouts.dimPx;
  const fits = Math.floor(Math.sqrt((1 << 20) / Math.max(1, cutouts.memberIds.length)));
  return Math.max(1, Math.min(native.dim ?? 64, 256, fits));
}

function setup(probeController?: PopulationProbeController) {
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
    reference: request.reference
      ? {
          id: 'reference',
          summary: [1, 2],
          validCounts: Array(2).fill(request.reference.memberIds.length),
          eligibleCount: request.reference.memberIds.length,
          unitCount: request.reference.memberIds.length,
        }
      : null,
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
  render(<PopulationLens service={service} probeController={probeController} />);
  return { evaluate, service };
}
const tiles = () =>
  screen.getAllByRole('button', { name: /^Focus subject/ }).map((b) => b.dataset.datumId);
const tile = (id: string) => screen.getByRole('button', { name: `Focus subject ${id}` });
const lastCutouts = (evaluate: ReturnType<typeof setup>['evaluate']) =>
  evaluate.mock.calls.at(-1)?.[0].cutouts;
/** Choose four tiles per row (the default width holds five). */
async function fourPerRow() {
  const slider = screen.getByRole('slider', { name: 'Tiles per row' });
  expect(slider).toHaveAttribute('aria-valuenow', '5');
  fireEvent.keyDown(slider, { key: 'ArrowLeft' });
  fireEvent.keyUp(slider, { key: 'ArrowLeft' });
  expect(slider).toHaveAttribute('aria-valuenow', '4');
  // Grouped rows follow the count once it has settled.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
}

it('shows one toolbar row over the tiles, one footer line below them, and nothing else', async () => {
  const { evaluate } = setup();
  await waitFor(() => expect(tiles()).toEqual(IDS));
  const montage = screen.getByRole('region', { name: 'Montage of subjects' });
  // One toolbar row, then the tiles, and the footer closes the montage.
  const toolbar = screen.getByRole('group', { name: 'Montage' });
  expect(toolbar.compareDocumentPosition(montage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(montage).getByRole('status')).toHaveTextContent('6 of 6 subjects · source order');
  // The montage speaks of subjects: in its toolbar, tiles, tooltips and footer.
  const words = [
    toolbar.textContent,
    montage.textContent,
    ...[...montage.querySelectorAll('[title]'), ...toolbar.querySelectorAll('[title]')].map(
      (element) => element.getAttribute('title'),
    ),
    ...[...montage.querySelectorAll('[aria-label]')].map((element) =>
      element.getAttribute('aria-label'),
    ),
  ].join(' ');
  expect(words).toMatch(/subjects/);
  expect(words).not.toMatch(/observations?|\bmembers?\b|cutouts?/i);
  expect(tile('sub001')).toHaveAttribute(
    'title',
    expect.stringMatching(/^sub001 — (\d+|<1|>99)% of the slice has data\n/),
  );
  expect(
    within(screen.getByRole('tablist', { name: 'Population view' }))
      .getAllByRole('tab')
      .map((tab) => tab.textContent),
  ).toEqual(['Summary', 'Montage']);
  for (const gone of [
    'Brush montage',
    'Center cutouts on crosshair',
    'Fit scale to visible context',
    'Show individual cutouts',
  ])
    expect(screen.queryByRole('button', { name: gone })).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Montage support' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Show' })).toBeNull();
  // C′: nothing below the images but the footer line; the analysis moved to
  // the Inspector and the dock's Values tab. A6: the montage shows every
  // subject at once, so its footer has no transport and no "1 / 6".
  const after = (element: Element) =>
    !!(montage.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(within(montage).queryByLabelText('Population navigation')).toBeNull();
  expect(within(montage).queryByText(/^\d+ \/ \d+$/)).toBeNull();
  const section = screen.getByRole('region', { name: 'Population brain views' });
  expect([...section.children].filter((child) => after(child))).toEqual([]);
  expect(screen.queryByRole('button', { name: 'Playback' })).toBeNull();
  expect(screen.queryByText('Select a range of observations')).toBeNull();
  expect(screen.queryByLabelText('Statistical question')).toBeNull();
  expect(screen.queryByLabelText('Spatial relationships')).toBeNull();
  expect(screen.queryByText('Coverage and source revisions')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Region' })).toBeNull();
  // The tiles' extent is in the ⋯ menu, not on the toolbar row.
  expect(within(toolbar).queryByRole('combobox', { name: 'Tiles' })).toBeNull();
  const more = screen.getByTitle('More').closest('details')!;
  expect(within(more).getByRole('combobox', { name: 'Tiles' })).toHaveValue('plane');
  // Large tiles ask for the most pixels the native sampler allows.
  // The tiles are asked for at the image's own resolution, whatever their size on screen.
  expect(lastCutouts(evaluate)?.dimPx).toBe(0);
  expect(lastCutouts(evaluate)?.wholePlane).toBe(true);
});

it('the Summary arrangement keeps its maps, scale and cutout controls', async () => {
  const { service } = setup();
  await waitFor(() => expect(service.getSnapshot().displayed).not.toBeNull());
  fireEvent.click(screen.getByRole('tab', { name: 'Summary' }));
  expect(useSetStudioStore.getState().population.presentation.arrangement).toBe('inspect');
  expect(screen.queryByRole('region', { name: 'Montage of subjects' })).toBeNull();
  // Round 3 row 2: Show, Group, Slice; Cutouts only once a point is pinned
  // (never a disabled button), Zoom in the ⋯ menu's View controls.
  expect(screen.getByRole('combobox', { name: 'Show' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Group' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Slice' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cutouts' })).toBeNull();
  expect(screen.getByRole('combobox', { name: 'Zoom' }).closest('details')).toBe(
    screen.getByTitle('More').closest('details'),
  );
  // The footer line: transport, status and the one colour scale.
  expect(screen.getByRole('group', { name: 'Colour scale' })).toBeInTheDocument();
  expect(screen.getByRole('slider', { name: 'Colour scale limit' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Playback' })).toBeNull();
  expect(screen.getByLabelText('Population navigation')).toBeInTheDocument();
});

it('Sort → Similarity with no fit requests one instead of failing', async () => {
  // The fit is under way for the rest of the test.
  const idle = populationRelationshipService.getSnapshot();
  const running = { ...idle, pending: true, error: null };
  let started = false;
  vi.spyOn(populationRelationshipService, 'getSnapshot').mockImplementation(() =>
    started ? running : idle,
  );
  const fit = vi.spyOn(populationRelationshipService, 'fit').mockImplementation(async () => {
    started = true;
  });
  setup();
  await waitFor(() => expect(tiles()).toEqual(IDS));
  fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), {
    target: { value: 'similarity:pattern-shape' },
  });
  expect(fit).toHaveBeenCalledTimes(1);
  // Correlation (pattern shape) is the default measure and the first offered.
  // C′: a grouping fit (Ward, scored cuts) serves the order too.
  expect(fit).toHaveBeenCalledWith('pattern-shape', false, { reuse: true, grouping: true });
  expect(screen.queryByRole('alert')).toBeNull();
  // Visible at once and for the whole wait: a spinner at the control and, C′,
  // the similarity strip beside the grid saying what is computed, with Cancel.
  // The grid stays readable; the footer keeps describing it.
  const montage = screen.getByRole('region', { name: 'Montage of subjects' });
  expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByRole('img', { name: 'Computing the order' })).toBeInTheDocument();
  const strip = within(montage).getByRole('complementary', { name: 'Similarity map' });
  expect(within(strip).getByTestId('similarity-busy')).toHaveTextContent(
    'Computing similarity for 6 subjects…',
  );
  expect(within(montage).queryByTestId('montage-footer-busy')).toBeNull();
  expect(tile('sub001').closest('[data-pending]')).toBeNull();
  // Cancel stops the fit and the wait, without an error.
  const cancel = vi.spyOn(populationRelationshipService, 'cancel').mockImplementation(() => {
    started = false;
  });
  fireEvent.click(within(strip).getByRole('button', { name: 'Cancel' }));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('img', { name: 'Computing the order' })).toBeNull();
  expect(within(montage).queryByTestId('similarity-busy')).toBeNull();
  // Nothing is left asking for similarity: the strip closes; the footer names the order.
  expect(within(montage).queryByRole('complementary', { name: 'Similarity map' })).toBeNull();
  expect(within(montage).getByTestId('montage-footer')).toHaveAttribute(
    'title',
    expect.stringContaining('6 of 6 subjects · source order'),
  );
  expect(within(montage).getByRole('status')).toHaveTextContent('6 of 6 subjects · source order');
});

it('the slice controls drive the lens plane and step the crosshair along its axis', async () => {
  const { evaluate } = setup();
  await waitFor(() => expect(tiles()).toEqual(IDS));
  const before = [...useViewStateStore.getState().viewState.crosshair.world_mm];
  fireEvent.click(screen.getByRole('button', { name: 'Next slice' }));
  const after = useViewStateStore.getState().viewState.crosshair.world_mm;
  expect([after[0], after[1], after[2] - before[2]]).toEqual([before[0], before[1], 1]);
  await waitFor(() => expect(evaluate.mock.calls.at(-1)?.[0].crosshairMm).toEqual([...after]));
  fireEvent.change(screen.getByRole('combobox', { name: 'Slice' }), {
    target: { value: 'coronal' },
  });
  await waitFor(() => expect(evaluate.mock.calls.at(-1)?.[0].orientation).toBe('coronal'));
});

const sentTiles = (evaluate: ReturnType<typeof setup>['evaluate']) =>
  evaluate.mock.calls.filter(([request]) => !request.focusOnly && request.cutouts);

it('opening the montage is one request, at the image\'s own resolution', async () => {
  native.dim = 109;
  const { evaluate, service } = setup();
  await waitFor(() => expect(tiles()).toEqual(IDS));
  await waitFor(() => expect(service.getSnapshot().pending).toBe(false));
  await new Promise((resolve) => setTimeout(resolve, 400));
  // One request: it asks for "native" and the answer is 109 voxels an edge.
  expect(sentTiles(evaluate).map(([request]) => request.cutouts?.dimPx)).toEqual([0]);
  expect(service.getSnapshot().displayed?.data.cutouts?.plane.dim_px).toEqual([109, 109]);
  expect(tile('sub001').querySelector('canvas')!.width).toBe(109);
});

it('the tiles-per-row control reflows at once and asks the sampler for nothing', async () => {
  native.dim = 109;
  const { evaluate, service } = setup();
  await waitFor(() => expect(tiles()).toEqual(IDS));
  await waitFor(() => expect(service.getSnapshot().pending).toBe(false));
  const size = screen.getByRole('slider', { name: 'Tiles per row' });
  const grid = () => tile('sub001').parentElement as HTMLElement;
  const canvas = () => tile('sub001').querySelector('canvas')!;
  const before = evaluate.mock.calls.length;
  const shown = service.getSnapshot().displayed;
  // Five per row: 146 px tiles of a 109 px sample are enlarged, so drawn pixel for pixel.
  expect(canvas().dataset.rendering).toBe('pixelated');
  // Three quick steps: 6, 7, 8 tiles per row.
  for (let step = 0; step < 3; step++) {
    fireEvent.keyDown(size, { key: 'ArrowRight' });
    fireEvent.keyUp(size, { key: 'ArrowRight' });
  }
  // The grid reflows at once to whole columns that fill the width…
  expect(grid().style.gridTemplateColumns).toBe('repeat(8, minmax(0, 1fr))');
  // …88 px tiles are smaller than their sample: averaged down, the only smoothing there is.
  expect(canvas().dataset.rendering).toBe('smooth');
  await new Promise((resolve) => setTimeout(resolve, 500));
  // Nothing was requested: the same result, the same pictures, the same page.
  expect(evaluate.mock.calls.length).toBe(before);
  expect(service.getSnapshot().displayed).toBe(shown);
  expect(tiles()).toEqual(IDS);
  expect(document.querySelectorAll('button[title$="not loaded"]')).toHaveLength(0);
});

it('grouped rows wrap at any tiles-per-row count and ask the sampler for nothing', async () => {
  const { evaluate, service } = setup();
  await waitFor(() => expect(tiles()).toEqual(IDS));
  act(() => useSetStudioStore.getState().setActiveMember('sub001'));
  fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), {
    target: { value: 'factor:site' },
  });
  await waitFor(() => expect(lastCutouts(evaluate)?.memberIds).toEqual(IDS));
  await waitFor(() => expect(service.getSnapshot().pending).toBe(false));
  const before = sentTiles(evaluate).length;
  const size = screen.getByRole('slider', { name: 'Tiles per row' });
  // 4, 3, 2 per row in quick succession: every member stays, wrapped.
  for (let step = 0; step < 3; step++) {
    fireEvent.keyDown(size, { key: 'ArrowLeft' });
    fireEvent.keyUp(size, { key: 'ArrowLeft' });
  }
  expect(size).toHaveAttribute('aria-valuenow', '2');
  expect(tiles()).toEqual(IDS);
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(sentTiles(evaluate).length).toBe(before);
});

it('the tiles-per-row choice is remembered for the session, and the focused tile stays in view', async () => {
  setup();
  await waitFor(() => expect(tiles()).toEqual(IDS));
  act(() => useSetStudioStore.getState().setActiveMember('sub006'));
  // The focused tile sits below the visible grid at the new column count.
  const scroller = document.querySelector<HTMLElement>('[data-montage-scroller]')!;
  vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    bottom: 300,
    left: 0,
    right: 760,
    width: 760,
    height: 300,
    x: 0,
    y: 0,
    toJSON() {},
  } as DOMRect);
  vi.spyOn(tile('sub006'), 'getBoundingClientRect').mockReturnValue({
    top: 700,
    bottom: 1060,
    left: 0,
    right: 360,
    width: 360,
    height: 360,
    x: 0,
    y: 700,
    toJSON() {},
  } as DOMRect);
  const size = screen.getByRole('slider', { name: 'Tiles per row' });
  fireEvent.keyDown(size, { key: 'Home' });
  fireEvent.keyUp(size, { key: 'Home' });
  expect(size).toHaveAttribute('aria-valuenow', '2');
  // Scrolled so the focused tile's bottom edge is at the grid's.
  expect(scroller.scrollTop).toBe(760);
  cleanup();
  setup();
  expect(screen.getByRole('slider', { name: 'Tiles per row' })).toHaveAttribute('aria-valuenow', '2');
});

it('the footer limits set the shared scale through the service, and the bar fits it', async () => {
  const { service } = setup();
  await waitFor(() => expect(tiles()).toEqual(IDS));
  const setLimit = vi.spyOn(service, 'setEffectLimit');
  const fitScale = vi.spyOn(service, 'fitEffectScale');
  const upper = screen.getByRole('spinbutton', { name: 'Upper limit' });
  await waitFor(() => expect(upper).toBeEnabled());
  fireEvent.change(upper, { target: { value: '2.5' } });
  expect(setLimit).toHaveBeenLastCalledWith(2.5);
  await waitFor(() => expect(service.getSnapshot().displayed?.effectLimit).toBe(2.5));
  fireEvent.blur(upper);
  expect(screen.getByRole('spinbutton', { name: 'Lower limit' })).toHaveValue(-2.5);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Lower limit' }), {
    target: { value: '-3' },
  });
  expect(setLimit).toHaveBeenLastCalledWith(3);
  fireEvent.click(screen.getByRole('button', { name: 'Fit scale to the data' }));
  expect(fitScale).toHaveBeenCalledTimes(1);
});

it('selection needs no mode: the bar appears with a selection and goes when it is cleared', async () => {
  Object.defineProperty(window.navigator, 'platform', { value: 'MacIntel', configurable: true });
  setup();
  await waitFor(() => expect(tiles()).toEqual(IDS));
  // Everyone in play is not a selection: no tile is marked and there is no
  // segment; the montage's selection line says how to select instead.
  expect(screen.queryByRole('group', { name: 'Selection' })).toBeNull();
  expect(screen.getByTestId('montage-selection-hint')).toHaveTextContent(/Shift- or ⌘-click to select/);
  expect(tile('sub002')).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(tile('sub002'), { shiftKey: true });
  fireEvent.click(tile('sub004'), { shiftKey: true });
  // A7: on the montage's own line above the tiles, never on the toolbar row.
  const bar = within(screen.getByTestId('montage-selection-line')).getByRole('group', {
    name: 'Selection',
  });
  expect(
    within(screen.getByRole('group', { name: 'Montage' })).queryByRole('group', { name: 'Selection' }),
  ).toBeNull();
  expect(screen.getByRole('region', { name: 'Montage of subjects' }).contains(bar)).toBe(true);
  expect(within(bar).getByRole('status')).toHaveTextContent('2 selected');
  expect(tile('sub002')).toHaveAttribute('aria-pressed', 'true');
  // A3: the tiles outside the selection recede.
  expect(tile('sub001')).toHaveAttribute('data-receded', 'true');
  expect(tile('sub002')).not.toHaveAttribute('data-receded');
  expect(tile('sub001')).toHaveAttribute('aria-pressed', 'false');
  // A plain click still only focuses.
  fireEvent.click(tile('sub005'));
  expect(useSetStudioStore.getState().selection.activeMemberId).toBe('sub005');
  expect(within(bar).getByRole('status')).toHaveTextContent('2 selected');
  // Deselecting the last subject returns to everyone rather than to nobody.
  fireEvent.click(tile('sub002'), { shiftKey: true });
  fireEvent.click(tile('sub004'), { shiftKey: true });
  expect(screen.queryByRole('group', { name: 'Selection' })).toBeNull();
  expect(useSetStudioStore.getState().population.working.kind).toBe('context');
  expect(document.querySelectorAll('[data-receded]')).toHaveLength(0);
  fireEvent.click(tile('sub003'), { shiftKey: true });
  fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
  expect(screen.queryByRole('group', { name: 'Selection' })).toBeNull();
  expect(useSetStudioStore.getState().population.working.kind).toBe('context');
});

it('the selection bar saves a group and compares with the rest; Open in Deck is the Inspector\'s', async () => {
  setup();
  await waitFor(() => expect(tiles()).toEqual(IDS));
  fireEvent.click(tile('sub002'), { shiftKey: true });
  fireEvent.click(tile('sub004'), { shiftKey: true });
  const before = useSetStudioStore.getState();
  const saved = () => {
    const state = useSetStudioStore.getState();
    return state.sets[state.selection.activeSetId!].savedCohortIds.map((id) => state.cohorts[id]);
  };
  const count = saved().length;
  // "Save as group…" offers the name, and saves on Enter.
  fireEvent.click(screen.getByRole('button', { name: 'Save as group…' }));
  const name = screen.getByRole('textbox', { name: 'Group name' });
  expect(name).toHaveValue('2 subjects from the montage');
  fireEvent.submit(name.closest('form')!);
  expect(saved()).toHaveLength(count + 1);
  expect(saved().at(-1)?.memberIds).toEqual(['sub002', 'sub004']);
  expect(saved().at(-1)?.label).toBe('2 subjects from the montage');

  expect(screen.queryByRole('button', { name: 'Open in Deck' })).toBeNull();
  expect(useSetStudioStore.getState().selection.activeLens).toBe(before.selection.activeLens);

  fireEvent.click(screen.getByRole('button', { name: 'Compare with the rest' }));
  const population = useSetStudioStore.getState().population;
  expect(population.referenceMode).toBe('complement');
  expect(population.presentation.arrangement).toBe('comparison');
  expect(population.working).toMatchObject({ kind: 'members', memberIds: ['sub002', 'sub004'] });
});

it('grouped Summary: Show chooses the All card\'s statistic (labelled, enabled); no switch on a card', async () => {
  // No B yet: Show holds the statistics alone (A and B join once B is set, below).
  useSetStudioStore.getState().setCompareCohort(null);
  const { evaluate } = setup();
  await waitFor(() => expect(tiles()).toEqual(IDS));
  fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), {
    target: { value: 'factor:site' },
  });
  fireEvent.click(
    within(screen.getByRole('region', { name: 'site: X' })).getByRole('button', {
      name: 'Show mean of site: X',
    }),
  );
  expect(useSetStudioStore.getState().population.presentation.arrangement).toBe('groups');
  const show = screen.getByRole('combobox', { name: 'Show' });
  expect(show).toBeEnabled();
  expect([...show.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
    'Mean',
    't',
    '% positive',
  ]);
  expect(show).toHaveValue('mean');
  fireEvent.change(show, { target: { value: 'oneSampleT' } });
  await waitFor(() => expect(evaluate.mock.calls.at(-1)?.[0].summary).toBe('oneSampleT'));
  expect(screen.getByRole('combobox', { name: 'Show' })).toHaveValue('oneSampleT');
  expect(screen.queryByRole('radiogroup', { name: 'All: statistic' })).toBeNull();
});

it('grouped Summary: once B is set, Show also offers A and B / A − B and leaves the groups for them', async () => {
  setup();
  await waitFor(() => expect(tiles()).toEqual(IDS));
  fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), {
    target: { value: 'factor:site' },
  });
  fireEvent.click(
    within(screen.getByRole('region', { name: 'site: X' })).getByRole('button', {
      name: 'Show mean of site: X',
    }),
  );
  expect(useSetStudioStore.getState().population.presentation.arrangement).toBe('groups');
  // A = site X, B = site Y (as a card's "Use as A" / "Use as B" would).
  act(() => {
    populationProbeActions.select(IDS.slice(0, 5), 'replace', 'metadata', 'site: X');
    const state = useSetStudioStore.getState();
    const b = state.createSavedCohort({
      memberIds: IDS.slice(5),
      label: 'site: Y',
      originLabel: 'Factor site',
    })!;
    state.setPopulationReferenceMode('cohort');
    state.setCompareCohort(b);
  });
  const show = screen.getByRole('combobox', { name: 'Show' });
  expect([...show.querySelectorAll('option')].map((o) => o.getAttribute('value'))).toEqual([
    'mean',
    'oneSampleT',
    'positiveFraction',
    'compare:ab',
    'compare:diff',
  ]);
  fireEvent.change(show, { target: { value: 'compare:diff' } });
  expect(useSetStudioStore.getState().population.presentation.arrangement).toBe('difference');
  expect(screen.getByRole('combobox', { name: 'Show' })).toHaveValue('compare:diff');
});

it('Group by a factor shows every member of each group, wrapped, with no "more" cell', async () => {
  const { evaluate } = setup();
  await waitFor(() => expect(tiles()).toEqual(IDS));
  await fourPerRow();
  fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), {
    target: { value: 'factor:site' },
  });
  expect(useSetStudioStore.getState().population.presentation.arrangement).toBe('montage');
  const x = screen.getByRole('region', { name: 'site: X' });
  expect(x).toHaveTextContent('5 subjects');
  expect(screen.getByRole('region', { name: 'site: Y' })).toHaveTextContent('1 subject');
  // Four tiles per row: site X wraps onto two rows; nothing is held back.
  expect(within(x).getAllByRole('button', { name: /^Focus subject/ })).toHaveLength(5);
  expect(tiles()).toEqual(IDS);
  expect(screen.queryByRole('button', { name: /^Show all/ })).toBeNull();
  await waitFor(() => expect(lastCutouts(evaluate)?.memberIds).toEqual(IDS));
  expect(
    within(screen.getByRole('region', { name: 'Montage of subjects' })).getByRole('status'),
  ).toHaveTextContent('2 groups · 6 subjects · source order');

  // "Show mean of …" is the existing group-means view.
  fireEvent.click(within(x).getByRole('button', { name: 'Show mean of site: X' }));
  expect(useSetStudioStore.getState().population.presentation.arrangement).toBe('groups');
  // C′: the group means are the Summary with Group set; there is no Groups view.
  expect(
    within(screen.getByRole('tablist', { name: 'Population view' }))
      .getAllByRole('tab')
      .map((tab) => tab.textContent),
  ).toEqual(['Summary', 'Montage']);
  expect(screen.getByRole('tab', { name: 'Summary' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('tab', { name: 'Montage' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'none' } });
  expect(useSetStudioStore.getState().population.partition).toBeNull();
  expect(useSetStudioStore.getState().population.presentation.arrangement).toBe('montage');
  expect(tiles()).toEqual(IDS);
});

it('a view narrowed to one group shows that group alone and can return to all of them', async () => {
  setup();
  await waitFor(() => expect(tiles()).toEqual(IDS));
  fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), {
    target: { value: 'factor:site' },
  });
  act(() => {
    const state = useSetStudioStore.getState();
    state.setPopulationPresentation({
      ...state.population.presentation,
      contributorsGroupId: state.population.partition!.groups[0].id,
    });
  });
  expect(tiles()).toEqual(['sub001', 'sub002', 'sub003', 'sub004', 'sub005']);
  expect(screen.queryByRole('region', { name: 'site: Y' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show all groups' }));
  expect(screen.getByRole('region', { name: 'site: Y' })).toBeInTheDocument();
});

/** A set of `n` subjects in two site groups, the first `inX` of them at site X. */
function largeSet(n: number, inX: number) {
  const ids = Array.from({ length: n }, (_, i) => `s${String(i + 1).padStart(3, '0')}`);
  const state = useSetStudioStore.getState();
  const set = state.sets[state.selection.activeSetId!];
  useSetStudioStore.setState({
    sets: {
      ...state.sets,
      [set.id]: {
        ...set,
        memberIds: ids,
        memberCount: n,
        memberSummaries: ids.map((id) => ({ id, sourcePath: `/demo/${id}.nii.gz` })),
        designTablePreview: {
          columns: ['site'],
          rows: ids.map((id, i) => ({ id, cells: [i < inX ? 'X' : 'Y'] })),
        },
      } as typeof set,
    },
    selection: { ...state.selection, activeMemberId: ids[0] },
  });
  return ids;
}

it('grouped: a group past the request limit is paged, and every tile drawn has an image', async () => {
  const ids = largeSet(160, 150);
  const { evaluate, service } = setup();
  await waitFor(() => expect(tiles()).toHaveLength(80));
  fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), {
    target: { value: 'factor:site' },
  });
  const montage = screen.getByRole('region', { name: 'Montage of subjects' });
  const loaded = () =>
    new Set(service.getSnapshot().displayed?.data.cutouts?.members.map((m) => m.memberId));
  const everyTileHasAnImage = async () =>
    waitFor(() => {
      const have = loaded();
      expect(tiles().length).toBeGreaterThan(0);
      expect(tiles().every((id) => have.has(id!))).toBe(true);
    });
  // 160 tiles do not fit one request: the first page holds 80 of them.
  expect(tiles()).toEqual(ids.slice(0, 80));
  await everyTileHasAnImage();
  expect(evaluate.mock.calls.every(([request]) => (request.cutouts?.memberIds.length ?? 0) <= 96)).toBe(
    true,
  );
  expect(within(montage).getByRole('status')).toHaveTextContent('2 groups · 80 of 160 subjects');
  expect(within(montage).getByRole('group', { name: /page 1 of 2/i })).toBeInTheDocument();
  fireEvent.click(within(montage).getByRole('button', { name: 'Next page' }));
  // The rest of site X, then every member of site Y.
  expect(tiles()).toEqual(ids.slice(80, 160));
  await everyTileHasAnImage();
  expect(within(montage).getByRole('status')).toHaveTextContent('2 groups · 80 of 160 subjects');
  // Nothing is drawn without an image, on either page.
  expect(montage.querySelectorAll('button[title$="not loaded"]')).toHaveLength(0);
});

it('grouped: no subject is hidden, so focus from elsewhere always lands on a tile', async () => {
  setup();
  await waitFor(() => expect(tiles()).toEqual(IDS));
  await fourPerRow();
  fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), {
    target: { value: 'factor:site' },
  });
  expect(tiles()).toContain('sub005');
  // Playback, a plot or the Subjects list moves focus to a subject.
  act(() => useSetStudioStore.getState().setActiveMember('sub005'));
  expect(tiles()).toEqual(IDS);
  expect(tile('sub005')).toHaveAttribute('aria-current', 'true');
});

it('Sort → Value at crosshair waits for a pin, and a pin does not turn the tiles into cutouts', async () => {
  const controller = new PopulationProbeController(vi.fn(() => new Promise<never>(() => {})), 0);
  const { evaluate } = setup(controller);
  await waitFor(() => expect(lastCutouts(evaluate)?.wholePlane).toBe(true));
  // C′: nothing pins silently. With no pin, the value orders and pinned-region tiles say why not.
  const sort = screen.getByRole('combobox', { name: 'Sort' });
  expect(within(sort).getByRole('option', { name: 'Value at pin' })).toBeDisabled();
  expect(within(sort).getByRole('option', { name: 'Value at pin' })).toHaveAttribute(
    'title',
    'Pin a point first',
  );
  const tilesChoice = screen.getByRole('combobox', { name: 'Tiles' });
  expect(within(tilesChoice).getByRole('option', { name: /^Pinned region/ })).toBeDisabled();
  expect(within(tilesChoice).getByRole('option', { name: /^Pinned region/ })).toHaveAttribute(
    'title',
    'Pin a point first',
  );
  expect(useSetStudioStore.getState().population.pinnedProbe).toBeNull();
  act(() => populationProbeActions.pin(0, false));
  fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), {
    target: { value: 'crosshair' },
  });
  expect(useSetStudioStore.getState().population.pinnedProbe).not.toBeNull();
  // Let any request the pin causes go out, then check what the tiles show.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(evaluate.mock.calls.every(([request]) => request.cutouts?.wholePlane === true)).toBe(true);
  expect(screen.getByRole('combobox', { name: 'Tiles' })).toHaveValue('plane');
  // Only an explicit choice shows the pinned region.
  fireEvent.change(screen.getByRole('combobox', { name: 'Tiles' }), {
    target: { value: 'probe' },
  });
  await waitFor(() => expect(lastCutouts(evaluate)?.wholePlane).toBe(false));
});

it('Value at crosshair is unavailable once the values table has stopped', async () => {
  const controller = new PopulationProbeController(vi.fn(), 0);
  controller.stop();
  setup(controller);
  await waitFor(() => expect(tiles()).toEqual(IDS));
  expect(
    within(screen.getByRole('combobox', { name: 'Sort' })).getByRole('option', {
      name: 'Value at pin',
    }),
  ).toBeDisabled();
});

it('the footer and the Subjects list name the order the lens is using', async () => {
  const { usePopulationViewStore } = await import('@/stores/populationViewStore');
  setup();
  await waitFor(() => expect(tiles()).toEqual(IDS));
  const status = () =>
    within(screen.getByRole('region', { name: 'Montage of subjects' })).getByRole('status');
  const lensOrder = () => usePopulationViewStore.getState().lensOrder?.label;
  expect(lensOrder()).toBe('Source order');
  fireEvent.click(screen.getByRole('button', { name: 'Reverse order' }));
  expect(tiles()).toEqual([...IDS].reverse());
  expect(lensOrder()).toBe('Source order, reversed');
  fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), {
    target: { value: 'column:site' },
  });
  // Site Y (sub006) sorts after site X; reversed, it leads.
  expect(tiles()[0]).toBe('sub006');
  expect(lensOrder()).toBe('Ordered by site, reversed');
  expect(status()).toHaveTextContent('6 of 6 subjects · ordered by site, reversed');
});

it('Escape clears the selection from the grid; the grid keeps its room, nothing floats over it', async () => {
  setup();
  await waitFor(() => expect(tiles()).toEqual(IDS));
  const content = () =>
    document.querySelector('[data-montage-scroller]')!.firstElementChild as HTMLElement;
  expect(content()).toHaveClass('pb-3');
  fireEvent.click(tile('sub002'), { shiftKey: true });
  expect(screen.getByRole('group', { name: 'Selection' })).toBeInTheDocument();
  expect(content()).toHaveClass('pb-3');
  fireEvent.keyDown(tile('sub002'), { key: 'Escape' });
  expect(screen.queryByRole('group', { name: 'Selection' })).toBeNull();
  expect(useSetStudioStore.getState().population.working.kind).toBe('context');
});

it('a new order asks the sampler for nothing: the request lists the page in the context\'s order', async () => {
  const { evaluate, service } = setup();
  await waitFor(() => expect(tiles()).toEqual(IDS));
  await waitFor(() => expect(service.getSnapshot().pending).toBe(false));
  const before = sentTiles(evaluate).length;
  fireEvent.click(screen.getByRole('button', { name: 'Reverse order' }));
  expect(tiles()).toEqual([...IDS].reverse());
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(sentTiles(evaluate).length).toBe(before);
  expect(lastCutouts(evaluate)?.memberIds).toEqual(IDS);
  expect(document.querySelectorAll('button[title$="not loaded"]')).toHaveLength(0);
});

it('in the Studio the view switch joins row 1, the rarely used controls the one menu, and nothing is lost', async () => {
  const { StudioToolbarSlotContext } = await import('../studioToolbarSlots');
  const { StudioMenuSlotContext, StudioViewSlotContext } = await import('../studioToolbarSlots');
  const slot = (name: string) => {
    const element = document.createElement('div');
    element.dataset.slot = name;
    document.body.appendChild(element);
    return element;
  };
  const row2 = slot('row2'),
    view = slot('view'),
    menu = slot('menu');
  const service = new PopulationSliceService(
    { evaluate: vi.fn(() => new Promise(() => {})), release: vi.fn(), bitmap: vi.fn() } as never,
    0,
  );
  render(
    <StudioToolbarSlotContext.Provider value={row2}>
      <StudioViewSlotContext.Provider value={view}>
        <StudioMenuSlotContext.Provider value={menu}>
          <PopulationLens service={service} />
        </StudioMenuSlotContext.Provider>
      </StudioViewSlotContext.Provider>
    </StudioToolbarSlotContext.Provider>,
  );
  try {
    // Row 1: Summary | Montage, and only that.
    expect(within(view).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Summary',
      'Montage',
    ]);
    // Row 2 in Montage: the one toolbar, left-aligned, with no menus of its own.
    const controls = within(row2).getByLabelText('Population controls');
    expect(within(controls).getByRole('group', { name: 'Montage' })).toBeInTheDocument();
    expect(controls.className).not.toContain('justify-end');
    expect(row2.querySelectorAll('details')).toHaveLength(0);
    expect(within(row2).queryByRole('tab')).toBeNull();
    // The tiles' extent is in the menu, not on row 2.
    expect(within(row2).queryByRole('combobox', { name: 'Tiles' })).toBeNull();
    expect(within(menu).getByRole('combobox', { name: 'Tiles' })).toBeInTheDocument();
    // The menu: Save calculation and everything that was under More.
    expect(within(menu).getByText('Save calculation')).toBeInTheDocument();
    // C′: the menu keeps the rare commands; ±1 mm, the order buttons and
    // hold-to-preview are gone from it (the stepper, Sort and the Inspector).
    for (const name of ['Center brain', 'Refresh images'])
      expect(within(menu).getByRole('button', { name })).toBeInTheDocument();
    expect(within(menu).getByRole('combobox', { name: 'Playback speed' })).toBeInTheDocument();
    for (const name of [
      'Previous population slice',
      'Next population slice',
      'Hold to preview without focused observation',
      'Order observations by pinned response',
    ])
      expect(within(menu).queryByRole('button', { name })).toBeNull();
    // Summary: its row takes row 2 in the montage toolbar's place; Zoom is
    // a View control in the menu.
    fireEvent.click(within(view).getByRole('tab', { name: 'Summary' }));
    expect(within(row2).getByRole('combobox', { name: 'Show' })).toBeInTheDocument();
    expect(within(row2).getByRole('combobox', { name: 'Slice' })).toBeInTheDocument();
    expect(within(row2).queryByRole('combobox', { name: 'Zoom' })).toBeNull();
    expect(within(menu).getByRole('combobox', { name: 'Zoom' })).toBeInTheDocument();
    expect(within(row2).queryByRole('group', { name: 'Montage' })).toBeNull();
    expect(within(menu).getByText('Save calculation')).toBeInTheDocument();
  } finally {
    cleanup();
    row2.remove();
    view.remove();
    menu.remove();
  }
});

it('a fine image keeps its resolution by shortening the page, once, whatever the tile size', async () => {
  // A 1 mm slice: 256 voxels an edge.
  native.dim = 256;
  const ids = largeSet(160, 150);
  const { evaluate } = setup();
  const montage = () => screen.getByRole('region', { name: 'Montage of subjects' });
  // Its resolution known, the page is what 2^20 values allow at it: 16 subjects.
  await waitFor(() => expect(tiles()).toEqual(ids.slice(0, 16)), { timeout: 8000 });
  await waitFor(() => expect(lastCutouts(evaluate)?.memberIds).toEqual(ids.slice(0, 16)), {
    timeout: 8000,
  });
  const sent = sentTiles(evaluate).map(([request]) => request.cutouts!);
  // Every request asked for the image's own resolution and stayed within the budget:
  // the first, for 80 subjects, was answered at 114 px rather than refused.
  expect(sent.every((cutouts) => cutouts.dimPx === 0)).toBe(true);
  expect(sent.map((cutouts) => cutouts.memberIds.length)).toEqual([80, 16]);
  expect(sent.map(sampledDim)).toEqual([114, 256]);
  expect(sent.every((cutouts) => cutouts.memberIds.length * sampledDim(cutouts) ** 2 <= 1 << 20)).toBe(
    true,
  );
  await waitFor(() =>
    expect(within(montage()).getByRole('status')).toHaveTextContent(/^16 of 160 subjects · source order/),
  );
  // At its own resolution now: nothing is said about a lowered one.
  expect(within(montage()).getByRole('status')).not.toHaveTextContent(/tiles at/);
  expect(within(montage()).getByRole('group', { name: /page 1 of 10/i })).toBeInTheDocument();
  // The page does not move with the tile size.
  const size = screen.getByRole('slider', { name: 'Tiles per row' });
  fireEvent.keyDown(size, { key: 'End' });
  fireEvent.keyUp(size, { key: 'End' });
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(tiles()).toEqual(ids.slice(0, 16));
  expect(within(montage()).getByRole('group', { name: /page 1 of 10/i })).toBeInTheDocument();
  expect(sentTiles(evaluate)).toHaveLength(2);
}, 30000);

it('says so in the footer when the sampler had to lower the resolution', async () => {
  // An image finer than the sampler's 256 px edge: its tiles cannot reach it.
  native.dim = 400;
  const { service } = setup();
  await waitFor(() => expect(tiles()).toEqual(IDS));
  await waitFor(() =>
    expect(service.getSnapshot().displayed?.data.cutouts?.plane.dim_px).toEqual([256, 256]),
  );
  expect(
    within(screen.getByRole('region', { name: 'Montage of subjects' })).getByRole('status'),
  ).toHaveTextContent(/^6 of 6 subjects · source order · .*tiles at 256 of 400 px$/);
});

it('double-clicking a tile opens that subject on its own (the Inspector\'s Open in Deck)', async () => {
  setup();
  await waitFor(() => expect(tiles()).toEqual(IDS));
  fireEvent.doubleClick(tile('sub004'));
  const state = useSetStudioStore.getState();
  expect(state.selection.activeMemberId).toBe('sub004');
  expect(state.selection.activeLens).toBe('deck');
});

it('the tile fit and the drawn tiles use one crop, made once, even after the montage remounts', async () => {
  spriteCalls.length = 0;
  setup();
  await waitFor(() => expect(tiles()).toEqual(IDS));
  await waitFor(() => expect(spriteCalls.length).toBeGreaterThan(0));
  // Summary and back: the montage remounts; its tiles keep the lens's crop.
  const presentation = () => useSetStudioStore.getState().population.presentation;
  act(() => useSetStudioStore.getState().setPopulationPresentation({ ...presentation(), arrangement: 'inspect' }));
  act(() => useSetStudioStore.getState().setPopulationPresentation({ ...presentation(), arrangement: 'montage' }));
  await waitFor(() => expect(tiles()).toEqual(IDS));
  // One memory for everything: never a second, separately remembered crop.
  expect(new Set(spriteCalls.map((call) => call.memory)).size).toBe(1);
  expect(spriteCalls.every((call) => call.memory)).toBe(true);
});
