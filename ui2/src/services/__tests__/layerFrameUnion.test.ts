/**
 * The standard panes frame the union of the visible layers' world boxes,
 * whoever changes the layers (QA 2026-10-29 §3.2 and its review: W1, M5, M10).
 * Runs against the real view-state store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { coalesceUtils } from '@/stores/middleware/coalesceUpdatesMiddleware';
import { LayerService, type LayerApi } from '@/services/LayerService';
import { layerFrameBoxes } from '@/services/layerFrameBoxes';
import { fitViewsToWorldBox, worldBoxFromViews, type WorldBox } from '@/utils/worldFrame';
import type { ViewLayer, ViewState } from '@/types/viewState';

vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));

const roi: WorldBox = { min: [10, -20, 20], max: [30, 0, 40] };
const t1: WorldBox = { min: [-90, -126, -72], max: [90, 90, 108] };
const crosshair: [number, number, number] = [20, -10, 30];

const viewLayer = (id: string, visible: boolean): ViewLayer =>
  ({ id, name: id, volumeId: id, visible, opacity: 1 }) as unknown as ViewLayer;

const views = () => useViewStateStore.getState().viewState.views;
const state = () => useViewStateStore.getState().viewState;

/** The panes cover `box`, with at most a couple of pixels to spare per side. */
function expectFrames(box: WorldBox) {
  const shown = worldBoxFromViews(views())!;
  const px = Math.hypot(...views().axial.u_mm);
  for (let a = 0; a < 3; a += 1) {
    expect(shown.min[a]).toBeLessThanOrEqual(box.min[a] + 1e-3);
    expect(shown.max[a]).toBeGreaterThanOrEqual(box.max[a] - 1e-3);
    expect(box.min[a] - shown.min[a]).toBeLessThan(px * 2);
    expect(shown.max[a] - box.max[a]).toBeLessThan(px * 2);
  }
}

/** First layer as the loader commits it: its initial views, then the layer. */
function loadFirst(id: string, box: WorldBox, visible = true) {
  layerFrameBoxes.record(id, box);
  useViewStateStore.getState().setViewState((draft: ViewState) => {
    draft.views = fitViewsToWorldBox(draft.views, box, crosshair, [400, 400]);
    draft.crosshair = { world_mm: crosshair, visible: true };
    draft.layers.push(viewLayer(id, visible));
  });
}

function load(id: string, box: WorldBox, visible = true) {
  layerFrameBoxes.record(id, box);
  useViewStateStore.getState().setViewState((draft: ViewState) => {
    draft.layers.push(viewLayer(id, visible));
  });
}

describe('union field of view', () => {
  beforeEach(() => {
    useViewStateStore.getState().resetToDefaults();
    useViewStateStore.getState().setViewState((draft: ViewState) => {
      draft.layers = [];
    });
    coalesceUtils.clearPending();
    coalesceUtils.setBackendCallback(vi.fn());
    layerFrameBoxes.clear();
  });

  afterEach(() => {
    coalesceUtils.clearPending();
    layerFrameBoxes.clear();
  });

  it('grows the frame when the Layers panel shows a large hidden layer (W1)', async () => {
    loadFirst('roi', roi);
    load('t1', t1, false);
    expectFrames(roi);

    // LayerService writes `visible` synchronously before the API call.
    const api = { updateLayer: vi.fn().mockResolvedValue({}) } as unknown as LayerApi;
    new LayerService(api).toggleVisibility('t1', true);
    expectFrames(t1);
    // Still world planes: sagittal is Y (anterior left) by Z (superior up).
    expect(views().sagittal.u_mm[1]).toBeLessThan(0);
    expect(views().sagittal.v_mm[2]).toBeLessThan(0);
    expect(views().sagittal.origin_mm[0]).toBe(crosshair[0]);

    new LayerService(api).toggleVisibility('t1', false);
    expectFrames(roi);
  });

  it('grows the frame from an Inspector-style direct draft write too', () => {
    loadFirst('roi', roi);
    load('t1', t1, false);
    useViewStateStore.getState().setViewState((draft: ViewState) => {
      const target = draft.layers.find((layer) => layer.id === 't1')!;
      target.visible = true;
    });
    expectFrames(t1);
  });

  it('keeps the zoom when the shown union does not change', () => {
    loadFirst('t1', t1);
    // The user zooms in: a new axial plane.
    const zoomed = { ...views().axial, u_mm: [0.1, 0, 0] as [number, number, number] };
    useViewStateStore.getState().setViewState((draft: ViewState) => {
      draft.views.axial = zoomed;
    });
    load('roi', roi);
    expect(views().axial).toEqual(zoomed);
  });

  it('keeps the crosshair inside the frame left after a removal (M5)', () => {
    loadFirst('t1', t1);
    load('far', { min: [100, 100, 100], max: [140, 140, 140] });
    useViewStateStore.getState().setViewState((draft: ViewState) => {
      draft.crosshair.world_mm = [120, 120, 120];
    });
    useViewStateStore.getState().setViewState((draft: ViewState) => {
      draft.layers = draft.layers.filter((layer) => layer.id !== 'far');
    });
    expectFrames(t1);
    expect(state().crosshair.world_mm).toEqual([90, 90, 108]);
    // The panes pass through the clamped crosshair.
    expect(views().axial.origin_mm[2]).toBe(108);
    expect(views().coronal.origin_mm[1]).toBe(90);
    expect(views().sagittal.origin_mm[0]).toBe(90);
  });

  it('drops frame boxes on reset and when their workspace closes (M10)', () => {
    loadFirst('t1', t1);
    useViewStateStore.getState().resetToDefaults();
    expect(layerFrameBoxes.get('t1')).toBeUndefined();

    const both = new Map([
      ['A', { id: 'A' }],
      ['B', { id: 'B' }],
    ]) as never;
    useWorkspaceStore.setState({ workspaces: both, activeWorkspaceId: 'A' });
    layerFrameBoxes.record('only-a', roi);
    useViewStateStore.getState().setViewState((draft: ViewState) => {
      draft.layers = [viewLayer('only-a', true)];
    }, 'A');
    useWorkspaceStore.setState({ workspaces: both, activeWorkspaceId: 'B' });
    layerFrameBoxes.record('only-b', roi);
    layerFrameBoxes.record('orphan', roi);
    useViewStateStore.getState().setViewState((draft: ViewState) => {
      draft.layers = [viewLayer('only-b', true)];
    }, 'B');
    // Close B.
    useWorkspaceStore.setState({
      workspaces: new Map([['A', { id: 'A' }]]) as never,
      activeWorkspaceId: 'A',
    });
    expect(layerFrameBoxes.get('only-a')).toEqual(roi);
    expect(layerFrameBoxes.get('only-b')).toBeUndefined();
    expect(layerFrameBoxes.get('orphan')).toBeUndefined();
    useWorkspaceStore.setState({ workspaces: new Map(), activeWorkspaceId: null });
  });
});
