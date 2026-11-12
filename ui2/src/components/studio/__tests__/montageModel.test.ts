import { describe, expect, it } from 'vitest';
import type { PopulationPartition } from '@/types/population';
import {
  clampTilesPerRow,
  defaultTilesPerRow,
  MONTAGE_TOOLBAR_MAX_LEVEL,
  montagePageSize,
  resolutionNote,
  tileDrawnPixelated,
  montageToolbarLayout,
  nearestTilePreset,
  presetTilesPerRow,
  tileWidthPx,
  tilesPerRowRange,
  groupedPages,
  fitTilesPerRow,
  montageLayoutHeight,
  MONTAGE_FIT_MIN_PX,
  MONTAGE_FIT_MAX_PX,
  limitText,
  montageFooterText,
  isGroupableColumn,
  groupableColumnsOf,
  montageGroupOptions,
  montageGroupValue,
  montageGroups,
  montageOrderLabel,
  montageSortOptions,
  correlationRefusal,
  similarityDescription,
  similarityMeasureOf,
  DEFAULT_SIMILARITY_MEASURE,
  orderByColumn,
  orderByDistance,
  rectsOverlap,
  sliceReadout,
  verticalNeighbour,
  orderByValueWithin,
  withinPlaces,
} from '../montageModel';

const partition = (overrides: Partial<PopulationPartition> = {}): PopulationPartition => ({
  setId: 'set',
  column: 'site',
  origin: 'metadata',
  contextIds: ['a', 'b', 'c', 'd'],
  groups: [
    { id: 'factor-0', label: 'site: X', value: 'X', memberIds: ['a', 'c'] },
    { id: 'factor-1', label: 'site: Y', value: 'Y', memberIds: ['b', 'd'] },
  ],
  ...overrides,
});

describe('sort options', () => {
  it('lists the orders (similarity by either measure) with their one-line explanations and the columns', () => {
    const options = montageSortOptions({ columns: ['age', 'site'], crosshairAvailable: true });
    expect(options.orders.map((o) => [o.label, o.description])).toEqual([
      ['Source order', 'As listed in the folder or table'],
      [
        'Similarity · correlation',
        'Neighbours are the most alike. Correlation distance of raw values (amplitude ignored), whole volume or mask, unthresholded',
      ],
      [
        'Similarity · amplitude',
        'Neighbours are the most alike. RMS difference of raw values (amplitude counts), whole volume or mask, unthresholded',
      ],
      ['Distance from mean', 'Most typical first, outliers last'],
      ['Value at pin', "Each map's value at the pinned point"],
      // C′ (inventory row 46): twelve maps sampled across the values, a Sort option.
      [
        'Value at pin, 12 sampled',
        'Twelve actual maps sampled across the range of values at the pinned point',
      ],
    ]);
    expect(options.columns.map((o) => o.value)).toEqual(['column:age', 'column:site']);
    // Reversal is a control of its own, never a sort that snaps back.
    expect(JSON.stringify(options)).not.toMatch(/reverse/i);
  });
  it('disables the value orders until a point is pinned, and says so', () => {
    const options = montageSortOptions({ columns: [], crosshairAvailable: false });
    for (const value of ['crosshair', 'witnesses']) {
      expect(options.orders.find((o) => o.value === value)?.disabled).toBe(true);
      expect(options.orders.find((o) => o.value === value)?.description).toBe('Pin a point first');
    }
  });
});

describe('orders the lens applies', () => {
  it('orders by a design column numerically, empty values last, ties in source order', () => {
    const rows = new Map([
      ['a', { age: '30' }],
      ['b', { age: '' }],
      ['c', { age: '9' }],
      ['d', { age: '30' }],
    ]);
    expect(orderByColumn(['a', 'b', 'c', 'd'], rows, 'age')).toEqual(['c', 'a', 'd', 'b']);
  });
  it('orders by distance with the most typical first and unmeasured subjects last', () => {
    const distance = new Map([
      ['a', { euclidean: 3 }],
      ['c', { euclidean: 1 }],
      ['d', { euclidean: 3 }],
    ]);
    expect(orderByDistance(['a', 'b', 'c', 'd'], distance)).toEqual(['c', 'a', 'd', 'b']);
  });
});

describe('group options', () => {
  it('lists only columns that make groups, names "roles" By map, and keeps the grouping in force', () => {
    const groupable = (column: string) => column !== 'member';
    const labels = (p: PopulationPartition | null) =>
      montageGroupOptions(['member', 'roles'], p, { groupable }).map((o) => o.label);
    expect(labels(null)).toEqual(['None', 'Similarity · correlation', 'Similarity · amplitude', 'By map']);
    // A grouping already made by a hidden column stays listed (the select shows it).
    expect(labels(partition({ column: 'member' }))).toContain('member');
    expect(isGroupableColumn(['a', 'a', 'b'])).toBe(true);
    expect(isGroupableColumn(['a', 'b', 'c', 'd'])).toBe(false); // one per subject
    expect(isGroupableColumn(['a', 'a', 'a'])).toBe(false); // one value
  });
  it('treats "one value per subject" as an ID only with more than three subjects', () => {
    // Two or three subjects with distinct values: a factor (patient / control), not an ID.
    expect(isGroupableColumn(['patient', 'control'])).toBe(true);
    expect(isGroupableColumn(['a', 'b', 'c'])).toBe(true);
    expect(isGroupableColumn(['x'])).toBe(false);
    expect(isGroupableColumn([])).toBe(false);
  });
  it('decides groupable columns over the whole set, not the subjects in view', () => {
    const rows = new Map([
      ['s1', { site: 'A', member: 's1' }],
      ['s2', { site: 'A', member: 's2' }],
      ['s3', { site: 'B', member: 's3' }],
      ['s4', { site: 'B', member: 's4' }],
      ['s5', { site: 'B', member: 's5' }],
    ]);
    const all = ['s1', 's2', 's3', 's4', 's5'];
    expect([...groupableColumnsOf(['site', 'member'], all, rows)]).toEqual(['site']);
    // A filtered view of one site alone would hide "site"; the set decides.
    expect(groupableColumnsOf(['site'], ['s3', 's4', 's5'], rows).has('site')).toBe(false);
  });
  it('offers None, Similarity and the factors, and names the grouping in force', () => {
    expect(montageGroupOptions(['site'], null).map((o) => o.label)).toEqual([
      'None',
      'Similarity · correlation',
      'Similarity · amplitude',
      'site',
    ]);
    // C5: "Restore previous grouping" ends the menu only when there is one to restore.
    expect(montageGroupOptions(['site'], null, { canRestore: true }).at(-1)).toMatchObject({
      label: 'Restore previous grouping',
    });
    expect(montageGroupOptions(['site'], null).some((o) => o.disabled)).toBe(false);
    // The closed select's short form of each measure.
    expect(montageGroupOptions(['site'], null).slice(1, 3).map((o) => o.short)).toEqual(['r', 'RMS']);
    // Each says what it measures and how the groups are formed, in one line.
    // C′: the montage asks for Ward linkage (the backend's grouping fit).
    expect(montageGroupOptions(['site'], null)[1].description).toBe(
      'Subjects whose maps are alike share a group (Ward linkage clustering). Correlation distance of raw values (amplitude ignored), whole volume or mask, unthresholded',
    );
    expect(montageGroupValue(null, ['site'])).toBe('none');
    expect(montageGroupValue(partition(), ['site'])).toBe('factor:site');
    expect(
      montageGroupValue(partition({ origin: 'map-derived', fitId: 'a'.repeat(64) }), ['site']),
    ).toBe('similarity');
    // C′: two crossed factors are a Group choice ("Two factors…").
    const crossed = partition({ column: 'site × sex', factorColumns: ['site', 'sex'] });
    expect(montageGroupValue(crossed, ['site', 'sex'])).toBe('two:["site","sex"]');
    expect(
      montageGroupOptions(['site', 'sex'], crossed).find((o) => o.value === 'two:["site","sex"]'),
    ).toMatchObject({ label: 'site × sex', group: 'Two factors' });
    // A crossed grouping over a column the menu does not list keeps its own entry.
    expect(montageGroupValue(crossed, ['site'])).toBe('other');
    expect(montageGroupOptions(['site'], crossed).find((o) => o.value === 'other')).toEqual({
      value: 'other',
      label: 'site × sex',
    });
  });
});

describe('grouped rows', () => {
  it('orders each group by the montage order and renames similarity groups', () => {
    expect(montageGroups(partition(), ['d', 'c', 'b', 'a'])).toEqual([
      { id: 'factor-0', label: 'site: X', memberIds: ['c', 'a'], unassigned: false },
      { id: 'factor-1', label: 'site: Y', memberIds: ['d', 'b'], unassigned: false },
    ]);
    const similarity = partition({
      origin: 'map-derived',
      fitId: 'a'.repeat(64),
      groups: [
        { id: 'similarity-0', label: 'Similarity group 1', value: '1', memberIds: ['a', 'b', 'c'] },
        {
          id: 'unassigned',
          label: 'Unassigned',
          value: null,
          memberIds: ['d'],
          origin: 'unassigned',
        } as PopulationPartition['groups'][number],
      ],
    });
    expect(montageGroups(similarity, ['a', 'b', 'c', 'd']).map((g) => [g.label, g.unassigned])).toEqual([
      ['Group 1', false],
      ['Not placed', true],
    ]);
  });
  it('shows every member of every group, wrapped: nothing is collapsed behind a "more" cell', () => {
    const groups = [
      { id: 'one', label: 'One', memberIds: ['a', 'b', 'c', 'd'], unassigned: false },
      { id: 'two', label: 'Two', memberIds: ['e', 'f', 'g', 'h'], unassigned: false },
    ];
    const [page] = groupedPages(groups);
    expect(page.map((row) => row.shown)).toEqual([
      ['a', 'b', 'c', 'd'],
      ['e', 'f', 'g', 'h'],
    ]);
    expect(page.every((row) => !('more' in row))).toBe(true);
  });
});

describe('layout', () => {
  it('offers only whole numbers of tiles per row, and the tiles fill the width exactly', () => {
    expect(tilesPerRowRange(726)).toEqual({ min: 2, max: 9 });
    expect(tilesPerRowRange(100)).toEqual({ min: 1, max: 1 });
    expect(tilesPerRowRange(5000)).toEqual({ min: 2, max: 12 });
    expect(clampTilesPerRow(4.4, 726)).toBe(4);
    expect(clampTilesPerRow(40, 726)).toBe(9);
    expect(clampTilesPerRow(0, 726)).toBe(2);
    expect(clampTilesPerRow(Number.NaN, 726)).toBe(2);
    expect(defaultTilesPerRow(726)).toBe(5);
    for (const count of [2, 3, 5, 9]) {
      const tile = tileWidthPx(726, count);
      // count tiles and the 6 px gutters between them are the whole width.
      expect(count * tile + (count - 1) * 6).toBeCloseTo(726, 6);
    }
  });
  it('maps the three sizes onto whole tiles per row for the width', () => {
    expect((['S', 'M', 'L'] as const).map((p) => presetTilesPerRow(p, 726))).toEqual([7, 5, 3]);
    expect(nearestTilePreset(3, 726)).toBe('L');
    expect(nearestTilePreset(5, 726)).toBe('M');
    expect(nearestTilePreset(9, 726)).toBe('S');
  });
  it('gives things up in order as the row narrows, and never the tile-size control', () => {
    const steps = Array.from({ length: MONTAGE_TOOLBAR_MAX_LEVEL + 1 }, (_, level) =>
      montageToolbarLayout(level),
    );
    expect(steps[0]).toEqual({
      sliceLabel: true,
      fieldLabels: true,
      tileControl: 'slider',
      compactSelects: false,
    });
    // The word "Slice" first, then the other words, then S / M / L, then a menu.
    expect(steps[1]).toMatchObject({ sliceLabel: false, fieldLabels: true, tileControl: 'slider' });
    expect(steps[2]).toMatchObject({ fieldLabels: false, tileControl: 'slider' });
    expect(steps[3]).toMatchObject({ tileControl: 'presets', compactSelects: false });
    // The sizes move into a menu: still there, never cut off.
    expect(steps[4]).toMatchObject({ tileControl: 'menu', compactSelects: false });
    // At the narrowest Sort and Group narrow to a fixed width (truncating in
    // their own box); the slice readout is never given up.
    expect(steps[5]).toMatchObject({ tileControl: 'menu', compactSelects: true });
    expect(steps.every((step) => !('sliceReadout' in step))).toBe(true);
  });
  it('pages by the image\'s own resolution alone, within 2^20 values a request', () => {
    const page = (nativeDim: number | null) =>
      montagePageSize({ nativeDim, maxDim: 256, valueBudget: 1 << 20 });
    // Unknown yet, or a 2 mm slice (109 voxels: 80 x 109 x 109 = 950 480 values): 80 a page.
    expect(page(null)).toBe(80);
    expect(page(109)).toBe(80);
    expect(80 * 109 * 109).toBeLessThanOrEqual(1 << 20);
    // A 1 mm slice (218 voxels): 22 a page keep its resolution.
    expect(page(218)).toBe(22);
    expect(22 * 218 * 218).toBeLessThanOrEqual(1 << 20);
    expect(23 * 218 * 218).toBeGreaterThan(1 << 20);
    // Finer than the sampler's edge: 16 a page at 256.
    expect(page(400)).toBe(16);
    expect(16 * 256 * 256).toBe(1 << 20);
  });
  it('draws an enlarged tile pixel for pixel and smooths only a reduced one', () => {
    // 146 px tiles of a 109 px sample: enlarged.
    expect(tileDrawnPixelated(146, 1, 109)).toBe(true);
    // 77 px tiles of a 109 px sample: reduced on a plain screen, enlarged on a 2x one.
    expect(tileDrawnPixelated(77, 1, 109)).toBe(false);
    expect(tileDrawnPixelated(77, 2, 109)).toBe(true);
  });
  it('notes a lowered resolution only when there is one', () => {
    expect(resolutionNote(114, 218)).toBe('tiles at 114 of 218 px');
    expect(resolutionNote(109, 109)).toBeNull();
    expect(resolutionNote(null, 109)).toBeNull();
    expect(resolutionNote(64, null)).toBeNull();
  });
  it('treats a drag rectangle that touches a tile as over it', () => {
    const tile = { left: 10, top: 10, right: 20, bottom: 20 };
    expect(rectsOverlap({ left: 0, top: 0, right: 12, bottom: 12 }, tile)).toBe(true);
    expect(rectsOverlap({ left: 0, top: 0, right: 9, bottom: 30 }, tile)).toBe(false);
  });
});

describe('wording', () => {
  it('reads the slice along the plane axis with a true minus', () => {
    expect(sliceReadout('axial', [1, 2, -8.5])).toBe('z −8.5 mm');
    expect(sliceReadout('coronal', [1, 2, 3])).toBe('y 2.0 mm');
    expect(sliceReadout('sagittal', [-0.04, 2, 3])).toBe('x 0.0 mm');
  });
  it('shows limits at three significant digits without trailing zeros', () => {
    expect(limitText(0.0219876)).toBe('0.022');
    expect(limitText(6)).toBe('6');
    expect(limitText(-1.5)).toBe('-1.5');
  });
  it('describes the grid in plain words and says "subjects"', () => {
    const base = {
      shown: 35,
      total: 35,
      sort: 'similarity' as const,
      reversed: false,
      groups: null,
      previous: false,
      updating: false,
    };
    expect(montageFooterText(base)).toBe('35 of 35 subjects · neighbours are the most alike');
    expect(montageFooterText({ ...base, sort: 'source', shown: 80, total: 120 })).toBe(
      '80 of 120 subjects · source order',
    );
    // Distance is to the mean of every subject, in groups too: the words say so.
    expect(montageFooterText({ ...base, sort: 'distance' })).toBe(
      '35 of 35 subjects · closest to the mean first',
    );
    expect(
      montageFooterText({ ...base, sort: 'distance', groups: 3, reversed: true }),
    ).toBe('3 groups · 35 subjects · closest to the overall mean first, reversed');
    // Collapsed rows or a page leave subjects off screen: the footer counts those on it.
    expect(montageFooterText({ ...base, sort: 'source', groups: 3, shown: 15 })).toBe(
      '3 groups · 15 of 35 subjects · source order',
    );
    expect(
      montageFooterText({
        ...base,
        sort: 'column:age',
        previous: true,
        updating: true,
        computing: 'similarity',
        orderNote: 'from an earlier fit',
      }),
    ).toBe(
      '35 of 35 subjects · ordered by age · from an earlier fit · computing similarity… · previous query · updating',
    );
    expect(montageFooterText({ ...base, shown: 1, total: 1 })).toMatch(/^1 of 1 subject ·/);
  });
  it('names the order in use for a label outside the grid', () => {
    expect(montageOrderLabel('source', false)).toBe('Source order');
    expect(montageOrderLabel('column:age', true)).toBe('Ordered by age, reversed');
    expect(montageOrderLabel('distance', false)).toBe('Distance from the mean, closest first');
    expect(montageOrderLabel('similarity', true)).toBe('Similarity order, reversed');
  });
});

describe('grouped paging', () => {
  const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
  const big = { id: 'big', label: 'Big', memberIds: ids('b', 150), unassigned: false };
  const small = { id: 'small', label: 'Small', memberIds: ids('s', 7), unassigned: false };
  it('never puts more tiles on a page than one request can carry, and loses none', () => {
    const pages = groupedPages([small, big]);
    expect(pages).toHaveLength(2);
    const counts = pages.map((rows) => rows.reduce((n, row) => n + row.shown.length, 0));
    expect(counts).toEqual([80, 77]);
    // Every member is shown; the long group continues on the next page.
    expect(pages[0][0]).toMatchObject({ shown: small.memberIds });
    expect(pages[0][1].group.id).toBe('big');
    expect(pages[1].map((row) => row.group.id)).toEqual(['big']);
    expect(pages.flatMap((rows) => rows.flatMap((row) => row.shown))).toEqual([
      ...small.memberIds,
      ...big.memberIds,
    ]);
  });
  it('pages many groups by the request size alone', () => {
    const many = Array.from({ length: 50 }, (_, g) => ({
      id: `g${g}`,
      label: `G${g}`,
      memberIds: ids(`g${g}-`, 9),
      unassigned: false,
    }));
    const pages = groupedPages(many, 80);
    expect(pages.map((rows) => rows.reduce((n, row) => n + row.shown.length, 0))).toEqual([
      80, 80, 80, 80, 80, 50,
    ]);
  });
});

describe('one shared tile size fitted to the pane', () => {
  const base = { width: 800, height: 800, aspect: 1.2, blocks: [35], headings: false };
  it('chooses the largest tile with which the whole set fits without scrolling', () => {
    const columns = fitTilesPerRow(base)!;
    expect(montageLayoutHeight(base, columns)).toBeLessThanOrEqual(800);
    // One tile larger (one fewer per row) would not fit.
    expect(montageLayoutHeight(base, columns - 1)).toBeGreaterThan(800);
  });
  it('counts group headings and the gaps between groups', () => {
    const grouped = { ...base, height: 1000, blocks: [29, 6], headings: true };
    const columns = fitTilesPerRow(grouped)!;
    expect(montageLayoutHeight(grouped, columns)).toBeLessThanOrEqual(1000);
    expect(montageLayoutHeight(grouped, columns)).toBeGreaterThan(montageLayoutHeight(base, columns));
    expect(columns).toBeGreaterThanOrEqual(fitTilesPerRow({ ...base, height: 1000 })!);
  });
  it('never shrinks tiles below the readable minimum: a set too big to fit scrolls', () => {
    const columns = fitTilesPerRow({ ...base, height: 200, blocks: [200] })!;
    expect(tileWidthPx(800, columns)).toBeGreaterThanOrEqual(MONTAGE_FIT_MIN_PX);
    expect(tileWidthPx(800, columns + 1)).toBeLessThan(MONTAGE_FIT_MIN_PX);
  });
  it('never blows a few subjects up past the largest size', () => {
    const columns = fitTilesPerRow({ ...base, blocks: [2] })!;
    expect(tileWidthPx(800, columns)).toBeLessThanOrEqual(MONTAGE_FIT_MAX_PX);
  });
  it('waits for the pane to be measured', () => {
    expect(fitTilesPerRow({ ...base, height: 0 })).toBeNull();
    expect(fitTilesPerRow({ ...base, width: 0 })).toBeNull();
  });
});

describe('moving between rows of different lengths', () => {
  const cell = (left: number, top: number) => ({ left, right: left + 100, top, bottom: top + 100 });
  // Row 1: three cells; row 2: one cell; row 3: two cells.
  const rects = [cell(0, 0), cell(110, 0), cell(220, 0), cell(0, 150), cell(0, 300), cell(110, 300)];
  it('goes to the cell nearest above or below, in the next row only', () => {
    expect(verticalNeighbour(rects, 2, 1)).toBe(3);
    expect(verticalNeighbour(rects, 3, 1)).toBe(4);
    expect(verticalNeighbour(rects, 5, -1)).toBe(3);
    expect(verticalNeighbour(rects, 3, -1)).toBe(0);
    expect(verticalNeighbour(rects, 1, -1)).toBeNull();
    expect(verticalNeighbour(rects, 4, 1)).toBeNull();
  });
});

describe('similarity wording', () => {
  it('defaults to correlation and reads the measure from a Sort or Group value', () => {
    expect(DEFAULT_SIMILARITY_MEASURE).toBe('pattern-shape');
    expect(similarityMeasureOf('similarity:pattern-shape')).toBe('pattern-shape');
    expect(similarityMeasureOf('similarity:effect')).toBe('effect');
    expect(similarityMeasureOf('similarity')).toBeNull();
    expect(similarityMeasureOf('factor:site')).toBeNull();
  });
  it('names the measure, where it was computed and the shared voxels', () => {
    expect(
      similarityDescription({ measure: 'pattern-shape', maskName: null, region: false, sharedVoxels: null }),
    ).toBe('correlation distance · whole volume, unthresholded');
    expect(
      similarityDescription({
        measure: 'effect',
        maskName: 'gm_mask.nii.gz',
        region: false,
        sharedVoxels: 9919,
      }),
    ).toBe('RMS difference · within mask gm_mask.nii.gz, unthresholded · 9,919 shared voxels');
    expect(
      similarityDescription({ measure: 'pattern-shape', maskName: 'gm', region: true, sharedVoxels: 12 }),
    ).toBe('correlation distance · within the pinned region, unthresholded · 12 shared voxels');
  });
  it('puts what made the groups beside them in the footer', () => {
    const groupSimilarity = similarityDescription({
      measure: 'pattern-shape',
      maskName: null,
      region: false,
      sharedVoxels: null,
    });
    expect(
      montageFooterText({
        shown: 35,
        total: 35,
        sort: 'source',
        reversed: false,
        groups: 3,
        previous: false,
        updating: false,
        groupSimilarity,
      }),
    ).toBe('3 groups · correlation distance · whole volume, unthresholded · 35 subjects · source order');
  });
  it('recognises the backend refusal of correlation and nothing else', () => {
    expect(
      correlationRefusal(
        'sub003 is constant on common support; pattern shape is undefined. Use effect distance or change context/support.',
      ),
    ).toMatch(/^Correlation cannot be computed: at least one map is constant/);
    expect(correlationRefusal('Pattern shape is undefined for a constant map.')).not.toBeNull();
    expect(correlationRefusal('Too few shared voxels.')).toBeNull();
    expect(correlationRefusal(null)).toBeNull();
  });
});

describe('a page ordered by the values at the pointer (B3)', () => {
  const values = new Map<string, number | null>([
    ['a', 3],
    ['b', null],
    ['c', 1],
    ['d', 3],
    ['e', Number.NaN],
  ]);
  it('puts the lowest first, the unavailable last, ties and unavailable in their given order', () => {
    expect(orderByValueWithin(['a', 'b', 'c', 'd', 'e'], values)).toEqual(['c', 'a', 'd', 'b', 'e']);
    // Reversed reverses the whole, as a reversed order does.
    expect(orderByValueWithin(['a', 'b', 'c', 'd', 'e'], values, true)).toEqual([
      'e',
      'b',
      'd',
      'a',
      'c',
    ]);
    // Nothing moves: the same array, so nothing re-renders or glides.
    const ordered = ['c', 'a', 'd'];
    expect(orderByValueWithin(ordered, values)).toBe(ordered);
  });
  it('gives the page its places in the whole sequence and moves no one else', () => {
    const order = ['p', 'a', 'q', 'b', 'c', 'r'];
    expect(withinPlaces(order, ['c', 'b', 'a'])).toEqual(['p', 'c', 'q', 'b', 'a', 'r']);
    expect(withinPlaces(order, ['a', 'b', 'c'])).toBe(order);
    // An ID the sequence does not hold is ignored.
    expect(withinPlaces(order, ['x', 'c', 'a'])).toEqual(['p', 'c', 'q', 'b', 'a', 'r']);
  });
});
