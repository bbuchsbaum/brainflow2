/**
 * Layout C′ (docs/plans/montage-toolbar-design/population-layout.md §10):
 * the similarity strip beside the montage, the footer as the only thing
 * below the images, and the explicit-pin and selection rules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PopulationLens } from '../PopulationLens';
import { populationLensMemory } from '../populationLensMemory';
import { PopulationMontage } from '../PopulationMontage';
import { stripLayout } from '../similarityStripLayout';
import {
  PopulationSliceService,
  type PopulationSliceRequest,
} from '@/services/studio/PopulationSliceService';
import {
  populationRelationshipService,
  type RelationshipRequest,
} from '@/services/studio/PopulationRelationshipService';
import { syntheticGroupingFit } from '@/services/studio/__tests__/relationshipFixtures';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { populationMemberHover } from '@/services/studio/populationMemberHover';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import { reloadPopulationViewMemory, usePopulationViewStore } from '@/stores/populationViewStore';

vi.mock('@/components/views/sliceViewer', () => ({
  ReusableSliceViewport: () => null,
  SliceViewerImageSurface: () => null,
  clientPointToWorld: vi.fn(),
  sliceImagePointToWorld: () => [0, 0, 0],
}));
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/services/transport', () => ({ getTransport: () => ({ invoke }) }));

const IDS = ['sub001', 'sub002', 'sub003', 'sub004', 'sub005', 'sub006'];
const state = () => useSetStudioStore.getState();
const rect = (x: number, y: number, width: number, height: number) =>
  ({
    x,
    y,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    width,
    height,
    toJSON() {},
  }) as DOMRect;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  try {
    globalThis.localStorage?.clear();
  } catch {
    // no storage in this environment
  }
  reloadPopulationViewMemory();
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  state().loadDemoSession();
  populationLensMemory.reset();
  invoke.mockReset();
  invoke.mockImplementation(async (command: string, args: { request: RelationshipRequest }) =>
    command === 'fit_population_relationship' ? syntheticGroupingFit(args.request) : undefined,
  );
  const set = state().sets[state().selection.activeSetId!];
  useSetStudioStore.setState({
    sets: {
      ...state().sets,
      [set.id]: {
        ...set,
        designTablePreview: {
          columns: ['site'],
          rows: set.memberIds.map((id, i) => ({ id, cells: [i < 5 ? 'X' : 'Y'] })),
        },
      },
    },
  });
  state().setPopulationPresentation({ ...state().population.presentation, arrangement: 'montage' });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  act(() => populationRelationshipService.resetScope(null));
});

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
    reference: request.reference
      ? {
          id: 'reference',
          values: [1, 2],
          validCounts: Array(2).fill(request.reference.memberIds.length),
          eligibleCount: request.reference.memberIds.length,
          unitCount: request.reference.memberIds.length,
        }
      : null,
    cutouts: request.cutouts
      ? {
          plane: {
            origin_mm: request.cutouts.centerMm,
            u_mm: [1, 0, 0] as [number, number, number],
            v_mm: [0, 1, 0] as [number, number, number],
            dim_px: [4, 4] as [number, number],
          },
          members: request.cutouts.memberIds.map((memberId) => ({
            memberId,
            values: Array(16).fill(1),
            validPixels: 16,
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
  render(<PopulationLens service={service} />);
  return { evaluate, service };
}
const tiles = () =>
  screen.getAllByRole('button', { name: /^Focus subject/ }).map((b) => b.dataset.datumId);
const tile = (id: string) => screen.getByRole('button', { name: `Focus subject ${id}` });
const strip = () => screen.queryByRole('complementary', { name: 'Similarity map' });
const choose = (name: 'Sort' | 'Group', value: string) =>
  fireEvent.change(screen.getByRole('combobox', { name }), { target: { value } });

describe('the similarity strip', () => {
  it('appears beside the grid only while Sort or Group is a similarity choice', async () => {
    setup();
    await waitFor(() => expect(tiles()).toEqual(IDS));
    expect(strip()).toBeNull();
    choose('Sort', 'column:site');
    expect(strip()).toBeNull();
    choose('Sort', 'similarity:pattern-shape');
    await waitFor(() => expect(strip()).not.toBeNull());
    // Inside the montage region (the same React root), to the right of the grid.
    const montage = screen.getByRole('region', { name: 'Montage of subjects' });
    expect(montage.contains(strip())).toBe(true);
    await waitFor(() =>
      expect(within(strip()!).getAllByRole('button', { name: /^Focus relationship/ })).toHaveLength(6),
    );
    choose('Sort', 'source');
    expect(strip()).toBeNull();
    choose('Group', 'similarity:effect');
    await waitFor(() => expect(strip()).not.toBeNull());
    await waitFor(() => expect(state().population.partition?.origin).toBe('map-derived'));
    choose('Group', 'none');
    expect(strip()).toBeNull();
  });

  it('starts the count at the fit\'s suggestion; the legend matches the group headers, with Outliers', async () => {
    invoke.mockImplementation(async (command: string, args: { request: RelationshipRequest }) =>
      command === 'fit_population_relationship'
        ? syntheticGroupingFit(args.request, { bestGroups: 3 })
        : undefined,
    );
    setup();
    await waitFor(() => expect(tiles()).toEqual(IDS));
    choose('Group', 'similarity:pattern-shape');
    await waitFor(() => expect(state().population.partition?.origin).toBe('map-derived'));
    // The grouping fit asked for Ward (grouping present).
    expect(invoke.mock.calls.at(-1)![1].request.grouping).toEqual({});
    // The count is folded into the Group select: its label says it, its menu marks the suggestion.
    const groupSelect = screen.getByRole('combobox', { name: 'Group' });
    // The fit's suggested cut (3 clusters) is two groups and one outlier: the
    // count shown never counts the outlier as a group.
    expect([...groupSelect.querySelectorAll('option')].find((o) => o.selected)?.textContent).toBe(
      'r · 2 groups · +1 outlier',
    );
    expect(groupSelect).toHaveAttribute('data-auto', 'true');
    expect(within(groupSelect).getByRole('option', { name: '✓ Auto (2)' })).toBeInTheDocument();
    expect(
      within(groupSelect).getByRole('option', { name: '2 groups + 1 outlier · suggested' }),
    ).toBeInTheDocument();
    const legend = within(strip()!).getByRole('list', { name: 'Similarity groups' });
    expect(within(legend).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Group 12',
      'Group 23',
      'Outliers1',
    ]);
    // The group headers wear the group marks (groupMarks): with two groups,
    // a filled and an open circle; the outliers a hollow diamond.
    const headers = ['Group 1', 'Group 2', 'Outliers'].map((name) =>
      screen.getByRole('region', { name: name === 'Outliers' ? 'Outliers' : name }),
    );
    expect(headers.map((h) => h.querySelector('[data-glyph]')?.getAttribute('data-glyph'))).toEqual(
      ['circle', 'circle-open', 'diamond-hollow'],
    );
    expect(within(strip()!).getByTestId('similarity-suggestion')).toHaveTextContent(
      'Suggested: 3 groups · showing 3. Outliers join no group.',
    );
    // The variance the map keeps is stated once, in the caption beside the measure.
    expect(within(strip()!).getByTestId('similarity-fit-quality')).toHaveTextContent(
      /^Silhouette 0\.61 · stress 0\.000 · 6 of 6 placed$/,
    );
    expect(within(strip()!).getByTestId('similarity-caption')).toHaveTextContent(
      'Distance: correlation (√(2−2r)) · 2-D keeps 100% of variance',
    );
    // The map's legend and points wear the headers' marks.
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((item) => item.querySelector('[data-glyph]')?.getAttribute('data-glyph')),
    ).toEqual(['circle', 'circle-open', 'diamond-hollow']);
    // A count chosen in the menu overrides the suggestion.
    choose('Group', 'count:2');
    await waitFor(() =>
      expect(within(strip()!).getByTestId('similarity-suggestion')).toHaveTextContent('showing 2.'),
    );
  });

  it('links a point and its tile both ways on hover', async () => {
    setup();
    await waitFor(() => expect(tiles()).toEqual(IDS));
    choose('Sort', 'similarity:pattern-shape');
    const point = (id: string) =>
      strip()!.querySelector<SVGCircleElement>(`circle[data-datum-id="${id}"]`)!;
    await waitFor(() => expect(point('sub003')).not.toBeNull());
    // Point → tile.
    fireEvent.pointerEnter(point('sub003'));
    expect(tile('sub003')).toHaveAttribute('data-linked', 'true');
    fireEvent.pointerLeave(point('sub003'));
    expect(tile('sub003')).not.toHaveAttribute('data-linked');
    // Tile → point.
    const canvas = tile('sub004').querySelector('canvas')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 40, 40));
    fireEvent.mouseMove(tile('sub004'), { clientX: 10, clientY: 10 });
    const ring = strip()!.querySelector('[data-mark="linked"]')!;
    expect(ring).not.toBeNull();
    expect(ring.getAttribute('cx')).toBe(point('sub004').getAttribute('cx'));
    expect(ring.getAttribute('cy')).toBe(point('sub004').getAttribute('cy'));
    // The hovered tile is not ringed by its own hover coming back through the map.
    expect(tile('sub004')).not.toHaveAttribute('data-linked');
  });

  it('shares tile hover across roots: another view marks the tile, the tile publishes its own', async () => {
    setup();
    await waitFor(() => expect(tiles()).toEqual(IDS));
    // No strip on screen: an Inspector row's hover still marks its tile.
    expect(strip()).toBeNull();
    act(() => populationMemberHover.set('sub003', 'inspector'));
    expect(tile('sub003')).toHaveAttribute('data-linked', 'true');
    act(() => populationMemberHover.set(null, 'inspector'));
    expect(tile('sub003')).not.toHaveAttribute('data-linked');
    // A tile under the pointer is published as the montage's hover…
    const canvas = tile('sub004').querySelector('canvas')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 40, 40));
    fireEvent.mouseMove(tile('sub004'), { clientX: 10, clientY: 10 });
    expect(populationMemberHover.getSnapshot()).toEqual({ memberId: 'sub004', source: 'montage' });
    // …and not echoed back onto the montage as a link mark.
    expect(tile('sub004')).not.toHaveAttribute('data-linked');
    // Leaving the grid withdraws it.
    fireEvent.mouseLeave(tile('sub004').closest('[data-montage-scroller]')!);
    await waitFor(() =>
      expect(populationMemberHover.getSnapshot()).toEqual({ memberId: null, source: null }),
    );
    populationMemberHover.reset();
  });

  it('a lasso on the map selects the tiles, as an exploratory selection', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    setup();
    await waitFor(() => expect(tiles()).toEqual(IDS));
    choose('Sort', 'similarity:pattern-shape');
    await waitFor(() => expect(strip()!.querySelectorAll('circle[data-datum-id]')).toHaveLength(6));
    // No Lasso button: a drag on empty space draws the lasso.
    expect(within(strip()!).queryByRole('button', { name: /Lasso/ })).toBeNull();
    const map = within(strip()!).getByRole('group', { name: 'Spatial MDS observations' });
    // jsdom lays nothing out: the frame's units are the client's here.
    const at = (id: string) => {
      const circle = map.querySelector(`circle[data-datum-id="${id}"]`)!;
      return [Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy'))] as const;
    };
    const lassoAround = (id: string, shiftKey = false) => {
      const [x, y] = at(id);
      fireEvent.pointerDown(map, { button: 0, clientX: x - 2, clientY: y - 2, shiftKey });
      for (const [dx, dy] of [
        [2, -2],
        [2, 2],
        [-2, 2],
      ])
        fireEvent.pointerMove(map, { clientX: x + dx, clientY: y + dy });
      fireEvent.pointerUp(map, { clientX: x - 2, clientY: y - 2 });
    };
    lassoAround('sub001');
    // Shift-drag adds.
    lassoAround('sub002', true);
    expect(state().population.working).toMatchObject({
      kind: 'members',
      memberIds: ['sub001', 'sub002'],
      origin: 'map-derived',
    });
    expect(tile('sub001')).toHaveAttribute('aria-pressed', 'true');
    expect(tile('sub002')).toHaveAttribute('aria-pressed', 'true');
    expect(tile('sub003')).toHaveAttribute('aria-pressed', 'false');
  });

  it('folds to a 24 px rail, remembered per dataset', async () => {
    setup();
    await waitFor(() => expect(tiles()).toEqual(IDS));
    choose('Sort', 'similarity:pattern-shape');
    await waitFor(() => expect(strip()).not.toBeNull());
    const slot = () => screen.getByTestId('similarity-strip-slot');
    expect(slot()).not.toHaveAttribute('data-collapsed');
    fireEvent.click(within(strip()!).getByRole('button', { name: 'Hide the similarity map' }));
    expect(slot()).toHaveAttribute('data-collapsed', 'true');
    expect(slot().style.width).toBe('24px');
    const setId = state().selection.activeSetId!;
    expect(usePopulationViewStore.getState().stripCollapsed[setId]).toBe(true);
    // Remembered across a reload of the app's memory, for this dataset only.
    act(() => reloadPopulationViewMemory());
    expect(usePopulationViewStore.getState().stripCollapsed[setId]).toBe(true);
    expect(usePopulationViewStore.getState().stripCollapsed['another-set']).toBeUndefined();
    fireEvent.click(within(strip()!).getByRole('button', { name: 'Show the similarity map' }));
    expect(slot()).not.toHaveAttribute('data-collapsed');
    expect(usePopulationViewStore.getState().stripCollapsed[setId]).toBe(false);
  });
});

describe('the strip\'s place', () => {
  it('is min(300 px, 40 % of the centre) inline, and a sheet below 720 px', () => {
    expect(stripLayout(1440, false)).toEqual({ mode: 'inline', width: 300 });
    expect(stripLayout(760, false)).toEqual({ mode: 'inline', width: 300 });
    expect(stripLayout(730, false)).toEqual({ mode: 'inline', width: 292 });
    expect(stripLayout(719, false).mode).toBe('sheet');
    // A sheet stays at most the strip's width and leaves 40 % of the grid visible.
    expect(stripLayout(508, false)).toEqual({ mode: 'sheet', width: 300 });
    expect(stripLayout(400, false)).toEqual({ mode: 'sheet', width: 240 });
    expect(stripLayout(700, false)).toEqual({ mode: 'sheet', width: 300 });
    expect(stripLayout(1440, true)).toEqual({ mode: 'inline', width: 24 });
  });

  it('lies over the grid\'s right edge in a narrow centre, so the grid keeps its columns', () => {
    const observers: ((width: number) => void)[] = [];
    const report = (width: number) => observers.forEach((notify) => notify(width));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe() {
          observers.push((width) =>
            this.callback(
              [{ contentRect: { width } } as ResizeObserverEntry],
              this as unknown as ResizeObserver,
            ),
          );
        }
        disconnect() {}
        unobserve() {}
      },
    );
    const onWidth = vi.fn();
    const props = {
      display: null,
      mirrorX: false,
      ids: IDS,
      groups: null,
      expanded: new Set<string>(),
      onExpand: () => {},
      columns: 3,
      onWidth,
      focusedId: null,
      selectedIds: new Set<string>(),
      onFocus: () => {},
      onToggle: () => {},
      onSelect: () => {},
      onClearSelection: () => {},
      selection: { onSaveGroup: () => {} },
      footer: { description: '', limit: 1, onLimit: () => {} },
      emptyText: '',
      height: 400,
      strip: { collapsed: false, render: () => <div>map</div> },
    };
    render(<PopulationMontage {...props} />);
    act(() => report(600));
    const slot = screen.getByTestId('similarity-strip-slot');
    expect(slot).toHaveAttribute('data-mode', 'sheet');
    expect(slot.className).toMatch(/absolute/);
  });
});

describe('below the images', () => {
  it('Summary has the panes and one footer line, nothing else', async () => {
    const { service } = setup();
    act(() =>
      state().setPopulationPresentation({ ...state().population.presentation, arrangement: 'inspect' }),
    );
    await waitFor(() => expect(service.getSnapshot().displayed).not.toBeNull());
    const section = screen.getByRole('region', { name: 'Population brain views' });
    const footer = within(section).getByTestId('montage-footer');
    expect(within(footer).getByRole('group', { name: 'Colour scale' })).toBeInTheDocument();
    // The footer is the section's last child, right after the images.
    expect(section.lastElementChild).toBe(footer);
    expect(within(footer).getByLabelText('Population navigation')).toBeInTheDocument();
    for (const gone of ['Statistical question', 'Spatial relationships', 'Population values'])
      expect(screen.queryByLabelText(gone)).toBeNull();
    expect(screen.queryByText(/Coverage and source revisions/)).toBeNull();
    expect(screen.queryByText(/Click either image to pin/)).toBeNull();
    expect(screen.queryByText('Select a range of observations')).toBeNull();
  });

  it('Montage has the grid and its footer, nothing else', async () => {
    setup();
    await waitFor(() => expect(tiles()).toEqual(IDS));
    const section = screen.getByRole('region', { name: 'Population brain views' });
    const montage = screen.getByRole('region', { name: 'Montage of subjects' });
    expect(section.lastElementChild).toBe(montage);
    expect(montage.lastElementChild).toHaveTextContent(/subjects/);
    expect(within(montage.lastElementChild as HTMLElement).getByRole('group', { name: 'Colour scale' })).toBeInTheDocument();
  });
});

describe('exploratory selections', () => {
  it('label A wherever it is named when the data chose it, and only then', async () => {
    const { service } = setup();
    act(() => {
      state().selectPopulationMembers(['sub001', 'sub002'], 'map-derived', 'Similarity map lasso');
      state().setPopulationReferenceMode('complement');
      state().setPopulationPresentation({
        ...state().population.presentation,
        arrangement: 'comparison',
      });
    });
    await waitFor(() => expect(service.getSnapshot().displayed?.query.request.reference).toBeTruthy());
    const title = await screen.findByTestId('population-exploratory-title');
    expect(title).toHaveTextContent('Exploratory selection');
    expect(title).toHaveAttribute(
      'title',
      'Chosen from the data; p-values are not valid for confirming it.',
    );
    expect(screen.getByRole('combobox', { name: 'Show' })).toHaveDisplayValue('A and B · exploratory A');
    // Said in the footer's status and tooltip (the description is not a line on it).
    const footer = screen.getByTestId('montage-footer');
    expect(within(footer).getByRole('status')).toHaveTextContent('(exploratory selection)');
    expect(footer).toHaveAttribute('title', expect.stringContaining('(exploratory selection)'));
    // A selection made by hand is not exploratory.
    act(() => state().selectPopulationMembers(['sub001', 'sub002'], 'manual', 'Picked'));
    await waitFor(() => expect(screen.queryByTestId('population-exploratory-title')).toBeNull());
    expect(screen.getByRole('combobox', { name: 'Show' })).toHaveDisplayValue('A and B');
  });
});

describe('review fixes: exploratory origin of grid selections', () => {
  it('a selection picked off a similarity order is exploratory; off the source order it is not', async () => {
    setup();
    await waitFor(() => expect(tiles()).toEqual(IDS));
    fireEvent.click(tile('sub002'), { shiftKey: true });
    expect(state().population.working).toMatchObject({ origin: 'manual' });
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    choose('Sort', 'similarity:pattern-shape');
    await waitFor(() => expect(strip()!.querySelectorAll('circle[data-datum-id]')).toHaveLength(6));
    fireEvent.click(tile('sub002'), { shiftKey: true });
    expect(state().population.working).toMatchObject({ origin: 'map-derived' });
    // Adding a hand-picked one keeps it exploratory.
    fireEvent.click(tile('sub004'), { shiftKey: true });
    expect(state().population.working).toMatchObject({
      origin: 'map-derived',
      memberIds: ['sub002', 'sub004'],
    });
  });

  it('dropping one subject from a similarity group keeps the selection exploratory', async () => {
    setup();
    await waitFor(() => expect(tiles()).toEqual(IDS));
    choose('Group', 'similarity:pattern-shape');
    await waitFor(() => expect(state().population.partition?.origin).toBe('map-derived'));
    const group2 = screen.getByRole('region', { name: 'Group 2' });
    fireEvent.click(within(group2).getByRole('button', { name: 'Select Group 2' }));
    expect(state().population.working).toMatchObject({
      origin: 'map-derived',
      memberIds: ['sub003', 'sub004', 'sub005'],
    });
    fireEvent.click(tile('sub004'), { shiftKey: true });
    expect(state().population.working).toMatchObject({
      origin: 'map-derived',
      memberIds: ['sub003', 'sub005'],
    });
    // Outliers are never offered as a group to select.
    const outliers = screen.getByRole('region', { name: 'Outliers' });
    expect(within(outliers).queryByRole('button', { name: /^Select / })).toBeNull();
    expect(within(outliers).queryByRole('button', { name: /^Show mean of/ })).toBeNull();
  });

  it('the group count stays within the cuts the fit scored, and says so', async () => {
    setup();
    await waitFor(() => expect(tiles()).toEqual(IDS));
    choose('Group', 'similarity:pattern-shape');
    await waitFor(() => expect(state().population.partition?.origin).toBe('map-derived'));
    const group = screen.getByRole('combobox', { name: 'Group' });
    // The fixture's cuts are 2..5 (Rust scores 2..=min(8, n − 1)): the menu offers no more.
    const counts = [...group.querySelectorAll('optgroup[label="Number of groups"] option')].map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(counts).toEqual(['count:auto', 'count:2', 'count:3', 'count:4', 'count:5']);
    expect(group).toHaveAttribute('title', expect.stringMatching(/up to 5 groups/));
    expect(state().population.partition?.groups.some((g) => g.id === 'outliers')).toBe(true);
    expect([...group.querySelectorAll('option')].find((o) => o.selected)?.textContent).toBe(
      'r · 2 groups · +1 outlier',
    );
    // A chosen count, then Auto: back to the suggestion.
    choose('Group', 'count:2');
    await waitFor(() => expect(group).not.toHaveAttribute('data-auto'));
    choose('Group', 'count:auto');
    await waitFor(() => expect(group).toHaveAttribute('data-auto', 'true'));
    expect([...group.querySelectorAll('option')].find((o) => o.selected)?.textContent).toBe(
      'r · 2 groups · +1 outlier',
    );
  });
});

describe('review fixes: the strip', () => {
  it('a regional fit says where it was made, and goes out of date when the pin or "Compare within" moves', async () => {
    setup();
    await waitFor(() => expect(tiles()).toEqual(IDS));
    // Pin at the crosshair with a radius (the app's own action: its support is the lens's).
    act(() => populationProbeActions.pin(6, false));
    act(() => state().setPopulationSimilarityRegion('probe'));
    choose('Sort', 'similarity:pattern-shape');
    await waitFor(() =>
      expect(within(strip()!).getByRole('heading')).toHaveTextContent(
        /within the pinned region \(r = \d+ mm\)/,
      ),
    );
    expect(within(strip()!).queryByText('Out of date')).toBeNull();
    // Moving the radius makes the fit out of date: Refit, and nearest/centre stop.
    act(() => {
      const pin = state().population.pinnedProbe!;
      state().setPopulationProbe({ ...pin, radiusMm: pin.radiusMm + 2 }, 'pin');
    });
    await waitFor(() => expect(within(strip()!).getByText('Out of date')).toBeInTheDocument());
    expect(within(strip()!).getByRole('button', { name: 'Refit' })).toBeInTheDocument();
    expect(populationRelationshipService.usableFit()).toBeNull();
  });

  it('Escape folds a sheet and focus returns to its rail; opening moves focus into the map', async () => {
    setup();
    await waitFor(() => expect(tiles()).toEqual(IDS));
    choose('Sort', 'similarity:pattern-shape');
    await waitFor(() => expect(strip()!.querySelectorAll('circle[data-datum-id]')).toHaveLength(6));
    fireEvent.keyDown(strip()!, { key: 'Escape' });
    expect(screen.getByTestId('similarity-strip-slot')).toHaveAttribute('data-collapsed', 'true');
    const open = within(strip()!).getByRole('button', { name: 'Show the similarity map' });
    expect(document.activeElement).toBe(open);
    fireEvent.click(open);
    expect(document.activeElement).toBe(strip());
  });

  it('a point says its subject and value at the pin in the strip, whatever its tile shows', async () => {
    setup();
    await waitFor(() => expect(tiles()).toEqual(IDS));
    choose('Sort', 'similarity:pattern-shape');
    const point = () => strip()!.querySelector<SVGCircleElement>('circle[data-datum-id="sub005"]')!;
    await waitFor(() => expect(point()).not.toBeNull());
    fireEvent.pointerEnter(point());
    expect(within(strip()!).getByTestId('similarity-readout')).toHaveTextContent('sub005');
    // Discoverable keyboard selection: one interaction away, behind the map's ⓘ.
    fireEvent.click(within(strip()!).getByRole('button', { name: 'About this map' }));
    expect(within(strip()!).getByTestId('similarity-howto').textContent).toMatch(
      /Shift\+Enter or Shift\+Space adds or removes one/,
    );
  });
});

