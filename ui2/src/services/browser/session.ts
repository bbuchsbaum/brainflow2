import { createStore } from 'zustand/vanilla';
import { RenderClient } from '@brainflow/api';
import type { DecodedRawRgbaFrame, RenderViewPayload, RenderViewType } from '@brainflow/api';
import { BrowserTransport } from './transport';
import type { BrowserSessionRecord } from './sessionRecord';
import type { SurfaceCanvasExporter, SurfaceCameraState } from '@brainflow/visualization/surface';
import type { SessionSource } from './sessionSources';
import type {
  BrowserVolume,
  BrowserGpuCapabilities,
  BrowserSurface,
  BrowserSurfaceLabels,
} from './protocol';

export const browserColormaps = ['gray', 'viridis', 'hot'] as const;
export const orientations: RenderViewType[] = ['axial', 'coronal', 'sagittal'];
export type BrowserLayer = BrowserVolume & {
  window: [number, number];
  opacity: number;
  colormap?: string;
};
export type BrowserSurfaceOverlay = { id: string; name: string; opacity: number } & (
  | { kind: 'scalar'; range: [number, number]; dataRange: [number, number]; colormap: string }
  | { kind: 'labels' }
);
export interface BrowserSurfaceState {
  id: string;
  name: string;
  vertices: number;
  faces: number;
  hemisphere: string;
  overlay: BrowserSurfaceOverlay | null;
  linked: boolean;
}
export interface BrowserSurfaceResources {
  geometry: BrowserSurface;
  source: File | null;
  overlaySource: File | null;
  values: Float32Array | null;
  labels: BrowserSurfaceLabels | null;
  overlayRequest: number;
}
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
  surfaces: BrowserSurfaceState[];
  selectedSurface: string | null;
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
  surfaces: [],
  selectedSurface: null,
  surfacePick: null,
});

/** Renderer-owned frames stay outside Zustand; stores hold control state only. */
export class BrowserSession {
  readonly store = createStore<BrowserState>(initial);
  readonly frames = new Map<RenderViewType, ImageBitmap>();
  surfaceExporter: SurfaceCanvasExporter | null = null;
  surfaceCamera: SurfaceCameraState | null = null;
  recordSurfaceCamera(state: SurfaceCameraState) {
    this.surfaceCamera = state;
  }
  private presented: BrowserState | null = null;
  private presentedRevision = -1;
  get presentedState(): BrowserState | null {
    return this.presented;
  }
  /** Wait for the current requested slice state, including GPU/frame conversion failures. */
  async whenPresented(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (!this.store.getState().layers.length) return;
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: unknown) => {
        unsubscribe();
        signal.removeEventListener('abort', abort);
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      const abort = () => finish(new DOMException('Operation cancelled', 'AbortError'));
      const check = () => {
        const state = this.store.getState();
        if (this.closed || signal.aborted) abort();
        else if (state.error) finish(new Error(state.error));
        else if (this.presentedRevision === this.revision) finish();
      };
      const unsubscribe = this.store.subscribe(check);
      const timeout = setTimeout(
        () => finish(new Error('Timed out waiting for restored images.')),
        60_000,
      );
      signal.addEventListener('abort', abort, { once: true });
      check();
    });
  }
  private volumeSources = new Map<string, { file: File; labels: boolean; table?: File }>();

  private client: RenderClient;
  private closed = false;
  private generation = 0;
  get workspaceGeneration() {
    return this.generation;
  }
  private revision = 0;
  private rendering = false;
  private dirty = false;
  private loads = new Set<AbortController>();
  readonly surfaceResources = new Map<string, BrowserSurfaceResources>();
  get activeSurface() {
    const state = this.store.getState();
    return state.surfaces.find((s) => s.id === state.selectedSurface) ?? null;
  }
  get surfaceGeometry() {
    return this.surfaceResources.get(this.store.getState().selectedSurface ?? '')?.geometry ?? null;
  }
  get surfaceValues() {
    return this.surfaceResources.get(this.store.getState().selectedSurface ?? '')?.values ?? null;
  }
  get surfaceLabels() {
    return this.surfaceResources.get(this.store.getState().selectedSurface ?? '')?.labels ?? null;
  }
  private surfaceRequest = 0;
  private patchSurface(id: string, patch: Partial<BrowserSurfaceState>) {
    this.store.setState((state) => ({
      surfaces: state.surfaces.map((surface) =>
        surface.id === id ? { ...surface, ...patch } : surface,
      ),
    }));
  }
  selectSurface(id: string) {
    if (this.surfaceResources.has(id))
      this.store.setState({ selectedSurface: id, surfacePick: null });
  }
  private playbackTimer: ReturnType<typeof setTimeout> | undefined;
  readonly transport: BrowserTransport;
  constructor(transport = new BrowserTransport()) {
    this.transport = transport;
    this.client = new RenderClient(transport);
  }
  /** Freeze settings and File references before hashing; later edits cannot change this save. */
  async saveRecord(signal?: AbortSignal): Promise<BrowserSessionRecord> {
    signal?.throwIfAborted();
    if (this.closed) throw new Error('Browser viewer is closed');
    const state = structuredClone(this.store.getState());
    if (state.loading) throw new Error('Wait for loading to finish before saving the session.');
    const sources = state.layers.map((layer) => {
      const source = this.volumeSources.get(layer.id);
      if (!source) throw new Error('The original image source is unavailable.');
      return source;
    });
    const surfaceSources = state.surfaces.map((surface) => {
      const resource = this.surfaceResources.get(surface.id);
      if (!resource?.source) throw new Error('The original surface source is unavailable.');
      return { source: resource.source, overlaySource: resource.overlaySource };
    });
    const camera = structuredClone(this.surfaceExporter?.captureCamera?.() ?? this.surfaceCamera);
    const generation = this.generation;
    const describe = async (file: File) => {
      const source = await this.transport.request<SessionSource>(
        'describe_source',
        { file },
        signal,
      );
      if (this.closed || generation !== this.generation)
        throw new DOMException('Workspace closed', 'AbortError');
      return source;
    };
    const volumes: BrowserSessionRecord['volumes'] = [];
    for (const [index, source] of sources.entries()) {
      const layer = state.layers[index];
      volumes.push({
        source: await describe(source.file),
        ...(source.table ? { table: await describe(source.table) } : {}),
        labels: source.labels,
        window: layer.window,
        opacity: layer.opacity,
        colormap: layer.colormap ?? (index ? 'hot' : 'gray'),
        frame: layer.currentFrame,
      });
    }
    const record: BrowserSessionRecord = {
      format: 'brainflow-browser-session',
      version: 2,
      surfaces: [],
      selectedSurface: state.surfaces.findIndex((s) => s.id === state.selectedSurface),
      ...(camera ? { camera } : {}),
      volumes,
      selected:
        state.selected === null
          ? null
          : state.layers.findIndex((layer) => layer.id === state.selected),
      crosshair: state.crosshair,
      view: state.view,
    };
    for (const [index, files] of surfaceSources.entries()) {
      const surface = state.surfaces[index];
      const saved: BrowserSessionRecord['surfaces'][number] = {
        source: await describe(files.source),
        linked: surface.linked,
      };
      if (files.overlaySource && surface.overlay) {
        const settings = surface.overlay;
        saved.overlay = {
          source: await describe(files.overlaySource),
          kind: settings.kind,
          opacity: settings.opacity,
          ...(settings.kind === 'scalar'
            ? { range: settings.range, colormap: settings.colormap }
            : {}),
        };
      }
      record.surfaces.push(saved);
    }
    return record;
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
      this.volumeSources.set(volume.id, { file, labels, table });
      const layers = this.store.getState().layers;
      const range: [number, number] =
        volume.range[0] < volume.range[1]
          ? volume.range
          : [volume.range[0] - 0.5, volume.range[1] + 0.5];
      this.store.setState({
        layers: [
          ...layers,
          {
            ...volume,
            window: range,
            opacity: layers.length ? 0.5 : 1,
            colormap: layers.length ? 'hot' : 'gray',
          },
        ],
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
  async loadSurface(file: File, add = false) {
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
      const existing = this.store.getState().surfaces;
      if (
        add &&
        existing.length &&
        (existing.length >= 2 ||
          !['left', 'right'].includes(mesh.hemisphere) ||
          existing.some(
            (surface) =>
              surface.hemisphere === mesh.hemisphere ||
              !['left', 'right'].includes(surface.hemisphere),
          ))
      )
        throw new Error(
          'A paired scene requires one left and one right hemisphere. Unload a surface before replacing it.',
        );
      if (!add) this.surfaceResources.clear();
      this.surfaceResources.set(mesh.id, {
        geometry: mesh,
        source: file,
        overlaySource: null,
        values: null,
        labels: null,
        overlayRequest: 0,
      });
      this.surfaceCamera = null;
      this.stopPlayback();
      this.store.setState({
        surfaces: [
          ...(add ? existing : []),
          {
            id: mesh.id,
            name: mesh.name,
            vertices: mesh.vertices.length / 3,
            faces: mesh.faces.length / 3,
            hemisphere: mesh.hemisphere,
            overlay: null,
            linked: false,
          },
        ],
        selectedSurface: mesh.id,
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
  unloadSurface(id = this.store.getState().selectedSurface) {
    ++this.surfaceRequest;
    if (id) this.surfaceResources.delete(id);
    const surfaces = this.store.getState().surfaces.filter((surface) => surface.id !== id);
    this.surfaceExporter = null;
    this.surfaceCamera = null;
    this.store.setState({
      surfaces,
      selectedSurface: surfaces.at(-1)?.id ?? null,
      surfacePick: null,
      ...(!surfaces.length ? { view: 'slices' as const } : {}),
    });
  }
  private clearSurfaces() {
    ++this.surfaceRequest;
    this.surfaceResources.clear();
    this.surfaceExporter = null;
    this.surfaceCamera = null;
    this.store.setState({ surfaces: [], selectedSurface: null, surfacePick: null, view: 'slices' });
  }
  async loadSurfaceOverlay(file: File, labels = false) {
    const mesh = this.surfaceGeometry;
    if (!mesh || this.closed) return;
    const resource = this.surfaceResources.get(mesh.id)!;
    const request = ++resource.overlayRequest;
    const abort = new AbortController();
    this.loads.add(abort);
    this.store.setState({ loading: true, error: null });
    try {
      const decoded = await this.transport.request<Float32Array | BrowserSurfaceLabels>(
        labels ? 'load_surface_labels' : 'load_surface_scalar',
        { file },
        abort.signal,
      );
      if (
        this.closed ||
        abort.signal.aborted ||
        this.surfaceResources.get(mesh.id) !== resource ||
        request !== resource.overlayRequest
      )
        return;
      const values = decoded instanceof Float32Array ? decoded : decoded.labels;
      if (values.length !== mesh.vertices.length / 3)
        throw new Error(
          `Overlay has ${values.length} values; surface requires ${mesh.vertices.length / 3}.`,
        );
      const common = { id: `surface-overlay-${request}`, name: file.name, opacity: 1 };
      let overlay: BrowserSurfaceOverlay;
      if (decoded instanceof Float32Array) {
        let low = Infinity,
          high = -Infinity;
        for (const value of decoded) {
          if (!Number.isFinite(value))
            throw new Error('Surface overlay requires finite scalar values.');
          low = Math.min(low, value);
          high = Math.max(high, value);
        }
        overlay = {
          ...common,
          kind: 'scalar',
          dataRange: [low, high],
          colormap: 'viridis',
          range:
            low < high
              ? [low, high]
              : [
                  low - Math.max(0.5, Math.abs(low) * 0.01),
                  high + Math.max(0.5, Math.abs(high) * 0.01),
                ],
        };
        resource.values = decoded;
        resource.labels = null;
      } else {
        overlay = { ...common, kind: 'labels' };
        resource.labels = decoded;
        resource.values = null;
      }
      resource.overlaySource = file;
      this.patchSurface(mesh.id, { overlay });
      this.store.setState({ view: 'surface' });
    } catch (error) {
      if (this.surfaceResources.get(mesh.id) === resource && request === resource.overlayRequest)
        this.error(error);
    } finally {
      this.loads.delete(abort);
      if (!this.closed) this.store.setState({ loading: this.loads.size > 0 });
    }
  }
  removeSurfaceOverlay() {
    const id = this.store.getState().selectedSurface;
    const resource = this.surfaceResources.get(id ?? '');
    if (!resource || !id) return;
    ++resource.overlayRequest;
    resource.overlaySource = null;
    resource.values = null;
    resource.labels = null;
    this.patchSurface(id, { overlay: null });
  }
  updateSurfaceOverlay(
    patch: Partial<{ range: [number, number]; colormap: string; opacity: number }>,
  ) {
    const current = this.activeSurface?.overlay;
    if (!current) return;
    const opacity = patch.opacity ?? current.opacity;
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) return;
    if (current.kind === 'labels') {
      this.patchSurface(this.activeSurface!.id, { overlay: { ...current, opacity } });
      return;
    }
    const next = { ...current, ...patch };
    if (
      !next.range.every(Number.isFinite) ||
      next.range[0] >= next.range[1] ||
      !browserColormaps.some((name) => name === next.colormap)
    )
      return;
    this.patchSurface(this.activeSurface!.id, { overlay: next });
  }
  setView(view: 'slices' | 'surface') {
    if (view === 'surface' && !this.surfaceGeometry) return;
    this.stopPlayback();
    this.store.setState({ view });
  }
  setSurfaceLink(linked: boolean) {
    const mesh = this.surfaceGeometry;
    if (linked && (!mesh || ['inflated', 'spherical', 'flat'].includes(mesh.surfaceType ?? ''))) {
      this.error(
        new Error('Linking a deformed surface requires anatomical companion coordinates.'),
      );
      return;
    }
    if (mesh) this.patchSurface(mesh.id, { linked });
  }
  pickSurface(world: [number, number, number], picked?: { handle: string; vertex: number }) {
    const mesh = this.surfaceResources.get(picked?.handle ?? '')?.geometry;
    if (
      !mesh ||
      !picked ||
      picked.handle !== mesh.id ||
      !world.every(Number.isFinite) ||
      !Number.isInteger(picked.vertex) ||
      picked.vertex < 0 ||
      picked.vertex >= mesh.vertices.length / 3
    )
      return;
    const linked =
      this.store.getState().surfaces.find((s) => s.id === mesh.id)?.linked &&
      this.store.getState().layers.length > 0;
    this.store.setState({
      selectedSurface: mesh.id,
      surfacePick: { world, vertex: picked.vertex },
      ...(linked ? { crosshair: world } : {}),
    });
    // Preserve the picked world point, even outside the image: clamping would
    // falsely associate a surface point with a different volume location.
    if (linked) this.schedule();
  }
  surfaceError(id: string | undefined, error: unknown) {
    if (
      id !==
      this.store
        .getState()
        .surfaces.map((s) => s.id)
        .join('|')
    )
      return;
    this.clearSurfaces();
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
  update(id: string, patch: Partial<Pick<BrowserLayer, 'window' | 'opacity' | 'colormap'>>) {
    if (patch.colormap && !browserColormaps.some((name) => name === patch.colormap)) return;
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
  crosshair(point: [number, number, number], constrainToVolume = true) {
    const base = this.store.getState().layers[0];
    if (!base) return;
    const clamped = point.map((v, a) =>
      constrainToVolume ? Math.max(base.bounds[0][a], Math.min(base.bounds[1][a], v)) : v,
    ) as [number, number, number];
    if (!clamped.every(Number.isFinite)) return;
    this.store.setState({ crosshair: clamped });
    this.schedule();
  }
  async remove(id: string) {
    this.volumeSources.delete(id);
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
    this.volumeSources.clear();
    ++this.generation;
    ++this.revision;
    this.cancelLoads();
    this.clearSurfaces();
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
        colormap: l.colormap ?? (i ? 'hot' : 'gray'),
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
        this.presented = structuredClone(snapshot);
        this.presentedRevision = revision;
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
    this.presented = null;
    this.presentedRevision = -1;
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
    this.volumeSources.clear();
    this.closed = true;
    ++this.generation;
    ++this.revision;
    this.cancelLoads();
    this.clearSurfaces();
    this.stopPlayback();
    this.clearFrames();
    this.transport.dispose();
  }
}
