import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { PopulationGroupViews } from '../PopulationGroupViews';
import { PopulationScaleStrip } from '../PopulationColorbar';
import { scaleClipping } from '@/services/studio/studioMapDisplay';
import {
  CARD_HEADER_PX,
  CARD_SCALE_PX,
  allCardStatistic,
  cardHeader,
  cardScaleText,
  croppedPlane,
  differenceCardHeader,
  fitSummaryCards,
  positiveFractionTick,
  shortGroupLabel,
  summaryCardCrop,
  useCroppedCard,
  useGroupMeanDifference,
} from '../summaryCards';
import { useSetStudioStore } from '@/stores/setStudioStore';
import type { PopulationSliceDisplay } from '@/services/studio/PopulationSliceService';

vi.mock('@/components/views/sliceViewer', () => ({
  ReusableSliceViewport: () => null,
  SliceViewerImageSurface: () => null,
}));

beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const plane = {
  origin_mm: [10, 20, 30] as [number, number, number],
  u_mm: [1, 0, 0] as [number, number, number],
  v_mm: [0, -2, 0] as [number, number, number],
  dim_px: [4, 3] as [number, number],
};

function display(summary: PopulationSliceDisplay['query']['request']['summary'] = 'mean') {
  const image = {} as ImageBitmap;
  return {
    query: {
      key: 'k',
      datasetKey: 'd',
      groupLabels: { g1: 'Group 1', g2: 'Group 2' },
      request: {
        summary,
        orientation: 'axial',
        groups: [
          { id: 'g1', memberIds: ['a', 'b'] },
          { id: 'g2', memberIds: ['c'] },
        ],
      },
    },
    data: {
      plane,
      summary: Array(12).fill(0.5),
      unitCount: 3,
      groups: [
        { id: 'g1', values: Array(12).fill(2), validCounts: [], eligibleCount: 2, unitCount: 2 },
        { id: 'g2', values: Array(12).fill(1), validCounts: [], eligibleCount: 1, unitCount: 1 },
      ],
    },
    images: { summary: image, groups: { g1: image, g2: image } },
    effectLimit: 0.0145,
    summaryLimit: 4.2,
  } as unknown as PopulationSliceDisplay;
}

const crosshairStyle = undefined as never;

it('orders the difference first, then the groups, then All; titles never cut', () => {
  render(
    <PopulationGroupViews
      display={display()}
      width={1000}
      current
      crosshairStyle={crosshairStyle}
      crosshairVisible
    />,
  );
  const cards = screen.getAllByTestId('population-summary-card');
  expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual([
    'G1 − G2',
    'G1',
    'G2',
    'All',
  ]);
  expect(within(cards[0]).getByRole('heading')).toHaveTextContent(/^G1 − G2 · 2 vs 1$/);
  expect(within(cards[1]).getByRole('heading')).toHaveTextContent(/^G1 · 2$/);
  expect(within(cards[3]).getByRole('heading')).toHaveTextContent(/^All · 3$/);
  for (const card of cards)
    expect(within(card).getByRole('heading').className).not.toMatch(/truncate/);
  // The statistic is chosen in the toolbar's Show: no switch on the card.
  expect(screen.queryByRole('radiogroup')).toBeNull();
});

it('gives a card its own bar only for a scale of its own (the difference, t)', () => {
  render(
    <PopulationGroupViews
      display={display('oneSampleT')}
      width={1000}
      current
      crosshairStyle={crosshairStyle}
      crosshairVisible
    />,
  );
  const all = screen.getByRole('region', { name: 'All' });
  expect(within(all).getByRole('heading')).toHaveTextContent(/^All · 3 · t$/);
  expect(within(all).getByTestId('population-card-scale')).toHaveTextContent('4.2');
  // A group mean is on the shared scale: the bar below the cards states it.
  const group = screen.getByRole('region', { name: 'G1' });
  expect(within(group).queryByTestId('population-card-scale')).toBeNull();
  expect(within(group).getByRole('heading')).toHaveAttribute(
    'title',
    'Mean of G1; colour ±0.0145',
  );
  // G1 − G2 has its own symmetric limit (here the means differ by exactly 1).
  const difference = screen.getByRole('region', { name: 'G1 − G2' });
  expect(within(difference).getByTestId('population-card-scale')).toHaveTextContent('1');
});

it('keeps each group\'s actions in a ⋯', () => {
  render(
    <PopulationGroupViews
      display={display()}
      width={1000}
      current
      crosshairStyle={crosshairStyle}
      crosshairVisible
    />,
  );
  const group = screen.getByRole('region', { name: 'G1' });
  expect(group).not.toHaveTextContent(/observations|analysis units/);
  expect(within(group).queryByRole('button', { name: 'Use as A' })).toBeNull();
  fireEvent.click(within(group).getByRole('button', { name: 'Actions for G1' }));
  expect(screen.getByRole('menuitem', { name: 'Use as A' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Use as B' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Show contributors' })).toBeInTheDocument();
});

it('every card, G1 − G2 and All included, has its ⋯ right-aligned inside its own header', () => {
  render(
    <PopulationGroupViews
      display={display()}
      width={1000}
      current
      crosshairStyle={crosshairStyle}
      crosshairVisible
    />,
  );
  const cards = screen.getAllByTestId('population-summary-card');
  for (const card of cards) {
    const header = within(card).getByTestId('population-card-header');
    const actions = within(header).getByTestId('population-card-actions');
    // The last thing in its own header, pushed to the right.
    expect(header.lastElementChild).toBe(actions);
    expect(actions).toHaveClass('ml-auto');
    expect(within(actions).getByRole('button', { name: /^Actions for / })).toBeInTheDocument();
  }
  fireEvent.click(
    within(screen.getByRole('region', { name: 'G1 − G2' })).getByRole('button', { name: 'Actions for G1 − G2' }),
  );
  expect(screen.getByRole('menuitem', { name: 'Use G1 as A, G2 as B' })).toBeInTheDocument();
});

it('keeps the A badge on the card of the group that is A', () => {
  useSetStudioStore.setState((state) => ({
    population: {
      ...state.population,
      working: { kind: 'members', memberIds: ['b', 'a'], origin: 'metadata', label: 'Group 1' },
    },
  }));
  render(
    <PopulationGroupViews
      display={display()}
      width={1000}
      current
      crosshairStyle={crosshairStyle}
      crosshairVisible
    />,
  );
  expect(
    within(screen.getByRole('region', { name: 'G1' })).getByTestId('population-card-badge-A'),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole('region', { name: 'G2' })).queryByTestId('population-card-badge-A'),
  ).toBeNull();
});

it('fits k = 2 on one screen: one row when wide, 2 × 2 when tall', () => {
  // Four square brains in a wide, short pane: one row draws them largest.
  const wide = fitSummaryCards({ count: 4, width: 1200, height: 360, aspect: 1, gap: 12 });
  expect(wide.columns).toBe(4);
  expect(2 * (CARD_HEADER_PX + CARD_SCALE_PX) + wide.imageHeight).toBeLessThanOrEqual(
    360 + CARD_HEADER_PX + CARD_SCALE_PX,
  );
  // A tall pane: two rows of two, every card within the height.
  const tall = fitSummaryCards({ count: 4, width: 700, height: 760, aspect: 1, gap: 12 });
  expect(tall.columns).toBe(2);
  expect(2 * (tall.imageHeight + CARD_HEADER_PX + CARD_SCALE_PX) + 12).toBeLessThanOrEqual(760);
  // Unknown height: the width alone decides.
  expect(fitSummaryCards({ count: 4, width: 1000, height: null, aspect: 1, gap: 12 }).columns).toBe(
    3,
  );
});

it('lays the grid out by the fit and keeps its size as the slice steps', () => {
  const d = display();
  const { container, rerender } = render(
    <PopulationGroupViews
      display={d}
      width={1200}
      height={360}
      current
      crosshairStyle={crosshairStyle}
      crosshairVisible
    />,
  );
  const grid = container.querySelector('[aria-label="Group effects"]') as HTMLElement;
  expect(grid.dataset.columns).toBe('4');
  const before = (screen.getAllByTestId('population-summary-card')[0].children[1] as HTMLElement)
    .style.height;
  // The next slice: same frame, a different depth.
  const next = {
    ...d,
    query: { ...d.query, request: { ...d.query.request, crosshairMm: [0, 0, 2] } },
    data: { ...d.data, plane: { ...plane, origin_mm: [10, 20, 32] } },
  } as unknown as PopulationSliceDisplay;
  rerender(
    <PopulationGroupViews
      display={next}
      width={1200}
      height={360}
      current
      crosshairStyle={crosshairStyle}
      crosshairVisible
    />,
  );
  expect(
    (screen.getAllByTestId('population-summary-card')[0].children[1] as HTMLElement).style.height,
  ).toBe(before);
});

it('has no difference card with a single group', () => {
  const one = display();
  (one.data as { groups: unknown[] }).groups = one.data.groups!.slice(0, 1);
  render(
    <PopulationGroupViews
      display={one}
      width={500}
      current
      crosshairStyle={crosshairStyle}
      crosshairVisible
    />,
  );
  expect(screen.getAllByTestId('population-summary-card')).toHaveLength(2);
});

it('card models: statistic, scale text, headers, short labels and the sign-share ticks', () => {
  expect(allCardStatistic('mad')).toBe('mean');
  expect(allCardStatistic('positiveFraction')).toBe('positiveFraction');
  expect(cardScaleText('positiveFraction', 0.5)).toBe('colour 0–100 %');
  expect(cardScaleText('mean', 0.014523)).toBe('colour ±0.0145');
  expect(cardHeader('G1', 29)).toBe('G1 · 29');
  expect(cardHeader('All', 35, 't')).toBe('All · 35 · t');
  expect(differenceCardHeader({ label: 'G1', count: 29 }, { label: 'G2', count: 6 })).toBe(
    'G1 − G2 · 29 vs 6',
  );
  expect(shortGroupLabel('Similarity group 2')).toBe('G2');
  expect(shortGroupLabel('Group 1')).toBe('G1');
  expect(shortGroupLabel('Controls')).toBe('Controls');
  expect(positiveFractionTick(-0.5)).toBe('0 %');
  expect(positiveFractionTick(0)).toBe('50 %');
  expect(positiveFractionTick(0.5)).toBe('100 %');
});

it('cards share one crop: the head and drawn values, the plane moved to its corner', () => {
  const d = display();
  // Anatomy only in the middle two columns of the middle row.
  (d.data as { underlay: unknown }).underlay = {
    values: [0, 0, 0, 0, 0, 5, 6, 0, 0, 0, 0, 0],
  };
  const { crop, background } = summaryCardCrop(d, []);
  expect(background).not.toBeNull();
  // The 1 × 2 head, widened by the 2 px margin and kept inside the 4 × 3 cell.
  expect(crop).toEqual({ x: 0, y: 0, width: 4, height: 3 });
  const inner = croppedPlane(plane, { x: 1, y: 1, width: 2, height: 1 });
  expect(inner.origin_mm).toEqual([11, 18, 30]);
  expect(inner.dim_px).toEqual([2, 1]);
  expect(inner.u_mm).toEqual(plane.u_mm);
});

it('keeps the cards\' crop across slices of one frame (the largest seen), not across orientations', () => {
  const at = (z: number, head: number[], orientation = 'axial') => {
    const d = display();
    const big = { ...plane, origin_mm: [10, 20, z] as [number, number, number], dim_px: [12, 12] as [number, number] };
    const values = Array<number>(144).fill(0);
    for (const i of head) values[i] = 5;
    return {
      ...d,
      query: { ...d.query, request: { ...d.query.request, orientation } },
      data: { ...d.data, plane: big, summary: Array(144).fill(null), groups: [], underlay: { values } },
    } as unknown as PopulationSliceDisplay;
  };
  const memory = { key: null, crop: null };
  const first = summaryCardCrop(at(30, [5 * 12 + 5]), [], memory).crop;
  expect(first).toEqual({ x: 3, y: 3, width: 5, height: 5 });
  // The next slice's head is elsewhere: the crop holds both, and keeps them.
  const second = summaryCardCrop(at(32, [8 * 12 + 8]), [], memory).crop;
  expect(second).toEqual({ x: 3, y: 3, width: 8, height: 8 });
  expect(summaryCardCrop(at(30, [5 * 12 + 5]), [], memory).crop).toEqual(second);
  // Another orientation starts again.
  expect(summaryCardCrop(at(30, [5 * 12 + 5], 'coronal'), [], memory).crop).toEqual(first);
});

it('never draws the uncut plane between slices: the last cut stays until the new one is made', async () => {
  const pending: ((bitmap: ImageBitmap) => void)[] = [];
  class FakeCanvas {
    constructor(
      public width: number,
      public height: number,
    ) {}
    getContext() {
      return {
        drawImage: () => {},
        getImageData: () => ({ data: new Uint8ClampedArray(this.width * this.height * 4) }),
        putImageData: () => {},
      };
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(() => new Promise<ImageBitmap>((resolve) => pending.push(resolve))),
  );
  try {
    const crop = { x: 1, y: 0, width: 2, height: 3 };
    const sliceA = { id: 'a' } as unknown as ImageBitmap;
    const sliceB = { id: 'b' } as unknown as ImageBitmap;
    const { result, rerender } = renderHook(
      ({ image }) => useCroppedCard(image, plane, crop, null, 'card'),
      { initialProps: { image: sliceA } },
    );
    // Before the first cut: nothing, at the cut's geometry (never the whole plane).
    expect(result.current.image).toBeNull();
    expect(result.current.plane.dim_px).toEqual([2, 3]);
    const cutA = { id: 'cut-a' } as unknown as ImageBitmap;
    await act(async () => pending.shift()!(cutA));
    expect(result.current.image).toBe(cutA);
    // The next slice: the previous cut stays on screen while the new one is made.
    rerender({ image: sliceB });
    expect(result.current.image).toBe(cutA);
    expect(result.current.plane.dim_px).toEqual([2, 3]);
    const cutB = { id: 'cut-b' } as unknown as ImageBitmap;
    await act(async () => pending.shift()!(cutB));
    expect(result.current.image).toBe(cutB);
  } finally {
    vi.unstubAllGlobals();
  }
});

function stubCanvas(
  pending: ((bitmap: ImageBitmap) => void)[],
  rejects: ((error: unknown) => void)[] = [],
  context: 'ok' | 'none' = 'ok',
) {
  class FakeCanvas {
    constructor(
      public width: number,
      public height: number,
    ) {}
    getContext() {
      if (context === 'none') return null;
      return {
        drawImage: () => {},
        getImageData: () => ({ data: new Uint8ClampedArray(this.width * this.height * 4) }),
        putImageData: () => {},
      };
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(
      () =>
        new Promise<ImageBitmap>((resolve, reject) => {
          pending.push(resolve);
          rejects.push(reject);
        }),
    ),
  );
}

it('shows no stale cut when the card identity, crop or background changes', async () => {
  const pending: ((bitmap: ImageBitmap) => void)[] = [];
  stubCanvas(pending);
  try {
    const crop = { x: 1, y: 0, width: 2, height: 3 };
    const sliceA = { id: 'a' } as unknown as ImageBitmap;
    const sliceB = { id: 'b' } as unknown as ImageBitmap;
    const { result, rerender } = renderHook(
      ({ image, identity, c, bg }) => useCroppedCard(image, plane, c, bg, identity),
      {
        initialProps: {
          image: sliceA,
          identity: 'mean',
          c: crop,
          bg: null as Uint8Array | null,
        },
      },
    );
    const cutA = { id: 'cut-a' } as unknown as ImageBitmap;
    await act(async () => pending.shift()!(cutA));
    expect(result.current.image).toBe(cutA);
    // Another statistic (identity): blank until its own cut, never the mean's.
    rerender({ image: sliceB, identity: 't', c: crop, bg: null });
    expect(result.current.image).toBeNull();
    const cutB = { id: 'cut-b' } as unknown as ImageBitmap;
    await act(async () => pending.shift()!(cutB));
    expect(result.current.image).toBe(cutB);
    // Same image, a new crop: the old cut is not taken for this crop's cut. It
    // may stay (same card) only at its own geometry while the new cut is made.
    const wider = { x: 0, y: 0, width: 3, height: 3 };
    rerender({ image: sliceB, identity: 't', c: wider, bg: null });
    expect(pending).toHaveLength(1);
    expect(result.current.image).toBe(cutB);
    expect(result.current.plane.dim_px).toEqual([2, 3]);
    const cutC = { id: 'cut-c' } as unknown as ImageBitmap;
    await act(async () => pending.shift()!(cutC));
    expect(result.current.image).toBe(cutC);
    expect(result.current.plane.dim_px).toEqual([3, 3]);
    // Same image and crop, a new background: a new cut is made and used.
    rerender({ image: sliceB, identity: 't', c: wider, bg: new Uint8Array(12) });
    expect(pending).toHaveLength(1);
    const cutD = { id: 'cut-d' } as unknown as ImageBitmap;
    await act(async () => pending.shift()!(cutD));
    expect(result.current.image).toBe(cutD);
    // And a new card at the same moment as a crop change: blank, not stale.
    rerender({ image: sliceA, identity: 'G2', c: crop, bg: null });
    expect(result.current.image).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('falls back to the whole image when a cut cannot be made', async () => {
  const crop = { x: 1, y: 0, width: 2, height: 3 };
  const image = { id: 'a' } as unknown as ImageBitmap;
  // No 2D context.
  stubCanvas([], [], 'none');
  try {
    const { result } = renderHook(() => useCroppedCard(image, plane, crop, null, 'card'));
    expect(result.current.image).toBe(image);
    expect(result.current.plane).toBe(plane);
  } finally {
    vi.unstubAllGlobals();
  }
  // createImageBitmap rejects.
  const pending: ((bitmap: ImageBitmap) => void)[] = [];
  const rejects: ((error: unknown) => void)[] = [];
  stubCanvas(pending, rejects);
  try {
    const { result } = renderHook(() => useCroppedCard(image, plane, crop, null, 'card'));
    expect(result.current.image).toBeNull();
    await act(async () => rejects.shift()!(new Error('refused')));
    expect(result.current.image).toBe(image);
    expect(result.current.plane).toBe(plane);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('never pairs an old difference raster with a new pair or limit', async () => {
  const pending: ((bitmap: ImageBitmap) => void)[] = [];
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(() => new Promise<ImageBitmap>((resolve) => pending.push(resolve))),
  );
  if (typeof ImageData === 'undefined')
    vi.stubGlobal(
      'ImageData',
      class {
        constructor(
          public data: Uint8ClampedArray,
          public width: number,
          public height: number,
        ) {}
      },
    );
  try {
    const d = {
      data: { plane: { ...plane, dim_px: [2, 1] } },
      underlay: null,
    } as unknown as PopulationSliceDisplay;
    const a1 = [1, 2];
    const a2 = [0, 0];
    const b1 = [5, -4];
    const b2 = [0, 0];
    const { result, rerender } = renderHook(
      ({ first, second, identity }) => useGroupMeanDifference(d, first, second, identity),
      { initialProps: { first: a1, second: a2, identity: 'G1-G2' } },
    );
    expect(result.current.image).toBeNull();
    const rasterA = { id: 'diff-a' } as unknown as ImageBitmap;
    await act(async () => pending.shift()!(rasterA));
    expect(result.current.image).toBe(rasterA);
    const limitA = result.current.limit;
    // Another pair: the old raster is not shown under the new pair's limit.
    rerender({ first: b1, second: b2, identity: 'G1-G3' });
    expect(result.current.image).toBeNull();
    expect(result.current.limit).not.toBe(limitA);
    const rasterB = { id: 'diff-b' } as unknown as ImageBitmap;
    await act(async () => pending.shift()!(rasterB));
    expect(result.current.image).toBe(rasterB);
    // A slice step of the same pair: the old raster stays, with its own limit.
    const limitB = result.current.limit;
    rerender({ first: [1, 1], second: [0, 3], identity: 'G1-G3' });
    expect(result.current.image).toBe(rasterB);
    expect(result.current.limit).toBe(limitB);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('fits cards to an unmeasured width without NaN', () => {
  for (const width of [Number.NaN, -10, Number.POSITIVE_INFINITY]) {
    const fit = fitSummaryCards({ count: 3, width, height: 400, aspect: 1, gap: 12 });
    expect(Number.isFinite(fit.cellWidth)).toBe(true);
    expect(Number.isFinite(fit.imageHeight)).toBe(true);
    expect(fit.columns).toBeGreaterThanOrEqual(1);
    const unknown = fitSummaryCards({ count: 3, width, height: null, aspect: 1, gap: 12 });
    expect(Number.isFinite(unknown.cellWidth)).toBe(true);
  }
});

it('marks the ends of a colour bar the data run past', () => {
  expect(scaleClipping([-0.045, 0.01], -0.0145, 0.0145)).toEqual({ low: true, high: false });
  expect(scaleClipping([0.001, null, -0.002], -0.0145, 0.0145)).toEqual({ low: false, high: false });
  expect(scaleClipping(null, -1, 1)).toBeNull();
  const { container } = render(
    <PopulationScaleStrip
      limit={0.0145}
      range="−0.0145 to 0.0145"
      clipped={{ low: true, high: false }}
    />,
  );
  expect(container.querySelector('[data-testid="scale-clipped-low"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="scale-clipped-high"]')).toBeNull();
  expect(screen.getByTestId('montage-scale-bar')).toHaveAccessibleName(
    /values beyond the lower end drawn at the end colour$/,
  );
});
