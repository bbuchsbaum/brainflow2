/**
 * Figure finish, in output pixels (v4 visual critic): tick labels clear of
 * their marks (a 2 px gap made "3.1" read "-3.1"), the header inset from
 * the pane edge, the scale bar's "10 mm" inside the pane, and the top tick
 * label clear of the colorbar caption. Drawn through compose() with a
 * recording 2D context.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compose,
  compositionLayout,
  headerCandidates,
  sideGapPx,
  SIDEBAR_W as SIDE,
  EDGE_INSET,
  ptToPx,
  TEXT_PT,
  TICK_LABEL_GAP,
  TICK_LEN,
  type CompositeOptions,
  type ExportPane,
} from '../compositeExport';

interface TextCall {
  text: string;
  x: number;
  y: number;
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
  px: number;
  left: number;
  right: number;
}
interface RectCall {
  x: number;
  y: number;
  w: number;
  h: number;
}

let texts: TextCall[] = [];
let rects: RectCall[] = [];
let images: RectCall[] = [];

function recorder(): CanvasRenderingContext2D {
  const state = {
    font: '10px sans',
    textAlign: 'start' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
  };
  const stack: Array<typeof state> = [];
  let tx = 0;
  const px = () => Number(/(\d+(?:\.\d+)?)px/.exec(state.font)?.[1] ?? 10);
  // Monospace-ish metrics: 0.6 em per character.
  const width = (t: string) => t.length * px() * 0.6;
  const ctx = {
    get font() {
      return state.font;
    },
    set font(v: string) {
      state.font = v;
    },
    get textAlign() {
      return state.textAlign;
    },
    set textAlign(v: CanvasTextAlign) {
      state.textAlign = v;
    },
    get textBaseline() {
      return state.textBaseline;
    },
    set textBaseline(v: CanvasTextBaseline) {
      state.textBaseline = v;
    },
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    shadowColor: '',
    shadowBlur: 0,
    save: () => stack.push({ ...state }),
    restore: () => Object.assign(state, stack.pop() ?? state),
    measureText: (t: string) => ({
      width: width(t),
      actualBoundingBoxAscent: px() * 0.7,
      actualBoundingBoxDescent: px() * 0.2,
    }),
    fillText: (text: string, x: number, y: number) => {
      const w = width(text);
      const left =
        state.textAlign === 'center'
          ? x - w / 2
          : state.textAlign === 'right' || state.textAlign === 'end'
            ? x - w
            : x;
      texts.push({
        text,
        x: x + tx,
        y,
        align: state.textAlign,
        baseline: state.textBaseline,
        px: px(),
        left: left + tx,
        right: left + tx + w,
      });
    },
    fillRect: (x: number, y: number, w: number, h: number) => rects.push({ x: x + tx, y, w, h }),
    translate: (dx: number) => {
      tx += dx;
    },
    strokeRect: () => {},
    drawImage: (_img: unknown, x: number, y: number, w: number, h: number) => images.push({ x: x + tx, y, w, h }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
    rect: () => {},
    clip: () => {},
    setLineDash: () => {},
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

const U = 300 / 96; // 300 dpi print
const plane = {
  origin_mm: [-90, 90, 50.5],
  u_mm: [0.2, 0, 0],
  v_mm: [0, -0.2, 0],
  dim_px: [900, 1000],
} as never;

function pane(over: Partial<ExportPane> = {}): ExportPane {
  return {
    image: {} as CanvasImageSource,
    width: 900,
    height: 1000,
    plane,
    framePlane: 'axial',
    positionMm: 50.5,
    layerName: 'zmap_synthetic.nii.gz',
    crosshairWorld: null,
    ...over,
  } as ExportPane;
}

const options: CompositeOptions = {
  header: true,
  orientation: true,
  colorbar: true,
  crosshair: false,
  sliceLabel: true,
  scaleBar: true,
  background: 'white',
  unit: U,
} as unknown as CompositeOptions;

const zLayer = {
  layerId: 'z',
  name: 'zmap_synthetic',
  colormap: 'fmri_redblue',
  intensity: [-6, 6] as const,
  threshold: [-3.1, 3.1] as const,
  units: 'z',
  nameLabel: 'zmap_synthetic',
};

describe('composer figure finish (output px)', () => {
  beforeEach(() => {
    texts = [];
    rects = [];
    images = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => recorder() as never,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps tick labels clear of their marks and the top label clear of the caption', () => {
    compose([[pane()]], { colorbar: zLayer as never }, options, {
      activeColor: '#0f0',
      activeThickness: 1,
      activeStyle: 'solid',
    });
    const ticks = texts.filter((t) =>
      ['6', '3.1', '0', '−3.1', '-3.1', '−6', '-6'].includes(t.text),
    );
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    const tickPx = ptToPx(TEXT_PT.tick, U);
    for (const t of ticks) {
      // The mark for this label: a TICK_LEN-unit rect centred on its y.
      const mark = rects.find(
        (r) => Math.abs(r.y + r.h / 2 - t.y) < 0.01 && Math.abs(r.w - TICK_LEN * U) < 0.01,
      );
      expect(mark, `mark for ${t.text}`).toBeTruthy();
      const gap = t.left - (mark!.x + mark!.w);
      expect(gap).toBeGreaterThanOrEqual(TICK_LABEL_GAP * U - 0.01);
      expect(gap).toBeGreaterThanOrEqual(15); // ≥ 15 output px at 300 dpi
    }
    // Caption baseline above the top tick label's top edge, with room.
    const top = ticks.reduce((a, b) => (a.y < b.y ? a : b));
    const caption = texts.find((t) => t.baseline === 'alphabetic' && t.y < top.y)!;
    expect(caption).toBeTruthy();
    const descent = caption.px * 0.25;
    expect(top.y - tickPx / 2 - (caption.y + descent)).toBeGreaterThanOrEqual(2 * U);
  });

  it('insets the header from the pane edge and keeps "10 mm" inside the pane', () => {
    // A narrow tile-like pane: the 10 mm bar is short, its label wider.
    const p = pane({
      width: 400,
      height: 420,
      plane: { ...(plane as object), u_mm: [0.5, 0, 0], v_mm: [0, -0.5, 0] } as never,
    });
    compose([[p]], { colorbar: null }, options, {
      activeColor: '#0f0',
      activeThickness: 1,
      activeStyle: 'solid',
    });
    const header = texts.find((t) => t.text === 'Axial')!;
    expect(header.left).toBeGreaterThanOrEqual(EDGE_INSET * U - 0.01);
    const label = texts.find((t) => t.text === '10 mm')!;
    expect(label.right).toBeLessThanOrEqual(p.width - EDGE_INSET * U + 0.01);
    expect(label.left).toBeGreaterThanOrEqual(0);
  });

  // v4 fidelity: "10 mm" (≈87 px at 300 dpi) centred on an 18-41 px bar
  // ran past the pane. Its box stays inside at every print size, on a
  // single pane and on the last mosaic tile.
  it.each([
    ['89 mm, 300 dpi, single pane', 89, 300, 1],
    ['183 mm, 300 dpi, single pane', 183, 300, 1],
    ['89 mm, 600 dpi, single pane', 89, 600, 1],
    ['183 mm, 600 dpi, single pane', 183, 600, 1],
    ['183 mm, 300 dpi, mosaic tile (6 columns)', 183, 300, 6],
    ['89 mm, 600 dpi, mosaic tile (4 columns)', 89, 600, 4],
  ])('scale-bar label inside the pane: %s', (_name, widthMm, dpi, columns) => {
    const unit = dpi / 96;
    const total = Math.round((widthMm / 25.4) * dpi);
    const paneW = Math.floor((total - SIDE * unit) / columns);
    // A brain about 150 mm across fills the pane: mm per px from that.
    const mmPerPx = 150 / paneW;
    const p = pane({
      width: paneW,
      height: Math.round(paneW * 1.15),
      plane: { ...(plane as object), u_mm: [mmPerPx, 0, 0], v_mm: [0, -mmPerPx, 0] } as never,
      ...(columns > 1 ? { tileLabel: { text: 'z 78.5', emphasis: false } } : {}),
    });
    compose([[p]], { colorbar: null }, { ...options, unit }, { activeColor: '#0f0', activeThickness: 1, activeStyle: 'solid' });
    const label = texts.find((t) => t.text === '10 mm')!;
    expect(label).toBeTruthy();
    expect(label.left).toBeGreaterThanOrEqual(0);
    expect(label.right).toBeLessThanOrEqual(p.width - EDGE_INSET * unit + 0.01);
    // The bar is drawn and inside the pane too.
    const bar = rects.find((r) => Math.abs(r.h - 2 * unit) < 0.01 && r.w > 4);
    expect(bar).toBeTruthy();
    expect(bar!.x).toBeGreaterThanOrEqual(0);
    expect(bar!.x + bar!.w).toBeLessThanOrEqual(p.width);
  });

  it('explains a statistic guessed from the file name on the figure ("z* inferred from file name")', () => {
    compose([[pane()]], { colorbar: { ...zLayer, units: 'z*', unitsFromName: true } as never }, options, {
      activeColor: '#0f0',
      activeThickness: 1,
      activeStyle: 'solid',
    });
    const note = texts.filter((t) => /inferred|file name|z\*/.test(t.text)).map((t) => t.text).join(' ');
    expect(note).toContain('z* inferred');
    expect(note).toContain('file name');
  });

  it('writes exactly the print width (89 mm at 300 dpi is 1051 px), centring the content', () => {
    // Two panes whose integer widths sum one pixel over the target.
    const a = pane({ width: 466, height: 500 });
    const b = pane({ width: 466, height: 500 });
    const natural = compose([[a, b]], { colorbar: null }, options, { activeColor: '#0f0', activeThickness: 1, activeStyle: 'solid' });
    const exact = compose([[a, b]], { colorbar: null }, { ...options, targetWidth: 1051 }, { activeColor: '#0f0', activeThickness: 1, activeStyle: 'solid' });
    expect(natural.width).not.toBe(1051);
    expect(exact.width).toBe(1051);
  });

  it('never prints an ellipsized name: a figure row, a long layer name, a narrow pane (v5 critics)', () => {
    const long = 'sub-01_task-motor_space-MNI152NLin2009cAsym_desc-zstat1.nii.gz';
    const row = [
      pane({ width: 640, height: 700, layerName: long }),
      pane({ width: 600, height: 560, framePlane: 'coronal', layerName: null }),
      pane({ width: 560, height: 560, framePlane: 'sagittal', layerName: null }),
    ];
    compose([row], { colorbar: { ...zLayer, name: long, nameLabel: long.replace('.nii.gz', '') } as never }, options, {
      activeColor: '#0f0',
      activeThickness: 1,
      activeStyle: 'solid',
    });
    expect(texts.length).toBeGreaterThan(5);
    for (const t of texts) expect(t.text).not.toContain('…');
    // The colorbar caption names the layer whole (wrapped at its own
    // boundaries) or not at all: never a fragment.
    const caption = texts.filter((t) => /sub-01|motor|zstat1/.test(t.text)).map((t) => t.text).join('');
    expect(caption === '' || caption === long.replace('.nii.gz', '')).toBe(true);
  });

  // v5 fidelity: the footnote fell below the canvas in short layouts. Every
  // drawn text box lies inside the canvas, for every target, both widths,
  // both resolutions, declared and guessed statistics.
  const box = (t: TextCall) => {
    const top =
      t.baseline === 'top'
        ? t.y
        : t.baseline === 'middle'
          ? t.y - t.px / 2
          : t.baseline === 'bottom'
            ? t.y - t.px
            : t.y - t.px * 0.8;
    return { left: t.left, right: t.right, top, bottom: top + t.px };
  };
  const shapes: Record<string, (avail: number, unit: number) => ExportPane[][]> = {
    axial: (w) => [[pane({ width: w, height: Math.round(w * 1.2) })]],
    sagittal: (w) => [[pane({ width: w, height: Math.round(w * 0.78), framePlane: 'sagittal' })]],
    'figure row': (w, unit) => {
      const each = Math.floor((w - 2 * 4 * unit) / 3);
      return [[
        pane({ width: each, height: Math.round(each * 1.2) }),
        pane({ width: each, height: Math.round(each * 0.95), framePlane: 'coronal', layerName: null }),
        pane({ width: each, height: Math.round(each * 0.78), framePlane: 'sagittal', layerName: null }),
      ]];
    },
    orthogonal: (w, unit) => {
      const half = Math.floor((w - 4 * unit) / 2);
      return [
        [pane({ width: half, height: Math.round(half * 1.2) })],
        [
          pane({ width: half, height: Math.round(half * 0.78), framePlane: 'sagittal', layerName: null }),
          pane({ width: half, height: Math.round(half * 0.95), framePlane: 'coronal', layerName: null }),
        ],
      ];
    },
    mosaic: (w, unit) => {
      const cols = w > 3000 ? 6 : 4;
      const tile = Math.floor((w - (cols - 1) * 6 * unit) / cols);
      return Array.from({ length: 2 }, (_, r) =>
        Array.from({ length: cols }, (_, c) =>
          pane({ width: tile, height: Math.round(tile * 1.2), layerName: null, tileLabel: { text: `z ${r * cols + c}`, emphasis: false } }),
        ),
      );
    },
  };
  const cases: Array<[string, number, number, boolean]> = [];
  for (const target of Object.keys(shapes))
    for (const mm of [89, 183])
      for (const dpi of [300, 600])
        for (const guessed of [false, true]) cases.push([target, mm, dpi, guessed]);
  it.each(cases)('all text inside the canvas: %s, %i mm, %i dpi, guessed statistic %s', (target, mm, dpi, guessed) => {
    const unit = dpi / 96;
    const total = Math.round((mm / 25.4) * dpi);
    const gap = target === 'mosaic' ? 6 : 4;
    // The capture solves panes to the target minus the side column and its
    // gutter (sideGapPx: the colorbar's own column, native check).
    const avail = total - SIDE * unit - sideGapPx(unit, gap);
    const layer = guessed ? { ...zLayer, units: 'z*', unitsFromName: true } : zLayer;
    const comp = compose(
      shapes[target](avail, unit),
      { colorbar: layer as never, value: 5.97 },
      { ...options, unit, targetWidth: total, paneGap: gap },
      { activeColor: '#0f0', activeThickness: 1, activeStyle: 'solid' },
    );
    expect(comp.width).toBe(total);
    if (guessed) expect(texts.some((t) => t.text.includes('inferred'))).toBe(true);
    for (const t of texts) {
      const b = box(t);
      expect(b.left, `${t.text} left`).toBeGreaterThanOrEqual(-0.5);
      expect(b.right, `${t.text} right`).toBeLessThanOrEqual(comp.width + 0.5);
      expect(b.top, `${t.text} top`).toBeGreaterThanOrEqual(-0.5);
      expect(b.bottom, `${t.text} bottom`).toBeLessThanOrEqual(comp.height + 0.5);
    }
  });

  // ── native check (P3 export defects) ──────────────────────────────────────

  const crosshair = { activeColor: '#0f0', activeThickness: 1, activeStyle: 'solid' } as never;
  const overlaps = (a: { left: number; right: number; top: number; bottom: number }, b: typeof a) =>
    a.left < b.right - 0.01 && b.left < a.right - 0.01 && a.top < b.bottom - 0.01 && b.top < a.bottom - 0.01;
  // Realistic figure shapes: a montage letters its first tile and puts the
  // scale bar on its last, as the capture does.
  const figureShapes: Record<string, (avail: number, unit: number) => ExportPane[][]> = {
    axial: shapes.axial,
    sagittal: shapes.sagittal,
    coronal: (w) => [[pane({ width: w, height: Math.round(w * 0.95), framePlane: 'coronal' })]],
    'figure row': (w, unit) => {
      const each = Math.floor((w - 2 * 4 * unit) / 3);
      return [[
        pane({ width: each, height: Math.round(each * 1.2), positionMm: -10, layerName: null }),
        pane({ width: each, height: Math.round(each * 0.95), framePlane: 'coronal', positionMm: -60, layerName: null }),
        pane({ width: each, height: Math.round(each * 0.78), framePlane: 'sagittal', positionMm: 42, layerName: null }),
      ]];
    },
    orthogonal: shapes.orthogonal,
    mosaic: (w, unit) => {
      const cols = w > 3000 ? 6 : 4;
      const tile = Math.floor((w - (cols - 1) * 6 * unit) / cols);
      const n = 2 * cols;
      return Array.from({ length: 2 }, (_, r) =>
        Array.from({ length: cols }, (_, c) => {
          const i = r * cols + c;
          return pane({
            width: tile,
            height: Math.round(tile * 1.2),
            layerName: null,
            tileLabel: { text: `z ${i}`, emphasis: false },
            orientation: i === 0,
            scaleBar: i === n - 1,
          });
        }),
      );
    },
  };
  const solveCase = (target: string, mm: number, dpi: number) => {
    const unit = dpi / 96;
    const total = Math.round((mm / 25.4) * dpi);
    const gap = target === 'mosaic' ? 6 : 4;
    const avail = total - SIDE * unit - sideGapPx(unit, gap);
    return { unit, total, gap, rows: figureShapes[target](avail, unit) };
  };
  const sizes: Array<[number, number]> = [
    [89, 300],
    [89, 600],
    [183, 300],
    [183, 600],
  ];

  // (c) The colorbar always has its own column: its box misses every pane
  // image, and everything the colorbar draws (caption, bar, ticks, the
  // crosshair value beside its caret) stays inside that column.
  const colorbarCases: Array<[string, number, number]> = [];
  for (const target of Object.keys(figureShapes)) for (const [mm, dpi] of sizes) colorbarCases.push([target, mm, dpi]);
  it.each(colorbarCases)('colorbar column clear of every image: %s, %i mm, %i dpi', (target, mm, dpi) => {
    const { unit, total, gap, rows } = solveCase(target, mm, dpi);
    const opts = { ...options, unit, targetWidth: total, paneGap: gap, crosshair: true };
    // A long crosshair value: its text sits left of the bar.
    compose(rows, { colorbar: zLayer as never, value: -12345.67 }, opts, crosshair);
    const layout = compositionLayout(
      rows.map((r) => r.map((p) => ({ width: p.width, height: p.height, tile: !!p.tileLabel }))),
      opts,
      true,
    );
    const side = layout.side!;
    expect(side).toBeTruthy();
    const sideBox = { left: side.x, right: side.x + side.width, top: side.y, bottom: side.y + side.height };
    // The drawn pane images are exactly the layout's image boxes.
    const imageBoxes = images.map((i) => ({ left: i.x, right: i.x + i.w, top: i.y, bottom: i.y + i.h }));
    expect(imageBoxes.length).toBe(rows.flat().length);
    for (const img of imageBoxes) {
      expect(overlaps(img, sideBox), 'colorbar column ∩ pane image').toBe(false);
      // A visible gutter, not a hairline.
      expect(sideBox.left - img.right).toBeGreaterThanOrEqual(10 * unit - 0.01);
    }
    // Everything drawn right of the grid belongs to the column and lies in it.
    const gridRight = Math.max(...imageBoxes.map((b) => b.right));
    const sideTexts = texts.filter((t) => t.right > gridRight + 0.5);
    expect(sideTexts.length).toBeGreaterThan(2);
    for (const t of texts) {
      const b = box(t);
      const inSide = overlaps(b, sideBox);
      if (!inSide) continue;
      expect(b.left, `${t.text} left of the column`).toBeGreaterThanOrEqual(side.x - 0.5);
      for (const img of imageBoxes) expect(overlaps(b, img), `${t.text} on an image`).toBe(false);
    }
    // The value is drawn, and inside the column.
    const value = texts.find((t) => /12,346/.test(t.text));
    expect(value, 'crosshair value').toBeTruthy();
    expect(value!.left).toBeGreaterThanOrEqual(side.x - 0.5);
  });

  // (e) Headers never run together or past their pane; no two text boxes
  // intersect anywhere on the figure.
  const textCases: Array<[string, number, number]> = [];
  for (const target of ['figure row', 'orthogonal', 'mosaic']) for (const [mm, dpi] of sizes) textCases.push([target, mm, dpi]);
  it.each(textCases)('no two text boxes intersect: %s, %i mm, %i dpi', (target, mm, dpi) => {
    const { unit, total, gap, rows } = solveCase(target, mm, dpi);
    compose(rows, { colorbar: zLayer as never }, { ...options, unit, targetWidth: total, paneGap: gap }, crosshair);
    const boxes = texts.map((t) => ({ t, b: box(t) }));
    expect(boxes.length).toBeGreaterThan(5);
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        expect(
          overlaps(boxes[i].b, boxes[j].b),
          `"${boxes[i].t.text}" overlaps "${boxes[j].t.text}"`,
        ).toBe(false);
      }
    }
    // Every header run stays inside its own pane's width.
    if (target !== 'mosaic') {
      const layout = compositionLayout(
        rows.map((r) => r.map((p) => ({ width: p.width, height: p.height }))),
        { ...options, unit, targetWidth: total, paneGap: gap },
        true,
      );
      const panes = layout.panes.flat();
      const inBand = (t: TextCall) =>
        panes.find((q) => t.y > q.y && t.y < q.y + q.band && t.left >= q.x - 0.5 && t.left < q.image.x + q.image.width);
      const headerTexts = texts.filter((t) => inBand(t));
      // Every pane has a header (at least the position).
      expect(new Set(headerTexts.map((t) => inBand(t))).size).toBe(panes.length);
      for (const t of headerTexts) {
        const p = inBand(t)!;
        expect(t.right, `${t.text} past its pane`).toBeLessThanOrEqual(p.image.x + p.image.width - EDGE_INSET * unit + 0.01);
      }
    }
  });

  it('shortens a header that does not fit: plane word first, then the "=" and the unit', () => {
    const variants = headerCandidates('axial', -10, 'zmap_synthetic.nii.gz').map((runs) =>
      runs.map((r) => r.text).join(' '),
    );
    expect(variants).toEqual([
      'Axial z = −10.0 mm zmap_synthetic',
      'Axial z = −10.0 mm',
      'z = −10.0 mm',
      'z −10.0 mm',
      'z −10.0',
      '',
    ]);
    // A figure row at 89 mm, 300 dpi: each pane shows "z = −10.0 mm" or a
    // shorter form, never three headers run together.
    const { unit, total, gap, rows } = solveCase('figure row', 89, 300);
    compose(rows, { colorbar: zLayer as never }, { ...options, unit, targetWidth: total, paneGap: gap }, crosshair);
    const joined = texts.map((t) => t.text).join('|');
    expect(joined).not.toMatch(/mmy|mmx/);
    for (const axis of ['z', 'y', 'x']) expect(texts.some((t) => t.text === axis)).toBe(true);
  });

  it('a figure row has one header baseline, however tall each image (native v6 recheck)', () => {
    const unit = 300 / 96;
    const row = [
      pane({ width: 640, height: 760, layerName: null }),
      pane({ width: 640, height: 600, framePlane: 'coronal', layerName: null }),
      pane({ width: 640, height: 500, framePlane: 'sagittal', layerName: null }),
    ];
    compose([row], { colorbar: null }, { ...options, unit }, { activeColor: '#0f0', activeThickness: 1, activeStyle: 'solid' });
    const headerYs = texts.filter((t) => /^= /.test(t.text)).map((t) => t.y);
    expect(headerYs).toHaveLength(3);
    for (const y of headerYs) expect(y).toBeCloseTo(headerYs[0], 6);
  });
});
