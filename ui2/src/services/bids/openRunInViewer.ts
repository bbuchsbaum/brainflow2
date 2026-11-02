/**
 * Open in viewer: the one way a BIDS run reaches the viewer. One tab shows the
 * run under review: opening another replaces it there, in place, so triage
 * neither grows the tab strip nor leaks the last run into the next one. Lands
 * on the run's FD peak, shows its time series and publishes its events as a
 * track. Reads the run's own record, so it never waits for a scan.
 *
 * Layers are global and a new tab starts as a copy of the view in front
 * (viewStateStore), so the tab is emptied here, not assumed empty. Opens run
 * one at a time: a load cannot be recalled, so the latest waits for the one
 * under way and the ones between are skipped.
 */
import type { BidsEventRow, BidsRunRecord } from '@brainflow/api';
import { openDockTab } from '@/components/layout/openDockTab';
import { isLayerFourD } from '@/components/plots/crosshairTimeSeriesPlot.helpers';
import { isViewWorkspaceType } from '@/components/ui/displayModeSelector.helpers';
import { getEventBus } from '@/events/EventBus';
import { getFileLoadingService } from '@/services/FileLoadingService';
import { getLayerService } from '@/services/LayerService';
import { expectLandingFrame, forgetLandingFrame } from '@/services/landingFrames';
import { getTimeNavigationService } from '@/services/TimeNavigationService';
import { selectBidsModel, useBidsStore } from '@/stores/bidsStore';
import { focusVolumeLayer, useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import { useLayerStore } from '@/stores/layerStore';
import { usePlotModeStore } from '@/stores/plotModeStore';
import { useTimeEventsStore } from '@/stores/timeEventsStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { SceneItemKind } from '@/types/sceneItem';
import type { ViewLayer } from '@/types/viewState';

/** Marks the tab across a relaunch, where only the workspace store survives. */
export const RUN_VIEWER_PRESET = 'bids-run-viewer';

type OpenableRun = Pick<BidsRunRecord, 'path' | 'fd'> & Partial<Pick<BidsRunRecord, 'id' | 'has_events'>>;

let latestRequest = 0;
let queue: Promise<unknown> = Promise.resolve();
/** The tab, by id: a layout change there drops its preset but not its job. */
let viewerId: string | null = null;
/** The run this module put in the tab. */
let shown: { layerId: string; path: string } | null = null;
/** The tab as it was before a load that has not landed yet: all of it comes back if none does. */
interface ParkedTab {
  /** The run taken out; every other layer stays in the view. */
  run: ViewLayer | null;
  order: { id: string; visible: boolean }[];
  selectedLayerId: string | null;
  inspector: { activeItemId: string; activeItemKind: SceneItemKind } | null;
}
let parked: ParkedTab | null = null;
/** Ends the watch on the tab. */
let unwatchTab: (() => void) | null = null;

/** Test seam. */
export function resetRunViewer(): void {
  unwatchTab?.();
  unwatchTab = null;
  latestRequest = 0;
  queue = Promise.resolve();
  viewerId = null;
  shown = null;
  parked = null;
}

const viewOf = (workspaceId: string) => useViewStateStore.getState().workspaceViewStates.get(workspaceId);

const pathOf = (layer: { id: string; sourcePath?: string }) =>
  useLayerStore.getState().layerMetadata?.get?.(layer.id)?.sourcePath ?? layer.sourcePath;

const layerIds = () => new Set(useLayerStore.getState().layers.map((layer) => layer.id));

/** The layer a load added: by the store, since a tab closed meanwhile no longer lists it. */
function loadedLayer(path: string, before: ReadonlySet<string>): string | null {
  const match = [...useLayerStore.getState().layers]
    .reverse()
    .find((layer) => !before.has(layer.id) && pathOf(layer) === path);
  return match?.id ?? null;
}

/** A file in a named template space belongs on that template; anything else does not. */
const inNativeSpace = (run: OpenableRun) => !/_space-/.test(run.id ?? run.path);

const isTemplate = (id: string) => {
  const { layers, layerMetadata } = useLayerStore.getState();
  const layer = layers.find((item) => item.id === id);
  return (layerMetadata?.get?.(id)?.source ?? layer?.source) === 'template';
};

/** Frees a run's GPU lease and volume, unless a view of the user's still shows it. */
async function release(layerId: string, workspaceId: string): Promise<void> {
  const { workspaces } = useWorkspaceStore.getState();
  const elsewhere = [...useViewStateStore.getState().workspaceViewStates].some(
    ([id, view]) =>
      id !== workspaceId &&
      isViewWorkspaceType(workspaces.get(id)?.type) &&
      view.layers.some((layer) => layer.id === layerId && layer.visible),
  );
  if (elsewhere) return;
  await getLayerService()
    .removeLayer(layerId)
    .catch((error: unknown) => console.warn(`[openRunInViewer] Could not release ${layerId}:`, error));
}

/** The user closed the tab: its run goes with it, whenever that happened. */
function tabClosed(workspaceId: string): void {
  const run = shown;
  unwatchTab?.();
  unwatchTab = null;
  viewerId = null;
  shown = null;
  parked = null;
  if (run) void release(run.layerId, workspaceId);
}

function watchTab(workspaceId: string): void {
  unwatchTab?.();
  unwatchTab = useWorkspaceStore.subscribe((state) => {
    if (!state.workspaces.has(workspaceId)) tabClosed(workspaceId);
  });
}

/** The run tab in front, holding at most its templates when it is new to this session. */
async function runViewerTab(): Promise<string> {
  const store = useWorkspaceStore.getState();
  if (viewerId && store.workspaces.has(viewerId)) {
    store.activateWorkspace(viewerId);
    return viewerId;
  }
  const id = await store.createWorkspace('orthogonal-locked', undefined, {
    title: 'Run viewer',
    presetId: RUN_VIEWER_PRESET,
  });
  viewerId = id;
  shown = null;
  parked = null;
  watchTab(id);
  useViewStateStore.getState().setViewState((state) => {
    state.layers = state.layers.filter((layer) => isTemplate(layer.id));
  }, id);
  return id;
}

/**
 * Empties the tab of the last run, and settles what stays before the load:
 * what the new run lands on sets its opacity and the crosshair it starts from.
 * Raw EPI is in its own space, so a template under it would claim an alignment
 * that does not exist, and the same goes for a user's layer: those stay in the
 * Scene, hidden. Under a template-space run they stay as they are.
 *
 * The selection leaves with the run, so the Plot dock and the Scene stop
 * speaking about it during the load.
 */
function clearForRun(run: OpenableRun, workspaceId: string): void {
  const view = viewOf(workspaceId);
  const previousId = shown?.layerId;
  const previous = view?.layers.find((layer) => layer.id === previousId);
  const { selectedLayerId, selectLayer } = useLayerStore.getState();
  const inspector = useInspectorSelectionStore.getState();
  const { activeItemId, activeItemKind } = inspector;
  parked = {
    run: previous ? { ...previous } : null,
    order: (view?.layers ?? []).map(({ id, visible }) => ({ id, visible })),
    selectedLayerId,
    inspector: activeItemId && activeItemKind ? { activeItemId, activeItemKind } : null,
  };
  if (previous) {
    if (selectedLayerId === previous.id) selectLayer(null);
    if (activeItemId === previous.id) inspector.clear();
  }
  const native = inNativeSpace(run);
  useViewStateStore.getState().setViewState((state) => {
    state.layers = state.layers.filter((layer) => layer.id !== previousId);
    for (const layer of state.layers) {
      if (native) layer.visible = false;
      else if (isTemplate(layer.id)) layer.visible = true;
    }
  }, workspaceId);
}

/**
 * A load that came to nothing: the tab is what it was, in order, hidden layers
 * hidden. A layer the user added meanwhile stays, after those; one they removed
 * stays removed.
 */
function restoreParked(workspaceId: string): void {
  const previous = parked;
  parked = null;
  if (!previous) return;
  useViewStateStore.getState().setViewState((state) => {
    const present = new Map(state.layers.map((layer) => [layer.id, layer]));
    const back = previous.order.flatMap(({ id, visible }) => {
      const layer = present.get(id) ?? (id === previous.run?.id ? previous.run : undefined);
      return layer ? [{ ...layer, visible }] : [];
    });
    const known = new Set(previous.order.map(({ id }) => id));
    state.layers = [...back, ...state.layers.filter((layer) => !known.has(layer.id))];
  }, workspaceId);
  // Unless the user has chosen something else in the meantime.
  const layers = useLayerStore.getState();
  if (layers.selectedLayerId === null && previous.selectedLayerId !== null) {
    layers.selectLayer(previous.selectedLayerId);
  }
  const inspector = useInspectorSelectionStore.getState();
  if (inspector.activeItemId === null && previous.inspector) {
    useInspectorSelectionStore.setState(previous.inspector);
  }
}

/** The run alone at the head of the list, fully opaque, in its tab, in front or not. */
async function showAlone(layerId: string, workspaceId: string): Promise<void> {
  const view = viewOf(workspaceId);
  if (!view) return;
  const others = view.layers.map((layer) => layer.id).filter((id) => id !== layerId);
  useViewStateStore.getState().setViewState((state) => {
    for (const layer of state.layers) {
      if (layer.id === layerId) layer.opacity = 1;
      else layer.visible = false;
    }
  }, workspaceId);
  if (others.length) await getLayerService().reorderLayers([layerId, ...others], workspaceId);
}

/** Volumes the source flags; a record from an older index has none. */
const nonSteadyVolumes = (run: OpenableRun): readonly number[] => run.fd?.non_steady_volumes ?? [];

async function publishEvents(
  run: OpenableRun,
  layerId: string,
  datasetPath: string | null,
  isCurrent: () => boolean,
): Promise<void> {
  const nonSteady = nonSteadyVolumes(run);
  let events: BidsEventRow[] = [];
  if (run.has_events && run.id) {
    try {
      events = await useBidsStore.getState().loadRunEvents(run.id, datasetPath);
    } catch (error) {
      if (isCurrent()) {
        getEventBus().emit('ui.notification', {
          type: 'error',
          message: `Events not loaded: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }
  if (!isCurrent() || (!events.length && !nonSteady.length)) return;
  useTimeEventsStore.getState().publish({
    layerId,
    label: run.id ?? run.path,
    events,
    ...(nonSteady.length ? { nonSteadyVolumes: nonSteady } : {}),
  });
}

/** The run becomes what the Inspector and the Plot dock speak about, at its peak. */
function land(run: OpenableRun, layerId: string): void {
  useLayerStore.getState().selectLayer(layerId);
  focusVolumeLayer(layerId);
  const peak = run.fd?.peak_volume;
  if (peak !== undefined) getTimeNavigationService().setTimepoint(peak);
  if (isLayerFourD(layerId)) {
    usePlotModeStore.getState().setActivePlotMode('crosshair-time-series');
    openDockTab('plot');
  }
}

/**
 * The frame the first window is read from: where the run lands, or its first
 * steady volume when that is a startup volume, whose brightness would say
 * nothing about the rest of the run.
 */
const windowFrame = ({ fd }: OpenableRun): number | undefined =>
  fd ? Math.max(fd.peak_volume, fd.first_valid_volume ?? 0) : undefined;

async function open(run: OpenableRun, request: number, datasetPath: string | null): Promise<void> {
  const latest = () => request === latestRequest;
  if (!latest()) return;
  const workspaceId = await runViewerTab();
  const tabOpen = () => useWorkspaceStore.getState().workspaces.has(workspaceId);
  // A newer open, or a user who has moved on, keeps its own timepoint and track.
  const isCurrent = () => latest() && useWorkspaceStore.getState().activeWorkspaceId === workspaceId;

  if (shown?.path === run.path && viewOf(workspaceId)?.layers.some((layer) => layer.id === shown?.layerId)) {
    land(run, shown.layerId);
    return;
  }

  clearForRun(run, workspaceId);
  const before = layerIds();
  const frame = windowFrame(run);
  if (frame !== undefined) expectLandingFrame(run.path, frame);
  try {
    await getFileLoadingService().loadFile(run.path, 'programmatic', 'default', workspaceId);
  } catch (error) {
    restoreParked(workspaceId);
    throw error;
  } finally {
    forgetLandingFrame(run.path);
  }
  const layerId = loadedLayer(run.path, before);
  if (!layerId) {
    restoreParked(workspaceId);
    return;
  }
  if (!latest() || !tabOpen()) {
    // Passed over while it loaded, or its tab closed after it was committed:
    // nothing may keep it alive (async ownership).
    await release(layerId, workspaceId);
    return;
  }

  const previous = shown;
  shown = { layerId, path: run.path };
  parked = null;
  // By tab, not by what is in front: a template must not stay under raw EPI
  // for a user who left during the load and comes back.
  if (inNativeSpace(run)) await showAlone(layerId, workspaceId);
  if (isCurrent()) land(run, layerId);
  if (previous) await release(previous.layerId, workspaceId);
  if (isCurrent()) await publishEvents(run, layerId, datasetPath, isCurrent);
}

export function openRunInViewer(run: OpenableRun): Promise<void> {
  const request = ++latestRequest;
  // The run belongs to the dataset showing now, whatever is current when its turn comes.
  const { datasetPath } = useBidsStore.getState();
  const turn = queue.then(() => open(run, request, datasetPath));
  queue = turn.catch(() => undefined);
  return turn;
}

/** Enter, double click: open whatever is selected. */
export function openSelectedRun(): void {
  const state = useBidsStore.getState();
  if (!state.selectedRunId) return;
  const facts = selectBidsModel(state).runsById.get(state.selectedRunId);
  if (facts) void openRunInViewer(facts.run);
}
