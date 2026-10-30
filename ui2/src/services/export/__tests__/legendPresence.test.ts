import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/ViewExportService', () => ({ getViewExportService: () => ({}) }));

import {
  labelProbeViewState,
  legendInPanes,
  presentLegendEntries,
  probePlane,
  rawFramePixels,
  type ProbeRender,
} from '../legendPresence';
import type { AtlasPaletteLegendEntry } from '@/types/atlasPalette';
import type { ViewPlane } from '@/types/coordinates';
import type { ViewState } from '@/types/viewState';

const entry = (
  label_id: number,
  roi: string,
  color: [number, number, number],
): AtlasPaletteLegendEntry => ({
  label_id,
  roi,
  color,
});
const thalamus = entry(10, 'LH Thalamus', [0, 118, 14]);
const putamen = entry(12, 'LH Putamen', [236, 13, 176]);
const caudate = entry(11, 'LH Caudate', [122, 186, 220]);
const legend = [thalamus, caudate, putamen];

/** A raw render_view frame (8-byte header) filled with `pixels` RGBA tuples. */
function rawFrame(
  width: number,
  height: number,
  pixels: Array<[number, number, number, number]>,
): Uint8Array {
  const bytes = new Uint8Array(8 + width * height * 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, width, true);
  view.setUint32(4, height, true);
  pixels.forEach((px, i) => bytes.set(px, 8 + i * 4));
  return bytes;
}

const plane = (z: number, dim: [number, number] = [4, 4]): ViewPlane => ({
  origin_mm: [-100, 100, z],
  u_mm: [1, 0, 0],
  v_mm: [0, -1, 0],
  dim_px: dim,
});

describe('presentLegendEntries', () => {
  it('keeps the entries whose colour is drawn opaque', () => {
    const pixels = new Uint8Array([0, 118, 14, 255, 0, 0, 0, 0, 236, 13, 176, 255]);
    expect(presentLegendEntries(legend, [pixels])).toEqual([thalamus, putamen]);
  });

  it('ignores partly transparent pixels (edges, halos) and the background', () => {
    const pixels = new Uint8Array([122, 186, 220, 128, 0, 0, 0, 0]);
    expect(presentLegendEntries(legend, [pixels])).toEqual([]);
  });

  it('collects over every pane and keeps regions that share a colour together', () => {
    const twin = entry(50, 'RH Caudate', [122, 186, 220]);
    const a = new Uint8Array([0, 118, 14, 255]);
    const b = new Uint8Array([122, 186, 220, 255]);
    expect(presentLegendEntries([...legend, twin], [a, b])).toEqual([thalamus, caudate, twin]);
  });
});

describe('presentLegendEntries: tolerance and unreadable colours (review minor 1)', () => {
  it('matches a colour within ±1 per channel', () => {
    expect(presentLegendEntries(legend, [new Uint8Array([1, 117, 15, 255])])).toEqual([thalamus]);
    expect(presentLegendEntries(legend, [new Uint8Array([255, 12, 177, 255, 0, 118, 14, 255])])).toEqual([thalamus]);
  });

  it('returns null when regions were drawn but no colour matches the legend', () => {
    expect(presentLegendEntries(legend, [new Uint8Array([2, 120, 14, 255])])).toBeNull();
    expect(presentLegendEntries(legend, [new Uint8Array([200, 200, 200, 255])])).toBeNull();
  });
});

describe('rawFramePixels', () => {
  it('strips the size header and rejects a frame of the wrong length', () => {
    const frame = rawFrame(2, 1, [
      [1, 2, 3, 255],
      [4, 5, 6, 255],
    ]);
    expect(Array.from(rawFramePixels(frame)!)).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
    expect(rawFramePixels(frame.subarray(0, 12))).toBeNull();
    expect(rawFramePixels(new Uint8Array(4))).toBeNull();
    // A PNG (the encoded format) is not a raw frame.
    expect(
      rawFramePixels(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])),
    ).toBeNull();
  });
});

describe('probePlane', () => {
  it('keeps the field of view at a capped resolution', () => {
    const big = {
      ...plane(0),
      u_mm: [0.25, 0, 0],
      v_mm: [0, -0.25, 0],
      dim_px: [1024, 512],
    } as ViewPlane;
    const small = probePlane(big, 512);
    expect(small.dim_px).toEqual([512, 256]);
    expect(small.u_mm[0] * small.dim_px[0]).toBeCloseTo(big.u_mm[0] * big.dim_px[0]);
    expect(small.v_mm[1] * small.dim_px[1]).toBeCloseTo(big.v_mm[1] * big.dim_px[1]);
    expect(small.origin_mm).toEqual(big.origin_mm);
    expect(probePlane(plane(0), 512)).toEqual(plane(0));
  });
});

describe('labelProbeViewState', () => {
  it('draws only the label layer, filled, opaque, without outline or crosshair', () => {
    const state = {
      crosshair: { world_mm: [0, 0, 0], visible: true },
      views: {},
      layers: [
        { id: 't1', visible: true, opacity: 1 },
        {
          id: 'aseg',
          visible: true,
          opacity: 0.6,
          layerMode: 'label',
          labelDisplay: 'outline',
          outline: { enabled: true, selectedLabelId: 0, color: [1, 1, 1, 1], thicknessPx: 2 },
        },
        { id: 'z', visible: true, opacity: 1 },
      ],
    } as unknown as ViewState;
    const probe = labelProbeViewState(state, 'aseg');
    expect(probe.crosshair.visible).toBe(false);
    expect(probe.layers.filter((l) => l.visible).map((l) => l.id)).toEqual(['aseg']);
    const aseg = probe.layers.find((l) => l.id === 'aseg')!;
    expect(aseg).toMatchObject({ opacity: 1, labelDisplay: 'fill', outline: { enabled: false } });
    // The live state is untouched.
    expect(state.layers[1].opacity).toBe(0.6);
  });
});

describe('legendInPanes (QA 2026-10-29 §13)', () => {
  const state = {
    crosshair: { world_mm: [0, 0, 48], visible: true },
    views: { axial: plane(48), coronal: plane(0), sagittal: plane(0) },
    layers: [{ id: 'aseg', visible: true, opacity: 1, layerMode: 'label' }],
  } as unknown as ViewState;

  /** Subcortical labels only below z = 30: the axial slice at z = 48 has none. */
  const render: ProbeRender = vi.fn(async (probe: ViewState, viewType, width, height) => {
    const z = probe.views[viewType].origin_mm[2];
    const fill: [number, number, number, number] = z < 30 ? [0, 118, 14, 255] : [0, 0, 0, 0];
    return rawFrame(
      width,
      height,
      Array.from({ length: width * height }, () => fill),
    );
  });

  it('drops every region when no label is in the exported slice', async () => {
    const result = await legendInPanes(
      state,
      'aseg',
      legend,
      [{ viewType: 'axial', plane: plane(48) }],
      { render },
    );
    expect(result).toEqual([]);
  });

  it('keeps the regions drawn in any exported pane', async () => {
    const result = await legendInPanes(
      state,
      'aseg',
      legend,
      [
        { viewType: 'axial', plane: plane(48) },
        { viewType: 'coronal', plane: plane(10) },
      ],
      { render },
    );
    expect(result).toEqual([thalamus]);
  });

  it('renders the probe as the label layer alone', async () => {
    const spy = vi.fn<ProbeRender>(async (_s, _v, w, h) => rawFrame(w, h, []));
    await legendInPanes(state, 'aseg', legend, [{ viewType: 'axial', plane: plane(48, [8, 6]) }], {
      render: spy,
    });
    const [probe, viewType, width, height] = spy.mock.calls[0];
    expect([viewType, width, height]).toEqual(['axial', 8, 6]);
    expect(probe.views.axial.dim_px).toEqual([8, 6]);
    expect(probe.crosshair.visible).toBe(false);
  });

  it('returns null (keep the full legend) when a probe fails or is not a raw frame', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing: ProbeRender = async () => {
      throw new Error('render_view failed');
    };
    expect(
      await legendInPanes(state, 'aseg', legend, [{ viewType: 'axial', plane: plane(48) }], {
        render: failing,
      }),
    ).toBeNull();
    const png: ProbeRender = async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(
      await legendInPanes(state, 'aseg', legend, [{ viewType: 'axial', plane: plane(48) }], {
        render: png,
      }),
    ).toBeNull();
    warn.mockRestore();
  });

  it('keeps the full legend (null) when the drawn colours are not the legend\'s', async () => {
    const grey: ProbeRender = async (_s, _v, w, h) =>
      rawFrame(w, h, Array.from({ length: w * h }, () => [90, 90, 90, 255] as [number, number, number, number]));
    expect(await legendInPanes(state, 'aseg', legend, [{ viewType: 'axial', plane: plane(48) }], { render: grey })).toBeNull();
  });

  it('stops when the capture is superseded', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      legendInPanes(state, 'aseg', legend, [{ viewType: 'axial', plane: plane(48) }], {
        render,
        signal: controller.signal,
      }),
    ).rejects.toThrow('superseded');
  });
});
