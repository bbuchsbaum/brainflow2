import {
  isSurfaceCameraState,
  type SurfaceCameraState,
} from '@brainflow/visualization/surface/camera';
import { BrowserSession, browserColormaps } from './session';
import { isSessionSource, matchSessionSources, type SessionSource } from './sessionSources';

export interface BrowserSessionRecord {
  format: 'brainflow-browser-session';
  version: 2;
  camera?: SurfaceCameraState;
  selectedSurface: number;
  volumes: Array<{
    source: SessionSource;
    table?: SessionSource;
    labels: boolean;
    window: [number, number];
    opacity: number;
    colormap: string;
    frame: number;
  }>;
  surfaces: Array<{
    source: SessionSource;
    linked?: boolean;
    overlay?: { opacity: number } & (
      | {
          source: SessionSource;
          kind: 'scalar' | 'labels';
          range?: [number, number];
          colormap?: string;
        }
      | {
          kind: 'projection';
          volume: number;
          frame: number;
          range: [number, number];
          colormap: string;
        }
    );
  }>;
  selected: number | null;
  crosshair: [number, number, number];
  view: 'slices' | 'surface';
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const range = (value: unknown): boolean =>
  Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && value[0] < value[1];
const opacity = (value: unknown): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const palette = (value: unknown): boolean => browserColormaps.some((name) => name === value);

/** Validate untrusted JSON before allocating a replacement session. */
export function parseSessionRecord(text: string): BrowserSessionRecord {
  if (text.length > 1024 * 1024) throw new Error('Session settings exceed 1 MiB.');
  let value: unknown = JSON.parse(text);
  if (object(value) && value.version === 1) {
    const legacy = value.surface;
    value = {
      ...value,
      version: 2,
      surfaces: legacy === undefined ? [] : [legacy],
      selectedSurface: legacy === undefined ? -1 : 0,
      ...(object(legacy) && legacy.camera !== undefined ? { camera: legacy.camera } : {}),
    };
  }
  if (!object(value) || value.format !== 'brainflow-browser-session' || value.version !== 2)
    throw new Error('Unsupported Brainflow session format or version.');
  if (
    !Array.isArray(value.volumes) ||
    value.volumes.length > 4 ||
    !value.volumes.every(
      (v: unknown) =>
        object(v) &&
        isSessionSource(v.source) &&
        (v.table === undefined || isSessionSource(v.table)) &&
        typeof v.labels === 'boolean' &&
        (v.table === undefined || v.labels) &&
        range(v.window) &&
        opacity(v.opacity) &&
        palette(v.colormap) &&
        typeof v.frame === 'number' &&
        Number.isSafeInteger(v.frame) &&
        v.frame >= 0,
    )
  )
    throw new Error('Invalid saved volume settings.');
  if (!Array.isArray(value.surfaces) || value.surfaces.length > 2)
    throw new Error('Invalid saved surface scene.');
  if (value.camera !== undefined && !isSurfaceCameraState(value.camera))
    throw new Error('Invalid saved surface camera.');
  if (
    !Number.isInteger(value.selectedSurface) ||
    typeof value.selectedSurface !== 'number' ||
    (value.surfaces.length
      ? value.selectedSurface < 0 || value.selectedSurface >= value.surfaces.length
      : value.selectedSurface !== -1)
  )
    throw new Error('Invalid selected surface.');
  for (const surface of value.surfaces) {
    if (!object(surface) || !isSessionSource(surface.source))
      throw new Error('Invalid saved surface.');
    if (surface.linked !== undefined && typeof surface.linked !== 'boolean')
      throw new Error('Invalid saved surface link.');
    const overlay = surface.overlay;
    if (overlay !== undefined) {
      if (!object(overlay) || !opacity(overlay.opacity))
        throw new Error('Invalid saved surface overlay.');
      if (overlay.kind === 'projection') {
        if (
          surface.linked !== true ||
          !Number.isInteger(overlay.volume) ||
          typeof overlay.volume !== 'number' ||
          overlay.volume < 0 ||
          overlay.volume >= value.volumes.length ||
          !Number.isSafeInteger(overlay.frame) ||
          typeof overlay.frame !== 'number' ||
          overlay.frame < 0 ||
          !range(overlay.range) ||
          !palette(overlay.colormap)
        )
          throw new Error('Invalid saved projection.');
      } else if (
        !isSessionSource(overlay.source) ||
        !(
          overlay.kind === 'labels' ||
          (overlay.kind === 'scalar' && range(overlay.range) && palette(overlay.colormap))
        )
      )
        throw new Error('Invalid saved surface overlay.');
    }
  }
  if (
    !(
      value.selected === null ||
      (typeof value.selected === 'number' &&
        Number.isInteger(value.selected) &&
        value.selected >= 0 &&
        value.selected < value.volumes.length)
    ) ||
    !Array.isArray(value.crosshair) ||
    value.crosshair.length !== 3 ||
    !value.crosshair.every(Number.isFinite) ||
    !(value.view === 'slices' || (value.view === 'surface' && value.surfaces.length > 0))
  )
    throw new Error('Invalid saved navigation settings.');
  return value as unknown as BrowserSessionRecord;
}

/** The caller owns the returned session; every failed or cancelled stage is disposed here. */
export async function restoreSessionRecord(
  record: BrowserSessionRecord,
  files: readonly File[],
  signal: AbortSignal,
  createSession = () => new BrowserSession(),
): Promise<BrowserSession> {
  // Also validate records supplied by callers rather than the JSON chooser.
  record = parseSessionRecord(JSON.stringify(record));
  if (files.length > 16) throw new Error('Select at most 16 session source files.');
  signal.throwIfAborted();
  const stage = createSession();
  const cancel = () => stage.dispose();
  signal.addEventListener('abort', cancel, { once: true });
  const check = () => {
    signal.throwIfAborted();
    const error = stage.store.getState().error;
    if (error) throw new Error(error);
  };
  try {
    const selected: Array<{ file: File; source: SessionSource }> = [];
    for (const file of files) {
      const source = await stage.transport.request<SessionSource>(
        'describe_source',
        { file },
        signal,
      );
      selected.push({ file, source });
    }
    const resolve = (source: SessionSource) => matchSessionSources([source], selected)[0];
    // Verify every required source before loading anything.
    for (const volume of record.volumes) {
      resolve(volume.source);
      if (volume.table) resolve(volume.table);
    }
    for (const surface of record.surfaces) {
      resolve(surface.source);
      if (surface.overlay && surface.overlay.kind !== 'projection') resolve(surface.overlay.source);
    }
    if (record.volumes.length) {
      await stage.initialize();
      check();
    }
    for (const volume of record.volumes) {
      await stage.load(
        resolve(volume.source),
        volume.labels,
        volume.table ? resolve(volume.table) : undefined,
      );
      check();
      const loaded = stage.store.getState().layers.at(-1);
      if (!loaded || volume.frame >= loaded.frameCount)
        throw new Error('Saved frame is outside the source image.');
      stage.update(loaded.id, {
        window: volume.window,
        opacity: volume.opacity,
        colormap: volume.colormap,
      });
      stage.setTimepoint(loaded.id, volume.frame);
    }
    for (const surface of record.surfaces) {
      await stage.loadSurface(resolve(surface.source), true);
      check();
      stage.setSurfaceLink(surface.linked ?? false);
      check();
      const overlay = surface.overlay;
      if (overlay) {
        if (overlay.kind === 'projection')
          await stage.projectVolume(
            stage.store.getState().layers[overlay.volume].id,
            overlay.frame,
          );
        else await stage.loadSurfaceOverlay(resolve(overlay.source), overlay.kind === 'labels');
        check();
        stage.updateSurfaceOverlay({
          opacity: overlay.opacity,
          ...(overlay.kind !== 'labels'
            ? { range: overlay.range, colormap: overlay.colormap }
            : {}),
        });
      }
    }
    if (record.camera) stage.recordSurfaceCamera(record.camera);
    if (record.selectedSurface >= 0)
      stage.selectSurface(stage.store.getState().surfaces[record.selectedSurface].id);
    stage.crosshair(record.crosshair, false);
    if (record.selected !== null) stage.select(stage.store.getState().layers[record.selected].id);
    stage.setView(record.view);
    await stage.whenPresented(signal);
    check();
    return stage;
  } catch (error) {
    stage.dispose();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
