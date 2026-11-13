/**
 * R5b: the demand each frame publishes (docs/plans/gpu-residency-r5-plan-2026-11.md),
 * on the real workspace, view-state and layer stores, and the residency store.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  protectedVolumes: new Set<string>(),
  pinned: new Set<string>(),
  maps: [] as { layerId: string; volumeId: string; borrowed?: boolean }[],
}));

vi.mock('@/services/workspaceDocuments', () => ({
  volumeDocumentRemovalReason: (id: string) => (h.protectedVolumes.has(id) ? 'Retained' : null),
  subscribeWorkspaceDocuments: () => () => {},
}));
vi.mock('@/services/studio/StudioDerivedMapService', () => ({
  getStudioDerivedMapService: () => ({
    pinnedLayerIds: () => h.pinned,
    heldMaps: () => h.maps,
    subscribe: () => () => {},
  }),
}));

import { MockTransport, getTransport } from '@/services/transport';
import {
  computeResidencyFrames,
  ResidencyDemandPublisher,
  STUDIO_PANES_FRAME,
} from '@/services/ResidencyDemandPublisher';
import { resetRenderLayerScope, setRenderLayerScope } from '@/services/render/RenderLayerScope';
import { useLayerStore } from '@/stores/layerStore';
import { useResidencyStore } from '@/stores/residencyStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { ResidencyReport } from '@brainflow/api';
import type { Workspace } from '@/types/workspace';

const TAB_A = 'orthogonal-1';
const TAB_B = 'mosaic-2';
const STUDIO = 'set-studio-3';

function workspace(id: string, type: string, timestamp: number): Workspace {
  return {
    id,
    type,
    title: id,
    timestamp,
    isActive: false,
    layoutConfig: { root: { type: 'row', content: [] } },
    panelStates: new Map(),
  } as unknown as Workspace;
}

function activate(id: string) {
  useWorkspaceStore.setState((state) => {
    const workspaces = new Map(state.workspaces);
    for (const [key, value] of workspaces) workspaces.set(key, { ...value, isActive: key === id });
    return { workspaces, activeWorkspaceId: id };
  });
}

type LayerSpec = { id: string; visible?: boolean; opacity?: number; volumeId?: string };

/** Replace a tab's scene; layers are bottom first. */
function scene(tab: string, layers: LayerSpec[]) {
  useViewStateStore.getState().setViewState((state) => {
    state.layers = layers.map(
      (layer) =>
        ({
          id: layer.id,
          volumeId: layer.volumeId ?? `vol-${layer.id}`,
          visible: layer.visible ?? true,
          opacity: layer.opacity ?? 1,
        }) as never,
    );
  }, tab);
}

function addLayer(id: string, layerKind?: string) {
  useLayerStore.getState().addLayer({
    id,
    name: id,
    volumeId: `vol-${id}`,
    type: 'anatomical',
    visible: true,
    order: 0,
    ...(layerKind ? { layerKind } : {}),
  } as never);
}

const ids = (frame: { layers: { layer_id: string }[] } | undefined) =>
  frame?.layers.map((layer) => layer.layer_id);

const mock = () => getTransport() as MockTransport;
const sent = (command: string) =>
  mock()
    .getCallLog()
    .filter((call) => call.cmd === command)
    .map((call) => call.args as Record<string, unknown>);

describe('ResidencyDemandPublisher', () => {
  beforeEach(() => {
    h.protectedVolumes = new Set();
    h.pinned = new Set();
    h.maps = [];
    resetRenderLayerScope();
    useLayerStore.setState({ layers: [], layerMetadata: new Map() } as never);
    const workspaces = new Map<string, Workspace>();
    workspaces.set(TAB_A, workspace(TAB_A, 'orthogonal-locked', 1));
    workspaces.set(TAB_B, workspace(TAB_B, 'mosaic', 2));
    workspaces.set(STUDIO, workspace(STUDIO, 'set-studio', 3));
    useWorkspaceStore.setState({ workspaces, activeWorkspaceId: null } as never);
    activate(TAB_B);
    activate(TAB_A);
    const views = useViewStateStore.getState();
    for (const key of views.workspaceViewStates.keys()) scene(key, []);
  });

  it('publishes_front_for_active_view_tab_background_for_others', () => {
    scene(TAB_A, [{ id: 'a1' }, { id: 'a2' }]);
    scene(TAB_B, [{ id: 'b1' }]);
    const frames = computeResidencyFrames();
    expect(frames.get(TAB_A)?.priority).toBe('front');
    expect(ids(frames.get(TAB_A))).toEqual(['a1', 'a2']);
    expect(frames.get(TAB_B)?.priority).toBe('background');
    expect(ids(frames.get(TAB_B))).toEqual(['b1']);
    expect(frames.get(TAB_A)?.layers[0]).toEqual({
      layer_id: 'a1',
      volume_id: 'vol-a1',
      pin: null,
    });

    activate(TAB_B);
    const switched = computeResidencyFrames();
    expect(switched.get(TAB_B)?.priority).toBe('front');
    expect(switched.get(TAB_A)?.priority).toBe('background');
  });

  it('tool_tab_in_front_publishes_no_front', () => {
    scene(TAB_A, [{ id: 'a1' }]);
    activate(STUDIO);
    // The Studio tab is seeded with a copy of the scene; it draws none of it.
    const frames = computeResidencyFrames();
    expect(frames.has(STUDIO)).toBe(false);
    expect([...frames.values()].some((frame) => frame.priority === 'front')).toBe(false);
    expect(frames.get(TAB_A)?.priority).toBe('background');

    // While it borrows the views for one member, that member is its Front.
    scene(STUDIO, [{ id: 'a1' }, { id: 'member' }]);
    setRenderLayerScope('studio-current', ['member']);
    const scoped = computeResidencyFrames();
    expect(scoped.get(STUDIO)?.priority).toBe('front');
    expect(ids(scoped.get(STUDIO))).toEqual(['member']);
  });

  it('seeded_tab_publishes_all_visible_in_stack_order', () => {
    const layers = Array.from({ length: 15 }, (_, i) => ({ id: `s${String(i).padStart(2, '0')}` }));
    scene(TAB_A, [
      ...layers.slice(0, 3),
      { id: 'hidden', visible: false },
      { id: 'clear', opacity: 0 },
      ...layers.slice(3),
    ]);
    const frame = computeResidencyFrames().get(TAB_A);
    // All 15 drawable layers, bottom first: the backend, not the publisher,
    // decides which 13 a draw can bind.
    expect(ids(frame)).toEqual(layers.map((layer) => layer.id));
    expect(frame?.held).toEqual([]);
  });

  it('closing_tab_clears_demand', () => {
    scene(TAB_A, [{ id: 'a1' }]);
    scene(TAB_B, [{ id: 'b1' }]);
    const publisher = new ResidencyDemandPublisher(getTransport, 0);
    publisher.flush();
    expect(
      sent('set_residency_demand')
        .map((args) => args.frameId)
        .sort(),
    ).toEqual([TAB_A, TAB_B].sort());
    const epochB = (
      sent('set_residency_demand').find((args) => args.frameId === TAB_B)?.demand as {
        epoch: number;
      }
    ).epoch;

    useWorkspaceStore.setState((state) => {
      const workspaces = new Map(state.workspaces);
      workspaces.delete(TAB_B);
      return { workspaces };
    });
    publisher.flush();
    const clears = sent('clear_residency_demand');
    expect(clears).toEqual([{ frameId: TAB_B, epoch: epochB + 1 }]);
    // Nothing changed for the open tab: it is not sent again.
    expect(sent('set_residency_demand')).toHaveLength(2);
  });

  it('studio_mount_publishes_pane_frame_with_pins', () => {
    scene(TAB_A, [{ id: 'template-layer' }, { id: 'a1' }]);
    h.pinned = new Set(['template-layer']);
    h.maps = [
      { layerId: 'template-layer', volumeId: 'vol-template-layer', borrowed: true },
      { layerId: 'studio-derived-1:zmap', volumeId: 'zmap' },
    ];
    activate(STUDIO);
    const frames = computeResidencyFrames();
    const panes = frames.get(STUDIO_PANES_FRAME);
    expect(panes?.priority).toBe('front');
    expect(panes?.layers).toEqual([
      { layer_id: 'template-layer', volume_id: 'vol-template-layer', pin: 'studio_pane' },
      { layer_id: 'studio-derived-1:zmap', volume_id: 'zmap', pin: 'studio_pane' },
    ]);
    // The borrowed underlay is pinned in the tab that owns it too.
    expect(frames.get(TAB_A)?.layers[0].pin).toBe('studio_pane');

    activate(TAB_A);
    expect(computeResidencyFrames().get(STUDIO_PANES_FRAME)?.priority).toBe('background');
    h.maps = [];
    expect(computeResidencyFrames().has(STUDIO_PANES_FRAME)).toBe(false);
  });

  it('segmentation_pins_reference_and_editable_layers', () => {
    addLayer('reference');
    addLayer('labels', 'segmentation.editable-label');
    addLayer('frame-2');
    h.protectedVolumes = new Set(['vol-reference', 'vol-frame-2']);
    scene(TAB_A, [
      { id: 'reference' },
      { id: 'frame-2', visible: false },
      { id: 'labels', visible: false },
      { id: 'plain', visible: false },
    ]);
    const frame = computeResidencyFrames().get(TAB_A);
    expect(frame?.layers).toEqual([
      { layer_id: 'reference', volume_id: 'vol-reference', pin: 'segmentation_session' },
    ]);
    // Hidden pinned layers are held, not drawn; a hidden plain layer is neither.
    expect(frame?.held).toEqual([
      { layer_id: 'frame-2', volume_id: 'vol-frame-2', pin: 'segmentation_session' },
      { layer_id: 'labels', volume_id: 'vol-labels', pin: 'editable_document' },
    ]);
  });

  it('publisher_never_sends_slot_fields', () => {
    addLayer('labels', 'segmentation.editable-label');
    scene(TAB_A, [{ id: 'a1' }, { id: 'labels' }]);
    scene(TAB_B, [{ id: 'b1' }]);
    new ResidencyDemandPublisher(getTransport, 0).flush();
    const keys = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          keys.add(key);
          walk(child);
        }
      }
    };
    sent('set_residency_demand').forEach(walk);
    expect(keys.size).toBeGreaterThan(0);
    for (const key of keys) expect(key).not.toMatch(/slot|index|binding|texture|generation/i);
  });

  it('sends a frame again only when its demand changed, with a newer epoch', () => {
    scene(TAB_A, [{ id: 'a1' }]);
    const publisher = new ResidencyDemandPublisher(getTransport, 0);
    publisher.flush();
    publisher.flush();
    expect(sent('set_residency_demand').filter((args) => args.frameId === TAB_A)).toHaveLength(1);
    scene(TAB_A, [{ id: 'a1' }, { id: 'a2' }]);
    publisher.flush();
    const epochs = sent('set_residency_demand')
      .filter((args) => args.frameId === TAB_A)
      .map((args) => (args.demand as { epoch: number }).epoch);
    expect(epochs).toHaveLength(2);
    expect(epochs[1]).toBe(epochs[0] + 1);
  });

  it('publishes within the settle window of the first change, however often stores change', () => {
    vi.useFakeTimers();
    try {
      scene(TAB_A, [{ id: 'a1' }]);
      const publisher = new ResidencyDemandPublisher(getTransport, 16);
      const tabA = () => sent('set_residency_demand').filter((args) => args.frameId === TAB_A);
      // A store changing every 5 ms (an upload storm) must not hold demand back.
      for (let elapsed = 0; elapsed < 15; elapsed += 5) {
        publisher.schedule();
        vi.advanceTimersByTime(5);
      }
      expect(tabA()).toHaveLength(0);
      publisher.schedule();
      vi.advanceTimersByTime(1);
      expect(tabA()).toHaveLength(1);
      publisher.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts epochs above any an earlier session sent, and clears its leftover frames', () => {
    scene(TAB_A, [{ id: 'a1' }]);
    const before = Date.now() * 1000;
    const publisher = new ResidencyDemandPublisher(getTransport, 0);
    publisher.flush();
    const first = sent('set_residency_demand').find((args) => args.frameId === TAB_A);
    expect((first?.demand as { epoch: number }).epoch).toBeGreaterThan(before);

    // The backend still holds frames from before a webview reload.
    publisher.clearUnknownFrames({
      seq: 1,
      budget_bytes: null,
      used_bytes: 0,
      binding_capacity: 13,
      undemanded_bytes: 0,
      layers: [
        {
          layer_id: 'a1',
          state: 'resident',
          bytes: 1,
          frames: [TAB_A, 'orthogonal-gone'],
          refusal: null,
        },
        { layer_id: 'old', state: 'resident', bytes: 1, frames: ['studio-panes'], refusal: null },
      ],
    });
    const cleared = sent('clear_residency_demand')
      .map((args) => args.frameId)
      .sort();
    expect(cleared).toEqual(['orthogonal-gone', 'studio-panes']);
    for (const args of sent('clear_residency_demand')) {
      expect(args.epoch as number).toBeGreaterThan(before);
    }
  });
});

describe('residencyStore', () => {
  const report = (seq: number): ResidencyReport => ({
    seq,
    budget_bytes: 100,
    used_bytes: 0,
    binding_capacity: 13,
    undemanded_bytes: 0,
    layers: [],
  });

  beforeEach(() => {
    useResidencyStore.setState({ report: null });
  });

  it('store_drops_older_seq_and_refetches_on_gap', async () => {
    const fetched = vi.fn(() => report(9));
    mock().setMockResponse('get_residency_state', fetched);
    const store = useResidencyStore.getState();
    store.apply(report(3));
    store.apply(report(4));
    store.apply(report(2));
    store.apply(report(4));
    expect(useResidencyStore.getState().report?.seq).toBe(4);
    expect(fetched).not.toHaveBeenCalled();

    // Event 5 was missed: apply 6, then fetch the current report.
    store.apply(report(6));
    expect(useResidencyStore.getState().report?.seq).toBe(6);
    await vi.waitFor(() => expect(useResidencyStore.getState().report?.seq).toBe(9));
    expect(fetched).toHaveBeenCalledTimes(1);
  });
});
