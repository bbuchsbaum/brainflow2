/**
 * The member layer the Studio shows (the Deck, Compare pane A) is drawn by
 * the Studio's map rule, the one the computed panes follow: a default, never
 * written over what the user set, and never on a layer the user opened.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioDisplayService } from '../StudioDisplayService';
import { studioMapDisplay } from '../studioMapDisplay';

const TEMPLATE = 'template:MNI152NLin2009cAsym_T1w_1mm';
const M1 = '/set/sub-1001_rsa_coef.nii.gz';
const M2 = '/set/sub-1002_rsa_coef.nii.gz';
const M3 = '/set/sub-1003_rsa_coef.nii.gz';
const SET = [M1, M2, M3];

type Range = { min: number; max: number };
type MockLayer = { id: string; sourcePath?: string | null; visible: boolean; name?: string; type?: string; source?: string };
type MockMetadata = { sourcePath?: string; dataRange?: Range; renderProps?: { opacity: number } };
type MockViewLayer = {
  id: string;
  opacity: number;
  intensity: [number, number];
  threshold: [number, number];
  colormap: string;
};

const h = vi.hoisted(() => ({
  loadFile: vi.fn(),
  loadTemplateBySourcePath: vi.fn(),
  toggleVisibility: vi.fn(),
  removeLayer: vi.fn(),
  selectLayer: vi.fn(),
  fetchLimit: vi.fn(),
}));

const layerState = {
  layers: [] as MockLayer[],
  layerMetadata: new Map<string, MockMetadata>(),
  selectedLayerId: null as string | null,
  selectLayer: h.selectLayer,
  setLayerMetadata(id: string, metadata: MockMetadata) {
    this.layerMetadata.set(id, metadata);
  },
  getLayer(id: string) {
    return this.layers.find((layer) => layer.id === id);
  },
};
const viewState = { layers: [] as MockViewLayer[] };

vi.mock('@/services/FileLoadingService', () => ({
  getFileLoadingService: () => ({ loadFile: h.loadFile }),
}));
vi.mock('@/services/TemplateService', () => ({
  getTemplateService: () => ({ loadTemplateBySourcePath: h.loadTemplateBySourcePath }),
}));
vi.mock('@/services/LayerService', () => ({
  getLayerService: () => ({ toggleVisibility: h.toggleVisibility, removeLayer: h.removeLayer }),
}));
vi.mock('@/stores/layerStore', () => ({ useLayerStore: { getState: () => layerState } }));
vi.mock('@/stores/viewStateStore', () => ({
  useViewStateStore: {
    getState: () => ({
      activeWorkspaceKey: 'studio',
      viewState,
      workspaceViewStates: new Map([['studio', viewState]]),
      setViewState: (updater: (draft: typeof viewState) => void) => updater(viewState),
    }),
  },
}));
vi.mock('@/stores/workspaceStore', () => ({ useWorkspaceStore: { getState: () => ({}) } }));
vi.mock('@/stores/comparisonStore', () => ({ useComparisonStore: { getState: () => ({}) } }));
vi.mock('../studioMapLimit', () => ({ fetchStudioRobustLimit: h.fetchLimit }));

/** What each file holds, and the robust window end its histogram gives. */
const RANGES: Record<string, Range> = {
  [M1]: { min: -0.018, max: 0.021 },
  [M2]: { min: -0.02, max: 0.0034 },
  [M3]: { min: 0.0001, max: 0.03 },
};
const LIMITS: Record<string, number | null> = { [M1]: 0.012, [M2]: 0.0145, [M3]: 0.011 };

/** The loader's own display of a file: grey over the data range, nothing hidden. */
function addLayer(id: string, sourcePath: string, range = RANGES[sourcePath], opacity = 1) {
  layerState.layers.push({ id, sourcePath, visible: true, name: sourcePath.split('/').pop(), type: 'anatomical' });
  layerState.layerMetadata.set(id, { sourcePath, ...(range ? { dataRange: range } : {}) });
  viewState.layers.push({
    id,
    opacity,
    intensity: range ? [range.min, range.max] : [0, 1],
    threshold: [0, 0],
    colormap: 'gray',
  });
}
const idFor = (sourcePath: string) => `layer:${sourcePath}`;
const view = (id: string) => viewState.layers.find((layer) => layer.id === id)!;
const shown = (id: string) => {
  const { colormap, intensity, threshold } = view(id);
  return { colormap, intensity, threshold };
};
const rule = (...args: Parameters<typeof studioMapDisplay>) => {
  const { colormap, intensity, threshold } = studioMapDisplay(...args);
  return { colormap, intensity, threshold };
};
/** The user changes the member's display in the Inspector. */
function edit(id: string, display: Partial<Pick<MockViewLayer, 'colormap' | 'intensity' | 'threshold'>>) {
  Object.assign(view(id), display);
}

beforeEach(() => {
  vi.clearAllMocks();
  layerState.layers = [];
  layerState.layerMetadata = new Map();
  layerState.selectedLayerId = null;
  viewState.layers = [];
  h.loadFile.mockImplementation(async (path: string) => addLayer(idFor(path), path));
  h.loadTemplateBySourcePath.mockImplementation(async (path: string) =>
    addLayer(idFor(path), path, { min: 0, max: 900 }, 0.5),
  );
  h.toggleVisibility.mockImplementation((id: string, visible: boolean) => {
    const layer = layerState.layers.find((candidate) => candidate.id === id);
    if (layer) layer.visible = visible;
  });
  h.removeLayer.mockImplementation(async (id: string) => {
    layerState.layers = layerState.layers.filter((layer) => layer.id !== id);
    layerState.layerMetadata.delete(id);
    viewState.layers = viewState.layers.filter((layer) => layer.id !== id);
  });
  h.fetchLimit.mockImplementation(async (layerId: string) => {
    const path = layerState.layerMetadata.get(layerId)?.sourcePath ?? '';
    return LIMITS[path] ?? null;
  });
});

describe('the member layer follows the Studio map rule by default', () => {
  it('a signed member is drawn diverging, symmetric at its robust limit, the band at zero hidden (first show)', async () => {
    const service = new StudioDisplayService();
    // The member that drew grey: −0.02 … 0.0034.
    await service.ensureSourcePathDisplayed(M2, SET);
    expect(shown(idFor(M2))).toEqual(rule(RANGES[M2], { limit: 0.0145 }));
    expect(shown(idFor(M2))).toMatchObject({ colormap: 'fmri', intensity: [-0.0145, 0.0145] });
    expect(view(idFor(M2)).threshold[1]).toBeCloseTo(0.00145, 12);
    // One histogram, asked for with the kind the rule gives the data.
    expect(h.fetchLimit).toHaveBeenCalledTimes(1);
    expect(h.fetchLimit).toHaveBeenCalledWith(idFor(M2), 'diverging');
  });

  it('an all-positive member is drawn sequential; without a histogram, over its own range', async () => {
    h.fetchLimit.mockResolvedValue(null);
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(M3, [M3]);
    expect(shown(idFor(M3))).toEqual(rule(RANGES[M3]));
    expect(view(idFor(M3)).colormap).toBe('hot');
  });

  it('an anatomy-like member keeps the grey its load gave it', async () => {
    const T1 = '/anat/sub-01_T1w.nii.gz';
    h.loadFile.mockImplementationOnce(async (path: string) => addLayer(idFor(path), path, { min: 0, max: 1.7 }));
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(T1, [T1]);
    expect(shown(idFor(T1))).toEqual({ colormap: 'gray', intensity: [0, 1.7], threshold: [0, 0] });
    expect(h.fetchLimit).not.toHaveBeenCalled();
    expect(service.isStudioMap(idFor(T1))).toBe(false);
  });

  it('each member paged to gets the default, on one scale that only widens', async () => {
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(M1, SET);
    expect(shown(idFor(M1))).toEqual(rule(RANGES[M1], { limit: 0.012 }));
    // A noisier member widens the window; its band is a tenth of the new one.
    await service.ensureSourcePathDisplayed(M2, SET);
    expect(shown(idFor(M2))).toEqual(rule(RANGES[M2], { limit: 0.0145 }));
    // A member with no negative value stays diverging, as its set is, on the
    // window reached so far (its own robust limit is smaller).
    await service.ensureSourcePathDisplayed(M3, SET);
    expect(shown(idFor(M3))).toEqual(rule(RANGES[M3], { signed: true, limit: 0.0145 }));
    // Back to the first: the scale stepping reached, not its own narrower one.
    await service.ensureSourcePathDisplayed(M1, SET);
    expect(shown(idFor(M1))).toEqual(rule(RANGES[M1], { limit: 0.0145 }));
    // Asked for again by itself (a re-render, a background change): unchanged.
    await service.ensureSourcePathDisplayed(M1, SET);
    expect(shown(idFor(M1))).toEqual(rule(RANGES[M1], { limit: 0.0145 }));
    // Each member's histogram was asked for once.
    expect(h.fetchLimit).toHaveBeenCalledTimes(3);
  });

  it('a member superseded while its histogram ran is neither styled nor shown', async () => {
    let release!: (limit: number) => void;
    h.fetchLimit.mockImplementationOnce(() => new Promise<number>((resolve) => (release = resolve)));
    const service = new StudioDisplayService();
    const first = service.ensureSourcePathDisplayed(M1, SET);
    await vi.waitFor(() => expect(h.fetchLimit).toHaveBeenCalledTimes(1));
    const second = service.ensureSourcePathDisplayed(M2, SET);
    await second;
    release(0.012);
    await first;
    expect(layerState.layers.find((layer) => layer.id === idFor(M1))?.visible).toBe(false);
    expect(layerState.layers.find((layer) => layer.id === idFor(M2))?.visible).toBe(true);
    expect(view(idFor(M1)).colormap).toBe('gray');
    expect(view(idFor(M2)).colormap).toBe('fmri');
  });
});

describe('the default never fights the user', () => {
  it('a display the user set is not overwritten, and is carried to the next members', async () => {
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(M1, SET);
    edit(idFor(M1), { colormap: 'viridis', intensity: [-0.005, 0.005], threshold: [-0.002, 0.002] });

    // Carried as before (QA F33): colour map and threshold, and a window that
    // covers both members' windows. No default is written for this member.
    await service.ensureSourcePathDisplayed(M2, SET);
    expect(shown(idFor(M2))).toEqual({
      colormap: 'viridis',
      intensity: [-0.02, 0.005],
      threshold: [-0.002, 0.002],
    });
    // And on: the user's choice holds for the set, not for one step.
    await service.ensureSourcePathDisplayed(M3, SET);
    expect(shown(idFor(M3))).toMatchObject({ colormap: 'viridis', threshold: [-0.002, 0.002] });
    // Back on the member they edited: still theirs.
    await service.ensureSourcePathDisplayed(M1, SET);
    expect(shown(idFor(M1))).toMatchObject({ colormap: 'viridis', threshold: [-0.002, 0.002] });
  });

  it('showing the edited member again by itself leaves it exactly as the user set it', async () => {
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(M1, SET);
    const mine = { colormap: 'viridis', intensity: [-0.005, 0.005] as [number, number], threshold: [0, 0] as [number, number] };
    edit(idFor(M1), mine);
    await service.ensureSourcePathDisplayed(M1, SET);
    expect(shown(idFor(M1))).toEqual(mine);
    // Nor does a group mean beside it widen a window the user chose.
    service.setCompareMeanLimit(0.5);
    expect(shown(idFor(M1))).toEqual(mine);
  });

  it('a layer the user opened themselves is left as it is, on first show and when paged to', async () => {
    addLayer('user-m2', M2);
    const before = shown('user-m2');
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(M2, SET);
    expect(shown('user-m2')).toEqual(before);
    expect(service.isStudioMap('user-m2')).toBe(false);
    expect(h.fetchLimit).not.toHaveBeenCalled();

    // From a member the Studio styled: its default is not handed on to it.
    layerState.layers.find((layer) => layer.id === 'user-m2')!.visible = false;
    const fresh = new StudioDisplayService();
    await fresh.ensureSourcePathDisplayed(M1, SET);
    expect(view(idFor(M1)).colormap).toBe('fmri');
    await fresh.ensureSourcePathDisplayed(M2, SET);
    expect(shown('user-m2')).toEqual(before);
    // The user's layer's own display is carried on, as before.
    await fresh.ensureSourcePathDisplayed(M3, SET);
    expect(view(idFor(M3)).colormap).toBe('gray');
  });
});

describe('the member and the group mean beside it (Compare A and B)', () => {
  it('the member’s default is widened to the mean’s robust limit, never narrowed', async () => {
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(M1, SET);
    service.setCompareMeanLimit(0.004);
    expect(shown(idFor(M1))).toEqual(rule(RANGES[M1], { limit: 0.012 }));
    service.setCompareMeanLimit(0.02);
    expect(shown(idFor(M1))).toEqual(rule(RANGES[M1], { limit: 0.02 }));
    // The next member starts from the larger of the limits in play.
    await service.ensureSourcePathDisplayed(M2, SET);
    expect(shown(idFor(M2))).toEqual(rule(RANGES[M2], { limit: 0.02 }));
    // The mean gone: nothing is narrowed, and later members are not held to it.
    service.setCompareMeanLimit(null);
    expect(shown(idFor(M2))).toEqual(rule(RANGES[M2], { limit: 0.02 }));
  });
});

describe('opacity and leaving the Studio', () => {
  it('a member the rule draws is opaque over the template, as the computed panes draw their maps', async () => {
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(M2, SET);
    await service.syncBackground(TEMPLATE);
    expect(service.isStudioMap(idFor(M2))).toBe(true);
    expect(view(idFor(M2)).opacity).toBe(1);
    expect(view(idFor(TEMPLATE)).opacity).toBe(1);
    // Paged to with the template on: the same. An all-positive map too,
    // which the stack rule alone would open translucent as an image.
    await service.ensureSourcePathDisplayed(M1, SET);
    expect(view(idFor(M1)).opacity).toBe(1);
    await service.ensureSourcePathDisplayed(M3, SET);
    expect(view(idFor(M3)).opacity).toBe(1);
    // An anatomy-like member keeps the stack rule's opacity.
    const T1 = '/anat/sub-01_T1w.nii.gz';
    h.loadFile.mockImplementationOnce(async (path: string) => addLayer(idFor(path), path, { min: 0, max: 1.7 }));
    await service.ensureSourcePathDisplayed(T1, [T1]);
    expect(view(idFor(T1)).opacity).toBe(0.5);
  });

  it('leaving removes the Studio’s layers and puts a user layer back exactly; re-entry starts from the default', async () => {
    addLayer('user-m2', M2, RANGES[M2], 0.8);
    layerState.layerMetadata.set('user-m2', { sourcePath: M2, dataRange: RANGES[M2], renderProps: { opacity: 0.8 } });
    // Hidden when the Studio is entered: the Studio shows it, and hides it again.
    layerState.layers[0].visible = false;
    const before = { ...shown('user-m2') };
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(M1, SET);
    await service.syncBackground(TEMPLATE);
    await service.ensureSourcePathDisplayed(M2, SET);
    // The user's layer takes the stack rule's opacity over the template, as
    // before (a signed map is opaque there).
    expect(view('user-m2').opacity).toBe(1);
    edit(idFor(M1), { colormap: 'viridis' });

    await service.releaseStudioLayers();
    expect(layerState.layers.map((layer) => layer.id)).toEqual(['user-m2']);
    expect(shown('user-m2')).toEqual(before);
    expect(view('user-m2').opacity).toBe(0.8);
    expect(layerState.layers[0].visible).toBe(false);

    // A new session: the member is loaded again and drawn by the rule, not
    // by the last session's edit.
    await service.ensureSourcePathDisplayed(M1, [M1]);
    expect(shown(idFor(M1))).toEqual(rule(RANGES[M1], { limit: 0.012 }));
  });

  it('a layer handed to a Compare view keeps the display it shows and is no longer written to', async () => {
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(M1, SET);
    const display = shown(idFor(M1));
    service.adopt(idFor(M1));
    service.setCompareMeanLimit(0.5);
    expect(shown(idFor(M1))).toEqual(display);
    expect(service.isStudioMap(idFor(M1))).toBe(false);
  });
});
