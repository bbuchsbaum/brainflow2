import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getEventBus } from '@/events/EventBus';
import { setTransport } from '@/services/transport';
import { useBidsStore } from '@/stores/bidsStore';
import { useLayerStore } from '@/stores/layerStore';
import { useTimeEventsStore } from '@/stores/timeEventsStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

const { loadFile, setTimepoint, reorderLayers, removeLayer } = vi.hoisted(() => ({
  loadFile: vi.fn(),
  setTimepoint: vi.fn(),
  reorderLayers: vi.fn(async () => undefined),
  removeLayer: vi.fn(async () => undefined),
}));
vi.mock('@/services/LayerService', () => ({ getLayerService: () => ({ reorderLayers, removeLayer }) }));
vi.mock('@/services/FileLoadingService', () => ({ getFileLoadingService: () => ({ loadFile }) }));
vi.mock('@/services/TimeNavigationService', () => ({ getTimeNavigationService: () => ({ setTimepoint }) }));

import { landingFrameOf } from '@/services/landingFrames';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import { RUN_VIEWER_PRESET, openRunInViewer, resetRunViewer } from '../openRunInViewer';

const run = { path: '/d/run.nii.gz', fd: { peak_volume: 149 } } as never;
const viewLayer = (id: string, visible = true) => ({ id, visible, opacity: 1 });
const view = (id = 'viewer') => useViewStateStore.getState().workspaceViewStates.get(id)!;
const addWorkspace = (id: string, type = 'orthogonal-locked') =>
  useWorkspaceStore.setState((state) => ({
    workspaces: new Map([...state.workspaces, [id, { id, type } as never]]),
  }));
const switchTo = (id: string) => {
  if (!useWorkspaceStore.getState().workspaces.has(id)) addWorkspace(id);
  useWorkspaceStore.setState({ activeWorkspaceId: id });
};
const layerIds = (id = 'viewer') => view(id).layers.map((layer) => layer.id);
const setLayers = (layers: object[], id?: string) =>
  useViewStateStore.getState().setViewState((state) => {
    state.layers = layers as never;
  }, id);

/** The real removal: gone from the layer store and from every view. */
const removesLayer = () =>
  removeLayer.mockImplementation(async (...[id]: unknown[]) => {
    useLayerStore.setState((state) => ({
      layers: state.layers.filter((layer) => layer.id !== id),
      selectedLayerId: state.selectedLayerId === id ? null : state.selectedLayerId,
    }));
    for (const workspaceId of useViewStateStore.getState().workspaceViewStates.keys()) {
      useViewStateStore.getState().setViewState((state) => {
        state.layers = state.layers.filter((layer) => layer.id !== id);
      }, workspaceId);
    }
  });
const closeTab = (id = 'viewer') =>
  useWorkspaceStore.setState((state) => {
    const workspaces = new Map(state.workspaces);
    workspaces.delete(id);
    return { workspaces, activeWorkspaceId: 'bids' };
  });

let nextLayer = 0;
/** What a load does: a new layer in the store and in the view it was asked for. */
const loadsLayer = (then?: () => void) =>
  loadFile.mockImplementation(async (path: string, _ingress: string, _intent: string, workspaceId: string) => {
    const id = `layer-${++nextLayer}`;
    useLayerStore.setState((state) => ({ layers: [...state.layers, { id, sourcePath: path }] as never }));
    useViewStateStore.getState().setViewState((state) => {
      state.layers.push(viewLayer(id) as never);
    }, workspaceId);
    then?.();
  });

describe('openRunInViewer', () => {
  /** A new tab starts as a copy of the view in front, as the real store does. */
  const createWorkspace = vi.fn(async (_type: string, _config: unknown, options: { presetId: string }) => {
    const front = useViewStateStore.getState().viewState.layers;
    useWorkspaceStore.setState((state) => ({
      workspaces: new Map([...state.workspaces, ['viewer', { id: 'viewer', type: 'orthogonal-locked', presetId: options.presetId } as never]]),
      activeWorkspaceId: 'viewer',
    }));
    setLayers(front.map((layer) => ({ ...layer })));
    return 'viewer';
  });

  beforeEach(() => {
    resetRunViewer();
    loadFile.mockReset();
    setTimepoint.mockReset();
    reorderLayers.mockClear();
    removeLayer.mockReset();
    removeLayer.mockImplementation(async () => undefined);
    useInspectorSelectionStore.getState().clear();
    createWorkspace.mockClear();
    nextLayer = 0;
    useLayerStore.setState({ layers: [], selectedLayerId: null });
    useTimeEventsStore.setState({ tracks: {} });
    useWorkspaceStore.setState({ workspaces: new Map(), activeWorkspaceId: null, createWorkspace: createWorkspace as never });
    switchTo('bids');
    useWorkspaceStore.setState((state) => ({
      workspaces: new Map(state.workspaces).set('bids', { id: 'bids', type: 'bids-explorer' } as never),
    }));
    setLayers([]);
  });

  it('opens one marked tab, then lands on the FD peak', async () => {
    loadsLayer();
    await openRunInViewer(run);
    expect(createWorkspace).toHaveBeenCalledWith('orthogonal-locked', undefined, expect.objectContaining({ presetId: RUN_VIEWER_PRESET }));
    expect(loadFile).toHaveBeenCalledWith('/d/run.nii.gz', 'programmatic', 'default', 'viewer');
    expect(setTimepoint).toHaveBeenCalledWith(149);
  });

  it('replaces the last run in the same tab and releases it', async () => {
    loadsLayer();
    await openRunInViewer(run);
    switchTo('bids');
    await openRunInViewer({ path: '/other/b.nii.gz', fd: { peak_volume: 7 } } as never);
    expect(createWorkspace).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('viewer');
    expect(layerIds()).toEqual(['layer-2']);
    expect(removeLayer.mock.calls).toEqual([['layer-1']]);
  });

  it('opening the same run again reuses it: no load, no duplicate', async () => {
    loadsLayer();
    await openRunInViewer(run);
    switchTo('bids');
    await openRunInViewer(run);
    expect(loadFile).toHaveBeenCalledTimes(1);
    expect(layerIds()).toEqual(['layer-1']);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('viewer');
    expect(setTimepoint).toHaveBeenCalledTimes(2);
  });

  it('keeps nothing from the view in front except a template, hidden under a native run', async () => {
    useLayerStore.setState({
      layers: [{ id: 'old', sourcePath: '/ds1/sub-02.nii.gz' }, { id: 'template', source: 'template' }] as never,
    });
    setLayers([viewLayer('old'), viewLayer('template')]);
    let duringLoad: unknown;
    loadsLayer(() => {
      duringLoad = view().layers.map((layer) => [layer.id, layer.visible]);
    });
    await openRunInViewer(run);
    // Hidden before the load: a visible layer under it would make it 50% opaque.
    expect(duringLoad).toEqual([['template', false], ['layer-1', true]]);
    expect(layerIds()).not.toContain('old');
    expect(view().layers.find((layer) => layer.id === 'layer-1')?.opacity).toBe(1);
    expect(removeLayer).not.toHaveBeenCalled();
  });

  it('never touches another tab or a layer the user opened there', async () => {
    addWorkspace('mine');
    useLayerStore.setState({ layers: [{ id: 'user', sourcePath: '/d/run.nii.gz' }] as never });
    switchTo('mine');
    setLayers([viewLayer('user')]);
    switchTo('bids');
    loadsLayer();
    await openRunInViewer(run);
    await openRunInViewer({ path: '/d/b.nii.gz', fd: null } as never);
    expect(view('mine').layers.map((layer) => layer.id)).toEqual(['user']);
    expect(removeLayer).not.toHaveBeenCalledWith('user');
  });

  it('keeps a run another view of the user still shows', async () => {
    loadsLayer();
    await openRunInViewer(run);
    addWorkspace('mine');
    switchTo('mine');
    setLayers([viewLayer('layer-1')]);
    await openRunInViewer({ path: '/d/b.nii.gz', fd: null } as never);
    expect(removeLayer).not.toHaveBeenCalled();
    expect(layerIds()).toEqual(['layer-2']);
  });

  it('a failed load gives the tab its run back', async () => {
    loadsLayer();
    await openRunInViewer(run);
    loadFile.mockReset();
    loadFile.mockResolvedValue(undefined);
    await openRunInViewer({ path: '/d/gone.nii.gz', fd: null } as never);
    expect(layerIds()).toEqual(['layer-1']);
    expect(removeLayer).not.toHaveBeenCalled();
  });

  describe('while a load is under way', () => {
    /** A load that waits for the test, then does what `loadsLayer` does. */
    const heldLoad = () => {
      let finish: () => void = () => undefined;
      let fail: (error: Error) => void = () => undefined;
      loadsLayer();
      const real = loadFile.getMockImplementation()!;
      loadFile.mockImplementationOnce(
        (...args: never[]) =>
          new Promise<void>((resolve, reject) => {
            finish = () => void Promise.resolve(real(...(args as [string, string, string, string]))).then(resolve);
            fail = reject;
          }),
      );
      return { finish: () => finish(), fail: (error: Error) => fail(error) };
    };
    const next = { path: '/d/next.nii.gz', fd: null } as never;
    const started = (calls: number) => vi.waitFor(() => expect(loadFile).toHaveBeenCalledTimes(calls));

    it('takes the selection off the parked run, so plot and Scene stop describing it', async () => {
      loadsLayer();
      await openRunInViewer(run);
      expect(useLayerStore.getState().selectedLayerId).toBe('layer-1');
      const load = heldLoad();
      const open = openRunInViewer(next);
      await started(2);
      expect(useLayerStore.getState().selectedLayerId).toBeNull();
      expect(useInspectorSelectionStore.getState().activeItemId).toBeNull();
      load.finish();
      await open;
      expect(useLayerStore.getState().selectedLayerId).toBe('layer-2');
    });

    it('a rejected load restores the tab whole: order, hidden layers, selection', async () => {
      loadsLayer();
      useLayerStore.setState({
        layers: [{ id: 'template', source: 'template' }, { id: 'mine', sourcePath: '/d/mine.nii.gz' }] as never,
      });
      await openRunInViewer(run);
      setLayers([viewLayer('mine', false), viewLayer('layer-1'), viewLayer('template')], 'viewer');
      const load = heldLoad();
      const open = openRunInViewer(next);
      await started(2);
      expect(layerIds()).toEqual(['mine', 'template']);
      expect(view().layers.every((layer) => !layer.visible)).toBe(true);
      load.fail(new Error('read failed'));
      await expect(open).rejects.toThrow('read failed');
      expect(view().layers.map((layer) => [layer.id, layer.visible])).toEqual([
        ['mine', false],
        ['layer-1', true],
        ['template', true],
      ]);
      expect(useLayerStore.getState().selectedLayerId).toBe('layer-1');
      expect(useInspectorSelectionStore.getState().activeItemId).toBe('layer-1');
      expect(removeLayer).not.toHaveBeenCalled();
    });

    it('a load that yields nothing restores it the same way, and keeps a layer added meanwhile', async () => {
      loadsLayer();
      useLayerStore.setState({ layers: [{ id: 'template', source: 'template' }] as never });
      await openRunInViewer(run);
      setLayers([viewLayer('layer-1'), viewLayer('template', false)], 'viewer');
      loadFile.mockImplementationOnce(async () => {
        useViewStateStore.getState().setViewState((state) => {
          state.layers.push(viewLayer('added') as never);
        }, 'viewer');
      });
      await openRunInViewer(next);
      expect(view().layers.map((layer) => [layer.id, layer.visible])).toEqual([
        ['layer-1', true],
        ['template', false],
        ['added', true],
      ]);
    });

    it('a selection the user made meanwhile is not taken back', async () => {
      loadsLayer();
      await openRunInViewer(run);
      const load = heldLoad();
      const open = openRunInViewer(next);
      await started(2);
      useLayerStore.setState({ selectedLayerId: 'elsewhere' });
      load.fail(new Error('read failed'));
      await expect(open).rejects.toThrow();
      expect(useLayerStore.getState().selectedLayerId).toBe('elsewhere');
    });

    it('frees a run whose tab closed after it was committed, and the one before it', async () => {
      removesLayer();
      loadsLayer();
      await openRunInViewer(run);
      loadsLayer(() => closeTab());
      await openRunInViewer(next);
      expect(removeLayer.mock.calls.map(([id]) => id).sort()).toEqual(['layer-1', 'layer-2']);
      expect(useLayerStore.getState().layers).toEqual([]);
    });

    it('frees a new run when the tab closes before the load commits, and the next open starts clean', async () => {
      removesLayer();
      loadsLayer();
      await openRunInViewer(run);
      const load = heldLoad();
      const open = openRunInViewer(next);
      await started(2);
      closeTab();
      await vi.waitFor(() => expect(removeLayer).toHaveBeenCalledWith('layer-1'));
      load.finish();
      await open;
      expect(removeLayer).toHaveBeenCalledWith('layer-2');
      loadsLayer();
      await openRunInViewer(run);
      expect(createWorkspace).toHaveBeenCalledTimes(2);
      expect(useLayerStore.getState().layers.map((layer) => layer.id)).toEqual(['layer-3']);
    });
  });

  describe('the first window', () => {
    const frameDuringLoad = async (target: object) => {
      let frame: number | undefined;
      loadsLayer(() => {
        frame = landingFrameOf((target as { path: string }).path);
      });
      await openRunInViewer(target as never);
      return frame;
    };

    it('is read from the frame the run lands on, and the hint ends with the load', async () => {
      const target = { path: '/d/a.nii.gz', fd: { peak_volume: 149, first_valid_volume: 4 } };
      expect(await frameDuringLoad(target)).toBe(149);
      expect(landingFrameOf(target.path)).toBeUndefined();
    });

    it('never from a bright startup volume, even when the run lands on one', async () => {
      expect(await frameDuringLoad({ path: '/d/b.nii.gz', fd: { peak_volume: 1, first_valid_volume: 4 } })).toBe(4);
    });

    it('has no hint for a run without FD, nor after a failed load', async () => {
      expect(await frameDuringLoad({ path: '/d/c.nii.gz', fd: null })).toBeUndefined();
      loadFile.mockRejectedValueOnce(new Error('gone'));
      const target = { path: '/d/d.nii.gz', fd: { peak_volume: 3, first_valid_volume: 0 } };
      await expect(openRunInViewer(target as never)).rejects.toThrow('gone');
      expect(landingFrameOf(target.path)).toBeUndefined();
    });
  });

  it('frees the run when the tab is closed while idle, without waiting for another open', async () => {
    removesLayer();
    loadsLayer();
    await openRunInViewer(run);
    closeTab();
    await vi.waitFor(() => expect(removeLayer).toHaveBeenCalledWith('layer-1'));
    expect(useLayerStore.getState().layers).toEqual([]);
  });

  it('a closed tab keeps a run another view of the user shows', async () => {
    removesLayer();
    loadsLayer();
    await openRunInViewer(run);
    switchTo('mine');
    setLayers([viewLayer('layer-1')]);
    closeTab();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(removeLayer).not.toHaveBeenCalled();
  });

  it('makes a new tab when the user closed the old one, and frees its run', async () => {
    loadsLayer();
    await openRunInViewer(run);
    useWorkspaceStore.setState((state) => {
      const workspaces = new Map(state.workspaces);
      workspaces.delete('viewer');
      return { workspaces, activeWorkspaceId: 'bids' };
    });
    await openRunInViewer({ path: '/d/b.nii.gz', fd: null } as never);
    expect(createWorkspace).toHaveBeenCalledTimes(2);
    expect(removeLayer).toHaveBeenCalledWith('layer-1');
  });

  it('keeps away from a workspace the user moved to during the load', async () => {
    loadsLayer(() => switchTo('another'));
    await openRunInViewer(run);
    expect(setTimepoint).not.toHaveBeenCalled();
  });

  it('does not touch the time when nothing opened', async () => {
    loadFile.mockResolvedValue(undefined);
    await openRunInViewer(run);
    expect(setTimepoint).not.toHaveBeenCalled();
  });

  it('lets the latest open win: skips those between, drops the one under way', async () => {
    let finishFirst: () => void = () => undefined;
    loadsLayer();
    const real = loadFile.getMockImplementation()!;
    loadFile.mockImplementationOnce(
      (...args: never[]) =>
        new Promise<void>((resolve) => {
          finishFirst = () => void Promise.resolve(real(...(args as [string, string, string, string]))).then(resolve);
        }),
    );
    // The real removal takes the layer out of every view.
    removeLayer.mockImplementationOnce(async (...[id]: unknown[]) =>
      setLayers(view().layers.filter((layer) => layer.id !== id), 'viewer'),
    );
    const first = openRunInViewer(run);
    await vi.waitFor(() => expect(loadFile).toHaveBeenCalledTimes(1));
    const skipped = openRunInViewer({ path: '/d/skip.nii.gz', fd: { peak_volume: 1 } } as never);
    const last = openRunInViewer({ path: '/d/b.nii.gz', fd: { peak_volume: 7 } } as never);
    finishFirst();
    await Promise.all([first, skipped, last]);
    expect(loadFile.mock.calls.map((call) => call[0])).toEqual(['/d/run.nii.gz', '/d/b.nii.gz']);
    expect(setTimepoint.mock.calls).toEqual([[7]]);
    expect(removeLayer.mock.calls).toEqual([['layer-1']]);
    expect(layerIds()).toEqual(['layer-2']);
  });

  it('skips the peak for a run with no FD', async () => {
    loadsLayer();
    await openRunInViewer({ path: '/d/t1.nii.gz', fd: null } as never);
    expect(setTimepoint).not.toHaveBeenCalled();
  });

  describe('events track', () => {
    const task = {
      id: 'sub-01_task-a_bold',
      path: '/d/task.nii.gz',
      fd: { peak_volume: 3 },
      has_events: true,
    } as never;
    const events = [{ onset: 1, duration: 2, trial_type: 'go', additional: {} }];
    let invoke: ReturnType<typeof vi.fn>;

    const openWithLayer = () => {
      nextLayer = 0;
      loadsLayer();
    };

    beforeEach(() => {
      invoke = vi.fn().mockResolvedValue(events);
      setTransport({ invoke } as never);
      useBidsStore.setState({ datasetPath: '/d', eventsCache: new Map() });
    });

    it('publishes the events on the new layer after landing on the peak', async () => {
      openWithLayer();
      await openRunInViewer(task);
      expect(setTimepoint).toHaveBeenCalledWith(3);
      expect(invoke).toHaveBeenCalledWith('get_bids_run_events', {
        datasetPath: '/d',
        runId: 'sub-01_task-a_bold',
      });
      expect(useTimeEventsStore.getState().tracks['layer-1'].events).toEqual(events);
    });

    it('shows a native-space run alone, selected, with its time series', async () => {
      useLayerStore.setState({ layers: [{ id: 'template', source: 'template' }] as never });
      setLayers([viewLayer('template')]);
      openWithLayer();
      await openRunInViewer(task);
      const layers = view().layers;
      expect(layers.find((layer) => layer.id === 'template')?.visible).toBe(false);
      expect(layers.find((layer) => layer.id === 'layer-1')?.visible).toBe(true);
      expect(reorderLayers).toHaveBeenCalledWith(['layer-1', 'template'], 'viewer');
      expect(useLayerStore.getState().selectedLayerId).toBe('layer-1');
    });

    it('applies to the tab of the load when the user has left it', async () => {
      useLayerStore.setState({ layers: [{ id: 'template', source: 'template' }] as never });
      setLayers([viewLayer('template')]);
      loadsLayer(() => switchTo('another'));
      await openRunInViewer(task);
      const layers = view().layers;
      expect(layers.find((layer) => layer.id === 'template')?.visible).toBe(false);
      expect(layers.find((layer) => layer.id === 'layer-1')?.visible).toBe(true);
      expect(reorderLayers).toHaveBeenCalledWith(['layer-1', 'template'], 'viewer');
      expect(setTimepoint).not.toHaveBeenCalled();
    });

    it('leaves a run in a template space on its template', async () => {
      useLayerStore.setState({ layers: [{ id: 'template', source: 'template' }] as never });
      setLayers([viewLayer('template')]);
      openWithLayer();
      await openRunInViewer({ ...(task as object), id: 'sub-01_task-a_space-MNI152NLin2009cAsym_bold' } as never);
      expect(view().layers[0]).toMatchObject({ id: 'template', visible: true });
      expect(reorderLayers).not.toHaveBeenCalled();
    });

    it('publishes flagged volumes for the time series, even without events', async () => {
      openWithLayer();
      await openRunInViewer({ path: '/d/rest.nii.gz', fd: { peak_volume: 3, non_steady_volumes: [0] } } as never);
      expect(useTimeEventsStore.getState().tracks['layer-1']).toMatchObject({ events: [], nonSteadyVolumes: [0] });
    });

    it('clears the track with its layer', async () => {
      openWithLayer();
      await openRunInViewer(task);
      getEventBus().emit('layer.removed', { layerId: 'layer-1' });
      expect(useTimeEventsStore.getState().tracks).toEqual({});
    });

    it('drops events that arrive after the user moved on', async () => {
      openWithLayer();
      let finish: (rows: typeof events) => void = () => undefined;
      invoke.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      const open = openRunInViewer(task);
      await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
      switchTo('another');
      finish(events);
      await open;
      expect(useTimeEventsStore.getState().tracks).toEqual({});
    });

    it('reads the events of the dataset the run was opened from, after a switch mid-load', async () => {
      invoke.mockImplementation(async (_cmd: string, args: { datasetPath: string }) => [
        { onset: 1, duration: 2, trial_type: args.datasetPath, additional: {} },
      ]);
      let finish: () => void = () => undefined;
      openWithLayer();
      const real = loadFile.getMockImplementation()!;
      loadFile.mockImplementationOnce(
        (...args: never[]) =>
          new Promise<void>((resolve) => {
            finish = () => void Promise.resolve(real(...(args as [string, string, string, string]))).then(resolve);
          }),
      );
      const open = openRunInViewer(task);
      await vi.waitFor(() => expect(loadFile).toHaveBeenCalled());
      // The other dataset has a run of the same id.
      useBidsStore.setState({ datasetPath: '/other', eventsCache: new Map() });
      finish();
      await open;
      expect(invoke.mock.calls[0][1]).toEqual({ datasetPath: '/d', runId: 'sub-01_task-a_bold' });
      expect(useTimeEventsStore.getState().tracks['layer-1'].events[0].trial_type).toBe('/d');
      const theirs = await useBidsStore.getState().loadRunEvents('sub-01_task-a_bold');
      expect(theirs[0].trial_type).toBe('/other');
    });

    it('skips a run without events, and a failed read costs only the track', async () => {
      openWithLayer();
      await openRunInViewer({ path: '/d/other.nii.gz', fd: null } as never);
      expect(invoke).not.toHaveBeenCalled();
      switchTo('bids');
      invoke.mockRejectedValue(new Error('gone'));
      const notified = vi.fn();
      const stop = getEventBus().on('ui.notification', notified);
      await openRunInViewer(task);
      stop();
      expect(notified.mock.calls[0][0].message).toContain('Events not loaded: gone');
      expect(setTimepoint).toHaveBeenCalledWith(3);
    });
  });
});
