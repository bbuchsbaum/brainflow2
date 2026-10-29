/// <reference lib="webworker" />
import init, {
  BrowserHost,
  decode_surface,
  decode_surface_scalar,
  decode_surface_labels,
} from '../../browser/generated/browser_host';
import wasmUrl from '../../browser/generated/browser_host_bg.wasm?url';
import type {
  BrowserVolume,
  BrowserSurfaceLabel,
  BrowserSurfaceLabels,
  WorkerReply,
  WorkerRequest,
} from './protocol';
import { installWgpu20Compatibility } from './webgpuCompatibility';
import { describeSessionSource } from './sessionSources';

import {
  buildLabelPalette,
  parseLabelTable,
  MAX_CATEGORICAL_LABEL,
  fallbackLabelColor,
} from '../../utils/labelTable';

const scope = self as unknown as DedicatedWorkerGlobalScope;
installWgpu20Compatibility((error) => {
  scope.postMessage({ id: 0, error, fatal: true } satisfies WorkerReply);
});
let host: BrowserHost | undefined;
let wasmInitialized = false;
async function initializeWasm() {
  if (!wasmInitialized) {
    await init({ module_or_path: wasmUrl });
    wasmInitialized = true;
  }
}
let chain = Promise.resolve();
const cancelled = new Set<number>();
const completedLoads = new Map<number, string>();

async function execute(message: Extract<WorkerRequest, { id: number }>) {
  const { id, cmd } = message;
  if (cancelled.delete(id)) return;
  try {
    const args = (message.args ?? {}) as Record<string, unknown>;
    if (cmd === 'describe_source') {
      const value = await describeSessionSource(args.file as File, () => cancelled.has(id));
      if (!cancelled.delete(id)) scope.postMessage({ id, value } satisfies WorkerReply);
      return;
    }
    if (cmd === 'load_surface' || cmd === 'load_surface_scalar' || cmd === 'load_surface_labels') {
      if (!(args.file instanceof File) || args.file.size > 64 * 1024 * 1024)
        throw new Error('Select a self-contained GIfTI no larger than 64 MiB.');
      await initializeWasm();
      const bytes = new Uint8Array(await args.file.arrayBuffer());
      if (cancelled.delete(id)) return;
      if (cmd === 'load_surface_scalar') {
        const values = decode_surface_scalar(bytes);
        if (!cancelled.delete(id))
          scope.postMessage({ id, value: values } satisfies WorkerReply, [values.buffer]);
        return;
      }
      if (cmd === 'load_surface_labels') {
        const decoded = decode_surface_labels(bytes);
        let labels: Uint32Array;
        let table: Array<
          Omit<BrowserSurfaceLabel, 'rgba'> & { rgba: BrowserSurfaceLabel['rgba'] | null }
        >;
        try {
          labels = decoded.labels();
          table = JSON.parse(decoded.table());
        } finally {
          decoded.free();
        }
        const entries = new Map(table.map((entry) => [entry.id, entry]));
        const legend: BrowserSurfaceLabel[] = Array.from(new Set(labels))
          .sort((a, b) => a - b)
          .map((id) => {
            const entry = entries.get(id);
            return {
              id,
              name: entry?.name || (id === 0 ? 'Background' : `Label ${id}`),
              rgba:
                id === 0
                  ? [0, 0, 0, 0]
                  : (entry?.rgba ??
                    ([
                      ...fallbackLabelColor(id).map((v) => v / 255),
                      1,
                    ] as BrowserSurfaceLabel['rgba'])),
            };
          });
        const colors = new Map(legend.map((entry) => [entry.id, entry.rgba]));
        const rgba = new Float32Array(labels.length * 4);
        for (let vertex = 0; vertex < labels.length; vertex++)
          rgba.set(colors.get(labels[vertex])!, vertex * 4);
        const value: BrowserSurfaceLabels = { labels, rgba, legend };
        if (!cancelled.delete(id))
          scope.postMessage({ id, value } satisfies WorkerReply, [labels.buffer, rgba.buffer]);
        return;
      }
      const decoded = decode_surface(bytes);
      let value;
      try {
        value = {
          id: `surface-${id}`,
          name: args.file.name,
          vertices: decoded.vertices(),
          faces: decoded.faces(),
          hemisphere: decoded.hemisphere(),
          surfaceType: decoded.surface_type(),
        };
      } finally {
        decoded.free();
      }
      if (!cancelled.delete(id))
        scope.postMessage({ id, value } satisfies WorkerReply, [
          value.vertices.buffer,
          value.faces.buffer,
        ]);
      return;
    }
    if (!host) {
      if (!(navigator as unknown as { gpu?: unknown }).gpu) {
        throw new Error(
          'WebGPU is unavailable in this browser worker. Open the viewer over HTTPS or localhost in a WebGPU-capable browser, or use the desktop app.',
        );
      }
      const ceiling = args.maxSampledTextures;
      if (
        ceiling !== undefined &&
        (typeof ceiling !== 'number' ||
          !Number.isInteger(ceiling) ||
          ceiling < 0 ||
          ceiling > 0xffffffff)
      ) {
        throw new Error('The GPU sampled-texture ceiling must be an unsigned integer.');
      }
      await initializeWasm();
      host = await BrowserHost.create(ceiling as number | undefined);
    }
    let value: unknown;
    switch (cmd) {
      case 'initialize':
        value = JSON.parse(host.capabilities());
        break;
      case 'load_file': {
        if (!(args.file instanceof File))
          throw new Error('Select a browser file; native paths are unavailable.');
        if (args.file.size > 256 * 1024 * 1024)
          throw new Error('File exceeds the 256 MiB browser input limit.');
        let entries = [] as ReturnType<typeof parseLabelTable>;
        if (args.table !== undefined) {
          if (!(args.table instanceof File) || args.table.size > 1024 * 1024)
            throw new Error('Select a label table smaller than 1 MiB.');
          entries = parseLabelTable(await args.table.text());
          if (!entries.length || entries.some((entry) => entry.id > MAX_CATEGORICAL_LABEL))
            throw new Error('Label table must contain names and integer IDs from 0 to 2047.');
        }
        const bytes = new Uint8Array(await args.file.arrayBuffer());
        if (cancelled.delete(id)) return;
        const volume = JSON.parse(
          await (args.labels === true || args.table
            ? host.load_label_nifti(args.file.name, bytes)
            : host.load_nifti(args.file.name, bytes)),
        ) as BrowserVolume;
        try {
          if (volume.labelIds) {
            const table = new Map(entries.map((entry) => [entry.id, entry]));
            const palette = buildLabelPalette(
              volume.labelIds.map(
                (label) => table.get(label) ?? { id: label, name: `Label ${label}`, color: null },
              ),
            );
            const rgba = new Uint8Array((MAX_CATEGORICAL_LABEL + 1) * 4);
            // Only IDs present in the volume receive opacity; holes and label 0 stay clear.
            for (const entry of palette.legend) {
              rgba.set([...entry.color, 255], entry.label_id * 4);
            }
            await host.set_label_palette(volume.id, rgba);
            volume.legend = palette.legend;
          }
        } catch (error) {
          await host.unload(volume.id);
          throw error;
        }
        completedLoads.set(id, volume.id);
        value = volume;
        break;
      }
      case 'unload_volume':
        await host.unload(String(args.volumeId));
        value = null;
        break;
      case 'set_timepoint': {
        if (typeof args.volumeId !== 'string')
          throw new Error('A loaded browser volume is required.');
        if (
          typeof args.timepoint !== 'number' ||
          !Number.isInteger(args.timepoint) ||
          args.timepoint < 0 ||
          args.timepoint > 0xffffffff
        ) {
          throw new Error('The browser timepoint must be an unsigned integer.');
        }
        await host.set_timepoint(args.volumeId, args.timepoint);
        value = null;
        break;
      }
      case 'projection_frame': {
        if (
          typeof args.volumeId !== 'string' ||
          typeof args.timepoint !== 'number' ||
          !Number.isInteger(args.timepoint) ||
          args.timepoint < 0 ||
          args.timepoint > 0xffffffff
        )
          throw new Error('Projection requires a volume and a valid frame index.');
        const decoded = host.projection_frame(args.volumeId, args.timepoint);
        let projection;
        try {
          projection = {
            values: decoded.values(),
            dims: Array.from(decoded.dims()),
            affine: decoded.affine(),
          };
        } finally {
          decoded.free();
        }
        if (!cancelled.delete(id))
          scope.postMessage({ id, value: projection } satisfies WorkerReply, [
            projection.values.buffer,
            projection.affine.buffer,
          ]);
        return;
      }
      case 'render_view':
        if (args.format !== 'rgba')
          throw new Error('Browser rendering currently supports RGBA output.');
        value = await host.render_view(String(args.stateJson));
        break;
      case 'label_at_world': {
        const point = args.world;
        if (!Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite))
          throw new Error('A finite world point is required.');
        value = host.label_at_world(String(args.volumeId), point[0], point[1], point[2]) ?? null;
        break;
      }
      case 'workspace_histogram':
        value = JSON.parse(
          host.histogram(
            String(args.volumeId),
            Number(args.binCount ?? 256),
            new Float32Array((args.range as number[]) ?? []),
            Boolean(args.excludeZeros),
            Boolean(args.allFrames),
          ),
        );
        break;
      case 'sample_at_world': {
        const p = args.world as [number, number, number];
        value = host.sample_at_world(String(args.volumeId), ...p) ?? null;
        break;
      }
      case 'workspace_info':
        value = JSON.parse(host.workspace_info(String(args.volumeId)));
        break;
      case 'workspace_view': {
        const p = args.point as [number, number, number];
        value = JSON.parse(
          host.workspace_view(
            String(args.volumeId),
            String(args.orientation),
            Number(args.width),
            Number(args.height),
            new Float32Array(p),
          ),
        );
        break;
      }
      case 'release_gpu':
        host.release_gpu(String(args.volumeId));
        break;
      case 'ensure_gpu':
        await host.ensure_gpu(String(args.volumeId));
        break;
      case 'diagnostics':
        value = JSON.parse(host.diagnostics());
        break;
      default:
        throw new Error(`Unsupported browser command: ${cmd}`);
    }
    if (cancelled.delete(id)) {
      const volume = completedLoads.get(id);
      if (volume) {
        await host.unload(volume);
        completedLoads.delete(id);
      }
      return;
    }
    const transfer = value instanceof Uint8Array ? [value.buffer] : [];
    scope.postMessage({ id, value } satisfies WorkerReply, transfer);
  } catch (e) {
    scope.postMessage({
      id,
      error: String(e instanceof Error ? e.message : e),
    } satisfies WorkerReply);
  }
}

scope.onmessage = ({ data }: MessageEvent<WorkerRequest>) => {
  if ('ack' in data) {
    completedLoads.delete(data.ack);
    return;
  }
  if ('cancel' in data) {
    cancelled.add(data.cancel);
    chain = chain
      .then(async () => {
        const volume = completedLoads.get(data.cancel);
        if (volume && host) {
          await host.unload(volume);
          completedLoads.delete(data.cancel);
        }
        cancelled.delete(data.cancel);
      })
      .catch(() => {});
    return;
  }
  chain = chain.then(() => execute(data));
};
