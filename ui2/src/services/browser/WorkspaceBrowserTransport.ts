import type { BackendTransport } from '../transport';
import { BrowserTransport } from './transport';
import type { BrowserVolume } from './protocol';
import { browserCapabilities, UnsupportedBrowserCapability } from './protocol';
import type { VolumeBounds } from '@brainflow/api';
import type { VolumeHandle } from '../volume/VolumeApiService';

interface VolumeInfo {
  volume: BrowserVolume;
  bounds: VolumeBounds;
  handle: VolumeHandle;
  gpu: {
    data_range: { min: number; max: number };
    dim: number[];
    spacing: number[];
    voxel_to_world: number[];
    world_to_voxel: number[];
  };
}

interface CommandArgs {
  path: string;
  volumeId: string;
  layerId: string;
  stateJson: string;
  format: string;
  layerSpec: { Volume: { id: string; source_resource_id: string } };
  metadataOnly?: boolean;
  crosshairMm: number[];
  dimensions: number[];
  maxPx: number[];
  viewType: string;
  dimensionsByView?: Record<string, number[]>;
  worldCoords: number[];
  timepoint: number;
}

/** Adapts the portable worker to the same contracts consumed by App's services.
 * File tokens and residency are host resources; layer/view state stays in App.
 */
export class WorkspaceBrowserTransport implements BackendTransport {
  readonly host = 'browser' as const;
  readonly capabilities = browserCapabilities;
  readonly worker: BrowserTransport;
  constructor(worker = new BrowserTransport()) {
    this.worker = worker;
  }
  private files = new Map<string, File>();
  private volumes = new Map<string, VolumeInfo>();
  private layers = new Map<string, string>();
  private resident = new Set<string>();
  private ready?: Promise<unknown>;
  registerFile(file: File) {
    const path = `browser-file://${crypto.randomUUID()}/${file.name}`;
    this.files.set(path, file);
    return path;
  }
  forgetFile(path: string) {
    this.files.delete(path);
  }
  private info(id: string) {
    const info = this.volumes.get(this.layers.get(id) ?? id);
    if (!info) throw new Error('Volume was unloaded');
    return info;
  }
  async invoke<T>(command: string, input?: unknown): Promise<T> {
    return this.request<T>(command, input);
  }
  async request<T>(command: string, input?: unknown, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    return (await this.execute(
      command.replace(/^plugin:api-bridge\|/, ''),
      (input ?? {}) as CommandArgs,
      signal,
    )) as T;
  }
  private async execute(
    command: string,
    args: CommandArgs,
    signal?: AbortSignal,
  ): Promise<unknown> {
    switch (command) {
      case 'open_file_dialog': {
        const { useViewStateStore } = await import('../../stores/viewStateStore');
        const workspaceId = useViewStateStore.getState().activeWorkspaceKey;
        const file = await new Promise<File | null>((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.nii,.nii.gz';
          input.ariaLabel = 'Choose image';
          input.hidden = true;
          document.body.append(input);
          const finish = (file: File | null) => {
            input.remove();
            resolve(file);
          };
          input.onchange = () => finish(input.files?.[0] ?? null);
          input.oncancel = () => finish(null);
          input.click();
        });
        if (!file) return;
        const path = this.registerFile(file);
        try {
          const { getDisplayLifecycleOrchestrator } = await import(
            '../DisplayLifecycleOrchestrator'
          );
          return await getDisplayLifecycleOrchestrator().loadFile({
            path,
            ingress: 'file-dialog',
            workspaceId,
          });
        } finally {
          this.forgetFile(path);
        }
      }
      case 'init_render_loop':
        return (this.ready ??= this.worker.invoke('initialize'));
      case 'load_file': {
        const file = this.files.get(args.path);
        if (!file) throw new Error('Select a browser file; native paths are unavailable.');
        const volume = await this.worker.request<BrowserVolume>('load_file', { file }, signal);
        try {
          const info = await this.worker.invoke<VolumeInfo>('workspace_info', {
            volumeId: volume.id,
          });
          signal?.throwIfAborted();
          this.volumes.set(volume.id, info);
          this.resident.add(volume.id);
          return { ...info.handle, path: args.path };
        } catch (error) {
          await this.worker.invoke('unload_volume', { volumeId: volume.id });
          throw error;
        }
      }
      case 'sample_layer_value_at_world':
        return this.worker
          .invoke<number | null>('sample_at_world', {
            volumeId: this.info(args.layerId).volume.id,
            world: args.worldCoords,
          })
          .then((value) => value ?? 0);
      case 'compute_layer_histogram':
        return this.worker.invoke('workspace_histogram', {
          ...args,
          volumeId: this.info(args.layerId).volume.id,
        });
      case 'get_volume_bounds':
        return this.info(args.volumeId).bounds;
      case 'get_initial_views':
      case 'recalculate_all_views': {
        const v = this.info(args.volumeId).volume;
        const point = args.crosshairMm ?? v.center;
        return Object.fromEntries(
          await Promise.all(
            ['axial', 'coronal', 'sagittal'].map(async (orientation) => [
              orientation,
              await this.view(
                v.id,
                orientation,
                args.dimensionsByView?.[orientation] ?? args.maxPx,
                point,
              ),
            ]),
          ),
        );
      }
      case 'recalculate_view_for_dimensions':
        return this.view(args.volumeId, args.viewType, args.dimensions, args.crosshairMm);
      case 'request_layer_gpu_resources': {
        const spec = args.layerSpec.Volume;
        const info = this.info(spec.source_resource_id);
        if (!args.metadataOnly && !this.resident.has(info.volume.id)) {
          await this.worker.invoke('ensure_gpu', { volumeId: info.volume.id });
          this.resident.add(info.volume.id);
        }
        this.layers.set(spec.id, info.volume.id);
        return info.gpu;
      }
      case 'wait_for_layer_ready':
        return this.resident.has(this.layers.get(args.layerId) ?? args.layerId);
      case 'release_layer_gpu_resources': {
        const id = this.layers.get(args.layerId) ?? args.layerId;
        if (this.resident.has(id)) {
          await this.worker.invoke('release_gpu', { volumeId: id });
          this.resident.delete(id);
        }
        this.layers.delete(args.layerId);
        return;
      }
      case 'unload_volume': {
        if (!this.volumes.has(args.volumeId)) return;
        await this.worker.invoke('unload_volume', args);
        this.volumes.delete(args.volumeId);
        this.resident.delete(args.volumeId);
        return;
      }
      case 'render_view': {
        const payload = JSON.parse(args.stateJson) as {
          timepoint?: number;
          layers: Array<{ volumeId: string }>;
        };
        for (const layer of payload.layers) {
          const volume = this.info(layer.volumeId).volume;
          const frame = payload.timepoint ?? volume.currentFrame;
          if (volume.frameCount > 1 && frame !== volume.currentFrame) {
            await this.worker.invoke('set_timepoint', { volumeId: volume.id, timepoint: frame });
            volume.currentFrame = frame;
          }
        }
        delete payload.timepoint;
        return this.worker.invoke('render_view', { ...args, stateJson: JSON.stringify(payload) });
      }
      case 'set_volume_timepoint': {
        await this.worker.invoke('set_timepoint', args);
        this.info(args.volumeId).volume.currentFrame = args.timepoint;
        return;
      }
      case 'get_volume_timepoint':
        return this.info(args.volumeId).volume.currentFrame;
      // Targets are per-frame in the portable renderer, rather than global.
      case 'create_offscreen_render_target':
      case 'resize_canvas':
        return;
      case 'diagnostics':
        return this.worker.invoke('diagnostics');
      default:
        throw new UnsupportedBrowserCapability(command);
    }
  }
  private view(volumeId: string, orientation: string, dimensions: number[], point: number[]) {
    return this.worker.invoke('workspace_view', {
      volumeId,
      orientation,
      width: dimensions[0],
      height: dimensions[1],
      point,
    });
  }
  dispose() {
    this.files.clear();
    this.volumes.clear();
    this.layers.clear();
    this.resident.clear();
    this.worker.dispose();
  }
}
