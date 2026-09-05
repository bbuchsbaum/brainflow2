import { useImageSetStore } from '@/stores/imageSetStore';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLoadingQueueStore } from '@/stores/loadingQueueStore';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import { useComparisonStore } from '@/stores/comparisonStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { getApiService } from './apiService';
import { getVolumeLoadingService, inferLayerTypeFromName } from './VolumeLoadingService';
import { fileLoadScheduler } from './LoadScheduler';
import { getEventBus } from '@/events/EventBus';
import { toError } from '@/utils/formatTauriError';
import type { ImageSelectionSet, ImageSetMember } from '@/types/imageSet';
import type { FileNode } from './filesystem/FilesystemService';
import type { ViewLayer } from '@/types/viewState';

const normalized = (path: string) => path.replace(/\\/g, '/').replace(/\/$/, '');
export const folderName = (path: string) => normalized(path).split('/').pop() || path;

/** Only direct children, in deterministic natural order. IDs remain the backend's exact paths. */
export function folderImageMembers(folder: string, nodes: FileNode[]): ImageSetMember[] {
  const prefix = `${normalized(folder)}/`;
  const seen = new Set<string>();
  return nodes
    .filter((node) => {
      const path = normalized(node.id);
      if (node.isDir || !/\.nii(\.gz)?$/i.test(node.name) || seen.has(path)) return false;
      if (!path.startsWith(prefix) || path.slice(prefix.length).includes('/')) return false;
      seen.add(path);
      return true;
    })
    .map((node) => ({ path: node.id, name: node.name }))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }) || a.path.localeCompare(b.path),
    );
}

export class ImageSetService {
  private requests = new Map<string, { index: number; token: string; workspaceId: string }>();
  private running = new Map<string, Promise<void>>();

  constructor() {
    useLayerStore.subscribe((state, previous) => {
      if (state.layers === previous.layers) return;
      for (const entry of Object.values(useImageSetStore.getState().sets)) {
        if (entry.layerId && !state.layers.some((layer) => layer.imageSetId === entry.id)) {
          this.forget(entry.id);
        }
      }
    });
  }

  private update(id: string, patch: Partial<ImageSelectionSet>) {
    const entry = useImageSetStore.getState().sets[id];
    if (!entry) return;
    useImageSetStore.setState((state) => ({
      sets: { ...state.sets, [id]: { ...entry, ...patch } },
    }));
  }

  private forget(id: string) {
    this.requests.delete(id);
    useImageSetStore.setState((state) => {
      const sets = { ...state.sets };
      delete sets[id];
      return { sets };
    });
  }

  async openFolder(folder: string): Promise<void> {
    this.closePreview();
    const id = crypto.randomUUID();
    const workspaceId = useViewStateStore.getState().activeWorkspaceKey;
    useImageSetStore.setState({
      preview: { id, folder, workspaceId, members: [], loading: true, opening: false, error: null },
    });
    try {
      const members = folderImageMembers(folder, await getApiService().listDirectory(folder, 1));
      const preview = useImageSetStore.getState().preview;
      if (preview?.id !== id) return;
      useImageSetStore.setState({ preview: { ...preview, members, loading: false } });
    } catch (error) {
      const preview = useImageSetStore.getState().preview;
      if (preview?.id === id)
        useImageSetStore.setState({
          preview: { ...preview, loading: false, error: toError(error).message },
        });
    }
  }

  closePreview(): void {
    const preview = useImageSetStore.getState().preview;
    // Closing while the first member loads invalidates its publication guard.
    if (preview?.setId && !useImageSetStore.getState().sets[preview.setId]?.layerId)
      this.forget(preview.setId);
    useImageSetStore.setState({ preview: null });
  }

  async confirmPreview(selectedPaths: string[], name: string): Promise<void> {
    const preview = useImageSetStore.getState().preview;
    if (!preview || preview.loading || preview.opening) return;
    const selected = new Set(selectedPaths);
    const members = preview.members.filter((member) => selected.has(member.path));
    if (!members.length) return;
    const id = crypto.randomUUID();
    const entry: ImageSelectionSet = {
      id,
      folder: preview.folder,
      name: name.trim() || folderName(preview.folder),
      members,
      layerId: null,
      activeIndex: -1,
      pendingIndex: null,
      error: null,
      renderByMember: {},
    };
    useImageSetStore.setState((state) => ({
      sets: { ...state.sets, [id]: entry },
      preview: { ...preview, opening: true, error: null, setId: id },
    }));
    await this.selectMember(id, 0, preview.workspaceId);
    const current = useImageSetStore.getState();
    if (current.preview?.id !== preview.id) return;
    if (current.sets[id]?.layerId) {
      useImageSetStore.setState({ preview: null });
    } else {
      useImageSetStore.setState({
        preview: {
          ...current.preview,
          opening: false,
          error: current.sets[id]?.error || 'Could not open the image set.',
          setId: undefined,
        },
      });
      this.forget(id);
    }
  }

  /** Latest choice wins; each set has at most one decode/upload in flight. */
  selectMember(
    id: string,
    index: number,
    workspaceId = useViewStateStore.getState().activeWorkspaceKey,
  ): Promise<void> {
    const entry = useImageSetStore.getState().sets[id];
    if (!entry || !Number.isInteger(index) || !entry.members[index]) return Promise.resolve();
    if (entry.activeIndex === index && entry.pendingIndex === null) return Promise.resolve();
    this.requests.set(id, { index, token: crypto.randomUUID(), workspaceId });
    this.update(id, { pendingIndex: index, error: null });
    let running = this.running.get(id);
    if (!running) {
      running = this.drain(id).finally(() => this.running.delete(id));
      this.running.set(id, running);
    }
    return running;
  }

  private saveRender(id: string, layerId: string): void {
    const entry = useImageSetStore.getState().sets[id];
    const member = entry?.members[entry.activeIndex];
    if (!member) return;
    const render: Record<string, ViewLayer> = {};
    for (const [workspaceId, state] of useViewStateStore.getState().workspaceViewStates) {
      const layer = state.layers.find((item) => item.id === layerId);
      if (layer) render[workspaceId] = structuredClone(layer);
    }
    this.update(id, { renderByMember: { ...entry.renderByMember, [member.path]: render } });
  }

  private async drain(id: string): Promise<void> {
    while (this.requests.has(id)) {
      const request = this.requests.get(id)!;
      const entry = useImageSetStore.getState().sets[id];
      if (!entry) return;
      if (entry.activeIndex === request.index) {
        this.requests.delete(id);
        this.update(id, { pendingIndex: null });
        continue;
      }
      const member = entry.members[request.index];
      const isCurrent = () =>
        this.requests.get(id)?.token === request.token &&
        !!useImageSetStore.getState().sets[id] &&
        (!entry.layerId || useLayerStore.getState().getLayer(entry.layerId) !== undefined);
      const queue = useLoadingQueueStore.getState();
      const queueId = queue.enqueue({
        type: 'volume-load',
        path: member.path,
        displayName: member.name,
      });
      const release = await fileLoadScheduler.acquire();
      let unownedVolumeId: string | undefined;
      try {
        if (!isCurrent()) {
          queue.cancel(queueId);
          continue;
        }
        queue.startLoading(queueId);
        queue.updateProgress(queueId, undefined, 'Reading image-set member');
        // loadFile already materializes remote sources into the bounded disk cache.
        const handle = await getApiService().loadFile(member.path);
        unownedVolumeId = handle.id;
        if (!isCurrent()) {
          queue.cancel(queueId);
          continue;
        }
        queue.updateProgress(queueId, undefined, 'Preparing display');
        // VolumeLoadingService now owns rollback of this decoded handle.
        unownedVolumeId = undefined;
        const layer = await getVolumeLoadingService().loadVolume({
          volumeHandle: handle,
          workspaceId: request.workspaceId,
          displayName: entry.name,
          source: 'file',
          sourcePath: member.path,
          layerType: inferLayerTypeFromName(member.name, 'file'),
          imageSetId: id,
          visible: true,
          replacement: {
            replaceLayerId: entry.layerId ?? undefined,
            memberRender: entry.renderByMember[member.path],
            isCurrent,
            beforeCommit: () => {
              if (entry.layerId) this.saveRender(id, entry.layerId);
            },
            afterCommit: (next) =>
              this.update(id, { layerId: next.id, activeIndex: request.index, error: null }),
          },
        });
        // A newer request may arrive during retirement of the previous GPU resource.
        // The committed member is still real, so record it before draining the next choice.
        if (!entry.layerId && useImageSetStore.getState().sets[id]) {
          const workspace = useWorkspaceStore.getState().workspaces.get(request.workspaceId);
          if (workspace?.type === 'comparison') {
            useComparisonStore
              .getState()
              .ensurePanelsForLayers(
                request.workspaceId,
                [layer.id],
                new Map([[layer.id, entry.name]]),
              );
          }
          if (useViewStateStore.getState().activeWorkspaceKey === request.workspaceId) {
            useLayerStore.getState().selectLayer(layer.id);
            const base = useLayerStore.getState().layers.find((item) => item.source !== 'atlas');
            useInspectorSelectionStore.setState({
              activeItemId: layer.id,
              activeItemKind: base?.id === layer.id ? 'volume-base' : 'volume-overlay',
            });
          }
        }
        queue.markComplete(queueId, { layerId: layer.id, volumeId: handle.id });
        getEventBus().emit('file.loaded', { path: member.path, volumeId: handle.id });
      } catch (error) {
        if (isCurrent()) {
          const failure = toError(error);
          this.update(id, { error: failure.message });
          queue.markError(queueId, failure);
        } else queue.cancel(queueId);
      } finally {
        if (unownedVolumeId)
          await getApiService().unloadVolume(unownedVolumeId).catch(console.warn);
        release();
        if (this.requests.get(id)?.token === request.token) {
          this.requests.delete(id);
          this.update(id, { pendingIndex: null });
        }
      }
    }
  }
}

let instance: ImageSetService | undefined;
export const getImageSetService = () => (instance ??= new ImageSetService());
