import { beforeEach, describe, expect, it, vi } from 'vitest';

const composeMock = vi.hoisted(() => vi.fn());
vi.mock('../compositeExport', async (importActual) => {
  const actual = await importActual<typeof import('../compositeExport')>();
  return {
    ...actual,
    compose: composeMock,
    encodeComposition: vi.fn(async () => new Uint8Array([9])),
  };
});
const exporterState = vi.hoisted(() => ({ exporter: null as unknown }));
vi.mock('../surfaceExporter', () => ({
  activeSurfaceFigureExporter: () =>
    exporterState.exporter ? { exporter: exporterState.exporter, surfaceHandle: 'lh' } : null,
}));

import { captureSurfaceComposite, surfacePaneSize, surfacePosePlan } from '../surfaceCapture';
import { ExportTooLargeError } from '../compositeCapture';
import { EXPORT_PRESETS, type ExportPane } from '../compositeExport';
import { useSurfaceStore } from '@/stores/surfaceStore';

const BASIS = { right: [0, -1, 0], up: [0, 0, 1], forward: [1, 0, 0] } as const;

function fakeExporter(hemispheres: Array<'left' | 'right'>, maxSide = 8192) {
  const capturePose = vi.fn(async () => ({ bytes: new Uint8Array([1]), basis: BASIS, hemispheres }));
  return Object.assign(vi.fn(), {
    capturePose,
    figureInfo: () => ({ hemispheres, viewport: { width: 800, height: 500 }, maxSide }),
  });
}

describe('surface figure poses (D3/D4)', () => {
  it('lateral + medial: one row per hemisphere view, left on the left', () => {
    expect(surfacePosePlan('surface-lat-med', ['left']).map((r) => r.map((p) => p.title))).toEqual([
      ['Left lateral', 'Left medial'],
    ]);
    const both = surfacePosePlan('surface-lat-med', ['left', 'right']);
    expect(both.map((r) => r.map((p) => p.title))).toEqual([
      ['Left lateral', 'Right lateral'],
      ['Left medial', 'Right medial'],
    ]);
    expect(both[1][1].pose).toEqual({ view: 'medial', hemisphere: 'right' });
  });

  it('"Surface" keeps the user\'s camera', () => {
    expect(surfacePosePlan('surface', ['right'])).toEqual([
      [{ pose: { view: 'current' }, title: 'Right hemisphere' }],
    ]);
  });

  it('print panes split the column width; the current view keeps the viewport aspect', () => {
    const size = { kind: 'print' as const, widthMm: 183, dpi: 300 };
    const unit = 300 / 96;
    const chrome = { unit, paneGap: 6, sideW: 0 };
    const two = surfacePaneSize(surfacePosePlan('surface-lat-med', ['left']), size, { viewport: { width: 800, height: 500 } }, chrome);
    expect(two.width).toBe(Math.floor((2161 - 6 * unit) / 2));
    expect(two.height).toBe(Math.round(two.width / 1.5));
    const one = surfacePaneSize(surfacePosePlan('surface', ['left']), size, { viewport: { width: 800, height: 500 } }, chrome);
    expect(one.width).toBe(2161);
    expect(one.height).toBe(Math.round(2161 / 1.6));
  });
});

describe('captureSurfaceComposite (D4)', () => {
  beforeEach(() => {
    composeMock.mockReset();
    composeMock.mockImplementation((rows: ExportPane[][]) => ({
      canvas: {},
      width: rows[0].reduce((w, p) => w + p.width, 0),
      height: rows.reduce((h, r) => h + r[0].height, 0),
    }));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })));
    useSurfaceStore.setState({ surfaces: new Map() });
  });

  it('captures each pose at pane size on the page colour and frames it as a surface pane', async () => {
    const exporter = fakeExporter(['left', 'right']);
    exporterState.exporter = exporter;
    const capture = await captureSurfaceComposite('surface-lat-med', 'png', {
      frame: { ...EXPORT_PRESETS.figure, crosshair: true },
      size: { kind: 'screen', scale: 2 },
    });
    const poses = exporter.capturePose.mock.calls.map((c) => (c as unknown as [{ pose: unknown; width: number; background?: string }])[0]);
    expect(poses.map((p) => p.pose)).toEqual([
      { view: 'lateral', hemisphere: 'left' },
      { view: 'lateral', hemisphere: 'right' },
      { view: 'medial', hemisphere: 'left' },
      { view: 'medial', hemisphere: 'right' },
    ]);
    expect(poses[0].width).toBe(800); // half the viewport, times 2
    expect(poses[0].background).toBe('#ffffff');
    const [rows, , options] = composeMock.mock.calls[0] as [ExportPane[][], unknown, { crosshair: boolean; scaleBar: boolean }];
    expect(options.crosshair).toBe(false);
    expect(options.scaleBar).toBe(false);
    expect(rows[1][0].surface?.header[0][0].text).toBe('Left medial');
    expect(rows[1][0].surface?.basis).toEqual(BASIS);
    expect(rows[0][0].plane).toBeNull();
    expect(capture.suggestedName).toBe('surface_lat_med_lh_rh.png');
    expect(capture.target.viewType).toBeNull();
  });

  it('a pose that fails mid-row closes every bitmap already made, that row included (review m10)', async () => {
    const closes: ReturnType<typeof vi.fn>[] = [];
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        const close = vi.fn();
        closes.push(close);
        return { close };
      }),
    );
    const exporter = fakeExporter(['left', 'right']);
    // Row 1 (lateral lh, rh) succeeds; row 2 fails on its second pose.
    let n = 0;
    exporter.capturePose.mockImplementation(async () => {
      n += 1;
      if (n === 4) throw new Error('GPU lost');
      return { bytes: new Uint8Array([1]), basis: BASIS, hemispheres: ['left', 'right'] as Array<'left' | 'right'> };
    });
    exporterState.exporter = exporter;
    await expect(
      captureSurfaceComposite('surface-lat-med', 'png', { frame: EXPORT_PRESETS.figure, size: { kind: 'screen', scale: 1 } }),
    ).rejects.toThrow('GPU lost');
    expect(closes).toHaveLength(3);
    for (const close of closes) expect(close).toHaveBeenCalledTimes(1);
  });

  it('refuses a pane past the GPU limit or a composition past the canvas limit, before rendering', async () => {
    const small = fakeExporter(['left'], 1000);
    exporterState.exporter = small;
    await expect(
      captureSurfaceComposite('surface', 'png', { frame: EXPORT_PRESETS.figure, size: { kind: 'print', widthMm: 183, dpi: 600 } }),
    ).rejects.toThrow(/over this GPU's 1000 px limit/);
    expect(small.capturePose).not.toHaveBeenCalled();

    const big = fakeExporter(['left']);
    exporterState.exporter = big;
    await expect(
      captureSurfaceComposite('surface', 'png', { frame: EXPORT_PRESETS.figure, size: { kind: 'screen', scale: 40 } }),
    ).rejects.toBeInstanceOf(ExportTooLargeError);
    expect(big.capturePose).not.toHaveBeenCalled();
  });
});

describe('one colorbar for both hemispheres (v1 F1)', () => {
  const overlay = (id: string, name: string, range: [number, number]) => ({
    id,
    name,
    visible: true,
    values: new Float32Array([0, 1]),
    colormap: 'viridis',
    range,
    dataRange: range,
    threshold: [0, 30000] as [number, number],
    opacity: 1,
  });
  const surf = (handle: string, hemi: string, layer: ReturnType<typeof overlay>) => ({
    handle,
    name: `${hemi}.inflated.gii`,
    visible: true,
    geometry: { vertices: new Float32Array(9), faces: new Uint32Array(3), hemisphere: hemi === 'lh' ? 'left' : 'right' },
    layers: new Map([[layer.id, layer]]),
    metadata: { vertexCount: 3, faceCount: 1, path: `/fig/${hemi}.inflated.gii` },
  });

  beforeEach(() => {
    composeMock.mockReset();
    composeMock.mockImplementation((rows: ExportPane[][]) => ({ canvas: {}, width: rows[0].reduce((w, p) => w + p.width, 0), height: 100 }));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })));
  });

  it('titles the shared bar with the map, without a hemisphere', async () => {
    useSurfaceStore.setState({
      surfaces: new Map([
        ['lh', surf('lh', 'lh', overlay('a', 'lh.sensorimotor.func.gii', [0, 59412]))],
        ['rh', surf('rh', 'rh', overlay('b', 'rh.sensorimotor.func.gii', [0, 59412]))],
      ]) as never,
    });
    exporterState.exporter = fakeExporter(['left', 'right']);
    await captureSurfaceComposite('surface-lat-med', 'png', { frame: EXPORT_PRESETS.figure, size: { kind: 'screen', scale: 1 } });
    const side = composeMock.mock.calls[0][1] as { colorbar: { name: string } };
    expect(side.colorbar.name).toBe('sensorimotor.func (lh, rh)');
  });

  it('refuses one bar over hemispheres drawn on different ranges', async () => {
    useSurfaceStore.setState({
      surfaces: new Map([
        ['lh', surf('lh', 'lh', overlay('a', 'lh.sensorimotor.func.gii', [0, 59412]))],
        ['rh', surf('rh', 'rh', overlay('b', 'rh.sensorimotor.func.gii', [0, 41588]))],
      ]) as never,
    });
    exporterState.exporter = fakeExporter(['left', 'right']);
    await expect(
      captureSurfaceComposite('surface-lat-med', 'png', { frame: EXPORT_PRESETS.figure, size: { kind: 'screen', scale: 1 } }),
    ).rejects.toThrow(/different colour ranges/);
  });
});
