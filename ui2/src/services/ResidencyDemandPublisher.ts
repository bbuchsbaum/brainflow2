/**
 * ResidencyDemandPublisher - tells the backend what each frame draws (R5b of
 * docs/plans/gpu-residency-r5-plan-2026-11.md).
 *
 * Frames:
 * - every view tab (orthogonal, mosaic, comparison, integrated), keyed by its
 *   workspace id: Front when it is the active tab, Background otherwise;
 * - the active tool tab only while it borrows the views through a render
 *   layer scope (the Set studio's "current" member); a tool tab draws nothing
 *   otherwise (A12), so it publishes no Front;
 * - `studio-panes`: the maps the Studio panes hold, Front while a tool tab
 *   is in front.
 *
 * A frame's `layers` are its drawable layers (visible, opacity above 0) in
 * stack order, bottom first, as the renderer draws them. Pinned layers (an
 * editable label, a segmentation document's images, a borrowed Studio
 * underlay) carry their pin; hidden pinned layers go in `held`.
 *
 * The UI still evicts (R5b records demand only). It never names slots,
 * bindings or texture indices. Each frame's epoch increases with every
 * message, so a late message never overrides a newer one.
 */

import type {
  ResidencyDemandedLayer,
  ResidencyDemandResult,
  ResidencyFrameDemand,
  ResidencyPin,
  ResidencyReport,
} from '@brainflow/api';
import { isViewWorkspaceType } from '@/components/ui/displayModeSelector.helpers';
import { isBrowserHost } from '@/services/applicationHost';
import {
  applyRenderLayerScope,
  hasRenderLayerScope,
  subscribeRenderLayerScope,
} from '@/services/render/RenderLayerScope';
import { getStudioDerivedMapService } from '@/services/studio/StudioDerivedMapService';
import { getTransport, type BackendTransport } from '@/services/transport';
import {
  subscribeWorkspaceDocuments,
  volumeDocumentRemovalReason,
} from '@/services/workspaceDocuments';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { ViewLayer } from '@/types/viewState';

/** A frame's demand before its epoch is attached. */
export type FrameDemandBody = Omit<ResidencyFrameDemand, 'epoch'>;

export const STUDIO_PANES_FRAME = 'studio-panes';

const EDITABLE_LABEL_KIND = 'segmentation.editable-label';

function drawable(layer: ViewLayer): boolean {
  return layer.visible && layer.opacity > 0;
}

/** Why `layer` must stay resident whatever its frame's priority, if it must. */
function pinOf(
  layer: ViewLayer,
  layerKinds: ReadonlyMap<string, string | undefined>,
  studioPins: ReadonlySet<string>,
): ResidencyPin | null {
  if (layerKinds.get(layer.id) === EDITABLE_LABEL_KIND) return 'editable_document';
  if (volumeDocumentRemovalReason(layer.volumeId)) return 'segmentation_session';
  if (studioPins.has(layer.id)) return 'studio_pane';
  return null;
}

function frameOf(
  layers: readonly ViewLayer[],
  priority: ResidencyFrameDemand['priority'],
  layerKinds: ReadonlyMap<string, string | undefined>,
  studioPins: ReadonlySet<string>,
): FrameDemandBody {
  const drawn: ResidencyDemandedLayer[] = [];
  const held: ResidencyDemandedLayer[] = [];
  for (const layer of layers) {
    const pin = pinOf(layer, layerKinds, studioPins);
    const demanded = { layer_id: layer.id, volume_id: layer.volumeId, pin };
    if (drawable(layer)) drawn.push(demanded);
    else if (pin) held.push(demanded);
  }
  return { priority, layers: drawn, held };
}

/** Every frame's demand now, from the stores. */
export function computeResidencyFrames(): Map<string, FrameDemandBody> {
  const frames = new Map<string, FrameDemandBody>();
  const { workspaces, activeWorkspaceId } = useWorkspaceStore.getState();
  const { workspaceViewStates, viewState: activeViewState } = useViewStateStore.getState();
  const layerKinds = new Map(
    useLayerStore.getState().layers.map((layer) => [layer.id, layer.layerKind] as const),
  );
  const studio = getStudioDerivedMapService();
  const studioPins = studio.pinnedLayerIds();

  for (const [id, workspace] of workspaces) {
    const active = id === activeWorkspaceId;
    const viewTab = isViewWorkspaceType(workspace.type);
    const viewState = active ? activeViewState : workspaceViewStates.get(id);
    if (!viewState) continue;
    if (active && (viewTab || hasRenderLayerScope())) {
      // The views draw the active tab's layers, or the scoped subset of them.
      const scoped = applyRenderLayerScope(viewState);
      frames.set(id, frameOf(scoped.layers, 'front', layerKinds, studioPins));
    } else if (viewTab && !active) {
      frames.set(id, frameOf(viewState.layers, 'background', layerKinds, studioPins));
    }
  }

  const maps = studio.heldMaps();
  if (maps.length > 0) {
    const active = activeWorkspaceId ? workspaces.get(activeWorkspaceId) : undefined;
    const toolInFront = Boolean(active && !isViewWorkspaceType(active.type));
    frames.set(STUDIO_PANES_FRAME, {
      priority: toolInFront ? 'front' : 'background',
      layers: maps.map((map) => ({
        layer_id: map.layerId,
        volume_id: map.volumeId,
        pin: 'studio_pane',
      })),
      held: [],
    });
  }
  return frames;
}

/** Sends each frame's demand when it changes, and clears frames that went away. */
export class ResidencyDemandPublisher {
  private readonly epochs = new Map<string, number>();
  /**
   * Epochs start above every epoch an earlier session of the webview sent:
   * the backend keeps each frame's epoch across a reload, and a lower one
   * would be ignored as stale.
   */
  private readonly epochBase = Date.now() * 1000;
  /** What was last sent per frame, to skip unchanged frames. */
  private readonly sent = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  private readonly transport: () => BackendTransport;
  private readonly settleMs: number;

  constructor(transport: () => BackendTransport = getTransport, settleMs = 16) {
    this.transport = transport;
    this.settleMs = settleMs;
  }

  private nextEpoch(frameId: string): number {
    const epoch = (this.epochs.get(frameId) ?? this.epochBase) + 1;
    this.epochs.set(frameId, epoch);
    return epoch;
  }

  /**
   * Publish within `settleMs` of the first change. The timer is not restarted
   * by later changes: during an upload storm the stores change continuously,
   * and a restarted timer held the new demand back while the UI was already
   * evicting for the new front tab (R5b native shadow run).
   */
  schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.settleMs);
  }

  /** Publish what changed now. */
  flush(): void {
    const frames = computeResidencyFrames();
    for (const [frameId, body] of frames) {
      const signature = JSON.stringify(body);
      if (this.sent.get(frameId) === signature) continue;
      this.sent.set(frameId, signature);
      const demand: ResidencyFrameDemand = { epoch: this.nextEpoch(frameId), ...body };
      this.send('set_residency_demand', { frameId, demand });
    }
    for (const frameId of [...this.sent.keys()]) {
      if (frames.has(frameId)) continue;
      this.sent.delete(frameId);
      this.send('clear_residency_demand', { frameId, epoch: this.nextEpoch(frameId) });
    }
  }

  /**
   * Clear frames the backend holds that this session does not publish: what
   * an earlier session of the webview (a reload) left behind.
   */
  clearUnknownFrames(report: ResidencyReport): void {
    const current = computeResidencyFrames();
    const known = new Set(report.layers.flatMap((layer) => layer.frames));
    for (const frameId of known) {
      if (this.sent.has(frameId) || current.has(frameId)) continue;
      this.send('clear_residency_demand', { frameId, epoch: this.nextEpoch(frameId) });
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private send(command: string, args: Record<string, unknown>): void {
    this.transport()
      .invoke<ResidencyDemandResult>(command, args)
      .catch((error) => {
        console.debug(`[ResidencyDemandPublisher] ${command} failed:`, error);
      });
  }
}

let stopPublishing: (() => void) | null = null;

/** Start publishing demand for the app's lifetime; idempotent. */
export function startResidencyDemandPublisher(): () => void {
  if (stopPublishing) return stopPublishing;
  // The browser host has no GPU residency to report on.
  if (isBrowserHost()) return () => {};
  const publisher = new ResidencyDemandPublisher();
  const schedule = () => publisher.schedule();
  const unsubscribers = [
    useViewStateStore.subscribe(schedule),
    useWorkspaceStore.subscribe(schedule),
    useLayerStore.subscribe(schedule),
    subscribeRenderLayerScope(schedule),
    getStudioDerivedMapService().subscribe(schedule),
    subscribeWorkspaceDocuments(schedule),
  ];
  publisher.schedule();
  void getTransport()
    .invoke<ResidencyReport | null>('get_residency_state')
    .then((report) => report && publisher.clearUnknownFrames(report))
    .catch(() => undefined);
  stopPublishing = () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
    publisher.dispose();
    stopPublishing = null;
  };
  return stopPublishing;
}
