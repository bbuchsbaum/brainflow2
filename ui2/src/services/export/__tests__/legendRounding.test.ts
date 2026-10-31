/**
 * QA N15: a single atlas (ASEG, 10 regions at z = 2) under a colorbar read
 * "8 regions ... +2 more": the colorbar/legend split was rounded up and the
 * legend lost a third of a pixel, so its 10-row column held 9. Every size
 * and chrome unit must list all 10.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/services/ViewExportService', () => ({ getViewExportService: () => ({}) }));
vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));
import { compose, type CompositeOptions, type ExportPane } from '../compositeExport';
let texts: string[] = [];
function rec(): CanvasRenderingContext2D {
  const st = { font: '10px sans' };
  const px = () => Number(/(\d+(?:\.\d+)?)px/.exec(st.font)?.[1] ?? 10);
  const n = () => {};
  return new Proxy({}, { get: (_t, k) => {
    if (k === 'font') return st.font;
    if (k === 'measureText') return (t: string) => ({ width: t.length * px() * 0.6, actualBoundingBoxAscent: px() * 0.7, actualBoundingBoxDescent: px() * 0.2 });
    if (k === 'fillText') return (t: string) => void texts.push(t);
    if (k === 'createLinearGradient') return () => ({ addColorStop: n });
    if (k === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)) });
    return n;
  }, set: (_t, k, v) => { if (k === 'font') st.font = v; return true; } }) as never;
}
const plane = { origin_mm: [-90, 90, 2], u_mm: [1, 0, 0], v_mm: [0, -1, 0], dim_px: [180, 216] } as never;
const z = { layerId: 'z', name: 'zmap', colormap: 'fmri_redblue', intensity: [-6, 6], threshold: [-3.1, 3.1], units: 'z', nameLabel: 'zmap' };
describe('legend rows under a colorbar (QA N15)', () => {
  beforeEach(() => { texts = []; vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => rec()); });
  afterEach(() => vi.restoreAllMocks());
  it('lists every region at every pane height and unit, with or without a colorbar', () => {
    const bad: string[] = [];
    for (const unit of [1, 2, 300 / 96, 600 / 96]) for (const h of [100, 150, 200, 216, 300, 400, 517, 640]) for (const cb of [false, true]) {
      texts = [];
      const p = { image: {}, width: Math.round(h * 0.83), height: h, plane, framePlane: 'axial', positionMm: 2, layerName: 'T1', crosshairWorld: null } as unknown as ExportPane;
      const legend = Array.from({ length: 10 }, (_, i) => ({ label_id: i + 1, roi: `Region ${i + 1}`, color: [i, 0, 0] as [number, number, number] }));
      compose([[p]], { colorbar: cb ? (z as never) : null, legend }, { header: true, orientation: true, colorbar: true, scaleBar: true, crosshair: false, background: 'white', unit } as unknown as CompositeOptions, { activeColor: '#0f0', activeThickness: 1, activeStyle: 'solid' } as never);
      const more = texts.find((t) => /more$/.test(t));
      if (more) bad.push(`u=${unit.toFixed(2)} h=${h} cb=${cb}: ${more}`);
    }
    expect(bad).toEqual([]);
  });
});
