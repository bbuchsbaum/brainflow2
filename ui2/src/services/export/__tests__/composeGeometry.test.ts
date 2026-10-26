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
    drawImage: () => {},
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
});
