import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type RefObject,
} from 'react';
import type { RovingItemProps } from '@/components/ui/bf';
import {
  populationHiddenBand,
  type PopulationSliceDisplay,
} from '@/services/studio/PopulationSliceService';
import { MONTAGE_GAP_PX, MONTAGE_ROW_GAP_PX as ROW_GAP } from './montageModel';
import { additiveKeyLabel } from '@/utils/selectionModifier';

/** Gutters between tiles: 6 px across (the column gap the tile width is fitted
 * with), 4 px down; groups sit 20 px apart (`MONTAGE_GROUP_GAP_CLASS`). */
export const MONTAGE_COLUMN_GAP_PX = MONTAGE_GAP_PX;
export const MONTAGE_ROW_GAP_PX = ROW_GAP;
export const MONTAGE_GROUP_GAP_CLASS = 'gap-5';
/** Pixels kept around the shared crop's union box. */
export const MONTAGE_CROP_MARGIN_PX = 2;

/**
 * The subject another view marks on the montage, unless it is the tile under
 * the pointer: a tile is never ringed by its own hover coming back through
 * the map or the shared hover channel.
 */
export const montageLinkedId = (linked: string | null, hoveredTile: string | null) =>
  linked !== null && linked !== hoveredTile ? linked : null;

/**
 * How tiles are focused and selected, said exactly as `MontageTile` and
 * `MontageSurface` implement it: a click focuses; Shift- or ⌘-click (Ctrl off
 * a Mac; see `isAdditive`), and Shift-Enter, adds or removes one; a drag
 * across tiles selects every tile it touches (the same modifiers add to the
 * selection); Escape clears; a double-click opens the subject on its own.
 * Read at call time, so the key name follows the platform.
 */
export function montageSelectionHint(): string {
  return `Click to focus · Shift- or ${additiveKeyLabel()}-click to select · drag across tiles to select several · Esc clears`;
}

/**
 * A tile's tooltip in plain words: the subject, how much of the slice has
 * data ("84% of the slice has data"), and the gestures.
 */
export function montageTileTitle(
  id: string,
  member: { validPixels: number; values: { length: number } } | null,
  selected = false,
): string {
  let coverage: string;
  if (!member) coverage = 'not loaded yet';
  else if (member.validPixels <= 0 || member.values.length === 0) coverage = 'no data in this slice';
  else {
    const share = (100 * member.validPixels) / member.values.length;
    // Never "0%" or "100%" for a slice that is partly covered.
    const shown =
      share > 0 && share < 1 ? '<1' : share < 100 && share > 99 ? '>99' : String(Math.round(share));
    coverage = `${shown}% of the slice has data`;
  }
  return `${id} — ${coverage}${selected ? ' · selected' : ''}\n${montageSelectionHint()} · double-click to open`;
}

/** Pointer travel before a press becomes a drag selection rather than a click. */
export const MONTAGE_DRAG_THRESHOLD_PX = 5;

type Cutouts = NonNullable<PopulationSliceDisplay['data']['cutouts']>;

/** Where each subject's tile sits in the shared sprite sheet. */
export interface MontageSprites {
  image: ImageBitmap;
  cutouts: Cutouts;
  index: ReadonlyMap<string, number>;
  /** Tiles per sheet row, as `packPopulationCutouts` lays them out. */
  sheetColumns: number;
  /** Radiological convention: axial and coronal tiles are drawn mirrored. */
  mirrorX: boolean;
  /** Draw pixel for pixel (the tile is shown at or above its sampled size). */
  pixelated: boolean;
  /**
   * The one source rectangle every tile is drawn from, in a cell's own
   * (unmirrored) pixels: the same crop for all tiles, so scale and position
   * agree across the small multiples. The whole cell when nothing is cropped.
   */
  crop: MontageCrop;
  /**
   * Per cell pixel: 1 outside the head (`montageBackground`). There the
   * sprite's anatomy grey is cleared, so the panel shows through; a map
   * colour painted there stays. Null without anatomy.
   */
  background: Uint8Array | null;
}

export interface MontageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Any finite nonzero anatomy is tissue: an underlay with negative values
// (a z-scored T1, CT in Hounsfield units) is not cleared as background.
const tissue = (value: number | null | undefined) =>
  value !== null && value !== undefined && value !== 0 && Number.isFinite(value);

/**
 * Where the anatomy is darker than this fraction of its robust range (2nd to
 * 98th percentile of its finite nonzero values, above the 2nd), it may be
 * outside the head: a template's background is rarely exactly zero
 * (resampling smears the head's edge, and some templates carry low noise),
 * so "nonzero" alone keeps the whole square.
 */
export const MONTAGE_BACKGROUND_FRACTION = 0.1;

/**
 * Per cell pixel, 1 outside the head: dark anatomy (at or below the
 * `MONTAGE_BACKGROUND_FRACTION` threshold, or no anatomy at all) connected to
 * the cell's edge. Dark tissue enclosed by the head (ventricles, skull under
 * the scalp) is not reached from the edge and stays. `fromEdge` false (a
 * pinned region's window, whose edge cuts through the brain) keeps the
 * stricter rule: only pixels without any anatomy are background.
 */
export function montageBackground(
  dims: readonly [number, number],
  anatomy: readonly (number | null)[],
  fromEdge = true,
): Uint8Array {
  const [w, h] = dims;
  const size = w * h;
  const strict = Uint8Array.from({ length: size }, (_, i) => (tissue(anatomy[i]) ? 0 : 1));
  if (!fromEdge) return strict;
  // The robust range of the anatomy itself (its nonzero values, like the
  // grey window): an exact zero is no anatomy, never a level of it.
  const finite: number[] = [];
  for (let i = 0; i < size; i++) if (tissue(anatomy[i])) finite.push(anatomy[i] as number);
  if (finite.length === 0) return strict;
  finite.sort((a, b) => a - b);
  const at = (p: number) => finite[Math.min(finite.length - 1, Math.floor(p * finite.length))];
  const low = at(0.02),
    high = at(0.98);
  if (!(high > low)) return strict;
  const threshold = low + MONTAGE_BACKGROUND_FRACTION * (high - low);
  const dark = (i: number) => !tissue(anatomy[i]) || (anatomy[i] as number) <= threshold;
  // Flood the dark pixels reachable from the edge (4-connected).
  const out = new Uint8Array(size);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (!out[i] && dark(i)) {
      out[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i + w < size) seed(i + w);
  }
  return out;
}

/**
 * The shared crop of a page of cutouts: the union of every tile's bounding
 * box of what is drawn (the head, by `background`, and any map value drawn
 * outside it: |v| at or above `band`), widened by `margin` and kept inside
 * the cell. Without anatomy, every finite nonzero map value counts. The whole
 * cell when nothing is found. One rectangle for all tiles: never a crop per tile.
 */
export function montageSharedCrop(
  dims: readonly [number, number],
  members: readonly { values: readonly (number | null)[] }[],
  background: Uint8Array | null | undefined,
  margin = MONTAGE_CROP_MARGIN_PX,
  band = 0,
): MontageCrop {
  const [w, h] = dims;
  let left = w,
    right = -1,
    top = h,
    bottom = -1;
  const include = (i: number) => {
    const x = i % w,
      y = Math.floor(i / w);
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  };
  const size = w * h;
  if (background) for (let i = 0; i < background.length && i < size; i++) if (!background[i]) include(i);
  const drawn = (value: number | null | undefined) =>
    value !== null &&
    value !== undefined &&
    Number.isFinite(value) &&
    value !== 0 &&
    Math.abs(value) >= band;
  for (const member of members)
    for (let i = 0; i < member.values.length && i < size; i++)
      // Inside the head the anatomy already counts: only what lies outside it is looked at.
      if ((!background || background[i]) && drawn(member.values[i])) include(i);
  if (right < 0) return { x: 0, y: 0, width: w, height: h };
  const x0 = Math.max(0, left - margin),
    y0 = Math.max(0, top - margin),
    x1 = Math.min(w - 1, right + margin),
    y1 = Math.min(h - 1, bottom + margin);
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * The crop kept across the pages and slices of one view: paging through the
 * montage shows other subjects on the same plane, and stepping the slice
 * shows the same subjects on a parallel plane of the same frame; every page
 * and slice is drawn with the largest crop seen so far, so the brains keep
 * their scale and place (no card or tile changes size or shifts as the slice
 * moves). Another orientation, frame (zoom, raster size), extent, scope or
 * set starts again.
 */
export interface MontageCropMemory {
  key: string | null;
  crop: MontageCrop | null;
}
export const createMontageCropMemory = (): MontageCropMemory => ({ key: null, crop: null });

const rounded = (values: readonly number[]) => values.map((v) => Math.round(v * 1000) / 1000);
/** A plane's frame without its depth: its axes, raster size and in-plane origin. */
export function planeFrameKey(plane: {
  origin_mm: readonly number[];
  u_mm: readonly number[];
  v_mm: readonly number[];
  dim_px: readonly number[];
}): unknown[] {
  const inPlane = [plane.u_mm, plane.v_mm].map((axis) => {
    const length = Math.hypot(axis[0], axis[1], axis[2]) || 1;
    return (
      (plane.origin_mm[0] * axis[0] + plane.origin_mm[1] * axis[1] + plane.origin_mm[2] * axis[2]) /
      length
    );
  });
  return [rounded(plane.u_mm), rounded(plane.v_mm), [...plane.dim_px], rounded(inPlane)];
}

/**
 * What a crop is kept for: the request without the page's members and, for
 * whole-slice tiles, without the slice (its centre is not the tiles' frame).
 */
export function montageCropKey(display: PopulationSliceDisplay): string {
  const request = display.query.request;
  const whole = request.cutouts?.wholePlane === true;
  const cutouts = request.cutouts
    ? { ...request.cutouts, memberIds: undefined, centerMm: whole ? undefined : request.cutouts.centerMm }
    : null;
  const plane = display.data.cutouts?.plane;
  return JSON.stringify([
    request.orientation,
    whole ? null : request.crosshairMm,
    cutouts,
    request.contextKey,
    request.mask?.sourcePath ?? null,
    request.underlay?.sourcePath ?? null,
    plane ? planeFrameKey(plane) : null,
  ]);
}

/** What the Summary cards' crop is kept for: the set and the plane's frame, not its slice. */
export function summaryCropKey(display: PopulationSliceDisplay): string {
  const request = display.query.request;
  return JSON.stringify([
    request.orientation,
    request.contextKey,
    request.mask?.sourcePath ?? null,
    request.underlay?.sourcePath ?? null,
    planeFrameKey(display.data.plane),
  ]);
}

/** The smallest rectangle holding both. */
export function unionCrop(a: MontageCrop, b: MontageCrop): MontageCrop {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** `crop` widened by what `memory` kept for the same key (and remembered). */
export function stableMontageCrop(
  memory: MontageCropMemory,
  key: string,
  crop: MontageCrop,
): MontageCrop {
  const kept = memory.key === key && memory.crop ? unionCrop(memory.crop, crop) : crop;
  memory.key = key;
  memory.crop = kept;
  return kept;
}

export function montageSprites(
  display: PopulationSliceDisplay | null,
  mirrorX: boolean,
  pixelated = true,
  cropMemory: MontageCropMemory | null = null,
): MontageSprites | null {
  const cutouts = display?.data.cutouts;
  const image = display?.images.cutouts;
  if (!cutouts || !image) return null;
  const [w, h] = cutouts.plane.dim_px;
  const underlay = display?.data.underlay?.cutouts;
  const anatomy = underlay && underlay.length === w * h ? underlay : null;
  // Only a whole-slice tile is cropped: a pinned region is already the
  // window asked for (and its edge cuts through the head).
  const whole = display?.query?.request?.cutouts?.wholePlane === true;
  const background = anatomy ? montageBackground([w, h], anatomy, whole) : null;
  // Values inside the hidden band are not drawn, so they do not widen the crop.
  const band =
    display && Number.isFinite(display.effectLimit) ? populationHiddenBand(display.effectLimit) : 0;
  return {
    image,
    cutouts,
    index: new Map(cutouts.members.map((member, i) => [member.memberId, i])),
    sheetColumns: Math.min(8, cutouts.members.length),
    mirrorX,
    pixelated,
    crop: whole
      ? cropMemory && display
        ? stableMontageCrop(
            cropMemory,
            montageCropKey(display),
            montageSharedCrop([w, h], cutouts.members, background, undefined, band),
          )
        : montageSharedCrop([w, h], cutouts.members, background, undefined, band)
      : { x: 0, y: 0, width: w, height: h },
    background,
  };
}

/**
 * Clear the anatomy outside the head on a drawn tile: a pixel is made
 * transparent where `background` marks it and the sprite painted it grey
 * (r = g = b: the anatomy at any intensity, or black; no map colour is a
 * grey). A map colour drawn outside the head stays. Canvas pixel (cx, cy)
 * shows cell pixel (crop.x + column, crop.y + cy), the column mirrored when
 * the tile is.
 */
export function clearTileBackground(
  pixels: Uint8ClampedArray,
  crop: MontageCrop,
  cellWidth: number,
  background: Uint8Array,
  mirrorX: boolean,
) {
  for (let cy = 0; cy < crop.height; cy++)
    for (let cx = 0; cx < crop.width; cx++) {
      const column = mirrorX ? crop.width - 1 - cx : cx;
      if (!background[(crop.y + cy) * cellWidth + crop.x + column]) continue;
      const p = (cy * crop.width + cx) * 4;
      if (pixels[p] === pixels[p + 1] && pixels[p + 1] === pixels[p + 2]) pixels[p + 3] = 0;
    }
  return pixels;
}

export const montageGridStyle = (columns: number): CSSProperties => ({
  gridTemplateColumns: `repeat(${Math.max(1, columns)}, minmax(0, 1fr))`,
  columnGap: MONTAGE_COLUMN_GAP_PX,
  rowGap: MONTAGE_ROW_GAP_PX,
});

const ID_PREFIX = /^[A-Za-z]+[-_]/;

/**
 * A word-and-separator prefix every ID shares ("sub-"), or '' when they do
 * not all share one. Only a whole leading token is taken, never digits, so
 * the prefix does not change from page to page ("sub-10…" stays "sub-").
 */
export function commonIdPrefix(ids: Iterable<string>): string {
  let prefix: string | null = null;
  for (const id of ids) {
    const match = ID_PREFIX.exec(id)?.[0];
    if (!match || match.length >= id.length) return '';
    if (prefix === null) prefix = match;
    else if (prefix !== match) return '';
  }
  return prefix ?? '';
}

/** An ID without the shared prefix (whole when it has none). */
export const shortId = (id: string, prefix: string) =>
  prefix && id.startsWith(prefix) && id.length > prefix.length ? id.slice(prefix.length) : id;

/**
 * Keep the focused subject's tile in view when focus moves (playback, a plot,
 * the Subjects list). Only the montage's own scroller moves, never the column.
 */
export function useRevealFocusedTile(focusedId: string | null, layoutKey: string) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!focusedId || !host.current) return;
    const tile = [...host.current.querySelectorAll<HTMLElement>('[data-datum-id]')].find(
      (element) => element.getAttribute('data-datum-id') === focusedId,
    );
    const scroller = host.current.closest<HTMLElement>('[data-montage-scroller]');
    if (!tile || !scroller) return;
    const view = scroller.getBoundingClientRect(),
      bounds = tile.getBoundingClientRect();
    // A group's heading sticks to the top of the scroller: a tile revealed
    // upwards lands below it, not under it.
    const heading = tile
      .closest('section')
      ?.querySelector<HTMLElement>('[data-montage-sticky]');
    const top = view.top + (heading?.offsetHeight ?? 0);
    if (bounds.top < top) scroller.scrollTop -= top - bounds.top;
    else if (bounds.bottom > view.bottom) scroller.scrollTop += bounds.bottom - view.bottom;
  }, [focusedId, layoutKey]);
  return host;
}

/** Roving-focus props for a cell of the montage (a tile). */
export const MontageCellContext = createContext<((id: string) => RovingItemProps) | null>(null);

/** The cell's tab stop and focus wiring; outside a surface every cell is its own stop. */
export function useMontageCell(id: string): Partial<RovingItemProps> {
  const getItemProps = useContext(MontageCellContext);
  return getItemProps ? getItemProps(id) : {};
}

/** How long tiles take to glide to a new order (ms). */
export const MONTAGE_FLIP_MS = 150;

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Each tile's offset from where it was to where it is now; unmoved and new tiles are left out. */
export function flipOffsets(
  before: ReadonlyMap<string, { left: number; top: number }>,
  after: ReadonlyMap<string, { left: number; top: number }>,
): Map<string, { dx: number; dy: number }> {
  const out = new Map<string, { dx: number; dy: number }>();
  for (const [id, now] of after) {
    const was = before.get(id);
    if (!was) continue;
    const dx = was.left - now.left,
      dy = was.top - now.top;
    if (dx || dy) out.set(id, { dx, dy });
  }
  return out;
}

/**
 * When the tiles' order changes, each tile glides from its old place to its
 * new one (FLIP, `MONTAGE_FLIP_MS`), so a re-sort reads as a reflow and not
 * a jump. Positions are the tiles' offsets in the scrolled content, so a
 * scroll between orders does not count as a move. A new order during a glide
 * starts from where each tile is drawn (the glide in flight is measured, then
 * cancelled), never from its old layout place. Nothing moves under
 * prefers-reduced-motion, or when the layout (the tiles per row) changed too.
 */
export function useTileFlip(host: RefObject<HTMLElement | null>, order: string, layout: string) {
  const last = useRef<{ order: string; layout: string; places: Map<string, { left: number; top: number }> } | null>(
    null,
  );
  const glides = useRef(new Map<string, Animation>());
  useLayoutEffect(() => {
    const root = host.current;
    if (!root) return;
    const tiles = [...root.querySelectorAll<HTMLElement>('[data-datum-id]')];
    const origin = root.getBoundingClientRect();
    const measure = () =>
      new Map(
        tiles.map((tile) => {
          const rect = tile.getBoundingClientRect();
          return [
            tile.getAttribute('data-datum-id')!,
            { left: rect.left - origin.left + root.scrollLeft, top: rect.top - origin.top + root.scrollTop },
          ] as const;
        }),
      );
    // Where each tile is drawn now (a glide in flight included), then its
    // layout place once the glides are cancelled.
    const drawn = measure();
    const gliding = glides.current.size > 0;
    for (const glide of glides.current.values()) glide.cancel();
    glides.current.clear();
    const places = gliding ? measure() : drawn;
    const previous = last.current;
    last.current = { order, layout, places };
    if (!previous || previous.order === order || previous.layout !== layout || reducedMotion())
      return;
    // Where each tile was seen: its previous layout place, moved by the
    // part of its glide still to run.
    const seen = new Map<string, { left: number; top: number }>();
    for (const [id, was] of previous.places) {
      const now = drawn.get(id),
        place = places.get(id);
      seen.set(
        id,
        now && place ? { left: was.left + now.left - place.left, top: was.top + now.top - place.top } : was,
      );
    }
    const offsets = flipOffsets(seen, places);
    for (const tile of tiles) {
      const id = tile.getAttribute('data-datum-id')!;
      const offset = offsets.get(id);
      if (!offset || typeof tile.animate !== 'function') continue;
      const glide = tile.animate(
        [
          { transform: `translate(${offset.dx}px, ${offset.dy}px)` },
          { transform: 'translate(0, 0)' },
        ],
        { duration: MONTAGE_FLIP_MS, easing: 'ease-out' },
      );
      if (!glide) continue;
      glides.current.set(id, glide);
      glide.onfinish = () => {
        if (glides.current.get(id) === glide) glides.current.delete(id);
      };
    }
  }, [host, order, layout]);
  useEffect(() => {
    const running = glides.current;
    return () => {
      for (const glide of running.values()) glide.cancel();
      running.clear();
    };
  }, []);
}
