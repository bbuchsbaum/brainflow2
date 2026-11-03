/**
 * Residency policy with a tool tab in front, on the real workspace, view-state
 * and layer stores (QA r0 2026-11-02, A12 / N32 and N34).
 *
 * Native scenario: 12 volumes shown in Orthogonal 6, other view tabs sharing
 * that scene, then the Set studio's Compare lens needs four texture slots.
 * The view-state store seeds the Studio tab with a copy of the scene it was
 * opened from, so the old policy read those layers as "visible in front" and
 * pinned them all: panes B-D stayed "GPU texture slots full".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  protectedVolumes: new Set<string>(),
  live: 0,
  pinned: new Set<string>(),
  release: vi.fn(),
}));

vi.mock('@/services/workspaceDocuments', () => ({
  volumeDocumentRemovalReason: (id: string) => (h.protectedVolumes.has(id) ? 'Retained' : null),
}));
vi.mock('@/services/studio/StudioDerivedMapService', () => ({
  getStudioDerivedMapService: () => ({ liveCount: () => h.live, pinnedLayerIds: () => h.pinned }),
}));
vi.mock('@/services/apiService', () => ({
  getApiService: () => ({
    getAtlasStats: async () => ({ volumeTextureSlots: 13, renderLayerCapacity: 16 }),
    releaseLayerGpuResources: h.release,
    reclaimCachedImageSlots: async () => ({ reclaimed: 0, freeTextureSlots: 0 }),
  }),
}));
vi.mock('@/events/EventBus', () => ({ getEventBus: () => ({ emit: vi.fn(), on: vi.fn() }) }));

import { layerEvictionService } from '@/services/LayerEvictionService';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { Workspace } from '@/types/workspace';

const VIEW_TABS = ['orthogonal-6', 'orthogonal-9', 'orthogonal-10', 'orthogonal-11'];
const STUDIO = 'set-studio-1';
const BIDS_TOOL = 'bids-explorer-1';

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

/** Load `count` resident volumes into the front tab; layer i was drawn at time i + 1. */
function loadInFront(count: number, kinds: Record<number, string> = {}) {
  const ids = Array.from({ length: count }, (_, i) => `layer-${i}`);
  for (const [i, id] of ids.entries()) {
    useLayerStore.getState().addLayer({
      id,
      name: `Volume ${i}`,
      volumeId: `vol-${i}`,
      type: 'anatomical',
      visible: true,
      order: i,
      ...(kinds[i] ? { layerKind: kinds[i] } : {}),
    } as never);
    useLayerStore
      .getState()
      .setLayerMetadata(id, { gpuResident: true, lastRenderTime: i + 1 } as never);
  }
  useViewStateStore.getState().setViewState((state) => {
    for (const id of ids) {
      state.layers.push({
        id,
        volumeId: `vol-${ids.indexOf(id)}`,
        visible: true,
        opacity: 1,
      } as never);
    }
  });
  return ids;
}

const resident = (id: string) =>
  useLayerStore.getState().layerMetadata.get(id)?.gpuResident !== false;
const released = () => h.release.mock.calls.map(([id]) => id as string);

describe('residency policy with a tool tab in front (QA r0 A12, N34)', () => {
  beforeEach(() => {
    h.protectedVolumes = new Set();
    h.pinned = new Set();
    h.live = 0;
    h.release.mockReset().mockResolvedValue(undefined);
    layerEvictionService.resetGpuTextureSlotsForTests();
    layerEvictionService.resetReservationsForTests();
    useLayerStore.setState({ layers: [], layerMetadata: new Map() } as never);
    const workspaces = new Map<string, Workspace>();
    VIEW_TABS.forEach((id, i) => workspaces.set(id, workspace(id, 'orthogonal-locked', i + 1)));
    workspaces.set(STUDIO, workspace(STUDIO, 'set-studio', 10));
    useWorkspaceStore.setState({ workspaces, activeWorkspaceId: null } as never);
    activate('orthogonal-6');
    // The stores are singletons: start every test from empty scenes.
    const views = useViewStateStore.getState();
    for (const key of views.workspaceViewStates.keys()) {
      views.setViewState((state) => {
        state.layers = [];
      }, key);
    }
  });

  /**
   * The native sequence: 12 volumes in Orthogonal 6, the other view tabs
   * opened on that scene (shared), then the Studio tab, which the view-state
   * store seeds with a copy of the same scene.
   */
  function nativeScene(kinds: Record<number, string> = {}) {
    const ids = loadInFront(12, kinds);
    for (const id of VIEW_TABS.slice(1)) activate(id);
    activate('orthogonal-6');
    activate(STUDIO);
    // The Studio's own view state is the scene copy, all of it "visible".
    const studioView = useViewStateStore.getState().viewState;
    expect(studioView.layers.filter((layer) => layer.visible)).toHaveLength(12);
    expect(
      useViewStateStore.getState().workspaceViewStates.get('orthogonal-10')?.layers,
    ).toHaveLength(12);
    return ids;
  }

  it('evicts layers shown only in view tabs, least recently drawn first, for Studio maps', async () => {
    const ids = nativeScene();
    // Pane A borrows the anatomy (layer-0); B, C, D and the template take four slots.
    h.pinned = new Set(['layer-0']);
    h.live = 4;
    await expect(
      layerEvictionService.makeRoomForUpload(undefined, { counted: true }),
    ).resolves.toBe(true);
    // 12 layers + 4 maps on 13 slots: three go, the oldest unpinned ones.
    expect(released()).toEqual(['layer-1', 'layer-2', 'layer-3']);
    expect(resident('layer-0')).toBe(true);
    for (const id of ids.slice(4)) expect(resident(id)).toBe(true);
    // Nothing is uploaded again while the Studio is in front (no ping-pong):
    // the tool tab's copy of the scene is not on screen.
    expect(layerEvictionService.evictedFrontLayers()).toEqual([]);
    // Back on a view tab of the shared scene, its evicted layers are restored.
    activate('orthogonal-9');
    expect(layerEvictionService.evictedFrontLayers()).toEqual(['layer-1', 'layer-2', 'layer-3']);
  });

  it('still pins the visible layers of a view tab in front, even when another view tab shares them', async () => {
    nativeScene();
    activate('orthogonal-10');
    h.live = 4;
    // Every layer is drawn by the front tab: nothing may go, so the maps are refused.
    await expect(
      layerEvictionService.makeRoomForUpload(undefined, { counted: true }),
    ).resolves.toBe(false);
    expect(h.release).not.toHaveBeenCalled();
  });

  it('never evicts an open segmentation session, its frames or a layer the Studio borrows', async () => {
    // layer-0: reference (document-protected), layer-1: frozen frame
    // (document-protected), layer-2: editable labels, layer-3: borrowed by pane A.
    nativeScene({ 2: 'segmentation.editable-label' });
    h.protectedVolumes = new Set(['vol-0', 'vol-1']);
    h.pinned = new Set(['layer-3']);
    // More maps than the unpinned layers can make room for.
    h.live = 13;
    await expect(
      layerEvictionService.makeRoomForUpload(undefined, { counted: true }),
    ).resolves.toBe(false);
    expect(released()).toEqual(Array.from({ length: 8 }, (_, i) => `layer-${i + 4}`));
    for (const id of ['layer-0', 'layer-1', 'layer-2', 'layer-3']) expect(resident(id)).toBe(true);
  });

  it('treats any tool tab like the Studio: its scene copy pins nothing', async () => {
    useWorkspaceStore.setState((state) => {
      const workspaces = new Map(state.workspaces);
      workspaces.set(BIDS_TOOL, workspace(BIDS_TOOL, 'bids-explorer', 11));
      return { workspaces };
    });
    loadInFront(12);
    activate(BIDS_TOOL);
    expect(useViewStateStore.getState().viewState.layers).toHaveLength(12);
    h.live = 1;
    // 12 + 1 = 13: the upload being counted already, the budget is met.
    await expect(
      layerEvictionService.makeRoomForUpload(undefined, { counted: true }),
    ).resolves.toBe(true);
    expect(h.release).not.toHaveBeenCalled();
    h.live = 2;
    await expect(
      layerEvictionService.makeRoomForUpload(undefined, { counted: true }),
    ).resolves.toBe(true);
    expect(released()).toEqual(['layer-0']);
  });
});
