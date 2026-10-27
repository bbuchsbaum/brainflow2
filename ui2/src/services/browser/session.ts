import { createStore } from 'zustand/vanilla';
import { RenderClient } from '@brainflow/api';
import type { DecodedRawRgbaFrame, RenderViewPayload, RenderViewType } from '@brainflow/api';
import { BrowserTransport } from './transport';
import type { BrowserVolume, BrowserGpuCapabilities } from './protocol';

export const orientations: RenderViewType[] = ['axial', 'coronal', 'sagittal'];
export type BrowserLayer = BrowserVolume & { window: [number, number]; opacity: number };
export interface BrowserState {
  gpu: BrowserGpuCapabilities | null;
  ready: boolean;
  loading: boolean;
  error: string | null;
  layers: BrowserLayer[];
  crosshair: [number, number, number];
  selected: string | null;
  frameRevision: number;
}
const initial = (): BrowserState => ({
  gpu: null,
  ready: false,
  loading: false,
  error: null,
  layers: [],
  crosshair: [0, 0, 0],
  selected: null,
  frameRevision: 0,
});

/** Renderer-owned frames stay outside Zustand; stores hold control state only. */
export class BrowserSession {
  readonly store = createStore<BrowserState>(initial);
  readonly frames = new Map<RenderViewType, ImageBitmap>();
  private client: RenderClient;
  private closed = false;
  private generation = 0;
  private revision = 0;
  private rendering = false;
  private dirty = false;
  private loads = new Set<AbortController>();
  readonly transport: BrowserTransport;
  constructor(transport = new BrowserTransport()) {
    this.transport = transport;
    this.client = new RenderClient(transport);
  }
  async initialize() {
    try {
      const gpu = await this.transport.invoke<BrowserGpuCapabilities>('initialize');
      if (!this.closed) this.store.setState({ ready: true, gpu });
    } catch (e) {
      this.error(e);
    }
  }
  private error(e: unknown) {
    if (!this.closed && !(e instanceof DOMException && e.name === 'AbortError'))
      this.store.setState({ error: String(e instanceof Error ? e.message : e) });
  }
  async load(file: File) {
    const generation = this.generation;
    const abort = new AbortController();
    this.loads.add(abort);
    this.store.setState({ loading: true, error: null });
    try {
      const volume = await this.transport.request<BrowserVolume>(
        'load_file',
        { file },
        abort.signal,
      );
      if (this.closed || generation !== this.generation) {
        await this.transport.invoke('unload_volume', { volumeId: volume.id });
        return;
      }
      const layers = this.store.getState().layers;
      const range: [number, number] =
        volume.range[0] < volume.range[1]
          ? volume.range
          : [volume.range[0] - 0.5, volume.range[1] + 0.5];
      this.store.setState({
        layers: [...layers, { ...volume, window: range, opacity: layers.length ? 0.5 : 1 }],
        selected: volume.id,
        ...(layers.length ? {} : { crosshair: volume.center }),
      });
      this.schedule();
    } catch (e) {
      if (generation === this.generation) this.error(e);
    } finally {
      this.loads.delete(abort);
      if (!this.closed) this.store.setState({ loading: this.loads.size > 0 });
    }
  }
  cancelLoads() {
    for (const abort of this.loads) abort.abort();
  }
  select(id: string) {
    this.store.setState({ selected: id });
  }
  update(id: string, patch: Partial<Pick<BrowserLayer, 'window' | 'opacity'>>) {
    this.store.setState({
      layers: this.store.getState().layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    });
    this.schedule();
  }
  crosshair(point: [number, number, number]) {
    const base = this.store.getState().layers[0];
    if (!base) return;
    const clamped = point.map((v, a) =>
      Math.max(base.bounds[0][a], Math.min(base.bounds[1][a], v)),
    ) as [number, number, number];
    if (!clamped.every(Number.isFinite)) return;
    this.store.setState({ crosshair: clamped });
    this.schedule();
  }
  async remove(id: string) {
    const layers = this.store.getState().layers.filter((l) => l.id !== id);
    this.store.setState({ layers, selected: layers.at(-1)?.id ?? null });
    ++this.revision;
    if (!layers.length) this.clearFrames();
    try {
      await this.transport.invoke('unload_volume', { volumeId: id });
      this.schedule();
    } catch (e) {
      this.error(e);
    }
  }
  async reset() {
    ++this.generation;
    ++this.revision;
    this.cancelLoads();
    const layers = this.store.getState().layers;
    this.store.setState({ layers: [], selected: null, error: null });
    this.clearFrames();
    for (const l of layers) {
      try {
        await this.transport.invoke('unload_volume', { volumeId: l.id });
      } catch (e) {
        this.error(e);
      }
    }
  }
  plane(view: RenderViewType, size = 512) {
    const { layers, crosshair } = this.store.getState();
    const base = layers[0];
    const fov = base ? Math.max(...base.bounds[1].map((v, a) => v - base.bounds[0][a])) * 1.05 : 1;
    const [u, v] =
      view === 'axial'
        ? [
            [fov, 0, 0],
            [0, -fov, 0],
          ]
        : view === 'coronal'
          ? [
              [fov, 0, 0],
              [0, 0, -fov],
            ]
          : [
              [0, -fov, 0],
              [0, 0, -fov],
            ];
    const origin = crosshair.map((c, a) => c - (u[a] + v[a]) / 2) as [number, number, number];
    return {
      origin_mm: origin,
      u_mm: u.map((c) => c / size) as [number, number, number],
      v_mm: v.map((c) => c / size) as [number, number, number],
      dim_px: [size, size] as [number, number],
    };
  }
  payload(view: RenderViewType): RenderViewPayload {
    const { layers, crosshair } = this.store.getState();
    const views = {
      axial: this.plane('axial'),
      coronal: this.plane('coronal'),
      sagittal: this.plane('sagittal'),
    };
    const p = views[view];
    return {
      views,
      crosshair: { world_mm: crosshair, visible: false },
      requestedView: {
        type: view,
        width: 512,
        height: 512,
        origin_mm: [...p.origin_mm, 1],
        u_mm: [...p.u_mm.map((v) => v * 512), 0],
        v_mm: [...p.v_mm.map((v) => v * 512), 0],
      },
      layers: layers.map((l, i) => ({
        id: l.id,
        volumeId: l.id,
        visible: true,
        opacity: l.opacity,
        colormap: i ? 'hot' : 'gray',
        intensity: l.window,
        threshold: [0, 0],
        interpolation: 'linear',
      })),
    };
  }
  private schedule() {
    ++this.revision;
    this.dirty = true;
    void this.render();
  }
  private async render() {
    if (this.rendering || this.closed) return;
    this.rendering = true;
    try {
      while (this.dirty && !this.closed) {
        this.dirty = false;
        if (!this.store.getState().layers.length) continue;
        const revision = this.revision;
        const outcomes = await Promise.allSettled(
          orientations.map(async (view) => {
            const { frame } = await this.client.renderView(this.payload(view), { format: 'rgba' });
            const rgba = frame as DecodedRawRgbaFrame;
            return [
              view,
              await createImageBitmap(
                new ImageData(new Uint8ClampedArray(rgba.rgba), rgba.width, rgba.height),
              ),
            ] as const;
          }),
        );
        const results = outcomes.flatMap((outcome) =>
          outcome.status === 'fulfilled' ? [outcome.value] : [],
        );
        const failure = outcomes.find((outcome) => outcome.status === 'rejected');
        if (failure?.status === 'rejected') {
          results.forEach(([, image]) => image.close());
          throw failure.reason;
        }
        if (this.closed || revision !== this.revision) {
          results.forEach(([, image]) => image.close());
          continue;
        }
        for (const [view, image] of results) {
          this.frames.get(view)?.close();
          this.frames.set(view, image);
        }
        this.store.setState((s) => ({ frameRevision: s.frameRevision + 1 }));
      }
    } catch (e) {
      this.error(e);
    } finally {
      this.rendering = false;
      if (this.dirty && !this.closed) void this.render();
    }
  }
  private clearFrames() {
    this.frames.forEach((f) => f.close());
    this.frames.clear();
    this.store.setState((s) => ({ frameRevision: s.frameRevision + 1 }));
  }
  dispose() {
    this.closed = true;
    ++this.generation;
    ++this.revision;
    this.cancelLoads();
    this.clearFrames();
    this.transport.dispose();
  }
}
