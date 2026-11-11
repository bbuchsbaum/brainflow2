import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioDisplayService } from '../StudioDisplayService';
import { studioMemberForLoad } from '../studioMemberLoads';

const TEMPLATE = 'template:MNI152NLin2009cAsym_T1w_1mm';
const OTHER = 'template:MNI152NLin6Asym_T1w_1mm';
const MEMBER = '/set/sub-01_zstat.nii.gz';
const MEMBER_2 = '/set/sub-02_zstat.nii.gz';

type MockLayer = { id: string; sourcePath?: string | null; visible: boolean };
type MockMetadata = { sourcePath?: string; renderProps?: { opacity: number } };
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
/** The view of another workspace tab, and which tab is in front. */
const otherViewState = { layers: [] as MockViewLayer[] };
const views = new Map([
  ['studio', viewState],
  ['other', otherViewState],
]);
const front = { key: 'studio' };

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
    // `viewState` is the active view: a layer of another tab is not in it.
    getState: () => ({
      activeWorkspaceKey: front.key,
      viewState: views.get(front.key),
      workspaceViewStates: views,
      setViewState: (updater: (draft: typeof viewState) => void, workspaceKey = front.key) => {
        const view = views.get(workspaceKey);
        if (view) updater(view);
      },
    }),
  },
}));
vi.mock('@/stores/workspaceStore', () => ({ useWorkspaceStore: { getState: () => ({}) } }));
vi.mock('@/stores/comparisonStore', () => ({ useComparisonStore: { getState: () => ({}) } }));

function addLayer(id: string, sourcePath: string, opacity = 1) {
  layerState.layers.push({ id, sourcePath, visible: true });
  layerState.layerMetadata.set(id, { sourcePath });
  viewState.layers.push({ id, opacity, intensity: [0, 1], threshold: [0, 0], colormap: 'gray' });
}
const idFor = (sourcePath: string) => `layer:${sourcePath}`;
const opacity = (id: string) => viewState.layers.find((layer) => layer.id === id)?.opacity;
const visible = (id: string) => layerState.layers.find((layer) => layer.id === id)?.visible;
const present = () => layerState.layers.map((layer) => layer.id);

/** Let a request reach its (gated) load. */
const started = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A load that finishes only when released. */
function gate() {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

beforeEach(() => {
  vi.clearAllMocks();
  layerState.layers = [];
  layerState.layerMetadata = new Map();
  layerState.selectedLayerId = null;
  viewState.layers = [];
  otherViewState.layers = [];
  front.key = 'studio';
  h.selectLayer.mockImplementation((id: string) => {
    layerState.selectedLayerId = id;
  });
  h.loadFile.mockImplementation(async (path: string) => addLayer(idFor(path), path));
  // A template opened alone takes the selection, translucent over a member.
  h.loadTemplateBySourcePath.mockImplementation(async (path: string) => {
    addLayer(idFor(path), path, 0.5);
    layerState.selectedLayerId = idFor(path);
  });
  h.toggleVisibility.mockImplementation((id: string, visible: boolean) => {
    const layer = layerState.layers.find((candidate) => candidate.id === id);
    if (layer) layer.visible = visible;
  });
  h.removeLayer.mockImplementation(async (id: string) => {
    layerState.layers = layerState.layers.filter((layer) => layer.id !== id);
    layerState.layerMetadata.delete(id);
    viewState.layers = viewState.layers.filter((layer) => layer.id !== id);
  });
});

describe('StudioDisplayService background template', () => {
  it('loads the template quietly as a Studio layer and leaves the member in charge', async () => {
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(MEMBER, [MEMBER]);
    let attributed: string | undefined = 'unset';
    h.loadTemplateBySourcePath.mockImplementationOnce(async (path: string) => {
      attributed = studioMemberForLoad(path);
      addLayer(idFor(path), path, 0.5);
      layerState.selectedLayerId = idFor(path);
    });

    const result = await service.syncBackground(TEMPLATE);

    expect(result).toEqual({ status: 'ready', sourcePath: TEMPLATE, layerId: idFor(TEMPLATE) });
    expect(h.loadTemplateBySourcePath).toHaveBeenCalledWith(TEMPLATE, { quiet: true });
    // Not logged as a member of the set.
    expect(attributed).toBeUndefined();
    expect(service.ownsLayer(idFor(TEMPLATE))).toBe(true);
    // Opaque at the bottom; the member keeps the selection (colorbar, readouts).
    expect(viewState.layers.find((layer) => layer.id === idFor(TEMPLATE))?.opacity).toBe(1);
    expect(layerState.selectedLayerId).toBe(idFor(MEMBER));
    // A statistic map stays opaque over anatomy (the stack rule, unmocked).
    expect(opacity(idFor(MEMBER))).toBe(1);
    // The member's display is otherwise untouched.
    expect(h.toggleVisibility).not.toHaveBeenCalled();
  });

  it('waits for the member being displayed before loading the template', async () => {
    const member = gate();
    h.loadFile.mockImplementationOnce(async (path: string) => {
      await member.wait;
      addLayer(idFor(path), path);
    });
    const service = new StudioDisplayService();
    const displayed = service.ensureSourcePathDisplayed(MEMBER, [MEMBER]);
    const background = service.syncBackground(TEMPLATE);
    await started();
    expect(h.loadTemplateBySourcePath).not.toHaveBeenCalled();
    member.open();
    await displayed;
    expect((await background).status).toBe('ready');
    expect(present()).toEqual([idFor(MEMBER), idFor(TEMPLATE)]);
  });

  it('does not reload the template when members are paged or it is asked for again', async () => {
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(MEMBER, [MEMBER, MEMBER_2]);
    const first = service.syncBackground(TEMPLATE);
    await first;
    expect(service.syncBackground(TEMPLATE)).toBe(first);

    await service.ensureSourcePathDisplayed(MEMBER_2, [MEMBER, MEMBER_2]);

    expect(h.loadTemplateBySourcePath).toHaveBeenCalledTimes(1);
    expect(h.removeLayer).not.toHaveBeenCalled();
    // The member before is hidden; the template is not part of that syncing.
    expect(visible(idFor(MEMBER))).toBe(false);
    expect(visible(idFor(MEMBER_2))).toBe(true);
    expect(visible(idFor(TEMPLATE))).toBe(true);
    expect(h.toggleVisibility).not.toHaveBeenCalledWith(idFor(TEMPLATE), expect.anything());
    expect(layerState.selectedLayerId).toBe(idFor(MEMBER_2));
  });

  it('does not share the template display with a member, or count it as one', async () => {
    const service = new StudioDisplayService();
    await service.syncBackground(TEMPLATE);
    viewState.layers[0].colormap = 'template-map';
    // Even a set that lists the template among its members.
    await service.ensureSourcePathDisplayed(MEMBER, [MEMBER, TEMPLATE]);
    expect(viewState.layers.find((layer) => layer.id === idFor(MEMBER))?.colormap).toBe('gray');
    expect(layerState.layers.find((layer) => layer.id === idFor(TEMPLATE))?.visible).toBe(true);
  });

  it('removes the last template when another, or none, is chosen', async () => {
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(MEMBER, [MEMBER]);
    await service.syncBackground(TEMPLATE);

    expect((await service.syncBackground(OTHER)).status).toBe('ready');
    expect(h.removeLayer).toHaveBeenCalledWith(idFor(TEMPLATE));
    expect(present()).toEqual([idFor(MEMBER), idFor(OTHER)]);

    expect(await service.syncBackground(null)).toEqual({ status: 'none', sourcePath: null });
    expect(present()).toEqual([idFor(MEMBER)]);
    expect(service.ownsLayer(idFor(OTHER))).toBe(false);
  });

  it('borrows a template the workspace already has, and never removes it', async () => {
    addLayer('user-template', TEMPLATE, 0.4);
    layerState.layers[0].visible = false;
    const service = new StudioDisplayService();

    const result = await service.syncBackground(TEMPLATE);

    expect(result.layerId).toBe('user-template');
    expect(h.loadTemplateBySourcePath).not.toHaveBeenCalled();
    expect(service.ownsLayer('user-template')).toBe(false);
    // Shown for the Studio; the user's opacity is theirs.
    expect(h.toggleVisibility).toHaveBeenCalledWith('user-template', true);
    expect(viewState.layers[0].opacity).toBe(0.4);

    await service.syncBackground(null);
    await service.releaseStudioLayers();
    expect(h.removeLayer).not.toHaveBeenCalled();
    // Hidden again, as the user had it.
    expect(h.toggleVisibility).toHaveBeenLastCalledWith('user-template', false);
  });

  it('drops a template that finishes loading after another was chosen', async () => {
    const slow = gate();
    h.loadTemplateBySourcePath.mockImplementationOnce(async (path: string) => {
      await slow.wait;
      addLayer(idFor(path), path);
    });
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(MEMBER, [MEMBER]);

    const first = service.syncBackground(TEMPLATE);
    await started();
    expect(h.loadTemplateBySourcePath).toHaveBeenCalledWith(TEMPLATE, { quiet: true });
    const second = service.syncBackground(OTHER);
    slow.open();

    expect((await first).status).toBe('stale');
    expect((await second).status).toBe('ready');
    expect(h.removeLayer).toHaveBeenCalledWith(idFor(TEMPLATE));
    expect(present()).toEqual([idFor(MEMBER), idFor(OTHER)]);
    expect(service.ownsLayer(idFor(TEMPLATE))).toBe(false);
    expect(layerState.selectedLayerId).toBe(idFor(MEMBER));
  });

  it('drops a template that finishes loading after None was chosen', async () => {
    const slow = gate();
    h.loadTemplateBySourcePath.mockImplementationOnce(async (path: string) => {
      await slow.wait;
      addLayer(idFor(path), path);
    });
    const service = new StudioDisplayService();
    const first = service.syncBackground(TEMPLATE);
    await started();
    const none = service.syncBackground(null);
    slow.open();
    expect((await first).status).toBe('stale');
    expect((await none).status).toBe('none');
    expect(present()).toEqual([]);
  });

  it('keeps a template asked for again while its first load was still running', async () => {
    const slow = gate();
    h.loadTemplateBySourcePath.mockImplementationOnce(async (path: string) => {
      await slow.wait;
      addLayer(idFor(path), path);
    });
    const service = new StudioDisplayService();
    const first = service.syncBackground(TEMPLATE);
    await started();
    void service.syncBackground(null);
    const again = service.syncBackground(TEMPLATE);
    slow.open();

    expect((await first).status).toBe('stale');
    expect((await again).status).toBe('ready');
    expect(h.loadTemplateBySourcePath).toHaveBeenCalledTimes(1);
    expect(h.removeLayer).not.toHaveBeenCalled();
    expect(present()).toEqual([idFor(TEMPLATE)]);
  });

  it('discards a template that finishes loading after the Studio was left', async () => {
    const slow = gate();
    h.loadTemplateBySourcePath.mockImplementationOnce(async (path: string) => {
      await slow.wait;
      addLayer(idFor(path), path);
    });
    const service = new StudioDisplayService();
    const pending = service.syncBackground(TEMPLATE);
    await started();
    await service.releaseStudioLayers();
    slow.open();

    expect((await pending).status).toBe('stale');
    expect(h.removeLayer).toHaveBeenCalledWith(idFor(TEMPLATE));
    expect(present()).toEqual([]);
  });

  it('releases the template with the member layers when the Studio is left', async () => {
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(MEMBER, [MEMBER]);
    await service.syncBackground(TEMPLATE);
    await service.releaseStudioLayers();
    expect(present()).toEqual([]);
    // A new session loads it afresh.
    expect((await service.syncBackground(TEMPLATE)).status).toBe('ready');
    expect(h.loadTemplateBySourcePath).toHaveBeenCalledTimes(2);
  });

  it('a failed load leaves the member as it was and nothing behind', async () => {
    // TemplateService reports its own failure and adds no layer.
    h.loadTemplateBySourcePath.mockImplementationOnce(async () => undefined);
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(MEMBER, [MEMBER]);
    h.selectLayer.mockClear();

    const result = await service.syncBackground(TEMPLATE);

    expect(result).toEqual({ status: 'failed', sourcePath: TEMPLATE });
    expect(present()).toEqual([idFor(MEMBER)]);
    expect(h.removeLayer).not.toHaveBeenCalled();
    expect(h.toggleVisibility).not.toHaveBeenCalled();
    expect(opacity(idFor(MEMBER))).toBe(1);
    expect(h.selectLayer).not.toHaveBeenCalled();
    expect(layerState.selectedLayerId).toBe(idFor(MEMBER));
    // Not retried behind the user's back; choosing another template works.
    expect(await service.syncBackground(TEMPLATE)).toEqual(result);
    expect(h.loadTemplateBySourcePath).toHaveBeenCalledTimes(1);
    expect((await service.syncBackground(OTHER)).status).toBe('ready');
  });

  it('a load that throws is a failure too', async () => {
    h.loadTemplateBySourcePath.mockRejectedValueOnce(new Error('offline'));
    const service = new StudioDisplayService();
    expect((await service.syncBackground(TEMPLATE)).status).toBe('failed');
    expect(present()).toEqual([]);
  });
});

// Continuous images (anatomy band): the stack rule draws them translucent
// over a template. MEMBER above is a statistic, which stays opaque.
const T1_A = '/set/sub-01_T1w.nii.gz';
const T1_B = '/set/sub-02_T1w.nii.gz';
const T1_C = '/set/sub-03_T1w.nii.gz';
const T1S = [T1_A, T1_B, T1_C];

describe('StudioDisplayService member opacity (review item 1)', () => {
  it('gives every member one opacity over a template, whenever it was loaded', async () => {
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(T1_A, T1S);
    await service.ensureSourcePathDisplayed(T1_B, T1S);
    expect([opacity(idFor(T1_A)), opacity(idFor(T1_B))]).toEqual([1, 1]);

    await service.syncBackground(TEMPLATE);
    // The member on display, at once.
    expect(opacity(idFor(T1_B))).toBe(0.5);
    // One loaded before the template, on its next visit.
    await service.ensureSourcePathDisplayed(T1_A, T1S);
    expect(opacity(idFor(T1_A))).toBe(0.5);
    // One loaded after it, whatever its load gave it.
    await service.ensureSourcePathDisplayed(T1_C, T1S);
    expect(opacity(idFor(T1_C))).toBe(0.5);
    expect(opacity(idFor(TEMPLATE))).toBe(1);
  });

  it('makes every member opaque again when the background returns to None', async () => {
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(T1_A, T1S);
    await service.syncBackground(TEMPLATE);
    await service.ensureSourcePathDisplayed(T1_B, T1S);
    expect([opacity(idFor(T1_A)), opacity(idFor(T1_B))]).toEqual([0.5, 0.5]);

    await service.syncBackground(null);
    // The hidden member too, not only the one on display.
    expect([opacity(idFor(T1_A)), opacity(idFor(T1_B))]).toEqual([1, 1]);
  });

  it('opens a member loaded translucent by its load opaque when there is no background', async () => {
    h.loadFile.mockImplementationOnce(async (path: string) => addLayer(idFor(path), path, 0.5));
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(T1_A, T1S);
    expect(opacity(idFor(T1_A))).toBe(1);
  });

  it("restores a user's own layer exactly when the background goes, and when the Studio is left", async () => {
    addLayer('user-t1', T1_A, 0.8);
    layerState.layerMetadata.set('user-t1', { sourcePath: T1_A, renderProps: { opacity: 0.8 } });
    const props = () => layerState.layerMetadata.get('user-t1')?.renderProps?.opacity;
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(T1_A, T1S);
    // No background: the user's layer is as they had it.
    expect(opacity('user-t1')).toBe(0.8);

    await service.syncBackground(TEMPLATE);
    expect([opacity('user-t1'), props()]).toEqual([0.5, 0.5]);
    await service.syncBackground(null);
    expect([opacity('user-t1'), props()]).toEqual([0.8, 0.8]);

    await service.syncBackground(TEMPLATE);
    expect(opacity('user-t1')).toBe(0.5);
    await service.releaseStudioLayers();
    expect([opacity('user-t1'), props()]).toEqual([0.8, 0.8]);
    expect(present()).toEqual(['user-t1']);
  });

  it('leaves an opacity the user set by hand in the Studio alone', async () => {
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(T1_A, T1S);
    await service.syncBackground(TEMPLATE);
    viewState.layers.find((layer) => layer.id === idFor(T1_A))!.opacity = 0.7;
    await service.ensureSourcePathDisplayed(T1_B, T1S);
    await service.ensureSourcePathDisplayed(T1_A, T1S);
    expect(opacity(idFor(T1_A))).toBe(0.7);
    await service.syncBackground(null);
    expect(opacity(idFor(T1_A))).toBe(0.7);
  });

  it('gives a failed template no hold on the members', async () => {
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(T1_A, T1S);
    await service.syncBackground(TEMPLATE);
    h.loadTemplateBySourcePath.mockImplementationOnce(async () => undefined);
    expect((await service.syncBackground(OTHER)).status).toBe('failed');
    // The first template was dropped: nothing is beneath the member.
    expect(opacity(idFor(T1_A))).toBe(1);
  });
});

describe('StudioDisplayService and other workspaces (review item 2)', () => {
  /** A layer in the global layer store that the active view does not draw. */
  function addLayerInAnotherTab(id: string, sourcePath: string) {
    layerState.layers.push({ id, sourcePath, visible: true });
    layerState.layerMetadata.set(id, { sourcePath });
  }

  it('loads its own template when the only copy is open in another tab', async () => {
    addLayerInAnotherTab('other-tab-template', TEMPLATE);
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(MEMBER, [MEMBER]);

    const result = await service.syncBackground(TEMPLATE);

    expect(h.loadTemplateBySourcePath).toHaveBeenCalledWith(TEMPLATE, { quiet: true });
    expect(result).toEqual({ status: 'ready', sourcePath: TEMPLATE, layerId: idFor(TEMPLATE) });
    // The other tab's copy is not the Studio's, and stays when it leaves.
    expect(service.ownsLayer('other-tab-template')).toBe(false);
    await service.releaseStudioLayers();
    expect(present()).toEqual(['other-tab-template']);
  });

  it('reports a failure, not ready, when no layer reaches this view', async () => {
    addLayerInAnotherTab('other-tab-template', TEMPLATE);
    h.loadTemplateBySourcePath.mockImplementationOnce(async () => undefined);
    const service = new StudioDisplayService();
    expect(await service.syncBackground(TEMPLATE)).toEqual({
      status: 'failed',
      sourcePath: TEMPLATE,
    });
  });

  it("loads its own member, and leaves another tab's copy of it as it is", async () => {
    addLayerInAnotherTab('other-tab-member', MEMBER);
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(MEMBER, [MEMBER, MEMBER_2]);
    expect(h.loadFile).toHaveBeenCalledTimes(1);
    expect(layerState.selectedLayerId).toBe(idFor(MEMBER));

    await service.ensureSourcePathDisplayed(MEMBER_2, [MEMBER, MEMBER_2]);
    expect(visible(idFor(MEMBER))).toBe(false);
    expect(visible('other-tab-member')).toBe(true);
    expect(h.toggleVisibility).not.toHaveBeenCalledWith('other-tab-member', expect.anything());
  });
});

describe('StudioDisplayService rapid paging (review item 4)', () => {
  it('keeps the latest member on display when an earlier, slower load finishes last', async () => {
    const slow = gate();
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(MEMBER, [MEMBER, T1_A, T1_B]);
    h.loadFile.mockImplementationOnce(async (path: string) => {
      await slow.wait;
      addLayer(idFor(path), path);
      // As a load does: the new layer takes the selection.
      layerState.selectedLayerId = idFor(path);
    });

    const first = service.ensureSourcePathDisplayed(T1_A, [MEMBER, T1_A, T1_B]);
    await started();
    await service.ensureSourcePathDisplayed(T1_B, [MEMBER, T1_A, T1_B]);
    slow.open();
    await first;

    expect(visible(idFor(T1_B))).toBe(true);
    expect(visible(idFor(T1_A))).toBe(false);
    expect(visible(idFor(MEMBER))).toBe(false);
    expect(layerState.selectedLayerId).toBe(idFor(T1_B));
    // The background follows the member on display, not the late one.
    await service.syncBackground(TEMPLATE);
    expect(opacity(idFor(T1_B))).toBe(0.5);
    expect(opacity(idFor(T1_A))).toBe(1);
    // The late member stayed loaded: visiting it does not load it again.
    await service.ensureSourcePathDisplayed(T1_A, [MEMBER, T1_A, T1_B]);
    expect(h.loadFile).toHaveBeenCalledTimes(3);
    expect(visible(idFor(T1_A))).toBe(true);
    expect(visible(idFor(T1_B))).toBe(false);
    expect(opacity(idFor(T1_A))).toBe(0.5);
  });
});

describe('StudioDisplayService background retries (review item 6)', () => {
  it('waits for a template load already under way and does not take its layer', async () => {
    // TemplateService joined the Templates menu's load of the same template.
    h.loadTemplateBySourcePath.mockImplementationOnce(async (path: string) => {
      addLayer(idFor(path), path);
      return { joined: true };
    });
    const service = new StudioDisplayService();
    const result = await service.syncBackground(TEMPLATE);
    expect(result.status).toBe('ready');
    expect(service.ownsLayer(idFor(TEMPLATE))).toBe(false);
    await service.releaseStudioLayers();
    expect(present()).toEqual([idFor(TEMPLATE)]);
  });

  it('tries a failed template again when asked to retry', async () => {
    h.loadTemplateBySourcePath.mockImplementationOnce(async () => undefined);
    const service = new StudioDisplayService();
    expect((await service.syncBackground(TEMPLATE)).status).toBe('failed');
    expect((await service.retryBackground(TEMPLATE)).status).toBe('ready');
    expect(h.loadTemplateBySourcePath).toHaveBeenCalledTimes(2);
  });

  it('does not keep a request that threw: the same template asked for again is loaded again', async () => {
    h.toggleVisibility.mockImplementationOnce(() => {
      throw new Error('layer service down');
    });
    addLayer('user-template', TEMPLATE);
    layerState.layers[0].visible = false;
    const service = new StudioDisplayService();
    const first = await service.syncBackground(TEMPLATE);
    expect(first.status).toBe('failed');
    const second = service.syncBackground(TEMPLATE);
    expect((await second).status).toBe('ready');
  });
});

describe('StudioDisplayService after a workspace tab switch (review 2026-11-10)', () => {
  /** Another workspace tab comes in front: the active view is now its view. */
  const switchTab = () => {
    front.key = 'other';
  };

  it('removes a member that finishes loading after the user switched tab and the Studio was left', async () => {
    const slow = gate();
    h.loadFile.mockImplementationOnce(async (path: string) => {
      await slow.wait;
      // The load puts its layer in the view it started in: the Studio's.
      addLayer(idFor(path), path);
    });
    const service = new StudioDisplayService();
    const pending = service.ensureSourcePathDisplayed(MEMBER, [MEMBER]);
    await started();
    switchTab();
    await service.releaseStudioLayers();
    slow.open();
    await pending;

    expect(h.removeLayer).toHaveBeenCalledWith(idFor(MEMBER));
    expect(present()).toEqual([]);
  });

  it('owns a member that finishes loading in the gap between the tab switch and the release', async () => {
    const slow = gate();
    h.loadFile.mockImplementationOnce(async (path: string) => {
      await slow.wait;
      addLayer(idFor(path), path);
    });
    const service = new StudioDisplayService();
    const pending = service.ensureSourcePathDisplayed(MEMBER, [MEMBER]);
    await started();
    switchTab();
    slow.open();
    await pending;

    expect(service.ownsLayer(idFor(MEMBER))).toBe(true);
    await service.releaseStudioLayers();
    expect(present()).toEqual([]);
  });

  it('removes a background template that finishes loading after a tab switch', async () => {
    const slow = gate();
    h.loadTemplateBySourcePath.mockImplementationOnce(async (path: string) => {
      await slow.wait;
      addLayer(idFor(path), path);
    });
    const service = new StudioDisplayService();
    const pending = service.syncBackground(TEMPLATE);
    await started();
    switchTab();
    await service.releaseStudioLayers();
    slow.open();

    expect((await pending).status).toBe('stale');
    expect(h.removeLayer).toHaveBeenCalledWith(idFor(TEMPLATE));
    expect(present()).toEqual([]);
  });

  it("restores a user layer's opacity in the Studio's view when the Studio is left by a tab switch", async () => {
    addLayer('user-t1', T1_A, 0.8);
    layerState.layerMetadata.set('user-t1', { sourcePath: T1_A, renderProps: { opacity: 0.8 } });
    const props = () => layerState.layerMetadata.get('user-t1')?.renderProps?.opacity;
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(T1_A, T1S);
    await service.syncBackground(TEMPLATE);
    expect([opacity('user-t1'), props()]).toEqual([0.5, 0.5]);

    // The view swaps first; the release runs after it.
    switchTab();
    await service.releaseStudioLayers();

    expect([opacity('user-t1'), props()]).toEqual([0.8, 0.8]);
    expect(otherViewState.layers).toEqual([]);
  });

  it("restores an adopted layer's opacity in the Studio's view from another tab", async () => {
    addLayer('user-t1', T1_A, 0.8);
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(T1_A, T1S);
    await service.syncBackground(TEMPLATE);
    expect(opacity('user-t1')).toBe(0.5);
    switchTab();
    service.adopt('user-t1');
    expect(opacity('user-t1')).toBe(0.8);
  });
});

describe('StudioDisplayService background hand-over (review 2026-11-10)', () => {
  it("lets go of the user's template when another is chosen, while it loads and when it fails", async () => {
    addLayer('user-template', TEMPLATE);
    const slow = gate();
    const service = new StudioDisplayService();
    await service.ensureSourcePathDisplayed(T1_A, T1S);
    expect((await service.syncBackground(TEMPLATE)).layerId).toBe('user-template');
    expect(service.ownsLayer('user-template')).toBe(false);
    expect(opacity(idFor(T1_A))).toBe(0.5);

    h.loadTemplateBySourcePath.mockImplementationOnce(async () => {
      await slow.wait;
    });
    const next = service.syncBackground(OTHER);
    await started();
    // Nothing is beneath the member while the next template loads.
    expect(opacity(idFor(T1_A))).toBe(1);
    slow.open();
    expect((await next).status).toBe('failed');
    expect(opacity(idFor(T1_A))).toBe(1);
    // The user's template is theirs: still there.
    expect(present()).toContain('user-template');

    // The background follows again once a template does load.
    expect((await service.retryBackground(OTHER)).status).toBe('ready');
    expect(opacity(idFor(T1_A))).toBe(0.5);
  });

  it('keeps a template the user was loading when the Studio is left before it finishes', async () => {
    const slow = gate();
    // TemplateService joined the Templates menu's load of the same template.
    h.loadTemplateBySourcePath.mockImplementationOnce(async (path: string) => {
      await slow.wait;
      addLayer(idFor(path), path);
      return { joined: true };
    });
    const service = new StudioDisplayService();
    const pending = service.syncBackground(TEMPLATE);
    await started();
    await service.releaseStudioLayers();
    slow.open();

    expect((await pending).status).toBe('stale');
    expect(h.removeLayer).not.toHaveBeenCalled();
    expect(present()).toEqual([idFor(TEMPLATE)]);
    expect(service.ownsLayer(idFor(TEMPLATE))).toBe(false);
  });

  it('makes a template opaque that finished loading for a stale request and was asked for again', async () => {
    const template = gate();
    const member = gate();
    h.loadTemplateBySourcePath.mockImplementationOnce(async (path: string) => {
      await template.wait;
      // Opened by the stack rule over a member: translucent, and selected.
      addLayer(idFor(path), path, 0.5);
      layerState.selectedLayerId = idFor(path);
    });
    h.loadFile.mockImplementationOnce(async (path: string) => {
      await member.wait;
      addLayer(idFor(path), path);
    });
    const service = new StudioDisplayService();
    const first = service.syncBackground(TEMPLATE);
    await started();
    void service.syncBackground(null);
    const shown = service.ensureSourcePathDisplayed(MEMBER, [MEMBER]);
    // Asked for again: this request waits behind the member.
    const again = service.syncBackground(TEMPLATE);
    await started();
    template.open();
    expect((await first).status).toBe('stale');
    member.open();
    await shown;

    expect((await again).status).toBe('ready');
    expect(h.loadTemplateBySourcePath).toHaveBeenCalledTimes(1);
    expect(service.ownsLayer(idFor(TEMPLATE))).toBe(true);
    expect(opacity(idFor(TEMPLATE))).toBe(1);
    expect(layerState.selectedLayerId).toBe(idFor(MEMBER));
  });
});

describe('StudioDisplayService members and other sources (review 2026-11-10)', () => {
  const ARTIFACT = '/derived/mean.nii.gz';
  const set = {
    memberSummaries: [
      { id: 'sub-01', sourcePath: MEMBER },
      { id: 'sub-02', sourcePath: MEMBER_2 },
    ],
  } as unknown as Parameters<StudioDisplayService['ensureMemberDisplayed']>[0];

  it('shows the member still downloading after an already-loaded artifact was opened', async () => {
    const slow = gate();
    addLayer('artifact', ARTIFACT);
    const service = new StudioDisplayService();
    await service.ensureMemberDisplayed(set, 'sub-01');
    h.loadFile.mockImplementationOnce(async (path: string) => {
      await slow.wait;
      addLayer(idFor(path), path);
    });

    const paging = service.ensureMemberDisplayed(set, 'sub-02');
    await started();
    await service.ensureSourcePathDisplayed(ARTIFACT, [ARTIFACT]);
    slow.open();
    await paging;

    // The store's active member is on display, not shelved.
    expect(visible(idFor(MEMBER_2))).toBe(true);
    expect(visible(idFor(MEMBER))).toBe(false);
    expect(layerState.selectedLayerId).toBe(idFor(MEMBER_2));
  });

  it('still shelves a member superseded by a later member', async () => {
    const slow = gate();
    const service = new StudioDisplayService();
    h.loadFile.mockImplementationOnce(async (path: string) => {
      await slow.wait;
      addLayer(idFor(path), path);
      layerState.selectedLayerId = idFor(path);
    });
    const first = service.ensureMemberDisplayed(set, 'sub-01');
    await started();
    await service.ensureMemberDisplayed(set, 'sub-02');
    slow.open();
    await first;

    expect(visible(idFor(MEMBER_2))).toBe(true);
    expect(visible(idFor(MEMBER))).toBe(false);
    expect(layerState.selectedLayerId).toBe(idFor(MEMBER_2));
  });
});
