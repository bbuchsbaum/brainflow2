import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  PopulationImages,
  type PopulationSliceDisplay,
} from '@/services/studio/PopulationSliceService';
import { MontageGroupRows } from '../MontageGroupRows';
import { MontageGrid, MontageSurface } from '../MontageTiles';
import {
  MONTAGE_COLUMN_GAP_PX,
  clearTileBackground,
  commonIdPrefix,
  montageGridStyle,
  createMontageCropMemory,
  montageCropKey,
  flipOffsets,
  montageBackground,
  montageSharedCrop,
  montageSprites,
  shortId,
} from '../montageTileSupport';
import { MONTAGE_GAP_PX, groupedPages } from '../montageModel';

const drawImage = vi.fn();
/** The modifier tests below default to a Mac (⌘ adds); some switch to another platform. */
const setPlatform = (value: string) =>
  Object.defineProperty(window.navigator, 'platform', { value, configurable: true });
beforeEach(() => {
  setPlatform('MacIntel');
  drawImage.mockClear();
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  cleanup();
  delete (window.navigator as { platform?: string }).platform;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const IDS = ['A', 'B', 'C', 'D'];
function display(ids = IDS): PopulationSliceDisplay {
  const image = { width: 8, height: 2, close: vi.fn() } as unknown as ImageBitmap;
  return {
    query: { key: 'fixture' },
    data: {
      cutouts: {
        plane: {
          origin_mm: [0, 0, 0],
          u_mm: [1, 0, 0],
          v_mm: [0, 1, 0],
          dim_px: [2, 2],
        },
        members: ids.map((memberId, i) => ({
          memberId,
          values: i === 3 ? [null, null, null, null] : [i, 0, null, i],
          validPixels: i === 3 ? 0 : 3,
        })),
      },
    },
    images: new PopulationImages(image, image, image),
  } as unknown as PopulationSliceDisplay;
}
const rect = (left: number, top: number, size = 100) =>
  ({
    left,
    top,
    right: left + size,
    bottom: top + size,
    width: size,
    height: size,
    x: left,
    y: top,
    toJSON() {},
  }) as DOMRect;
/** Lay the tiles out two to a row, 100 px each with a 10 px gap, in a 220 × 400 grid. */
function layOut(viewHeight = 400) {
  IDS.forEach((id, i) => {
    const tile = screen.queryByRole('button', { name: `Focus subject ${id}` });
    if (tile)
      vi.spyOn(tile, 'getBoundingClientRect').mockReturnValue(
        rect((i % 2) * 110, Math.floor(i / 2) * 110),
      );
  });
  const scroller = document.querySelector<HTMLElement>('[data-montage-scroller]')!;
  vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({
    ...rect(0, 0),
    right: 220,
    width: 220,
    bottom: viewHeight,
    height: viewHeight,
  } as DOMRect);
  return scroller;
}

function grid(
  overrides: { focusedId?: string | null; selected?: string[]; viewHeight?: number } = {},
) {
  const handlers = {
    onFocus: vi.fn(),
    onToggle: vi.fn(),
    onSelect: vi.fn(),
    onHover: vi.fn(),
    onClearSelection: vi.fn(),
  };
  const view = render(
    <MontageSurface
      columns={2}
      cellIds={IDS}
      activeId={overrides.focusedId ?? 'B'}
      scope="fixture"
      onSelect={handlers.onSelect}
      onClearSelection={handlers.onClearSelection}
      hasSelection={(overrides.selected ?? []).length > 0}
    >
      <MontageGrid
        ids={IDS}
        columns={2}
        sprites={montageSprites(display(), false)}
        focusedId={overrides.focusedId ?? 'B'}
        selectedIds={new Set(overrides.selected ?? [])}
        onFocus={handlers.onFocus}
        onToggle={handlers.onToggle}
        onHover={handlers.onHover}
      />
    </MontageSurface>,
  );
  const scroller = layOut(overrides.viewHeight);
  return { ...handlers, ...view, scroller };
}
/** A pointer move with the primary button held, as a real drag reports it. */
const dragTo = (target: Element, clientX: number, clientY: number) =>
  fireEvent.pointerMove(target, { clientX, clientY, buttons: 1 });
const tile = (id: string) => screen.getByRole('button', { name: `Focus subject ${id}` });

it('draws one tile per subject with the ID alone in the label and its coverage in plain words in the tooltip', () => {
  grid({ selected: ['A'] });
  expect(drawImage).toHaveBeenCalledTimes(4);
  expect(tile('B')).toHaveAttribute('aria-current', 'true');
  expect(tile('B')).toHaveTextContent(/^B$/);
  expect(tile('B')).toHaveAttribute(
    'title',
    'B — 75% of the slice has data\nClick to focus · Shift- or ⌘-click to select · drag across tiles to select several · Esc clears · double-click to open',
  );
  // A selected tile says so; a slice without data says that plainly.
  expect(tile('A').getAttribute('title')).toMatch(/^A — 75% of the slice has data · selected\n/);
  expect(tile('D').getAttribute('title')).toMatch(/^D — no data in this slice\n/);
  expect(tile('A')).toHaveAttribute('aria-pressed', 'true');
  expect(tile('C')).toHaveAttribute('aria-pressed', 'false');
  // A subject whose slice has no data says so on the tile.
  expect(tile('D')).toHaveTextContent('No coverage');
});

it('a click focuses, Shift-click and Shift-Enter toggle, and a still press is not a drag', () => {
  const { onFocus, onToggle, onSelect } = grid();
  fireEvent.pointerDown(tile('C'), { button: 0, clientX: 20, clientY: 130 });
  // Travel under the threshold: still a click.
  dragTo(tile('C'), 22, 131);
  fireEvent.pointerUp(tile('C'), { clientX: 22, clientY: 131 });
  fireEvent.click(tile('C'));
  expect(onFocus).toHaveBeenCalledWith('C');
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.queryByTestId('montage-drag-rect')).toBeNull();
  fireEvent.click(tile('A'), { shiftKey: true });
  expect(onToggle).toHaveBeenCalledWith('A');
  fireEvent.keyDown(tile('B'), { key: 'Enter', shiftKey: true });
  expect(onToggle).toHaveBeenLastCalledWith('B');
  expect(onFocus).toHaveBeenCalledTimes(1);
});

it('dragging across tiles selects every tile the rectangle touches, without focusing', () => {
  const { onFocus, onSelect } = grid();
  fireEvent.pointerDown(tile('A'), { button: 0, clientX: 20, clientY: 20 });
  dragTo(tile('B'), 150, 60);
  expect(screen.getByTestId('montage-drag-rect')).toBeInTheDocument();
  // Nothing is selected until release.
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.pointerUp(tile('B'), { clientX: 150, clientY: 60 });
  expect(onSelect).toHaveBeenCalledWith(['A', 'B'], false);
  expect(screen.queryByTestId('montage-drag-rect')).toBeNull();
  // The click that ends the gesture is not a focus…
  fireEvent.click(tile('B'));
  expect(onFocus).not.toHaveBeenCalled();
  // …and the next plain click is one again.
  fireEvent.click(tile('B'));
  expect(onFocus).toHaveBeenCalledWith('B');
});

it('a Shift-drag adds to the selection and Escape cancels a drag', () => {
  const { onSelect } = grid();
  fireEvent.pointerDown(tile('C'), { button: 0, clientX: 20, clientY: 130, shiftKey: true });
  dragTo(tile('D'), 150, 170);
  fireEvent.pointerUp(tile('D'), { clientX: 150, clientY: 170 });
  expect(onSelect).toHaveBeenLastCalledWith(['C', 'D'], true);
  onSelect.mockClear();
  fireEvent.pointerDown(tile('A'), { button: 0, clientX: 20, clientY: 20 });
  dragTo(tile('B'), 150, 60);
  expect(screen.getByTestId('montage-drag-rect')).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByTestId('montage-drag-rect')).toBeNull();
  fireEvent.pointerUp(tile('B'), { clientX: 150, clientY: 60 });
  expect(onSelect).not.toHaveBeenCalled();
});

it('after Escape, the release of that same press neither selects nor focuses a tile', () => {
  const { onFocus, onSelect } = grid();
  fireEvent.pointerDown(tile('A'), { button: 0, clientX: 20, clientY: 20 });
  dragTo(tile('B'), 150, 60);
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.pointerUp(tile('B'), { clientX: 150, clientY: 60 });
  fireEvent.click(tile('B'));
  expect(onFocus).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
  // The next press is an ordinary click again.
  fireEvent.pointerDown(tile('C'), { button: 0, clientX: 20, clientY: 130 });
  fireEvent.pointerUp(tile('C'), { clientX: 20, clientY: 130 });
  fireEvent.click(tile('C'));
  expect(onFocus).toHaveBeenCalledWith('C');
});

it('a press released where the grid never heard it leaves no phantom drag', () => {
  const { onSelect } = grid();
  fireEvent.pointerDown(tile('A'), { button: 0, clientX: 20, clientY: 20 });
  // The button came up outside: the pointer returns with nothing held.
  fireEvent.pointerMove(tile('D'), { clientX: 150, clientY: 170, buttons: 0 });
  expect(screen.queryByTestId('montage-drag-rect')).toBeNull();
  fireEvent.pointerMove(tile('D'), { clientX: 160, clientY: 180, buttons: 0 });
  fireEvent.pointerUp(tile('D'), { clientX: 160, clientY: 180 });
  expect(onSelect).not.toHaveBeenCalled();
  // A ctrl-press (the context menu) and a press on the scrollbar start nothing either.
  fireEvent.pointerDown(tile('A'), { button: 0, clientX: 20, clientY: 20, ctrlKey: true });
  dragTo(tile('B'), 150, 60);
  expect(screen.queryByTestId('montage-drag-rect')).toBeNull();
  fireEvent.pointerUp(tile('B'), { clientX: 150, clientY: 60 });
  fireEvent.pointerDown(tile('A'), { button: 2, clientX: 20, clientY: 20 });
  dragTo(tile('B'), 150, 60);
  expect(screen.queryByTestId('montage-drag-rect')).toBeNull();
  expect(onSelect).not.toHaveBeenCalled();
});

it('ignores a press on the scrollbar', () => {
  const { onSelect, scroller } = grid();
  Object.defineProperty(scroller, 'clientWidth', { value: 205, configurable: true });
  fireEvent.pointerDown(scroller, { button: 0, clientX: 212, clientY: 20 });
  dragTo(scroller, 212, 180);
  expect(screen.queryByTestId('montage-drag-rect')).toBeNull();
  fireEvent.pointerUp(scroller, { clientX: 212, clientY: 180 });
  expect(onSelect).not.toHaveBeenCalled();
});

it('selects only tiles inside the visible grid, however far the pointer travels', () => {
  // The grid shows 100 px: the second row (from 110 px) is scrolled out of view.
  const { onSelect } = grid({ viewHeight: 100 });
  fireEvent.pointerDown(tile('A'), { button: 0, clientX: 20, clientY: 20 });
  dragTo(tile('A'), 800, 900);
  fireEvent.pointerUp(tile('A'), { clientX: 800, clientY: 900 });
  expect(onSelect).toHaveBeenCalledWith(['A', 'B'], false);
});

it('scrolls the grid while a drag is held near its bottom edge, and stops on release', () => {
  vi.useFakeTimers();
  const { scroller } = grid();
  let top = 0;
  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = value;
    },
  });
  fireEvent.pointerDown(tile('A'), { button: 0, clientX: 20, clientY: 20 });
  dragTo(tile('A'), 30, 390);
  act(() => {
    vi.advanceTimersByTime(64);
  });
  expect(top).toBeGreaterThan(0);
  // Away from the edge the grid holds still.
  dragTo(tile('A'), 30, 200);
  const held = top;
  act(() => {
    vi.advanceTimersByTime(64);
  });
  expect(top).toBe(held);
  dragTo(tile('A'), 30, 395);
  fireEvent.pointerUp(tile('A'), { clientX: 30, clientY: 395 });
  const released = top;
  act(() => {
    vi.advanceTimersByTime(64);
  });
  expect(top).toBe(released);
});

it('Escape with no drag in progress clears the selection, from a tile', () => {
  const { onClearSelection, onSelect } = grid({ selected: ['A'] });
  tile('C').focus();
  fireEvent.keyDown(tile('C'), { key: 'Escape' });
  expect(onClearSelection).toHaveBeenCalledTimes(1);
  expect(onSelect).not.toHaveBeenCalled();
});

it('the grid is one tab stop and the arrow keys move between tiles by row and column', () => {
  grid();
  // The focused subject holds the tab stop; every tile can still take focus.
  expect(IDS.map((id) => tile(id).tabIndex)).toEqual([-1, 0, -1, -1]);
  act(() => tile('A').focus());
  expect(IDS.map((id) => tile(id).tabIndex)).toEqual([0, -1, -1, -1]);
  fireEvent.keyDown(tile('A'), { key: 'ArrowRight' });
  expect(document.activeElement).toBe(tile('B'));
  fireEvent.keyDown(tile('B'), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(tile('D'));
  fireEvent.keyDown(tile('D'), { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(tile('C'));
  fireEvent.keyDown(tile('C'), { key: 'ArrowUp' });
  expect(document.activeElement).toBe(tile('A'));
  // Past the first tile there is nowhere to go.
  fireEvent.keyDown(tile('A'), { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(tile('A'));
});

it('reports the value under the pointer, reading a mirrored tile back the same way', () => {
  const { onHover } = grid();
  const canvas = tile('B').querySelector('canvas')!;
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(rect(110, 0));
  fireEvent.mouseMove(tile('B'), { clientX: 120, clientY: 10 });
  expect(onHover).toHaveBeenLastCalledWith({ id: 'B', value: 1, world: [0, 0, 0] });
  fireEvent.mouseMove(tile('B'), { clientX: 120, clientY: 90 });
  expect(onHover).toHaveBeenLastCalledWith({ id: 'B', value: null, world: [0, 1, 0] });
});

it('reads the exact pixel under the pointer on a finely sampled, mirrored tile', () => {
  // An 8 x 8 tile whose value names its pixel: 10 * row + column.
  const image = { width: 8, height: 8, close: vi.fn() } as unknown as ImageBitmap;
  const fine = {
    query: { key: 'fine' },
    data: {
      cutouts: {
        nativeDimPx: 8,
        plane: { origin_mm: [-4, -4, 0], u_mm: [1, 0, 0], v_mm: [0, 1, 0], dim_px: [8, 8] },
        members: [
          {
            memberId: 'A',
            values: Array.from({ length: 64 }, (_, i) => 10 * Math.floor(i / 8) + (i % 8)),
            validPixels: 64,
          },
        ],
      },
    },
    images: new PopulationImages(image, image, image),
  } as unknown as PopulationSliceDisplay;
  const onHover = vi.fn();
  render(
    <MontageGrid
      ids={['A']}
      columns={1}
      sprites={montageSprites(fine, true)}
      focusedId={null}
      selectedIds={new Set()}
      onFocus={vi.fn()}
      onToggle={vi.fn()}
      onHover={onHover}
    />,
  );
  const canvas = tile('A').querySelector('canvas')!;
  // Drawn at 360 px: 45 screen pixels to one sampled pixel.
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 360));
  // Sampled 8 x 8 and enlarged: drawn pixel for pixel, so no colour is blended.
  expect(canvas.width).toBe(8);
  expect(canvas.dataset.rendering).toBe('pixelated');
  // Screen column 1 of 8, row 2 of 8; mirrored, that is the sampled column 6.
  fireEvent.mouseMove(tile('A'), { clientX: 50, clientY: 100 });
  expect(onHover).toHaveBeenLastCalledWith({ id: 'A', value: 26, world: [2, -2, 0] });
  // The far right edge of the screen is the first sampled column.
  fireEvent.mouseMove(tile('A'), { clientX: 359, clientY: 359 });
  expect(onHover).toHaveBeenLastCalledWith({ id: 'A', value: 70, world: [-4, 3, 0] });
});

const GROUPS = [
  { id: 'similarity-0', label: 'Group 1', memberIds: ['A', 'B', 'C'], unassigned: false },
  { id: 'similarity-1', label: 'Group 2', memberIds: ['D'], unassigned: false },
];

it('grouped: every member of every group is shown, wrapped, with no "more" cell', () => {
  const onShowMean = vi.fn();
  render(
    <MontageGroupRows
      rows={groupedPages(GROUPS)[0]}
      columns={2}
      onShowMean={onShowMean}
      sprites={montageSprites(display(), false)}
      focusedId={null}
      selectedIds={new Set(['B'])}
      onFocus={vi.fn()}
      onToggle={vi.fn()}
    />,
  );
  const first = screen.getByRole('region', { name: 'Group 1' });
  expect(first).toHaveTextContent('Group 1');
  expect(first).toHaveTextContent('3 subjects');
  expect(screen.getByRole('region', { name: 'Group 2' })).toHaveTextContent('1 subject');
  // Two columns: Group 1 wraps onto a second row; nothing is held back.
  expect(screen.getAllByRole('button', { name: /^Focus subject/ }).map((b) => b.dataset.datumId)).toEqual([
    'A',
    'B',
    'C',
    'D',
  ]);
  expect(screen.queryByRole('button', { name: /^Show all/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Show one row' })).toBeNull();
  expect(screen.queryByText(/\bmore\b/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Focus subject B' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Show mean of Group 2' }));
  expect(onShowMean).toHaveBeenCalledWith('similarity-1');
});

it('grouped: each group heading sticks to the top of the scroller over its tiles', () => {
  render(
    <MontageGroupRows
      rows={groupedPages(GROUPS)[0]}
      columns={2}
      sprites={montageSprites(display(), false)}
      focusedId={null}
      selectedIds={new Set()}
      onFocus={vi.fn()}
      onToggle={vi.fn()}
    />,
  );
  const headings = screen.getAllByTestId('montage-group-heading');
  expect(headings).toHaveLength(2);
  for (const heading of headings) {
    // Sticky inside its section (the next heading pushes it off), opaque, above the tiles.
    expect(heading.className).toMatch(/\bsticky\b/);
    expect(heading.className).toMatch(/\btop-0\b/);
    expect(heading.className).toMatch(/\bbg-bf-bg-panel\b/);
    expect(heading.className).toMatch(/\bz-10\b/);
    expect(heading.parentElement!.tagName).toBe('SECTION');
  }
  expect(headings[0]).toHaveTextContent('Group 1');
});

it('the scroller has no top padding: the first row sits under the toolbar', () => {
  grid();
  expect(document.querySelector('[data-montage-scroller]')!.className).not.toMatch(/\bpt-/);
});

it('grouped: roving focus crosses rows of different lengths', () => {
  // Three columns. Group 1: A, B, C on one row and E alone on the next; Group 2: D alone.
  const rows = groupedPages([{ ...GROUPS[0], memberIds: ['A', 'B', 'C', 'E'] }, GROUPS[1]])[0];
  const cellIds = rows.flatMap((row) => row.shown);
  render(
    <MontageSurface columns={3} cellIds={cellIds} activeId="B" scope="fixture" onSelect={vi.fn()}>
      <MontageGroupRows
        rows={rows}
        columns={3}
        sprites={montageSprites(display(), false)}
        focusedId="B"
        selectedIds={new Set()}
        onFocus={vi.fn()}
        onToggle={vi.fn()}
      />
    </MontageSurface>,
  );
  const place = (element: HTMLElement, left: number, top: number) =>
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect(left, top));
  place(tile('A'), 0, 0);
  place(tile('B'), 110, 0);
  place(tile('C'), 220, 0);
  place(tile('E'), 0, 110);
  place(tile('D'), 0, 260);
  const cells = () => ['A', 'B', 'C', 'E', 'D'].map(tile);
  // One tab stop for the whole grid, on the focused subject.
  expect(cells().map((cell) => cell.tabIndex)).toEqual([-1, 0, -1, -1, -1]);
  tile('B').focus();
  fireEvent.keyDown(tile('B'), { key: 'ArrowRight' });
  expect(document.activeElement).toBe(tile('C'));
  // Below C the next row has one tile, far to the left: go there.
  fireEvent.keyDown(tile('C'), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(tile('E'));
  fireEvent.keyDown(tile('E'), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(tile('D'));
  expect(cells().map((cell) => cell.tabIndex)).toEqual([-1, -1, -1, -1, 0]);
  fireEvent.keyDown(tile('D'), { key: 'ArrowUp' });
  expect(document.activeElement).toBe(tile('E'));
  fireEvent.keyDown(tile('E'), { key: 'Home' });
  expect(document.activeElement).toBe(tile('A'));
  fireEvent.keyDown(tile('A'), { key: 'End' });
  expect(document.activeElement).toBe(tile('D'));
});

// ── R1-B: frameless tiles, one shared crop, gutters, labels, headers ────────

/** A 6 x 6 whole-slice page: anatomy in a 2 x 2 block, maps reaching further. */
function cropped(ids = ['sub-01', 'sub-02', 'sub-03'], wholePlane = true): PopulationSliceDisplay {
  const image = { width: 18, height: 6, close: vi.fn() } as unknown as ImageBitmap;
  const at = (x: number, y: number) => y * 6 + x;
  const blank = () => Array<number | null>(36).fill(0);
  const underlay = Array<number | null>(36).fill(0);
  for (const [x, y] of [
    [2, 2],
    [3, 2],
    [2, 3],
    [3, 3],
  ])
    underlay[at(x, y)] = 100;
  // Each subject's map reaches a different corner of the anatomy: the crop is
  // the union of their boxes, not any one of them.
  const values = [blank(), blank(), blank()];
  values[0][at(1, 2)] = 1;
  values[1][at(4, 3)] = -1;
  values[2][at(3, 4)] = 2;
  return {
    query: { key: 'cropped', request: { cutouts: { wholePlane } } },
    data: {
      cutouts: {
        plane: { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, 1, 0], dim_px: [6, 6] },
        members: ids.map((memberId, i) => ({ memberId, values: values[i], validPixels: 36 })),
      },
      underlay: { values: [], cutouts: underlay },
    },
    images: new PopulationImages(image, image, image),
  } as unknown as PopulationSliceDisplay;
}

it('the shared crop is the union of every tile’s box, widened by 2 px and kept in the cell', () => {
  const dims = [6, 6] as const;
  const head = montageBackground(dims, cropped().data.underlay!.cutouts!);
  // Anatomy alone: x 2–3, y 2–3, widened by 2 → x 0–5, y 0–5 (clamped).
  expect(montageSharedCrop(dims, [], head)).toEqual({
    x: 0,
    y: 0,
    width: 6,
    height: 6,
  });
  // No margin: anatomy x 2–3 / y 2–3, maps reach x 1 and 4, y 4.
  expect(montageSharedCrop(dims, cropped().data.cutouts!.members, head, 0)).toEqual({
    x: 1,
    y: 2,
    width: 4,
    height: 3,
  });
  // A value inside the hidden band is not drawn, so it does not widen the crop.
  expect(montageSharedCrop(dims, cropped().data.cutouts!.members, head, 0, 1.5)).toEqual({
    x: 2,
    y: 2,
    width: 2,
    height: 3,
  });
  // A larger cell, margin 2: a 1-pixel subject at (5, 5) and another at (8, 6).
  const big = (x: number, y: number) => {
    const v = Array<number | null>(400).fill(null);
    v[y * 20 + x] = 3;
    return { values: v };
  };
  expect(montageSharedCrop([20, 20], [big(5, 5), big(8, 6)], null)).toEqual({
    x: 3,
    y: 3,
    width: 8,
    height: 6,
  });
  // Nothing anywhere: the whole cell.
  expect(montageSharedCrop([4, 4], [{ values: Array(16).fill(0) }], null)).toEqual({
    x: 0,
    y: 0,
    width: 4,
    height: 4,
  });
});

/** A 20 x 20 whole-slice page whose one subject maps a single pixel. */
function page(
  x: number,
  y: number,
  request: { orientation?: string; crosshairMm?: number[]; memberIds?: string[] } = {},
): PopulationSliceDisplay {
  const values = Array<number | null>(400).fill(null);
  values[y * 20 + x] = 3;
  const image = { width: 20, height: 20, close: vi.fn() } as unknown as ImageBitmap;
  return {
    query: {
      key: `page-${x}-${y}`,
      request: {
        orientation: request.orientation ?? 'axial',
        crosshairMm: request.crosshairMm ?? [0, 0, 0],
        contextKey: 'ctx',
        cutouts: {
          wholePlane: true,
          centerMm: [0, 0, 0],
          widthMm: 60,
          dimPx: 20,
          memberIds: request.memberIds ?? [`m-${x}-${y}`],
        },
      },
    },
    data: {
      cutouts: {
        plane: { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, 1, 0], dim_px: [20, 20] },
        members: [{ memberId: `m-${x}-${y}`, values, validPixels: 1 }],
      },
      underlay: null,
    },
    images: new PopulationImages(image, image, image),
  } as unknown as PopulationSliceDisplay;
}

it('keeps one crop across the pages and slices of a view (the largest seen), and starts again on another orientation', () => {
  const memory = createMontageCropMemory();
  const first = montageSprites(page(5, 5, { memberIds: ['a'] }), false, true, memory)!.crop;
  expect(first).toEqual({ x: 3, y: 3, width: 5, height: 5 });
  // The next page's subject sits elsewhere: the crop grows to hold both pages…
  const second = montageSprites(page(12, 10, { memberIds: ['b'] }), false, true, memory)!.crop;
  expect(second).toEqual({ x: 3, y: 3, width: 12, height: 10 });
  // …and turning back keeps it: the brains do not rescale between pages.
  expect(montageSprites(page(5, 5, { memberIds: ['a'] }), false, true, memory)!.crop).toEqual(second);
  // Another slice of the same frame keeps it: the tiles neither resize nor shift
  // as the slice steps (the crop key ignores the slice).
  const deeper = page(5, 5, { memberIds: ['a'], crosshairMm: [0, 0, 4] });
  expect(montageCropKey(deeper)).toBe(montageCropKey(page(5, 5, { memberIds: ['a'] })));
  expect(montageSprites(deeper, false, true, memory)!.crop).toEqual(second);
  // Another orientation is another frame: its own crop.
  expect(
    montageSprites(page(5, 5, { memberIds: ['a'], orientation: 'coronal' }), false, true, memory)!
      .crop,
  ).toEqual(first);
  // Without a memory each page is cropped alone (as before).
  expect(montageSprites(page(12, 10), false)!.crop).toEqual({ x: 10, y: 8, width: 5, height: 5 });
});

it('counts negative anatomy as tissue (a z-scored or CT underlay is not background)', () => {
  const underlay = Array<number | null>(36).fill(0);
  underlay[2 * 6 + 2] = -0.8;
  underlay[3 * 6 + 3] = Number.NaN;
  expect(montageSharedCrop([6, 6], [], montageBackground([6, 6], underlay), 0)).toEqual({
    x: 2,
    y: 2,
    width: 1,
    height: 1,
  });
  // A pinned region's window (strict rule): background is where there is no
  // tissue, so a negative pixel at its edge is kept.
  const region = cropped(undefined, false);
  region.data.underlay!.cutouts![0] = -5;
  const sprites = montageSprites(region, false)!;
  expect(sprites.background![0]).toBe(0);
  expect(sprites.background![1]).toBe(1);
  // A whole slice of a z-scored head: dark (negative) tissue inside the bright
  // head is kept; only what is dark and reaches the edge is outside.
  const z = Array<number | null>(36).fill(0);
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 4; x++) z[y * 6 + x] = 2;
  z[2 * 6 + 2] = -1.5;
  z[3 * 6 + 3] = -1.2;
  const head = montageBackground([6, 6], z);
  expect(head[2 * 6 + 2]).toBe(0);
  expect(head[3 * 6 + 3]).toBe(0);
  expect(head[0]).toBe(1);
});

it('draws every tile from one source rectangle: same size and same place in its cell', () => {
  const sprites = montageSprites(cropped(), false)!;
  // Anatomy x 2–3 / y 2–3 and maps out to x 1–4 / y 2–4, plus 2 px, in a 6 px cell.
  expect(sprites.crop).toEqual({ x: 0, y: 0, width: 6, height: 6 });
  const fine = { ...sprites, crop: montageSharedCrop([6, 6], sprites.cutouts.members, null, 0) };
  render(
    <MontageGrid
      ids={['sub-01', 'sub-02', 'sub-03']}
      columns={3}
      sprites={fine}
      focusedId={null}
      selectedIds={new Set()}
      onFocus={vi.fn()}
      onToggle={vi.fn()}
    />,
  );
  // The maps alone: x 1–4, y 2–4.
  expect(fine.crop).toEqual({ x: 1, y: 2, width: 4, height: 3 });
  expect(drawImage).toHaveBeenCalledTimes(3);
  const rects = drawImage.mock.calls.map(([, sx, sy, sw, sh, dx, dy, dw, dh]) => ({
    // Where the source sits within its own cell of the sheet (cells are 6 px).
    inCell: [sx % 6, sy % 6],
    size: [sw, sh],
    dest: [dx, dy, dw, dh],
  }));
  for (const rect of rects) {
    expect(rect.inCell).toEqual([1, 2]);
    expect(rect.size).toEqual([4, 3]);
    expect(rect.dest).toEqual([0, 0, 4, 3]);
  }
  // The canvas is the crop's size, its aspect the crop's.
  const canvas = tile('sub-02').querySelector('canvas')!;
  expect([canvas.width, canvas.height]).toEqual([4, 3]);
  expect(canvas.style.aspectRatio).toBe('4 / 3');
  // Hovering the crop's first pixel reads the cell's pixel (1, 2).
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ ...rect(0, 0, 40), height: 30, bottom: 30 } as DOMRect);
  const onHover = vi.fn();
  cleanup();
  render(
    <MontageGrid
      ids={['sub-01']}
      columns={1}
      sprites={fine}
      focusedId={null}
      selectedIds={new Set()}
      onFocus={vi.fn()}
      onToggle={vi.fn()}
      onHover={onHover}
    />,
  );
  const first = tile('sub-01').querySelector('canvas')!;
  vi.spyOn(first, 'getBoundingClientRect').mockReturnValue({ ...rect(0, 0, 40), height: 30, bottom: 30 } as DOMRect);
  fireEvent.mouseMove(tile('sub-01'), { clientX: 1, clientY: 1 });
  expect(onHover).toHaveBeenLastCalledWith({ id: 'sub-01', value: 1, world: [1, 2, 0] });
});

it('crops only a whole slice: a pinned region is drawn whole', () => {
  const region = montageSprites(cropped(undefined, false), false)!;
  expect(region.crop).toEqual({ x: 0, y: 0, width: 6, height: 6 });
  // Without a request (an older result) nothing is cropped either.
  expect(montageSprites(display(), false)!.crop).toEqual({ x: 0, y: 0, width: 2, height: 2 });
});

it('clears the anatomy grey outside the head, keeping a map colour painted there', () => {
  const background = Uint8Array.from([1, 1, 0, 1]);
  // Canvas pixels: black outside, dark noise grey outside, black tissue, red outside.
  const pixels = Uint8ClampedArray.from([
    0, 0, 0, 255, 12, 12, 12, 255, 0, 0, 0, 255, 200, 20, 20, 255,
  ]);
  clearTileBackground(pixels, { x: 0, y: 0, width: 2, height: 2 }, 2, background, false);
  // Alpha: cleared, cleared (any grey, not only pure black), kept (tissue is
  // never cleared), kept (a map colour).
  expect([pixels[3], pixels[7], pixels[11], pixels[15]]).toEqual([0, 0, 255, 255]);
  // Mirrored: canvas column 0 shows cell column 1.
  const mirrored = Uint8ClampedArray.from([0, 0, 0, 255, 0, 0, 0, 255]);
  clearTileBackground(mirrored, { x: 0, y: 0, width: 2, height: 1 }, 2, Uint8Array.from([0, 1]), true);
  expect([mirrored[3], mirrored[7]]).toEqual([0, 255]);
  // The sprite records the anatomy's background per cell pixel.
  const sprites = montageSprites(cropped(), false)!;
  expect(sprites.background![2 * 6 + 2]).toBe(0);
  expect(sprites.background![0]).toBe(1);
  expect(montageSprites(display(), false)!.background).toBeNull();
});

/** A 12 x 12 template slice as resampled templates come: faint nonzero noise
 * all round the head, a bright ring of scalp, and a dark ventricle inside. */
function noisyTemplate(): (number | null)[] {
  const anatomy = Array.from({ length: 144 }, (_, i) => 3 + (i % 5));
  for (let y = 2; y <= 9; y++) for (let x = 2; x <= 9; x++) anatomy[y * 12 + x] = 800;
  for (let y = 5; y <= 6; y++) for (let x = 5; x <= 6; x++) anatomy[y * 12 + x] = 20;
  return anatomy;
}

it('a template whose background is faint noise, not zero, is still cleared outside the head (S1)', () => {
  const anatomy = noisyTemplate();
  // Every pixel is "tissue" by the nonzero rule: the black square of S1.
  expect(anatomy.every((value) => value !== 0)).toBe(true);
  const background = montageBackground([12, 12], anatomy);
  // The noise around the head is background…
  expect(background[0]).toBe(1);
  expect(background[1 * 12 + 6]).toBe(1);
  // …the head is not, and neither is the dark ventricle it encloses.
  expect(background[2 * 12 + 2]).toBe(0);
  expect(background[5 * 12 + 5]).toBe(0);
  // The crop holds the head (x, y 2–9) and its margin, not the whole square.
  expect(montageSharedCrop([12, 12], [], background, 0)).toEqual({ x: 2, y: 2, width: 8, height: 8 });
  // A pinned region's window keeps the strict rule: its edge cuts through the head.
  expect(montageBackground([12, 12], anatomy, false).every((b) => b === 0)).toBe(true);
});

it('tiles of a whole slice are cropped and cleared by the same head mask', () => {
  const anatomy = noisyTemplate();
  const values = Array<number | null>(144).fill(null);
  const image = { width: 12, height: 12, close: vi.fn() } as unknown as ImageBitmap;
  const sprites = montageSprites(
    {
      query: { key: 'noisy', request: { cutouts: { wholePlane: true } } },
      data: {
        cutouts: {
          plane: { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, 1, 0], dim_px: [12, 12] },
          members: [{ memberId: 'a', values, validPixels: 0 }],
        },
        underlay: { values: [], cutouts: anatomy },
      },
      effectLimit: 1,
      images: new PopulationImages(image, image, image),
    } as unknown as PopulationSliceDisplay,
    false,
  )!;
  expect(sprites.crop).toEqual({ x: 0, y: 0, width: 12, height: 12 });
  expect(sprites.background![0]).toBe(1);
  expect(sprites.background![5 * 12 + 5]).toBe(0);
});

it('a tile is frameless: no border, no black box, the label small muted mono without a box', () => {
  grid();
  const button = tile('A');
  // No border class and no dark box (the focus ring's own classes aside).
  const classes = button.className.split(/\s+/);
  expect(classes.filter((c) => /^border(-|$)/.test(c))).toEqual([]);
  expect(classes.filter((c) => /^bg-/.test(c))).toEqual(['bg-transparent']);
  const label = button.querySelector('[data-tile-label]')!;
  expect(label.className).toMatch(/\bfont-mono\b/);
  expect(label.className).toMatch(/\btext-bf-2xs\b/);
  expect(label.className).toMatch(/\btext-bf-text-muted\b/);
  expect(label.className).not.toMatch(/\bbg-|\bborder|shadow-/);
  // The label is below the image.
  const image = button.querySelector('[data-tile-image]')!;
  expect(image.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('focus is a 1 px light outline on the image; selection is the amber edge', () => {
  grid({ focusedId: 'B', selected: ['C'] });
  const image = (id: string) => tile(id).querySelector<HTMLElement>('[data-tile-image]')!;
  expect(image('B').className).toMatch(/\boutline-1\b/);
  expect(image('B').className).toMatch(/\boutline-primary\b/);
  expect(image('C').className).not.toMatch(/\boutline-primary\b/);
  const edge = image('C').querySelector<HTMLElement>('[data-tile-selected-edge]')!;
  expect(edge.className).toContain('var(--bf-accent)');
  expect(image('B').querySelector('[data-tile-selected-edge]')).toBeNull();
  // The amber is the selection's alone: the focused tile wears none.
  expect(tile('B').innerHTML).not.toContain('--bf-accent');
});

it('gutters: 6 px across, 4 px down within a group; 20 px between groups', () => {
  expect(montageGridStyle(3)).toMatchObject({ columnGap: 6, rowGap: 4 });
  expect(MONTAGE_COLUMN_GAP_PX).toBe(MONTAGE_GAP_PX);
  render(
    <MontageGroupRows
      rows={groupedPages(GROUPS)[0]}
      columns={2}
      sprites={montageSprites(display(), false)}
      focusedId={null}
      selectedIds={new Set()}
      onFocus={vi.fn()}
      onToggle={vi.fn()}
    />,
  );
  const sections = screen.getAllByRole('region');
  // gap-5 is 20 px.
  expect(sections[0].parentElement!.className).toMatch(/\bgap-5\b/);
  const gridStyle = sections[0].querySelector<HTMLElement>('.grid')!.style;
  expect([gridStyle.columnGap, gridStyle.rowGap]).toEqual(['6px', '4px']);
});

it('strips a prefix every ID shares from the labels and says it once', () => {
  expect(commonIdPrefix(['sub-01', 'sub-102'])).toBe('sub-');
  expect(commonIdPrefix(['sub_01', 'sub_02'])).toBe('sub_');
  expect(commonIdPrefix(['sub-01', 'ses-01'])).toBe('');
  expect(commonIdPrefix(['sub-01', 'A'])).toBe('');
  // Only a whole leading word: digits never become part of it.
  expect(commonIdPrefix(['sub-1006', 'sub-1007'])).toBe('sub-');
  expect(commonIdPrefix(['sub-'])).toBe('');
  expect(shortId('sub-01', 'sub-')).toBe('01');
  expect(shortId('X', 'sub-')).toBe('X');
  const ids = ['sub-01', 'sub-02', 'sub-03'];
  render(
    <MontageGrid
      ids={ids}
      columns={3}
      sprites={montageSprites(cropped(ids), false)}
      focusedId={null}
      selectedIds={new Set()}
      onFocus={vi.fn()}
      onToggle={vi.fn()}
    />,
  );
  // The label is short; the name and tooltip keep the whole ID.
  expect(tile('sub-02').querySelector('[data-tile-label]')).toHaveTextContent(/^02$/);
  expect(tile('sub-02').getAttribute('title')).toMatch(/^sub-02 — /);
  // The prefix is said once, in the toolbar row (MontageToolbar): never under the tiles.
  expect(screen.queryByTestId('montage-id-prefix')).toBeNull();
  expect(screen.queryByText(/sub-…/)).toBeNull();
});

it('grouped: headers never carry the prefix and never truncate; IDs without a shared one stay whole', () => {
  const groups = [
    { id: 'g1', label: 'Group 1', memberIds: ['sub-01', 'sub-02'], unassigned: false },
    { id: 'g2', label: 'Group 2', memberIds: ['sub-03'], unassigned: false },
  ];
  render(
    <MontageGroupRows
      rows={groupedPages(groups)[0]}
      columns={3}
      idPrefix="sub-"
      sprites={montageSprites(cropped(), false)}
      focusedId={null}
      selectedIds={new Set()}
      onFocus={vi.fn()}
      onToggle={vi.fn()}
    />,
  );
  const headings = screen.getAllByTestId('montage-group-heading').map((h) => h.querySelector('h3')!);
  expect(headings.map((h) => h.textContent)).toEqual(['Group 1 · 2 subjects', 'Group 2 · 1 subject']);
  for (const heading of headings) {
    expect(heading.className).toMatch(/\bwhitespace-nowrap\b/);
    expect(heading.className).toMatch(/\bshrink-0\b/);
    expect(heading.className).not.toMatch(/\btruncate\b/);
  }
  // C5: the stripped prefix is said once, in the first group's heading, beside (not in) its name.
  const notes = screen.getAllByTestId('montage-id-prefix');
  expect(notes).toHaveLength(1);
  expect(notes[0]).toHaveTextContent('IDs without “sub-”');
  expect(screen.getAllByTestId('montage-group-heading')[0].contains(notes[0])).toBe(true);
  expect(tile('sub-03').querySelector('[data-tile-label]')).toHaveTextContent(/^03$/);
  cleanup();
  // A, B, C, D share nothing: labels stay whole.
  render(
    <MontageGroupRows
      rows={groupedPages(GROUPS)[0]}
      columns={2}
      sprites={montageSprites(display(), false)}
      focusedId={null}
      selectedIds={new Set()}
      onFocus={vi.fn()}
      onToggle={vi.fn()}
    />,
  );
  expect(tile('A').querySelector('[data-tile-label]')).toHaveTextContent(/^A$/);
});

it('a group header: its mark, "Group 1 · 3", and quiet Select and Mean ghost buttons', () => {
  const onSelectGroup = vi.fn(),
    onShowMean = vi.fn();
  render(
    <MontageGroupRows
      rows={groupedPages(GROUPS)[0]}
      columns={2}
      onShowMean={onShowMean}
      onSelectGroup={onSelectGroup}
      glyphs={new Map([
        ['similarity-0', 'circle'],
        ['similarity-1', 'square'],
      ])}
      sprites={montageSprites(display(), false)}
      focusedId={null}
      selectedIds={new Set()}
      onFocus={vi.fn()}
      onToggle={vi.fn()}
    />,
  );
  const [first, second] = screen.getAllByTestId('montage-group-heading');
  // Two groups: a filled and an open circle (k ≤ 3 marks differ in fill).
  expect(first.querySelector('svg')!.getAttribute('data-glyph')).toBe('circle');
  expect(second.querySelector('svg')!.getAttribute('data-glyph')).toBe('circle-open');
  // The heading reads "Group 1 · 3"; "subjects" is for screen readers.
  const heading = first.querySelector('h3')!;
  expect(heading.className).toMatch(/\btext-bf-xs\b/);
  expect(heading.className).toMatch(/\bfont-medium\b/);
  expect(heading).toHaveTextContent('Group 1 · 3 subjects');
  expect(heading.querySelector('.sr-only')).toHaveTextContent('subjects');
  // 20–28 px high.
  expect(first.className).toMatch(/\bh-6\b/);
  // Ghost buttons, always shown, never underlined links.
  const select = within(first).getByRole('button', { name: 'Select Group 1' });
  const mean = within(first).getByRole('button', { name: 'Show mean of Group 1' });
  expect(select).toHaveTextContent(/^Select$/);
  expect(mean).toHaveTextContent(/^Mean$/);
  for (const button of [select, mean]) {
    expect(button.className).not.toMatch(/\bunderline\b/);
    expect(button.className).toMatch(/hover:bg-accent/);
  }
  fireEvent.click(select);
  expect(onSelectGroup).toHaveBeenCalledWith('similarity-0');
  fireEvent.click(within(second).getByRole('button', { name: 'Show mean of Group 2' }));
  expect(onShowMean).toHaveBeenCalledWith('similarity-1');
});

// ── Round 2: one subset rule (A3) and the reflow (B3) ──────────────────────

it('with a selection, the tiles outside it recede to 60 % (still legible); the selected keep the amber edge and ✓', () => {
  grid({ selected: ['B', 'C'] });
  const image = (id: string) => tile(id).querySelector<HTMLElement>('[data-tile-image]')!;
  const label = (id: string) => tile(id).querySelector<HTMLElement>('[data-tile-label]')!;
  for (const id of ['A', 'D']) {
    expect(tile(id)).toHaveAttribute('data-receded', 'true');
    expect(image(id).style.opacity).toBe('0.6');
    expect(label(id).style.opacity).toBe('0.6');
  }
  for (const id of ['B', 'C']) {
    expect(tile(id)).not.toHaveAttribute('data-receded');
    expect(image(id).style.opacity).toBe('');
    expect(image(id).querySelector('[data-tile-selected-edge]')).not.toBeNull();
    expect(label(id).querySelector('svg.lucide-check')).not.toBeNull();
  }
  cleanup();
  // No selection: everyone is in play, nothing recedes.
  grid();
  expect(document.querySelectorAll('[data-receded]')).toHaveLength(0);
});

it('a new order glides each moved tile from where it was (FLIP), and holds still under reduced motion', () => {
  expect(
    flipOffsets(
      new Map([
        ['A', { left: 0, top: 0 }],
        ['B', { left: 110, top: 0 }],
      ]),
      new Map([
        ['A', { left: 110, top: 0 }],
        ['B', { left: 0, top: 0 }],
        ['C', { left: 220, top: 0 }],
      ]),
    ),
  ).toEqual(
    new Map([
      ['A', { dx: -110, dy: 0 }],
      ['B', { dx: 110, dy: 0 }],
    ]),
  );
  // Lay tiles out by their place among their siblings: 110 px apart on one
  // row, drawn displaced by whatever glide is in flight on them.
  const place = (element: HTMLElement) =>
    [...(element.parentElement?.children ?? [])].indexOf(element) * 110;
  const inFlight = new WeakMap<Element, number>();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const left = this.hasAttribute('data-datum-id')
      ? place(this as HTMLElement) + (inFlight.get(this) ?? 0)
      : 0;
    return { left, top: 0, right: left + 100, bottom: 100, width: 100, height: 100, x: left, y: 0 } as DOMRect;
  });
  // A glide is caught halfway: the tile is drawn at half its starting offset
  // until the glide is cancelled.
  const cancel = vi.fn();
  const animate = vi.fn(function (this: Element, keyframes: Keyframe[]) {
    const dx = Number(/translate\((-?[\d.]+)px/.exec(String(keyframes[0].transform))?.[1] ?? 0);
    inFlight.set(this, dx / 2);
    return {
      cancel: () => {
        cancel();
        inFlight.delete(this);
      },
    } as unknown as Animation;
  });
  Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true });
  const view = (ids: string[]) => (
    <MontageGrid
      ids={ids}
      columns={4}
      sprites={null}
      focusedId={null}
      selectedIds={new Set()}
      onFocus={vi.fn()}
      onToggle={vi.fn()}
    />
  );
  const { rerender } = render(view(['A', 'B', 'C']));
  expect(animate).not.toHaveBeenCalled();
  rerender(view(['C', 'B', 'A']));
  // A and C swapped ends; B stayed.
  expect(animate).toHaveBeenCalledTimes(2);
  const frames = animate.mock.calls.map(([keyframes, options]) => [keyframes[0].transform, options.duration]);
  expect(frames).toEqual(
    expect.arrayContaining([
      ['translate(220px, 0px)', 150],
      ['translate(-220px, 0px)', 150],
    ]),
  );
  // Re-sorted back mid-glide: A is drawn halfway (110 px), C likewise. The
  // glides in flight are cancelled, and each tile starts from where it is
  // drawn, not from its old layout place (which would jump 110 px).
  animate.mockClear();
  rerender(view(['A', 'B', 'C']));
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(animate.mock.calls.map(([keyframes]) => keyframes[0].transform)).toEqual(
    expect.arrayContaining(['translate(110px, 0px)', 'translate(-110px, 0px)']),
  );
  animate.mockClear();
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
  rerender(view(['C', 'B', 'A']));
  expect(animate).not.toHaveBeenCalled();
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
});

// ── Selection clarity: focus ring by keyboard only, ⌘-click, plain tooltips ──

it('⌘-click adds or removes one subject like Shift-click; a ⌘-drag adds to the selection', () => {
  const { onFocus, onToggle, onSelect } = grid();
  fireEvent.click(tile('C'), { metaKey: true });
  expect(onToggle).toHaveBeenCalledWith('C');
  expect(onFocus).not.toHaveBeenCalled();
  fireEvent.pointerDown(tile('C'), { button: 0, clientX: 20, clientY: 130, metaKey: true });
  dragTo(tile('D'), 150, 170);
  fireEvent.pointerUp(tile('D'), { clientX: 150, clientY: 170 });
  expect(onSelect).toHaveBeenLastCalledWith(['C', 'D'], true);
});

it('off a Mac, Ctrl is the additive key: Ctrl-click toggles and a Ctrl-drag adds (⌘ does not)', () => {
  setPlatform('Win32');
  const { onFocus, onToggle, onSelect } = grid();
  fireEvent.click(tile('C'), { ctrlKey: true });
  expect(onToggle).toHaveBeenCalledWith('C');
  expect(onFocus).not.toHaveBeenCalled();
  fireEvent.click(tile('B'), { metaKey: true });
  expect(onFocus).toHaveBeenCalledWith('B');
  // A Ctrl-press is not the context menu here: it starts an additive drag.
  fireEvent.pointerDown(tile('C'), { button: 0, clientX: 20, clientY: 130, ctrlKey: true });
  dragTo(tile('D'), 150, 170);
  fireEvent.pointerUp(tile('D'), { clientX: 150, clientY: 170 });
  expect(onSelect).toHaveBeenLastCalledWith(['C', 'D'], true);
  expect(document.querySelector('[data-montage-scroller]')!.getAttribute('title')).toMatch(
    /^Click to focus · Shift- or Ctrl-click to select/,
  );
});

it('the window losing focus (⌘-Tab away) keeps pointer modality, so no ring after returning', () => {
  grid();
  const scroller = document.querySelector<HTMLElement>('[data-montage-scroller]')!;
  fireEvent.pointerDown(tile('C'), { button: 0, clientX: 20, clientY: 130 });
  expect(scroller).toHaveAttribute('data-modality', 'pointer');
  const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  fireEvent.blur(scroller, { relatedTarget: null });
  expect(scroller).toHaveAttribute('data-modality', 'pointer');
  // Focus genuinely leaving the grid inside the window still resets it.
  hasFocus.mockReturnValue(true);
  fireEvent.blur(scroller, { relatedTarget: document.body });
  expect(scroller).toHaveAttribute('data-modality', 'keyboard');
});

it('the amber focus ring is for keyboard focus only; a click marks focus with the light outline', () => {
  grid();
  const scroller = document.querySelector<HTMLElement>('[data-montage-scroller]')!;
  // The ring is gated on keyboard modality, never the bare :focus-visible
  // that WebKit also matches after a click focuses the tile.
  const ring = tile('C').className;
  expect(ring).toMatch(/(^|\s)focus-visible:outline-none(\s|$)/);
  expect(ring).toMatch(/group-data-\[modality=keyboard\]\/montage:focus-visible:outline-\[var\(--bf-border-focus\)\]/);
  expect(ring).not.toMatch(/(^|\s)focus-visible:outline-\[var\(--bf-border-focus\)\]/);
  expect(scroller.className).toMatch(/\bgroup\/montage\b/);
  // Entering by Tab is keyboard use.
  expect(scroller).toHaveAttribute('data-modality', 'keyboard');
  // A press is not: the tile it focuses gets no ring.
  fireEvent.pointerDown(tile('C'), { button: 0, clientX: 20, clientY: 130 });
  expect(scroller).toHaveAttribute('data-modality', 'pointer');
  // Holding Shift for a Shift-click is still a pointer gesture.
  fireEvent.keyDown(tile('C'), { key: 'Shift', shiftKey: true });
  expect(scroller).toHaveAttribute('data-modality', 'pointer');
  // Arrow keys move focus: the ring comes back.
  fireEvent.keyDown(tile('C'), { key: 'ArrowRight' });
  expect(scroller).toHaveAttribute('data-modality', 'keyboard');
  // Leaving the grid resets, so a later Tab back in shows the ring.
  fireEvent.pointerDown(tile('C'), { button: 0, clientX: 20, clientY: 130 });
  fireEvent.blur(scroller, { relatedTarget: document.body });
  expect(scroller).toHaveAttribute('data-modality', 'keyboard');
});

it('the grid\'s tooltip says how selection works, in the gestures that exist', () => {
  grid();
  expect(document.querySelector('[data-montage-scroller]')).toHaveAttribute(
    'title',
    'Click to focus · Shift- or ⌘-click to select · drag across tiles to select several · Esc clears · double-click opens a subject on its own',
  );
});
