import { createStore } from 'zustand/vanilla';
import { RenderClient } from '@brainflow/api';
import type { DecodedRawRgbaFrame, RenderViewPayload, RenderViewType } from '@brainflow/api';
import { BrowserTransport } from './transport';
import type { BrowserVolume, BrowserGpuCapabilities, BrowserSurface } from './protocol';

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
  /** The one layer advancing only after its preceding frame is presented. */
  playing: string | null;
  frameRevision: number;
  selectedLabel: number | null;
  view: 'slices' | 'surface';
  surface: { id: string; name: string; vertices: number; faces: number } | null;
  surfacePick: { world: [number, number, number]; vertex: number } | null;
}
const initial = (): BrowserState => ({
  gpu: null,
  ready: false,
  loading: false,
  error: null,
  layers: [],
  crosshair: [0, 0, 0],
  selected: null,
  playing: null,
  frameRevision: 0,
  selectedLabel: null,
  view: 'slices',
  surface: null,
  surfacePick: null,
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
  surfaceGeometry: BrowserSurface | null = null;
  private surfaceRequest = 0;
  private playbackTimer: ReturnType<typeof setTimeout> | undefined;
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
  async load(file: File, labels = false, table?: File) {
    const generation = this.generation;
    const abort = new AbortController();
    this.loads.add(abort);
    this.store.setState({ loading: true, error: null });
    try {
      const volume = await this.transport.request<BrowserVolume>(
        'load_file',
        { file, labels, table },
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
        view: 'slices',
        selectedLabel: null,
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
  async loadSurface(file: File) {
    const generation = this.generation;
    const request = ++this.surfaceRequest;
    const abort = new AbortController();
    this.loads.add(abort);
    this.store.setState({ loading: true, error: null });
    try {
      const mesh = await this.transport.request<BrowserSurface>(
        'load_surface',
        { file },
        abort.signal,
      );
      if (this.closed || generation !== this.generation || request !== this.surfaceRequest) return;
      this.surfaceGeometry = mesh;
      this.stopPlayback();
      this.store.setState({
        surface: {
          id: mesh.id,
          name: mesh.name,
          vertices: mesh.vertices.length / 3,
          faces: mesh.faces.length / 3,
        },
        surfacePick: null,
        view: 'surface',
      });
    } catch (error) {
      if (generation === this.generation && request === this.surfaceRequest) this.error(error);
    } finally {
      this.loads.delete(abort);
      if (!this.closed) this.store.setState({ loading: this.loads.size > 0 });
    }
  }
  unloadSurface() {
    ++this.surfaceRequest;
    this.surfaceGeometry = null;
    this.store.setState({ surface: null, surfacePick: null, view: 'slices' });
  }
  setView(view: 'slices' | 'surface') {
    if (view === 'surface' && !this.surfaceGeometry) return;
    this.stopPlayback();
    this.store.setState({ view });
  }
  pickSurface(world: [number, number, number], picked?: { handle: string; vertex: number }) {
    if (!picked || picked.handle !== this.surfaceGeometry?.id || !world.every(Number.isFinite))
      return;
    this.store.setState({ surfacePick: { world, vertex: picked.vertex } });
  }
  surfaceError(id: string | undefined, error: unknown) {
    if (id !== this.surfaceGeometry?.id) return;
    this.unloadSurface();
    this.error(error);
  }
  async loadLabels(files: File[]) {
    if (!files.length) return;
    const images = files.filter((file) => /\.nii(\.gz)?$/i.test(file.name));
    const tables = files.filter((file) => /\.(tsv|lut|txt)$/i.test(file.name));
    if (
      images.length !== 1 ||
      tables.length > 1 ||
      images.length + tables.length !== files.length
    ) {
      this.error(
        new Error('Select one label NIfTI and, optionally, one TSV or FreeSurfer LUT together.'),
      );
      return;
    }
    await this.load(images[0], true, tables[0]);
  }
  cancelLoads() {
    for (const abort of this.loads) abort.abort();
  }
  select(id: string) {
    this.store.setState({ selected: id, selectedLabel: null });
    this.schedule();
  }
  update(id: string, patch: Partial<Pick<BrowserLayer, 'window' | 'opacity'>>) {
    this.store.setState({
      layers: this.store.getState().layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    });
    this.schedule();
  }
  setTimepoint(id: string, timepoint: number) {
    const layer = this.store.getState().layers.find((candidate) => candidate.id === id);
    if (!layer || layer.frameCount < 2 || !Number.isInteger(timepoint)) return;
    const currentFrame = Math.max(0, Math.min(timepoint, layer.frameCount - 1));
    if (currentFrame === layer.currentFrame) return;
    this.store.setState({
      layers: this.store
        .getState()
        .layers.map((candidate) =>
          candidate.id === id ? { ...candidate, currentFrame } : candidate,
        ),
    });
    this.schedule();
  }
  togglePlayback(id: string) {
    const layer = this.store.getState().layers.find((candidate) => candidate.id === id);
    if (!layer || layer.frameCount < 2) return;
    const playing = this.store.getState().playing === id ? null : id;
    this.stopPlaybackTimer();
    this.store.setState({ playing });
    if (playing) this.schedule();
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
    if (this.store.getState().playing === id) this.stopPlayback();
    this.store.setState({ layers, selected: layers.at(-1)?.id ?? null, selectedLabel: null });
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
    this.unloadSurface();
    this.stopPlayback();
    const layers = this.store.getState().layers;
    this.store.setState({ layers: [], selected: null, playing: null, error: null });
    this.clearFrames();
    for (const l of layers) {
      try {
        await this.transport.invoke('unload_volume', { volumeId: l.id });
      } catch (e) {
        this.error(e);
      }
    }
  }
  plane(view: RenderViewType, size = 512, state = this.store.getState()) {
    const { layers, crosshair } = state;
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
  payload(view: RenderViewType, state = this.store.getState()): RenderViewPayload {
    const { layers, crosshair } = state;
    const views = {
      axial: this.plane('axial', 512, state),
      coronal: this.plane('coronal', 512, state),
      sagittal: this.plane('sagittal', 512, state),
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
    // A newer interaction must finish presenting before playback advances again.
    this.stopPlaybackTimer();
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
        const snapshot = this.store.getState();
        if (!snapshot.layers.length) continue;
        const revision = this.revision;
        await this.prepareTimepoints(snapshot.layers);
        if (this.closed || revision !== this.revision) continue;
        const selected = snapshot.layers.find((layer) => layer.id === snapshot.selected);
        const selectedLabel = selected?.labelIds
          ? await this.transport.invoke<number | null>('label_at_world', {
              volumeId: selected.id,
              world: snapshot.crosshair,
            })
          : null;
        if (this.closed || revision !== this.revision) continue;
        const outcomes = await Promise.allSettled(
          orientations.map(async (view) => {
            const { frame } = await this.client.renderView(this.payload(view, snapshot), {
              format: 'rgba',
            });
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
        this.store.setState((s) => ({ frameRevision: s.frameRevision + 1, selectedLabel }));
        this.queuePlayback(revision);
      }
    } catch (e) {
      this.stopPlayback();
      this.error(e);
    } finally {
      this.rendering = false;
      if (this.dirty && !this.closed) void this.render();
    }
  }
  private clearFrames() {
    this.frames.forEach((f) => f.close());
    this.frames.clear();
    this.store.setState((s) => ({ frameRevision: s.frameRevision + 1, selectedLabel: null }));
  }
  private async prepareTimepoints(layers: readonly BrowserLayer[]) {
    const pending = layers.filter((layer) => layer.frameCount > 1);
    await Promise.all(
      pending.map(async (layer) => {
        await this.transport.invoke('set_timepoint', {
          volumeId: layer.id,
          timepoint: layer.currentFrame,
        });
      }),
    );
  }
  private queuePlayback(revision: number) {
    const id = this.store.getState().playing;
    if (!id || revision !== this.revision || this.closed) return;
    const layer = this.store.getState().layers.find((candidate) => candidate.id === id);
    if (!layer || layer.frameCount < 2) {
      this.stopPlayback();
      return;
    }
    this.stopPlaybackTimer();
    this.playbackTimer = setTimeout(() => {
      this.playbackTimer = undefined;
      if (this.closed || this.store.getState().playing !== id) return;
      const current = this.store.getState().layers.find((candidate) => candidate.id === id);
      if (current) this.setTimepoint(id, (current.currentFrame + 1) % current.frameCount);
    }, 250);
  }
  private stopPlaybackTimer() {
    if (this.playbackTimer !== undefined) clearTimeout(this.playbackTimer);
    this.playbackTimer = undefined;
  }
  private stopPlayback() {
    this.stopPlaybackTimer();
    if (this.store.getState().playing) this.store.setState({ playing: null });
  }
  dispose() {
    this.closed = true;
    ++this.generation;
    ++this.revision;
    this.cancelLoads();
    this.unloadSurface();
    this.stopPlayback();
    this.clearFrames();
    this.transport.dispose();
  }
}
