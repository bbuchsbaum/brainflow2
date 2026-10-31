import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockToggle, mockReorder, mockRemove, mockLoadFile } = vi.hoisted(() => ({
  mockToggle: vi.fn(),
  mockReorder: vi.fn(),
  mockRemove: vi.fn(),
  mockLoadFile: vi.fn(),
}));

vi.mock('@/services/LayerService', () => ({
  getLayerService: () => ({
    toggleVisibility: mockToggle,
    reorderLayers: mockReorder,
    removeLayer: mockRemove,
  }),
}));
vi.mock('../FileLoadingService', () => ({
  getFileLoadingService: () => ({ loadFile: mockLoadFile }),
}));

import {
  COALESCE_MS,
  HISTORY_LIMIT,
  SceneHistoryService,
  isTextEditingElement,
} from '../SceneHistoryService';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore, type LayerInfo } from '@/stores/layerStore';
import { getEventBus } from '@/events/EventBus';
import type { ViewLayer, ViewState } from '@/types/viewState';
import type { Layer } from '@/types/layers';

const viewLayer = (id: string, extra: Partial<ViewLayer> = {}): ViewLayer => ({
  id,
  name: id,
  volumeId: id,
  visible: true,
  opacity: 1,
  colormap: 'gray',
  intensity: [0, 100],
  threshold: [0, 0],
  ...extra,
});

const layerInfo = (id: string, extra: Partial<LayerInfo> = {}): LayerInfo =>
  ({
    id,
    name: id,
    volumeId: id,
    type: 'anatomical',
    visible: true,
    order: 0,
    source: 'file',
    sourcePath: `/data/${id}.nii.gz`,
    ...extra,
  }) as LayerInfo;

function seed(workspaces: Record<string, ViewLayer[]>, active: string): void {
  const base = useViewStateStore.getState().viewState;
  const states = new Map<string, ViewState>(
    Object.entries(workspaces).map(([id, layers]) => [id, { ...base, layers }]),
  );
  useViewStateStore.setState({
    workspaceViewStates: states,
    activeWorkspaceKey: active,
    viewState: states.get(active)!,
  });
}

const layersOf = (ws: string) => useViewStateStore.getState().workspaceViewStates.get(ws)!.layers;
const field = (ws: string, id: string) => layersOf(ws).find((l) => l.id === id)!;

function setOpacity(id: string, opacity: number, ws?: string) {
  useViewStateStore.getState().setViewState((draft) => {
    const target = draft.layers.find((l) => l.id === id);
    if (target) target.opacity = opacity;
  }, ws);
}

describe('SceneHistoryService', () => {
  let clock = 1000;
  let history: SceneHistoryService;
  let stop: () => void;

  beforeEach(() => {
    clock = 1000;
    history = new SceneHistoryService({ now: () => clock });
    stop = history.start();
    mockToggle.mockReset().mockImplementation((id: string, visible: boolean) => {
      useViewStateStore.getState().setViewState((draft) => {
        const target = draft.layers.find((l) => l.id === id);
        if (target) target.visible = visible;
      });
    });
    mockReorder.mockReset().mockImplementation(async (ids: string[]) => {
      const byId = new Map(useLayerStore.getState().layers.map((l) => [l.id, l]));
      useLayerStore.getState().reorderLayers(ids.map((id) => byId.get(id)!).filter(Boolean));
    });
    mockRemove.mockReset();
    mockLoadFile.mockReset();
    useLayerStore.getState().clearLayers();
    ['t1', 'z'].forEach((id) => useLayerStore.getState().addLayer(layerInfo(id)));
    seed(
      { ws1: [viewLayer('t1'), viewLayer('z', { colormap: 'fmri' })], ws2: [viewLayer('t1')] },
      'ws1',
    );
  });

  afterEach(() => stop());

  it('undoes and redoes a display edit', async () => {
    history.record('opacity:z', 'Opacity', () => setOpacity('z', 0.4));
    expect(field('ws1', 'z').opacity).toBe(0.4);
    await expect(history.undo()).resolves.toBe(true);
    expect(field('ws1', 'z').opacity).toBe(1);
    await expect(history.redo()).resolves.toBe(true);
    expect(field('ws1', 'z').opacity).toBe(0.4);
    await expect(history.redo()).resolves.toBe(false);
  });

  it('records only what changed, and nothing for a no-op edit', () => {
    history.record('opacity:z', 'Opacity', () => setOpacity('z', 1));
    expect(history.canUndo()).toBe(false);
    history.record('colormap:z', 'Colormap', () =>
      useViewStateStore.getState().setViewState((d) => {
        d.layers[1].colormap = 'hot';
      }),
    );
    const [step] = history.steps().undo;
    expect(step).toMatchObject({
      kind: 'display',
      changes: [{ layerId: 'z', before: { colormap: 'fmri' }, after: { colormap: 'hot' } }],
    });
  });

  it('coalesces a pointer drag into one step, and starts a new one with the next drag', async () => {
    window.dispatchEvent(new Event('pointerdown'));
    for (const v of [0.9, 0.7, 0.5]) {
      clock += 2000; // a slow drag: still one step while the pointer is held
      history.record('opacity:z', 'Opacity', () => setOpacity('z', v));
    }
    window.dispatchEvent(new Event('pointerup'));
    expect(history.steps().undo).toHaveLength(1);
    window.dispatchEvent(new Event('pointerdown'));
    history.record('opacity:z', 'Opacity', () => setOpacity('z', 0.2));
    window.dispatchEvent(new Event('pointerup'));
    expect(history.steps().undo).toHaveLength(2);
    await history.undo();
    expect(field('ws1', 'z').opacity).toBe(0.5);
    await history.undo();
    expect(field('ws1', 'z').opacity).toBe(1);
  });

  it('coalesces keyboard steps only while they follow each other closely', () => {
    history.record('opacity:z', 'Opacity', () => setOpacity('z', 0.9));
    clock += COALESCE_MS / 2;
    history.record('opacity:z', 'Opacity', () => setOpacity('z', 0.8));
    expect(history.steps().undo).toHaveLength(1);
    clock += COALESCE_MS * 2;
    history.record('opacity:z', 'Opacity', () => setOpacity('z', 0.7));
    expect(history.steps().undo).toHaveLength(2);
    // Another control is another step.
    history.record('opacity:t1', 'Opacity', () => setOpacity('t1', 0.5));
    expect(history.steps().undo).toHaveLength(3);
  });

  it('drops a drag that ends where it started', () => {
    window.dispatchEvent(new Event('pointerdown'));
    history.record('opacity:z', 'Opacity', () => setOpacity('z', 0.3));
    history.record('opacity:z', 'Opacity', () => setOpacity('z', 1));
    window.dispatchEvent(new Event('pointerup'));
    expect(history.canUndo()).toBe(false);
  });

  it('keeps a history per workspace, capped, and clears it when the workspace closes', async () => {
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
      clock += 10_000;
      history.record('opacity:z', 'Opacity', () => setOpacity('z', i / 100));
    }
    expect(history.steps('ws1').undo).toHaveLength(HISTORY_LIMIT);
    seed({ ws1: layersOf('ws1'), ws2: layersOf('ws2') }, 'ws2');
    expect(history.canUndo()).toBe(false);
    await expect(history.undo()).resolves.toBe(false);
    // Closing ws1 forgets its steps.
    const states = new Map(useViewStateStore.getState().workspaceViewStates);
    states.delete('ws1');
    useViewStateStore.setState({ workspaceViewStates: states });
    expect(history.canUndo('ws1')).toBe(false);
  });

  it('starts a fresh redo branch after a new edit', async () => {
    history.record('opacity:z', 'Opacity', () => setOpacity('z', 0.5));
    await history.undo();
    expect(history.canRedo()).toBe(true);
    history.record('colormap:z', 'Colormap', () =>
      useViewStateStore.getState().setViewState((d) => {
        d.layers[1].colormap = 'hot';
      }),
    );
    expect(history.canRedo()).toBe(false);
  });

  it('undoes visibility through the layer service (GPU residency follows)', async () => {
    history.record('visible:z', 'Visibility', () => mockToggle('z', false));
    mockToggle.mockClear();
    await history.undo();
    expect(mockToggle).toHaveBeenCalledWith('z', true);
    expect(field('ws1', 'z').visible).toBe(true);
  });

  it('skips steps whose layers are gone', async () => {
    history.record('opacity:t1', 'Opacity', () => setOpacity('t1', 0.2));
    clock += 10_000;
    history.record('opacity:z', 'Opacity', () => setOpacity('z', 0.4));
    // z removed by a path that is not undoable (a Studio action, a set swap).
    useViewStateStore.getState().setViewState((d) => {
      d.layers = d.layers.filter((l) => l.id !== 'z');
    });
    await expect(history.undo()).resolves.toBe(true);
    expect(field('ws1', 't1').opacity).toBe(1);
  });

  it('does not record edits made while a step is applied', async () => {
    history.record('opacity:z', 'Opacity', () => setOpacity('z', 0.5));
    await history.undo();
    expect(history.steps().undo).toHaveLength(0);
    expect(history.steps().redo).toHaveLength(1);
  });

  it('undoes a reorder and the userMoved flag', async () => {
    await history.recordOrder(['z', 't1'], 'z', async () => {
      await mockReorder(['z', 't1']);
      useLayerStore.getState().updateLayer('z', { userMoved: true });
    });
    expect(useLayerStore.getState().layers.map((l) => l.id)).toEqual(['z', 't1']);
    await history.undo();
    expect(useLayerStore.getState().layers.map((l) => l.id)).toEqual(['t1', 'z']);
    expect(useLayerStore.getState().getLayer('z')?.userMoved).toBe(false);
    await history.redo();
    expect(useLayerStore.getState().layers.map((l) => l.id)).toEqual(['z', 't1']);
    expect(useLayerStore.getState().getLayer('z')?.userMoved).toBe(true);
  });

  it("undoes a Compare panel's own override (unlinked, panel scope; review M4)", async () => {
    const { useComparisonStore } = await import('@/stores/comparisonStore');
    const panels = new Map(useComparisonStore.getState().panels);
    panels.set('ws1', [
      { id: 'pA', layerIds: ['z'] },
      { id: 'pB', layerIds: ['z'] },
    ] as never);
    useComparisonStore.setState({ panels });
    const setOverride = (opacityLike: [number, number]) =>
      useComparisonStore.getState().setPanelOverride('ws1', 'pA', 'z', 'intensity', opacityLike as never);
    history.record('intensity:z@pA', 'intensity', () => setOverride([1, 5]));
    clock += 10_000;
    history.record('intensity:z@pA', 'intensity', () => setOverride([2, 6]));
    const pA = () => useComparisonStore.getState().panels.get('ws1')!.find((p) => p.id === 'pA')!;
    expect(pA().renderOverrides?.z).toEqual({ intensity: [2, 6] });
    // The shared layer is untouched, and ⌘Z undoes the override, not an older shared edit.
    await history.undo();
    expect(pA().renderOverrides?.z).toEqual({ intensity: [1, 5] });
    await history.undo();
    expect(pA().renderOverrides?.z).toBeUndefined();
    await history.redo();
    expect(pA().renderOverrides?.z).toEqual({ intensity: [1, 5] });
    expect(field('ws1', 'z').intensity).toEqual([0, 100]);
    panels.delete('ws1');
    useComparisonStore.setState({ panels: new Map(panels) });
  });

  describe('removal', () => {
    /** The load path: a new volume id, committed to the workspace, `layer.added` emitted. */
    function reopenAs(newId: string) {
      mockLoadFile.mockImplementation(
        async (path: string, _ingress: string, _intent: string, ws: string) => {
          if (!useViewStateStore.getState().workspaceViewStates.has(ws)) return;
          const info = layerInfo(newId, { sourcePath: path });
          useLayerStore.getState().addLayer(info);
          useViewStateStore.getState().setViewState((d) => {
            d.layers.push(viewLayer(newId));
          }, ws);
          getEventBus().emit('layer.added', { layer: info as Layer });
        },
      );
    }

    function removeZ(): void {
      const saved = history.captureRemoval('z');
      expect(saved).not.toBeNull();
      useLayerStore.getState().removeLayer('z');
      useViewStateStore.getState().setViewState((d) => {
        d.layers = d.layers.filter((l) => l.id !== 'z');
      });
      history.commitRemoval('z', saved!);
    }

    it('reopens the source with its display settings and stack position', async () => {
      useLayerStore
        .getState()
        .addLayer(layerInfo('atlas', { source: 'atlas', sourcePath: 'atlas:x' }));
      useViewStateStore.getState().setViewState((d) => {
        d.layers.push(viewLayer('atlas'));
        d.layers[1].opacity = 0.6;
        d.layers[1].threshold = [-3.1, 3.1];
      });
      removeZ();
      reopenAs('z2');
      await expect(history.undo()).resolves.toBe(true);
      expect(mockLoadFile).toHaveBeenCalledWith(
        '/data/z.nii.gz',
        'programmatic',
        'add-layer',
        'ws1',
      );
      expect(useLayerStore.getState().layers.map((l) => l.id)).toEqual(['t1', 'z2', 'atlas']);
      expect(field('ws1', 'z2')).toMatchObject({
        opacity: 0.6,
        colormap: 'fmri',
        threshold: [-3.1, 3.1],
      });
      // Redo removes the reopened copy again.
      mockRemove.mockImplementation(async (id: string) => useLayerStore.getState().removeLayer(id));
      await expect(history.redo()).resolves.toBe(true);
      expect(mockRemove).toHaveBeenCalledWith('z2');
      expect(history.steps().undo.at(-1)).toMatchObject({ kind: 'removal', layerId: 'z2' });
    });

    it('keeps the restored display from the histogram refinement', async () => {
      const { isLayerDisplayPreserved } = await import('../restoredDisplay');
      removeZ();
      reopenAs('z3');
      await history.undo();
      expect(isLayerDisplayPreserved('z3')).toBe(true);
    });

    it('ignores the same file loaded into another workspace meanwhile (review)', async () => {
      removeZ();
      mockLoadFile.mockImplementation(async (path: string, _i: string, _t: string, ws: string) => {
        // Another view opens the same file first: not this request's layer.
        const other = layerInfo('elsewhere', { sourcePath: path });
        useLayerStore.getState().addLayer(other);
        useViewStateStore.getState().setViewState((d) => {
          d.layers.push(viewLayer('elsewhere'));
        }, 'ws2');
        getEventBus().emit('layer.added', { layer: other as Layer });
        const mine = layerInfo('z4', { sourcePath: path });
        useLayerStore.getState().addLayer(mine);
        useViewStateStore.getState().setViewState((d) => {
          d.layers.push(viewLayer('z4'));
        }, ws);
        getEventBus().emit('layer.added', { layer: mine as Layer });
      });
      await history.undo();
      expect(field('ws1', 'z4').colormap).toBe('fmri');
      expect(history.steps().redo.at(-1)).toMatchObject({ kind: 'removal', layerId: 'z4' });
    });

    it('says "Restoring…" for ⌘Z while the reopen is loading', async () => {
      const { getSceneHistory, runEditCommand } = await import('../SceneHistoryService');
      const shared = getSceneHistory();
      const emit = vi.spyOn(getEventBus(), 'emit');
      const saved = shared.captureRemoval('z')!;
      useLayerStore.getState().removeLayer('z');
      useViewStateStore.getState().setViewState((d) => {
        d.layers = d.layers.filter((l) => l.id !== 'z');
      });
      shared.commitRemoval('z', saved);
      let finish!: () => void;
      mockLoadFile.mockImplementation(() => new Promise<void>((r) => (finish = r)));
      const pending = shared.undo();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      expect(shared.restoringName()).toBe('z');
      runEditCommand('undo', 'menu');
      expect(emit).toHaveBeenCalledWith('ui.notification', expect.objectContaining({ message: 'Restoring z…' }));
      finish();
      await pending;
      expect(shared.restoringName()).toBeNull();
      emit.mockRestore();
      shared.clear();
    });

    it('carries earlier steps over to the reopened layer', async () => {
      history.record('opacity:z', 'Opacity', () => setOpacity('z', 0.3));
      removeZ();
      reopenAs('z2');
      await history.undo();
      await history.undo();
      expect(field('ws1', 'z2').opacity).toBe(1);
    });

    it('drops the undo when the workspace closed during the reload', async () => {
      removeZ();
      mockLoadFile.mockImplementation(async () => {
        const states = new Map(useViewStateStore.getState().workspaceViewStates);
        states.delete('ws1');
        useViewStateStore.setState({ workspaceViewStates: states, activeWorkspaceKey: 'ws2' });
      });
      await history.undo();
      expect(useLayerStore.getState().getLayer('z')).toBeUndefined();
      expect(history.canUndo('ws1')).toBe(false);
      expect(history.canRedo('ws1')).toBe(false);
    });

    it('is not offered for an atlas or an image-set member', () => {
      useLayerStore
        .getState()
        .addLayer(layerInfo('atlas', { source: 'atlas', sourcePath: 'atlas:x' }));
      useLayerStore.getState().addLayer(layerInfo('m1', { imageSetId: 'set' }));
      useViewStateStore.getState().setViewState((d) => {
        d.layers.push(viewLayer('atlas'), viewLayer('m1'));
      });
      expect(history.captureRemoval('atlas')).toBeNull();
      expect(history.captureRemoval('m1')).toBeNull();
    });
  });
});

describe('isTextEditingElement', () => {
  it('is true for text fields only (a slider or select is the scene)', () => {
    const text = document.createElement('input');
    const range = document.createElement('input');
    range.type = 'range';
    const area = document.createElement('textarea');
    const select = document.createElement('select');
    expect(isTextEditingElement(text)).toBe(true);
    expect(isTextEditingElement(area)).toBe(true);
    expect(isTextEditingElement(range)).toBe(false);
    expect(isTextEditingElement(select)).toBe(false);
    expect(isTextEditingElement(null)).toBe(false);
  });
});

describe('runEditCommand', () => {
  it('runs the scene undo once for a key press and its menu echo', async () => {
    const { getSceneHistory, runEditCommand } = await import('../SceneHistoryService');
    const undo = vi.spyOn(getSceneHistory(), 'undo').mockResolvedValue(true);
    (document.activeElement as HTMLElement | null)?.blur?.();
    runEditCommand('undo', 'key');
    runEditCommand('undo', 'menu');
    expect(undo).toHaveBeenCalledTimes(1);
    // A menu command on its own (Edit › Undo clicked) runs.
    runEditCommand('undo', 'menu');
    expect(undo).toHaveBeenCalledTimes(2);
    undo.mockRestore();
  });

  it('matches each key press to one echo: ⌘Z ⌘Z then two menu echoes undo twice', async () => {
    const { getSceneHistory, runEditCommand } = await import('../SceneHistoryService');
    const undo = vi.spyOn(getSceneHistory(), 'undo').mockResolvedValue(true);
    (document.activeElement as HTMLElement | null)?.blur?.();
    runEditCommand('undo', 'key');
    runEditCommand('undo', 'key');
    runEditCommand('undo', 'menu');
    runEditCommand('undo', 'menu');
    expect(undo).toHaveBeenCalledTimes(2);
    // An echo is only an echo shortly after its press.
    vi.useFakeTimers();
    runEditCommand('undo', 'key');
    vi.advanceTimersByTime(500);
    runEditCommand('undo', 'menu');
    expect(undo).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
    undo.mockRestore();
  });

  it("leaves a focused text field's undo to the field", async () => {
    const { getSceneHistory, runEditCommand } = await import('../SceneHistoryService');
    const undo = vi.spyOn(getSceneHistory(), 'undo').mockResolvedValue(true);
    const exec = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    runEditCommand('undo', 'menu');
    expect(exec).toHaveBeenCalledWith('undo');
    expect(undo).not.toHaveBeenCalled();
    input.remove();
    undo.mockRestore();
  });
});
