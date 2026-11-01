import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LabelTableService, READ_TEXT_FILE_COMMAND } from '../LabelTableService';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { BackendTransport } from '../transport';

vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));

const TSV = 'index\tname\tcolor\n1\tL_sensorimotor\t#4682b4\n2\tR_occipitotemporal\t#dcb43c\n';
const IMAGE = '/study/stats/atlas-synth3_dseg.nii.gz';

function transportWith(files: Record<string, string>, colormapId: number | Error = 70) {
  const invoke = vi.fn(async (cmd: string, args?: unknown) => {
    if (cmd === READ_TEXT_FILE_COMMAND) {
      const path = (args as { path: string }).path;
      if (!(path in files)) throw new Error(`failed to open file at path: ${path} with error: No such file or directory (os error 2)`);
      return new TextEncoder().encode(files[path]).buffer;
    }
    if (cmd === 'register_categorical_colormap') {
      if (colormapId instanceof Error) throw colormapId;
      return colormapId;
    }
    throw new Error(`unexpected ${cmd}`);
  });
  return { invoke } as unknown as BackendTransport & { invoke: typeof invoke };
}

function seedLayer() {
  useLayerStore.setState({
    layers: [{ id: 'atlas', name: 'atlas', volumeId: 'atlas', type: 'volume', visible: true, order: 0 } as never],
  });
  useViewStateStore.getState().setViewState((state) => {
    state.layers = [
      {
        id: 'atlas',
        name: 'atlas',
        volumeId: 'atlas',
        visible: true,
        opacity: 1,
        colormap: 'gray',
        intensity: [1, 3],
        threshold: [0, 0],
        blendMode: 'alpha',
        interpolation: 'linear',
        layerMode: 'scalar',
      },
    ];
  });
}

describe('LabelTableService.applySidecar', () => {
  beforeEach(() => {
    useViewStateStore.getState().resetToDefaults();
    seedLayer();
  });

  it('registers the table colours and turns the layer into a categorical label layer', async () => {
    const transport = transportWith({ '/study/stats/atlas-synth3_dseg.tsv': TSV });
    const result = await new LabelTableService(transport).applySidecar('atlas', IMAGE);

    expect(result).toEqual({ path: '/study/stats/atlas-synth3_dseg.tsv', regions: 2, colormapId: 70 });
    expect(transport.invoke).toHaveBeenCalledWith('register_categorical_colormap', {
      key: 'label_table|/study/stats/atlas-synth3_dseg.tsv',
      maxLabel: 2,
      lutRgb: [0, 0, 0, 0x46, 0x82, 0xb4, 0xdc, 0xb4, 0x3c],
    });
    const view = useViewStateStore.getState().viewState.layers[0];
    expect(view).toMatchObject({
      colormapId: 70,
      layerMode: 'label',
      interpolation: 'nearest',
      intensity: [-0.5, 2.5],
      threshold: [0, 0],
    });
    const layer = useLayerStore.getState().layers[0];
    expect(layer.type).toBe('label');
    expect(layer.atlasPaletteLegend?.find((e) => e.label_id === 2)?.displayName).toBe('R_occipitotemporal');
  });

  it('tries the next candidate when the TSV is missing (FreeSurfer .lut)', async () => {
    const transport = transportWith({
      '/study/stats/atlas-synth3_dseg.lut': '0 Unknown 0 0 0 0\n17 Left-Hippocampus 220 216 20 0\n',
    });
    const result = await new LabelTableService(transport).applySidecar('atlas', IMAGE);
    expect(result?.regions).toBe(1);
  });

  it('does nothing without a usable sidecar', async () => {
    const transport = transportWith({ '/study/stats/atlas-synth3_dseg.txt': 'notes about the scan' });
    expect(await new LabelTableService(transport).applySidecar('atlas', IMAGE)).toBeNull();
    expect(useLayerStore.getState().layers[0].atlasPaletteLegend).toBeUndefined();
    expect(useViewStateStore.getState().viewState.layers[0].layerMode).toBe('scalar');
  });

  it('keeps region names when the colormap cannot be registered', async () => {
    const transport = transportWith({ '/study/stats/atlas-synth3_dseg.tsv': TSV }, new Error('GPU down'));
    const result = await new LabelTableService(transport).applySidecar('atlas', IMAGE);
    expect(result?.colormapId).toBeNull();
    expect(useLayerStore.getState().layers[0].atlasPaletteLegend).toHaveLength(2);
    expect(useViewStateStore.getState().viewState.layers[0].colormapId).toBeUndefined();
  });

  it('drops the result when the layer was removed while the table was read', async () => {
    const transport = transportWith({ '/study/stats/atlas-synth3_dseg.tsv': TSV });
    transport.invoke.mockImplementationOnce(async () => {
      useLayerStore.setState({ layers: [] });
      throw new Error('missing');
    });
    expect(await new LabelTableService(transport).applySidecar('atlas', IMAGE)).toBeNull();
  });

  it('colours a declared label map without a table by id', async () => {
    const transport = transportWith({});
    const result = await new LabelTableService(transport).applyGeneratedPalette('atlas', 3);
    expect(result).toEqual({ path: null, regions: 3, colormapId: 70 });
    const layer = useLayerStore.getState().layers[0];
    expect(layer.isLabelMap).toBe(true);
    expect(layer.atlasPaletteLegend?.map((e) => e.displayName)).toEqual(['Label 1', 'Label 2', 'Label 3']);
    expect(useViewStateStore.getState().viewState.layers[0].layerMode).toBe('label');
  });

  it('warns when a sidecar exists but cannot be read, and stays silent when it is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const transport = transportWith({});
    transport.invoke.mockImplementationOnce(async () => {
      throw new Error('forbidden path: /Volumes/data/atlas-synth3_dseg.tsv');
    });
    await new LabelTableService(transport).readSidecar('/Volumes/data/atlas-synth3_dseg.nii.gz');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('atlas-synth3_dseg.tsv');
    warn.mockRestore();
  });
});


describe('applyLabelDisplayDefault', () => {
  it('outlines a label map loaded above a statistic map, and leaves it filled otherwise', async () => {
    const { applyLabelDisplayDefault } = await import('../LabelTableService');
    useViewStateStore.getState().resetToDefaults();
    const view = (id: string, extra: Record<string, unknown> = {}) => ({
      id, name: id, volumeId: id, visible: true, opacity: 1, colormap: 'gray', intensity: [0, 1], threshold: [0, 0], ...extra,
    });
    useLayerStore.setState({
      layers: [
        { id: 't', name: 't', volumeId: 't', type: 'volume', visible: true, order: 0,
          statistic: { kind: 't', intentCode: 3, intentParams: [24, 0, 0], intentName: '', dof: [24], label: 't(24)', fromDescription: false, positiveDataLabel: null } },
        { id: 'atlas', name: 'atlas', volumeId: 'atlas', type: 'label', visible: true, order: 1 },
        { id: 'plain', name: 'plain', volumeId: 'plain', type: 'label', visible: true, order: 2 },
      ] as never,
    });
    useViewStateStore.getState().setViewState((state) => {
      state.layers = [view('t'), view('atlas', { layerMode: 'label' })] as never;
    });
    applyLabelDisplayDefault('atlas');
    expect(useViewStateStore.getState().viewState.layers[1]).toMatchObject({
      labelDisplay: 'outline',
      outline: { enabled: true, selectedLabelId: 0 },
    });
    useViewStateStore.getState().setViewState((state) => {
      state.layers = [view('plain', { layerMode: 'label' })] as never;
    });
    applyLabelDisplayDefault('plain');
    expect(useViewStateStore.getState().viewState.layers[0].labelDisplay).toBeUndefined();
  });
});

describe('applyLabelDisplayDefault outline style', () => {
  const view = (id: string, extra: Record<string, unknown> = {}) => ({
    id, name: id, volumeId: id, visible: true, opacity: 1, colormap: 'gray', intensity: [0, 1], threshold: [0, 0],
    layerMode: 'label', ...extra,
  });
  const legend = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: i + 1, displayName: `R${i + 1}`, color: [1, 1, 1] }));
  const seed = (regions: number, extra: Record<string, unknown> = {}) => {
    useViewStateStore.getState().resetToDefaults();
    useLayerStore.setState({
      layers: [
        { id: 'atlas', name: 'atlas', volumeId: 'atlas', type: 'label', visible: true, order: 0, atlasPaletteLegend: legend(regions) },
      ] as never,
    });
    useViewStateStore.getState().setViewState((state) => {
      state.layers = [view('atlas', extra)] as never;
    });
  };

  it('gives a dense atlas a neutral 1 px outline and a small one region colours', async () => {
    const { applyLabelDisplayDefault } = await import('../LabelTableService');
    seed(360);
    applyLabelDisplayDefault('atlas');
    expect(useViewStateStore.getState().viewState.layers[0].outline).toMatchObject({
      enabled: false, colorMode: 'uniform', thicknessPx: 1, haloPx: 0,
    });
    // Seeding the style leaves the display (fill) alone.
    expect(useViewStateStore.getState().viewState.layers[0].labelDisplay).toBeUndefined();

    seed(40);
    applyLabelDisplayDefault('atlas');
    expect(useViewStateStore.getState().viewState.layers[0].outline).toMatchObject({
      enabled: false, colorMode: 'lut', thicknessPx: 2, haloPx: 1,
    });
  });

  it("never replaces the user's outline settings", async () => {
    const { applyLabelDisplayDefault } = await import('../LabelTableService');
    const mine = { enabled: true, selectedLabelId: 7, color: [1, 0, 0, 1], thicknessPx: 3, colorMode: 'lut', haloPx: 2 };
    seed(360, { outline: mine, labelDisplay: 'both' });
    applyLabelDisplayDefault('atlas');
    expect(useViewStateStore.getState().viewState.layers[0].outline).toEqual(mine);
    expect(useViewStateStore.getState().viewState.layers[0].labelDisplay).toBe('both');
  });
});

describe('LabelColormapPool (review D2: slots are reused and released)', () => {
  it('shares a key between layers of the same table and recycles it after the last one goes', async () => {
    const { LabelColormapPool } = await import('../LabelTableService');
    const pool = new LabelColormapPool();
    expect(pool.acquire('a', 'label_ids|5')).toBe('label_ids|5');
    expect(pool.acquire('b', 'label_ids|5')).toBe('label_ids|5');
    pool.release('a');
    // Still held by b: a new table takes a new slot.
    expect(pool.acquire('c', 'label_table|/x.tsv')).toBe('label_table|/x.tsv');
    pool.release('b');
    // label_ids|5 is free now: the next new table reuses that slot.
    expect(pool.acquire('d', 'label_table|/y.tsv')).toBe('label_ids|5');
    expect(pool.slotsTaken).toBe(2);
  });

  it('a long session of load / unload never takes more slots than are live at once', async () => {
    const { LabelColormapPool } = await import('../LabelTableService');
    const pool = new LabelColormapPool();
    for (let i = 0; i < 500; i += 1) {
      pool.acquire(`layer-${i}`, `label_table|/study/atlas-${i}.tsv`);
      pool.release(`layer-${i}`);
    }
    expect(pool.slotsTaken).toBe(1);
  });

  it('generated palettes are keyed by the label range only (shared across layers)', async () => {
    const transport = transportWith({});
    const service = new LabelTableService(transport);
    useLayerStore.setState({
      layers: [
        { id: 'l1', name: 'l1', volumeId: 'l1', type: 'volume', visible: true, order: 0 },
        { id: 'l2', name: 'l2', volumeId: 'l2', type: 'volume', visible: true, order: 1 },
      ] as never,
    });
    await service.applyGeneratedPalette('l1', 7);
    await service.applyGeneratedPalette('l2', 7);
    const keys = transport.invoke.mock.calls
      .filter(([cmd]) => cmd === 'register_categorical_colormap')
      .map(([, args]) => (args as { key: string }).key);
    expect(keys).toEqual(['label_ids|7', 'label_ids|7']);
  });
});
