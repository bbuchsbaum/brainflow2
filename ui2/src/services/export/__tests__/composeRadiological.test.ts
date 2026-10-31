/**
 * Export under the radiological convention (QA features 2026-10-31 §2): an
 * axial / coronal pane is drawn mirrored as on screen, its left and right
 * letters swap and an "R | L" marker says so; off, nothing changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/ViewExportService', () => ({ getViewExportService: () => ({}) }));
vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));

import { compose, RADIOLOGICAL_MARKER, type CompositeOptions, type ExportPane } from '../compositeExport';

let calls: string[] = [];
let texts: Array<{ text: string; x: number }> = [];

function recorder(): CanvasRenderingContext2D {
  const state = { font: '10px sans', textAlign: 'start' as CanvasTextAlign, textBaseline: 'alphabetic' as CanvasTextBaseline };
  const stack: Array<typeof state> = [];
  const px = () => Number(/(\d+(?:\.\d+)?)px/.exec(state.font)?.[1] ?? 10);
  const noop = () => {};
  return {
    get font() { return state.font; },
    set font(v: string) { state.font = v; },
    get textAlign() { return state.textAlign; },
    set textAlign(v: CanvasTextAlign) { state.textAlign = v; },
    get textBaseline() { return state.textBaseline; },
    set textBaseline(v: CanvasTextBaseline) { state.textBaseline = v; },
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, shadowColor: '', shadowBlur: 0,
    save: () => { stack.push({ ...state }); calls.push('save'); },
    restore: () => { Object.assign(state, stack.pop() ?? state); calls.push('restore'); },
    measureText: (t: string) => ({ width: t.length * px() * 0.6, actualBoundingBoxAscent: px() * 0.7, actualBoundingBoxDescent: px() * 0.2 }),
    fillText: (text: string, x: number) => void texts.push({ text, x }),
    translate: (x: number, y: number) => void calls.push(`translate ${x} ${y}`),
    scale: (x: number, y: number) => void calls.push(`scale ${x} ${y}`),
    drawImage: (img: unknown, x: number, y: number) => {
      if (img === IMAGE) calls.push(`draw ${x} ${y}`);
    },
    fillRect: noop, strokeRect: noop, beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop,
    fill: noop, stroke: noop, rect: noop, clip: noop, setLineDash: noop, arc: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
  } as unknown as CanvasRenderingContext2D;
}

const IMAGE = {} as CanvasImageSource;
// An axial plane: +x (Right) along the image's u axis, as the backend renders it.
const plane = { origin_mm: [-90, 90, 10], u_mm: [1, 0, 0], v_mm: [0, -1, 0], dim_px: [180, 180] } as never;
const pane = (mirrored: boolean): ExportPane => ({
  image: IMAGE, width: 180, height: 180, plane, framePlane: 'axial', positionMm: 10,
  layerName: null, crosshairWorld: null, mirrored,
});
const options: CompositeOptions = {
  header: false, orientation: true, colorbar: false, scaleBar: false, crosshair: false,
  background: 'black', unit: 1,
} as CompositeOptions;
const settings = { activeColor: '#0f0', activeThickness: 1, activeStyle: 'solid' } as never;
const letterAt = (side: 'left' | 'right') => {
  const lr = texts.filter((t) => t.text === 'L' || t.text === 'R').sort((a, b) => a.x - b.x);
  return side === 'left' ? lr[0]?.text : lr[lr.length - 1]?.text;
};

describe('compose under the radiological convention', () => {
  beforeEach(() => {
    calls = [];
    texts = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => recorder() as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it('off: the pane is drawn as rendered, L on the left, no marker', () => {
    compose([[pane(false)]], { colorbar: null }, options, settings);
    expect(calls).toContain('draw 0 0');
    expect(calls.some((c) => c.startsWith('scale'))).toBe(false);
    expect([letterAt('left'), letterAt('right')]).toEqual(['L', 'R']);
    expect(texts.some((t) => t.text === RADIOLOGICAL_MARKER)).toBe(false);
  });

  it('on: mirrored image (translate · scale −1 · draw), letters swapped, "R | L" marker', () => {
    compose([[pane(true)]], { colorbar: null }, options, settings);
    const i = calls.indexOf('scale -1 1');
    expect(i).toBeGreaterThan(0);
    expect(calls[i - 1]).toMatch(/^translate 180 /);
    expect(calls[i + 1]).toBe('draw 0 0');
    expect([letterAt('left'), letterAt('right')]).toEqual(['R', 'L']);
    expect(texts.filter((t) => t.text === RADIOLOGICAL_MARKER)).toHaveLength(1);
  });
});
