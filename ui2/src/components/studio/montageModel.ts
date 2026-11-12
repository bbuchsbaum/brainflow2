import type { PopulationPartition } from '@/types/population';
import type { PopulationOrientation } from '@/services/studio/PopulationSliceService';
import { isOutlierGroup, isUnassignedGroup } from '@/services/studio/populationGroups';
import { displayMinus, formatWorldMm } from '@/utils/valueFormat';

/**
 * Pure model of the Population montage: the Sort and Group option lists, the
 * orders the lens itself applies (distance from mean, a design column,
 * reversal), the grouped-row layout and the footer wording. No store access.
 */

// ── limits ──────────────────────────────────────────────────────────────────

/** Most subjects on one page. */
export const MONTAGE_PAGE_SIZE = 80;
export const MONTAGE_GAP_PX = 6;
/** Groups a similarity grouping starts with (adjustable under Spatial relationships). */
export const MONTAGE_SIMILARITY_GROUPS = 3;

// ── sort ────────────────────────────────────────────────────────────────────

export type MontageSort =
  | 'source'
  | 'similarity'
  | 'distance'
  | 'crosshair'
  /** Twelve subjects sampled across the range of values at the pin. */
  | 'witnesses'
  | `column:${string}`;

/**
 * How alike two maps are, as the similarity fit measures it. Both are
 * computed on the files' raw values over the voxels finite in every fitted
 * subject (the whole volume, or a mask or pinned region when one applies);
 * the display threshold and the colour scale play no part.
 * - `pattern-shape`: each map has its mean removed and is scaled to unit
 *   length first, so the distance is a correlation distance and ignores
 *   amplitude.
 * - `effect`: the root-mean-square difference of the raw values, so maps
 *   that differ only in amplitude are far apart.
 */
export type SimilarityMeasure = 'pattern-shape' | 'effect';
export const DEFAULT_SIMILARITY_MEASURE: SimilarityMeasure = 'pattern-shape';
/**
 * The measure in words, in the Sort and Group menus ("Similarity ·
 * correlation"), and its notation where room is short: the closed Group
 * select reads "r · 2 groups" (r: correlation; RMS: root-mean-square
 * difference). Each option's tooltip says it in full.
 */
const MEASURE_WORD: Record<SimilarityMeasure, string> = {
  'pattern-shape': 'correlation',
  effect: 'amplitude',
};
const MEASURE_NAME: Record<SimilarityMeasure, string> = {
  'pattern-shape': 'r',
  effect: 'RMS',
};
/** What the footer calls the distance. */
const MEASURE_DISTANCE: Record<SimilarityMeasure, string> = {
  'pattern-shape': 'correlation distance',
  effect: 'RMS difference',
};
export const SIMILARITY_MEASURE_LINE: Record<SimilarityMeasure, string> = {
  'pattern-shape':
    'Correlation distance of raw values (amplitude ignored), whole volume or mask, unthresholded',
  effect: 'RMS difference of raw values (amplitude counts), whole volume or mask, unthresholded',
};
/** What each linkage the backend clusters with is called on screen. */
export const SIMILARITY_LINKAGE_NAME: Record<'ward' | 'average', string> = {
  ward: 'Ward linkage clustering',
  average: 'average-linkage clustering',
};
/**
 * The linkage the montage's Group by similarity asks for (a grouping fit; the
 * backend's default). A fit says which linkage made it (`geometry.grouping`);
 * one without grouping evidence was made with average linkage.
 */
export const SIMILARITY_GROUPING_LINKAGE = 'ward' as const;
export const SIMILARITY_GROUPING_METHOD = SIMILARITY_LINKAGE_NAME[SIMILARITY_GROUPING_LINKAGE];

/**
 * The backend refuses correlation when a map is constant on the voxels every
 * subject shares (its error says "pattern shape is undefined"): said plainly,
 * so amplitude can be offered in its place. Null for any other failure.
 */
export function correlationRefusal(error: string | null | undefined): string | null {
  return error && /pattern shape is undefined/i.test(error)
    ? 'Correlation cannot be computed: at least one map is constant on the voxels every subject shares. Amplitude can still be compared.'
    : null;
}

export const similarityValue = (measure: SimilarityMeasure) => `similarity:${measure}`;
/** The measure a Sort or Group value names, or null when it is not a similarity choice. */
export function similarityMeasureOf(value: string): SimilarityMeasure | null {
  return value === 'similarity:pattern-shape'
    ? 'pattern-shape'
    : value === 'similarity:effect'
      ? 'effect'
      : null;
}
const similarityOptions = (lead: string, method?: string): MontageOption[] =>
  (['pattern-shape', 'effect'] as const).map((measure) => ({
    value: similarityValue(measure),
    label: `Similarity · ${MEASURE_WORD[measure]}`,
    short: MEASURE_NAME[measure],
    description: `${lead}${method ? ` (${method})` : ''}. ${SIMILARITY_MEASURE_LINE[measure]}`,
  }));

/** "correlation distance · whole volume, unthresholded · 9,919 shared voxels". */
export function similarityDescription(args: {
  measure: SimilarityMeasure;
  maskName: string | null;
  /** The fit was restricted to the pinned region. */
  region: boolean;
  sharedVoxels: number | null;
}): string {
  const where = args.region
    ? 'within the pinned region'
    : args.maskName
      ? `within mask ${args.maskName}`
      : 'whole volume';
  return [
    MEASURE_DISTANCE[args.measure],
    `${where}, unthresholded`,
    ...(args.sharedVoxels === null
      ? []
      : [`${args.sharedVoxels.toLocaleString('en-US')} shared voxels`]),
  ].join(' · ');
}

export interface MontageOption {
  value: string;
  label: string;
  /** One line saying what the choice does (the option's tooltip). */
  description?: string;
  disabled?: boolean;
  /** Listed under this heading in the menu (consecutive options share one). */
  group?: string;
  /** What a closed select shows where room is short ("r" for "Similarity · correlation"). */
  short?: string;
}

export interface MontageSortOptions {
  orders: MontageOption[];
  columns: MontageOption[];
}

export function montageSortOptions(args: {
  columns: readonly string[];
  /** Whether a value at the pin can be read (a point is pinned). */
  crosshairAvailable: boolean;
}): MontageSortOptions {
  return {
    orders: [
      { value: 'source', label: 'Source order', description: 'As listed in the folder or table' },
      ...similarityOptions('Neighbours are the most alike'),
      {
        value: 'distance',
        label: 'Distance from mean',
        description: 'Most typical first, outliers last',
      },
      {
        value: 'crosshair',
        label: 'Value at pin',
        // Nothing pins silently: the point is pinned in the Values tab or on a map.
        description: args.crosshairAvailable ? "Each map's value at the pinned point" : 'Pin a point first',
        disabled: !args.crosshairAvailable,
      },
      {
        value: 'witnesses',
        label: 'Value at pin, 12 sampled',
        description: args.crosshairAvailable
          ? 'Twelve actual maps sampled across the range of values at the pinned point'
          : 'Pin a point first',
        disabled: !args.crosshairAvailable,
      },
    ],
    columns: args.columns.map((column) => ({
      value: `column:${column}`,
      label: column,
      description: `Ordered by the ${column} column`,
    })),
  };
}

export const sortColumn = (sort: MontageSort): string | null =>
  sort.startsWith('column:') ? sort.slice('column:'.length) : null;

/** `ids` by a design column: numeric-aware, empty values last, ties in source order. */
export function orderByColumn(
  ids: readonly string[],
  rows: ReadonlyMap<string, Readonly<Record<string, string>>>,
  column: string,
): string[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const position = new Map(ids.map((id, i) => [id, i]));
  const value = (id: string) => rows.get(id)?.[column]?.trim() ?? '';
  return [...ids].sort((a, b) => {
    const va = value(a),
      vb = value(b);
    if (!va || !vb) {
      if (!!va !== !!vb) return va ? -1 : 1;
      return position.get(a)! - position.get(b)!;
    }
    return collator.compare(va, vb) || position.get(a)! - position.get(b)!;
  });
}

/** `ids` nearest the mean first; subjects without a distance keep their order, last. */
export function orderByDistance(
  ids: readonly string[],
  distance: ReadonlyMap<string, { euclidean: number }>,
): string[] {
  const position = new Map(ids.map((id, i) => [id, i]));
  return [...ids].sort((a, b) => {
    const da = distance.get(a)?.euclidean,
      db = distance.get(b)?.euclidean;
    if (da === undefined || db === undefined) {
      if (da !== db) return da === undefined ? 1 : -1;
      return position.get(a)! - position.get(b)!;
    }
    return da - db || position.get(a)! - position.get(b)!;
  });
}

// ── group ───────────────────────────────────────────────────────────────────

export const MONTAGE_GROUP_NONE = 'none';
export const MONTAGE_GROUP_SIMILARITY = 'similarity';
/** A grouping made elsewhere that the menu cannot name (two crossed factors). */
export const MONTAGE_GROUP_OTHER = 'other';
/** The grouping before this one (the store's own history). */
export const MONTAGE_GROUP_RESTORE = 'restore';
/** Two crossed factors: `two:["first","second"]`. */
export const MONTAGE_GROUP_TWO_FACTORS = 'two:';
const twoFactorValue = (first: string, second: string) =>
  `${MONTAGE_GROUP_TWO_FACTORS}${JSON.stringify([first, second])}`;
/** Pairs offered under "Two factors…"; more columns than this list none. */
const TWO_FACTOR_PAIR_LIMIT = 15;

export function montageGroupValue(
  partition: PopulationPartition | null,
  columns: readonly string[],
): string {
  if (!partition) return MONTAGE_GROUP_NONE;
  if (partition.origin === 'map-derived') return MONTAGE_GROUP_SIMILARITY;
  if (
    partition.factorColumns &&
    partition.factorColumns.every((column) => columns.includes(column))
  )
    return twoFactorValue(partition.factorColumns[0], partition.factorColumns[1]);
  return !partition.factorColumns && columns.includes(partition.column)
    ? `factor:${partition.column}`
    : MONTAGE_GROUP_OTHER;
}

/** What the Group menu calls a design column, where its own name says little. */
const GROUP_COLUMN_LABEL: Readonly<Record<string, string>> = { roles: 'By map' };
const groupColumnLabel = (column: string) => GROUP_COLUMN_LABEL[column] ?? column;

/**
 * Whether grouping by a design column makes groups: at least two values, and
 * not one per subject (an ID such as "member" gives each subject a group of
 * its own). "One per subject" says the column is an ID only with more than
 * three subjects: in a set of two or three, distinct values are as likely a
 * factor (patient / control) as an ID. `values` are the column's values over
 * every subject of the set (`groupableColumnsOf`), not only those in view, so
 * the Group menu does not change as the view is filtered.
 */
export function isGroupableColumn(values: readonly string[]): boolean {
  const distinct = new Set(values).size;
  if (distinct < 2) return false;
  return values.length <= 3 || distinct < values.length;
}

/** The design columns that make groups over the subjects `ids` (see isGroupableColumn). */
export function groupableColumnsOf(
  columns: readonly string[],
  ids: readonly string[],
  rows: ReadonlyMap<string, Readonly<Record<string, string>>>,
): Set<string> {
  return new Set(
    columns.filter((column) => isGroupableColumn(ids.map((id) => rows.get(id)?.[column] ?? ''))),
  );
}

/**
 * The Group menu: None, similarity by either measure, the design columns that
 * make groups, crossed pairs of them, and "Restore previous grouping" while
 * there is one. A choice that does nothing is not listed (a column with one
 * value or one per subject, a restore with nothing to restore); the grouping
 * in force is always listed.
 */
export function montageGroupOptions(
  columns: readonly string[],
  partition: PopulationPartition | null,
  {
    canRestore = false,
    groupable = () => true,
  }: {
    canRestore?: boolean;
    /** Whether a column makes groups (see isGroupableColumn); every column when absent. */
    groupable?: (column: string) => boolean;
  } = {},
): MontageOption[] {
  const current = montageGroupValue(partition, columns);
  const offered = columns.filter(
    (column) => groupable(column) || current === `factor:${column}`,
  );
  const pairs = columns
    .flatMap((first, i) => columns.slice(i + 1).map((second) => [first, second] as const))
    .filter(
      ([first, second]) =>
        (groupable(first) && groupable(second)) || current === twoFactorValue(first, second),
    );
  return [
    { value: MONTAGE_GROUP_NONE, label: 'None', description: 'One grid of every subject' },
    ...similarityOptions('Subjects whose maps are alike share a group', SIMILARITY_GROUPING_METHOD),
    ...offered.map((column) => ({
      value: `factor:${column}`,
      label: groupColumnLabel(column),
      description: `One group per value of ${column}`,
    })),
    ...(current === MONTAGE_GROUP_OTHER
      ? [{ value: MONTAGE_GROUP_OTHER, label: partition!.column }]
      : []),
    ...(pairs.length <= TWO_FACTOR_PAIR_LIMIT
      ? pairs.map(([first, second]) => ({
          value: twoFactorValue(first, second),
          label: `${groupColumnLabel(first)} × ${groupColumnLabel(second)}`,
          description: `One group per pair of ${first} and ${second} values`,
          group: 'Two factors',
        }))
      : []),
    ...(canRestore
      ? [
          {
            value: MONTAGE_GROUP_RESTORE,
            label: 'Restore previous grouping',
            description: 'Go back to the grouping before this one',
            group: '',
          },
        ]
      : []),
  ];
}

export interface MontageGroup {
  id: string;
  label: string;
  /** Members in the montage's order. */
  memberIds: string[];
  /** Subjects a similarity fit could not place: listed, never a group with a mean. */
  unassigned: boolean;
  /** Subjects alone in their similarity cluster: listed, never a group with a mean. */
  outliers?: boolean;
}

/** The partition's groups with their members in `orderedIds` order. */
export function montageGroups(
  partition: PopulationPartition,
  orderedIds: readonly string[],
): MontageGroup[] {
  const position = new Map(orderedIds.map((id, i) => [id, i]));
  const rank = (id: string) => position.get(id) ?? Number.MAX_SAFE_INTEGER;
  return partition.groups.map((group) => {
    const unassigned = isUnassignedGroup(partition, group);
    // Outliers, and a saved similarity grouping's one-member groups, are not
    // groups: no Select group, no group mean.
    const outliers =
      isOutlierGroup(partition, group) ||
      (partition.origin === 'map-derived' && !unassigned && group.memberIds.length === 1);
    return {
      id: group.id,
      label: unassigned
        ? 'Not placed'
        : outliers
          ? 'Outliers'
        : partition.origin === 'map-derived' && group.value
          ? `Group ${group.value}`
          : group.label,
      memberIds: [...group.memberIds].sort((a, b) => rank(a) - rank(b)),
      unassigned,
      ...(outliers ? { outliers } : {}),
    };
  });
}

export interface MontageGroupRow {
  group: MontageGroup;
  /** The group's tiles on this page: every member, wrapped (never collapsed). */
  shown: string[];
}

/**
 * `ids` (one page's tiles, or one group's part of a page) ordered by their
 * values at the probe: lowest first, unavailable last, ties and the
 * unavailable in their given order, as a value-at-pin order is made. Reversed
 * reverses the whole, as a reversed order does. The same array comes back
 * when nothing moves, so an unchanged page does not re-render or glide.
 */
export function orderByValueWithin(
  ids: readonly string[],
  values: ReadonlyMap<string, number | null>,
  reversed = false,
): readonly string[] {
  const finite: { id: string; value: number }[] = [];
  const unavailable: string[] = [];
  for (const id of ids) {
    const value = values.get(id);
    if (typeof value === 'number' && Number.isFinite(value)) finite.push({ id, value });
    else unavailable.push(id);
  }
  // Array.prototype.sort is stable: ties keep their given order.
  finite.sort((a, b) => a.value - b.value);
  const ordered = [...finite.map((entry) => entry.id), ...unavailable];
  if (reversed) ordered.reverse();
  return ordered.every((id, i) => id === ids[i]) ? ids : ordered;
}

/**
 * `order` with the places held by `shown`'s IDs given to them in `shown`'s
 * order; every other ID keeps its place. A page reordered on screen thus
 * reorders the whole sequence (the transport, the Subjects list) without
 * moving anyone onto another page.
 */
export function withinPlaces(order: readonly string[], shown: readonly string[]): readonly string[] {
  const present = new Set(order);
  const placing = shown.filter((id) => present.has(id));
  const members = new Set(placing);
  let next = 0;
  let moved = false;
  const result = order.map((id) => {
    if (!members.has(id) || next >= placing.length) return id;
    const placed = placing[next++];
    if (placed !== id) moved = true;
    return placed;
  });
  return moved ? result : order;
}

/**
 * The grouped montage cut into pages of at most `pageSize` tiles, so one
 * request can carry an image for every tile drawn. Every member of every group
 * is shown, wrapped onto as many rows as it needs; a group too long for the
 * rest of a page continues on the next.
 */
export function groupedPages(
  groups: readonly MontageGroup[],
  pageSize = MONTAGE_PAGE_SIZE,
): MontageGroupRow[][] {
  const pages: MontageGroupRow[][] = [[]];
  let room = pageSize;
  for (const group of groups) {
    const shown = group.memberIds;
    let at = 0;
    do {
      if (room === 0) {
        pages.push([]);
        room = pageSize;
      }
      const part = shown.slice(at, at + room);
      at += part.length;
      room -= part.length;
      pages[pages.length - 1].push({ group, shown: part });
    } while (at < shown.length);
  }
  return pages;
}

/** The nearest cell in the row above (−1) or below (+1) `from`, by position on screen. */
export function verticalNeighbour(
  rects: readonly { left: number; right: number; top: number; bottom: number }[],
  from: number,
  direction: -1 | 1,
): number | null {
  const origin = rects[from];
  if (!origin) return null;
  const centre = (r: { left: number; right: number }) => (r.left + r.right) / 2;
  let best: number | null = null;
  rects.forEach((rect, i) => {
    const beyond = direction > 0 ? rect.top >= origin.bottom - 1 : rect.bottom <= origin.top + 1;
    if (i === from || !beyond) return;
    if (best === null) {
      best = i;
      return;
    }
    const current = rects[best];
    const rowGap = direction > 0 ? rect.top - current.top : current.top - rect.top;
    // A nearer row wins; within a row, the cell most nearly above or below.
    if (
      rowGap < -1 ||
      (Math.abs(rowGap) <= 1 &&
        Math.abs(centre(rect) - centre(origin)) < Math.abs(centre(current) - centre(origin)))
    )
      best = i;
  });
  return best;
}

// ── layout ──────────────────────────────────────────────────────────────────

/** A tile is never narrower than this, so its ID stays readable. */
export const MONTAGE_TILE_MIN_PX = 72;
export const MONTAGE_TILES_PER_ROW_MIN = 2;
export const MONTAGE_TILES_PER_ROW_MAX = 12;
/** The tile width the montage opens at, before a choice is made. */
const MONTAGE_TILE_DEFAULT_PX = 150;

/** The whole numbers of tiles per row a width can hold. */
export function tilesPerRowRange(width: number, gap = MONTAGE_GAP_PX): { min: number; max: number } {
  const fit = width > 0 ? Math.floor((width + gap) / (MONTAGE_TILE_MIN_PX + gap)) : 1;
  const max = Math.max(1, Math.min(MONTAGE_TILES_PER_ROW_MAX, fit));
  return { min: Math.min(MONTAGE_TILES_PER_ROW_MIN, max), max };
}

/** `count` snapped to a whole number of tiles the width can hold. */
export function clampTilesPerRow(count: number, width: number): number {
  const { min, max } = tilesPerRowRange(width);
  return Number.isFinite(count) ? Math.min(max, Math.max(min, Math.round(count))) : min;
}

const perRowFor = (width: number, tilePx: number, gap = MONTAGE_GAP_PX) =>
  clampTilesPerRow((width + gap) / (tilePx + gap), width);

export function defaultTilesPerRow(width: number): number {
  return perRowFor(width, MONTAGE_TILE_DEFAULT_PX);
}

export type MontageTilePreset = 'S' | 'M' | 'L';
const PRESET_PX: Record<MontageTilePreset, number> = { S: 100, M: 150, L: 230 };
/** Tiles per row of the three sizes offered when there is no room for a slider. */
export function presetTilesPerRow(preset: MontageTilePreset, width: number): number {
  return perRowFor(width, PRESET_PX[preset]);
}
/** The preset nearest a tiles-per-row count (fewer tiles per row is larger). */
export function nearestTilePreset(count: number, width: number): MontageTilePreset {
  const presets: MontageTilePreset[] = ['S', 'M', 'L'];
  return presets.reduce((best, preset) =>
    Math.abs(presetTilesPerRow(preset, width) - count) <
    Math.abs(presetTilesPerRow(best, width) - count)
      ? preset
      : best,
  );
}

/** Tiles fill the width exactly: the width of one of `count` per row. */
export function tileWidthPx(width: number, count: number, gap = MONTAGE_GAP_PX): number {
  return Math.max(1, (width - gap * (Math.max(1, count) - 1)) / Math.max(1, count));
}

/** Rows of tiles sit 4 px apart. */
export const MONTAGE_ROW_GAP_PX = 4;
/** A tile's ID line under its image. */
export const MONTAGE_TILE_LABEL_PX = 16;
/** A group's sticky heading (24 px) and the 2 px under it. */
export const MONTAGE_GROUP_HEADER_PX = 26;
/** Groups sit 20 px apart. */
export const MONTAGE_GROUP_GAP_PX = 20;
/** Room kept under the last row. */
export const MONTAGE_BOTTOM_PAD_PX = 12;
/**
 * The fitted size stays within these: smaller and the brains stop reading as
 * brains (a set too large to fit then scrolls), larger and a few subjects are
 * blown up past any use.
 */
export const MONTAGE_FIT_MIN_PX = 96;
export const MONTAGE_FIT_MAX_PX = 260;

export interface MontageFitInput {
  /** The width the tiles fill and the height of the grid's scroller (px). */
  width: number;
  height: number;
  /** A tile image's height over its width (the shared crop's). */
  aspect: number;
  /** Tiles in each block: one per group when grouped, else one block. */
  blocks: readonly number[];
  /** Each block has a group heading. */
  headings: boolean;
}

/** The height the montage takes at `columns` tiles per row (px). */
export function montageLayoutHeight(input: MontageFitInput, columns: number): number {
  const tile = tileWidthPx(input.width, columns) * input.aspect + MONTAGE_TILE_LABEL_PX;
  const blocks = input.blocks.filter((n) => n > 0);
  const body = blocks.reduce((sum, n) => {
    const rows = Math.ceil(n / Math.max(1, columns));
    return (
      sum +
      rows * tile +
      (rows - 1) * MONTAGE_ROW_GAP_PX +
      (input.headings ? MONTAGE_GROUP_HEADER_PX : 0)
    );
  }, 0);
  return body + Math.max(0, blocks.length - 1) * MONTAGE_GROUP_GAP_PX + MONTAGE_BOTTOM_PAD_PX;
}

/**
 * Tiles per row when none has been chosen: the largest shared tile with which
 * the whole page fits the pane without scrolling, within
 * `MONTAGE_FIT_MIN_PX`–`MONTAGE_FIT_MAX_PX`. When even the smallest of those
 * does not fit, the smallest is used and the rest scrolls. Null until the
 * pane has been measured.
 */
export function fitTilesPerRow(input: MontageFitInput): number | null {
  if (!(input.width > 0) || !(input.height > 0)) return null;
  const aspect = Number.isFinite(input.aspect) && input.aspect > 0 ? input.aspect : 1;
  const sized = { ...input, aspect };
  const { min, max } = tilesPerRowRange(input.width);
  let smallest = min;
  for (let columns = min; columns <= max; columns++) {
    const tile = tileWidthPx(input.width, columns);
    if (tile < MONTAGE_FIT_MIN_PX && columns > min) break;
    smallest = columns;
    if (tile > MONTAGE_FIT_MAX_PX && columns < max) continue;
    if (montageLayoutHeight(sized, columns) <= input.height) return columns;
  }
  return smallest;
}

// ── resolution ──────────────────────────────────────────────────────────────

/**
 * Subjects per page. Tiles are sampled at the image's own in-plane
 * resolution (`nativeDim` voxels an edge, known from the first result), so
 * the page is as long as the request's budget of values (pixels x subjects)
 * allows at that resolution, and no longer than 80. It depends on the image
 * alone: not on the tile size on screen or the display's pixel ratio.
 */
export function montagePageSize(args: {
  nativeDim: number | null;
  maxDim: number;
  valueBudget: number;
}): number {
  if (!args.nativeDim) return MONTAGE_PAGE_SIZE;
  const dim = Math.min(args.maxDim, Math.max(1, args.nativeDim));
  return Math.max(1, Math.min(MONTAGE_PAGE_SIZE, Math.floor(args.valueBudget / (dim * dim))));
}

/**
 * Whether a tile is drawn pixel for pixel (nearest neighbour): when it is
 * shown at or above the resolution it was sampled at. Enlarging with
 * smoothing would blend neighbouring colours into ones the scale does not
 * have; a tile shown smaller than it was sampled is averaged down instead.
 */
export function tileDrawnPixelated(tilePx: number, devicePixelRatio: number, dim: number): boolean {
  return tilePx * Math.max(1, devicePixelRatio || 1) >= dim;
}

/** "tiles at 114 of 218 px" when the sampler had to lower the resolution; else null. */
export function resolutionNote(dim: number | null, nativeDim: number | null): string | null {
  return dim && nativeDim && dim < nativeDim ? `tiles at ${dim} of ${nativeDim} px` : null;
}

// ── toolbar ─────────────────────────────────────────────────────────────────

export interface MontageToolbarLayout {
  /** The word "Slice" before the plane select. */
  sliceLabel: boolean;
  /** The words "Sort" and "Group" (the selects keep their names). */
  fieldLabels: boolean;
  /**
   * The narrowest step: Sort and Group keep a fixed, smaller width and
   * truncate inside their own box. Nothing on the row ever shrinks under
   * another control; the slice readout ("z −8.5 mm") is always shown.
   */
  compactSelects: boolean;
  /** A stepped slider, three sizes, or (narrowest) the three sizes in a menu. */
  tileControl: 'slider' | 'presets' | 'menu';
}

/** The narrowest layout: nothing more can be given up. */
export const MONTAGE_TOOLBAR_MAX_LEVEL = 5;

/**
 * What the one montage row shows at each step of narrowing. The row measures
 * itself and steps down while its content does not fit, so the order here is
 * the order things are given up: the word "Slice", the other field words,
 * the slider for three sizes, the sizes into a menu, and last Sort and Group
 * narrow to a fixed width. The tile-size control is never cut off and the
 * slice readout is never hidden.
 */
export function montageToolbarLayout(level: number): MontageToolbarLayout {
  return {
    sliceLabel: level < 1,
    fieldLabels: level < 2,
    tileControl: level < 3 ? 'slider' : level < 4 ? 'presets' : 'menu',
    compactSelects: level >= MONTAGE_TOOLBAR_MAX_LEVEL,
  };
}

/** Whether two client rectangles overlap (a drag across a tile selects it). */
export function rectsOverlap(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

// ── wording ─────────────────────────────────────────────────────────────────

const AXIS: Record<PopulationOrientation, { letter: string; index: 0 | 1 | 2 }> = {
  axial: { letter: 'z', index: 2 },
  coronal: { letter: 'y', index: 1 },
  sagittal: { letter: 'x', index: 0 },
};

/** "z −8.5 mm": the slice position along the plane's axis, with a true minus. */
export function sliceReadout(orientation: PopulationOrientation, worldMm: readonly number[]) {
  const { letter, index } = AXIS[orientation];
  return `${letter} ${formatWorldMm(worldMm[index])} mm`;
}

/** A scale limit at three significant digits, without trailing zeros ("0.022", "6"). */
export function limitText(limit: number): string {
  return Number.isFinite(limit) ? String(Number(limit.toPrecision(3))) : '';
}
export const limitDisplay = (limit: number) => displayMinus(limitText(limit));

function sortPhrase(sort: MontageSort, grouped: boolean): string {
  const column = sortColumn(sort);
  if (column) return `ordered by ${column}`;
  switch (sort) {
    case 'similarity':
      return 'neighbours are the most alike';
    case 'distance':
      // One mean, of every subject in context: groups are not ranked against their own.
      return grouped ? 'closest to the overall mean first' : 'closest to the mean first';
    case 'crosshair':
      return 'ordered by value at pin';
    default:
      return 'source order';
  }
}

/** The order in use, for a label outside the grid ("Ordered by age, reversed"). */
export function montageOrderLabel(sort: MontageSort, reversed: boolean): string {
  const column = sortColumn(sort);
  const name = column
    ? `Ordered by ${column}`
    : sort === 'similarity'
      ? 'Similarity order'
      : sort === 'distance'
        ? 'Distance from the mean, closest first'
        : sort === 'crosshair'
          ? 'Ordered by value at pin'
          : sort === 'witnesses'
            ? 'Value at pin, 12 sampled'
            : 'Source order';
  return reversed ? `${name}, reversed` : name;
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

export interface MontageFooterInput {
  /** Subjects with a tile on screen. */
  shown: number;
  total: number;
  sort: MontageSort;
  reversed: boolean;
  /** Number of groups, or null when ungrouped. */
  groups: number | null;
  /** The tiles belong to an earlier request. */
  previous: boolean;
  updating: boolean;
  /** What is being computed for the chosen sort or grouping, e.g. "similarity". */
  computing?: string | null;
  /** A caveat about the order (an earlier fit, changed images). */
  orderNote?: string | null;
  /** Why the maps have no anatomy under them. */
  anatomyNote?: string | null;
  /** The tiles are sampled below the image's own resolution. */
  resolutionNote?: string | null;
  /** What a similarity order was computed from (`similarityDescription`). */
  sortSimilarity?: string | null;
  /** What similarity groups were computed from. */
  groupSimilarity?: string | null;
}

/** The footer's plain description of what the grid shows. */
export function montageFooterText(input: MontageFooterInput): string {
  const subjects =
    input.groups !== null && input.shown >= input.total
      ? plural(input.total, 'subject')
      : // Collapsed rows and pages leave subjects off screen: say how many are on it.
        `${input.shown} of ${plural(input.total, 'subject')}`;
  const order = `${sortPhrase(input.sort, input.groups !== null)}${input.reversed ? ', reversed' : ''}`;
  // What was computed is named with the thing it made: groups first, then the order.
  const parts =
    input.groups === null
      ? [subjects, order, ...(input.sortSimilarity ? [input.sortSimilarity] : [])]
      : [
          plural(input.groups, 'group'),
          ...(input.groupSimilarity ? [input.groupSimilarity] : []),
          subjects,
          order,
          ...(input.sortSimilarity && input.sortSimilarity !== input.groupSimilarity
            ? [input.sortSimilarity]
            : []),
        ];
  if (input.orderNote) parts.push(input.orderNote);
  if (input.computing) parts.push(`computing ${input.computing}…`);
  if (input.previous) parts.push('previous query');
  if (input.updating) parts.push('updating');
  if (input.anatomyNote) parts.push(input.anatomyNote);
  if (input.resolutionNote) parts.push(input.resolutionNote);
  return parts.join(' · ');
}
