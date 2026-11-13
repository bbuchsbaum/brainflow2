import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Open in viewer" against small stand-ins for the global stores: the layer
 * store holds every tab's layers, each tab has its own view, and a new tab
 * is seeded with a copy of the view in front (as viewStateStore does).
 */
type ViewLayer = {
  id: string;
  colormap: string;
  intensity: [number, number];
  threshold: [number, number];
  visible?: boolean;
};
type Layer = { id: string; sourcePath: string; visible: boolean };

const h = vi.hoisted(() => {
  const state = {
    layers: [] as Layer[],
    views: new Map<string, { layers: ViewLayer[] }>(),
    active: 'studio',
    workspaces: new Map<string, { id: string; type: string }>(),
    listeners: new Set<() => void>(),
    warnings: [] as string[],
    created: 0,
  };
  const notify = () => state.listeners.forEach((listener) => listener());
  const activate = (id: string) => {
    if (!state.views.has(id))
      // The seeding rule: an empty new tab starts as a copy of the view in front.
      state.views.set(id, structuredClone(state.views.get(state.active) ?? { layers: [] }));
    state.active = id;
    notify();
  };
  /** The app's loader: a new layer in that tab's view; a second copy is warned about. */
  const load = (path: string, workspaceId: string, display?: Partial<ViewLayer>) => {
    const view = state.views.get(workspaceId)!;
    if (view.layers.some((l) => state.layers.find((x) => x.id === l.id)?.sourcePath === path))
      state.warnings.push(`Already open: ${path}`);
    const id = `layer-${state.layers.length + 1}`;
    state.layers.push({ id, sourcePath: path, visible: true });
    view.layers.push({
      id,
      colormap: 'gray',
      intensity: [0, 1],
      threshold: [0, 0],
      ...display,
    });
  };
  return { state, notify, activate, load };
});

vi.mock('@/stores/layerStore', () => ({
  useLayerStore: {
    getState: () => ({
      layers: h.state.layers,
      layerMetadata: new Map(),
      selectLayer: vi.fn(),
      getLayer: (id: string) => h.state.layers.find((layer) => layer.id === id),
    }),
  },
}));
vi.mock('@/stores/viewStateStore', () => ({
  useViewStateStore: {
    getState: () => ({
      activeWorkspaceKey: h.state.active,
      workspaceViewStates: h.state.views,
      viewState: h.state.views.get(h.state.active),
      setViewState: (update: (draft: { layers: ViewLayer[] }) => void, key = h.state.active) =>
        update(h.state.views.get(key)!),
    }),
  },
}));
vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: {
    getState: () => ({
      workspaces: h.state.workspaces,
      activeWorkspaceId: h.state.active,
      activateWorkspace: h.activate,
      createWorkspace: vi.fn(async (type: string) => {
        h.state.created += 1;
        const id = `${type}-${h.state.created}`;
        h.state.workspaces.set(id, { id, type });
        h.activate(id);
        return id;
      }),
    }),
    subscribe: (listener: () => void) => {
      h.state.listeners.add(listener);
      return () => h.state.listeners.delete(listener);
    },
  },
}));
const loadFile = vi.fn(async (path: string, _ingress: string, _intent: string, workspaceId?: string) =>
  h.load(path, workspaceId ?? h.state.active),
);
vi.mock('@/services/FileLoadingService', () => ({ getFileLoadingService: () => ({ loadFile }) }));
const loadTemplateBySourcePath = vi.fn(async (path: string) => {
  h.load(path, h.state.active, { colormap: 'gray' });
  return { joined: false };
});
vi.mock('@/services/TemplateService', () => ({
  getTemplateService: () => ({ loadTemplateBySourcePath }),
}));
const removeLayer = vi.fn(async (id: string) => {
  h.state.layers = h.state.layers.filter((layer) => layer.id !== id);
  for (const view of h.state.views.values()) view.layers = view.layers.filter((l) => l.id !== id);
});
vi.mock('@/services/LayerService', () => ({
  getLayerService: () => ({ removeLayer, toggleVisibility: vi.fn() }),
}));
vi.mock('@/stores/comparisonStore', () => ({ useComparisonStore: { getState: () => ({}) } }));

import { StudioDisplayService } from '../StudioDisplayService';
import { useAppModeStore } from '@/stores/appModeStore';

const MEMBER = '/cache/remote/sub-01_beta.nii.gz';
const TEMPLATE = 'template:MNI152NLin2009cAsym_T1w_2mm';

/** The Studio's private session state, seeded as a session would leave it. */
function seedStudio(service: StudioDisplayService) {
  h.state.layers = [
    { id: 'studio-bg', sourcePath: TEMPLATE, visible: true },
    { id: 'studio-member', sourcePath: MEMBER, visible: true },
    { id: 'user-t1', sourcePath: '/data/t1.nii.gz', visible: false },
  ];
  h.state.views = new Map([
    [
      'studio',
      {
        layers: [
          { id: 'studio-bg', colormap: 'gray', intensity: [0, 100], threshold: [0, 0] },
          { id: 'studio-member', colormap: 'RdBu', intensity: [-3, 3], threshold: [-1, 1] },
          { id: 'user-t1', colormap: 'gray', intensity: [0, 1], threshold: [0, 0], visible: false },
        ],
      },
    ],
    ['other', { layers: [] }],
  ]);
  h.state.workspaces = new Map([
    ['studio', { id: 'studio', type: 'set-studio' }],
    ['other', { id: 'other', type: 'orthogonal-locked' }],
  ]);
  h.state.active = 'studio';
  const internals = service as unknown as {
    owned: Set<string>;
    backgroundLayerId: string | null;
    background: { desired: string | null; run: null };
  };
  internals.owned.add('studio-bg');
  internals.owned.add('studio-member');
  internals.backgroundLayerId = 'studio-bg';
  internals.background = { desired: TEMPLATE, run: null };
}

/** What the mode switch does when a tab other than the Studio's comes to the front. */
async function leaveStudio(service: StudioDisplayService) {
  useAppModeStore.setState({ mode: 'imaging' });
  await service.releaseStudioLayers();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.warnings = [];
  h.state.listeners.clear();
  h.state.created = 0;
  useAppModeStore.setState({ mode: 'studio' });
});

describe('Open in viewer', () => {
  it('opens an empty new tab holding only the template and the file, with the Studio\'s display', async () => {
    const service = new StudioDisplayService();
    seedStudio(service);
    const id = await service.openInViewerTab(MEMBER);
    expect(id).toBe('orthogonal-locked-1');
    expect(h.state.active).toBe(id);
    const view = h.state.views.get(id!)!;
    const paths = view.layers.map((l) => h.state.layers.find((x) => x.id === l.id)!.sourcePath);
    // Exactly the underlay, then the file: none of the Studio's or the user's layers.
    expect(paths).toEqual([TEMPLATE, MEMBER]);
    expect(view.layers.map((l) => l.id)).not.toContain('studio-member');
    expect(view.layers.map((l) => l.id)).not.toContain('user-t1');
    expect(view.layers[1]).toMatchObject({
      colormap: 'RdBu',
      intensity: [-3, 3],
      threshold: [-1, 1],
    });
    // Through the app's loader, into that tab; the template as the Studio loads it.
    expect(loadFile).toHaveBeenCalledWith(MEMBER, 'programmatic', 'add-layer', id);
    expect(loadTemplateBySourcePath).toHaveBeenCalledWith(TEMPLATE, { quiet: true });
    // No "already open" second copy, and the Studio's view is as it was.
    expect(h.state.warnings).toEqual([]);
    expect(h.state.views.get('studio')!.layers.map((l) => l.id)).toEqual([
      'studio-bg',
      'studio-member',
      'user-t1',
    ]);
  });

  it('keeps the Studio\'s layers while its viewer tab is in front, so coming back reloads nothing', async () => {
    const service = new StudioDisplayService();
    seedStudio(service);
    const id = await service.openInViewerTab(MEMBER);
    await leaveStudio(service);
    expect(removeLayer).not.toHaveBeenCalled();
    expect(service.ownsLayer('studio-member')).toBe(true);
    // Back to the Studio: its layers are there, still its own.
    h.activate('studio');
    useAppModeStore.setState({ mode: 'studio' });
    service.resumeStudio();
    expect(service.holdingLayersForViewer()).toBe(false);
    expect(h.state.layers.map((l) => l.id)).toEqual(
      expect.arrayContaining(['studio-bg', 'studio-member']),
    );
    expect(removeLayer).not.toHaveBeenCalled();
    expect(id).not.toBeNull();
  });

  it('releases them as usual once another tab comes to the front', async () => {
    const service = new StudioDisplayService();
    seedStudio(service);
    await service.openInViewerTab(MEMBER);
    await leaveStudio(service);
    expect(removeLayer).not.toHaveBeenCalled();
    h.activate('other');
    await vi.waitFor(() => expect(removeLayer).toHaveBeenCalledTimes(2));
    expect(removeLayer.mock.calls.map(([id]) => id).sort()).toEqual(['studio-bg', 'studio-member']);
    expect(service.ownsLayer('studio-member')).toBe(false);
    // The file opened in the viewer tab is the user's: it stays.
    expect(h.state.layers.map((l) => l.sourcePath)).toContain(MEMBER);
  });

  it('a plain exit from the Studio still releases at once', async () => {
    const service = new StudioDisplayService();
    seedStudio(service);
    h.activate('other');
    await leaveStudio(service);
    expect(removeLayer).toHaveBeenCalledTimes(2);
  });

  it('does nothing without a path', async () => {
    const service = new StudioDisplayService();
    seedStudio(service);
    expect(await service.openInViewerTab('  ')).toBeNull();
    expect(loadFile).not.toHaveBeenCalled();
    expect(h.state.created).toBe(0);
  });
});
