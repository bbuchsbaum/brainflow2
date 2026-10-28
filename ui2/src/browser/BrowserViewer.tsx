import { DisplayRange, ColormapControl, OpacityControl } from '../components/ui/ImagingControls';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { SliceViewerImageSurface } from '@brainflow/visualization/slice';
import type { RenderViewType } from '@brainflow/api';
import { ReusableSliceViewport } from '../components/views/sliceViewer/ReusableSliceViewport';
import { Button } from '../components/ui/Button';
import { FieldRow } from '../components/ui/bf/FieldRow';
import { NumberField } from '../components/ui/bf/Fields';
import { Slider } from '../components/ui/bf/Slider';
import { BrowserSession, orientations, browserColormaps } from '../services/browser/session';
import { setTransport } from '../services/transport';
import { DEFAULT_CROSSHAIR_COLOR } from '../stores/crosshairSettingsStore';
import { BrowserSessionFiles } from './BrowserSessionFiles';
const BrowserSurfaceView = lazy(() => import('./BrowserSurfaceView'));

function Slice({ session, view }: { session: BrowserSession; view: RenderViewType }) {
  const state = useStore(session.store);
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(256);
  useEffect(() => {
    const element = container.current!;
    const observer = new ResizeObserver(([entry]) =>
      setSize(Math.max(1, Math.floor(Math.min(entry.contentRect.width, entry.contentRect.height)))),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <section className="browser-slice" aria-label={`${view} slice`}>
      <header>
        <h2>{view[0].toUpperCase() + view.slice(1)}</h2>
        <span>RAS · mm</span>
      </header>
      <div className="browser-raster" ref={container}>
        <div style={{ width: size, height: size }}>
          <ReusableSliceViewport
            width={size}
            height={size}
            viewPlane={session.plane(view)}
            crosshair={{ visible: true, world_mm: state.crosshair }}
            crosshairStyle={{ color: DEFAULT_CROSSHAIR_COLOR, lineWidth: 1, opacity: 1 }}
            onWorldClick={(point) => session.crosshair(point)}
            renderSurface={(props) => (
              <SliceViewerImageSurface {...props} image={session.frames.get(view) ?? null} />
            )}
          />
        </div>
      </div>
    </section>
  );
}

function Viewer({
  session,
  onRestore,
}: {
  session: BrowserSession;
  onRestore: (session: BrowserSession) => void;
}) {
  const state = useStore(session.store);
  const chooser = useRef<HTMLInputElement>(null);
  const labelChooser = useRef<HTMLInputElement>(null);
  const surfaceLabelChooser = useRef<HTMLInputElement>(null);
  const overlayChooser = useRef<HTMLInputElement>(null);
  const surfaceChooser = useRef<HTMLInputElement>(null);
  const overlay = state.surfaceOverlay;
  const pickedLabelId = state.surfacePick
    ? session.surfaceLabels?.labels[state.surfacePick.vertex]
    : undefined;
  const pickedLabel = session.surfaceLabels?.legend.find((entry) => entry.id === pickedLabelId);
  const selected = state.layers.find((l) => l.id === state.selected);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [cached, setCached] = useState(false);
  const [update, setUpdate] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    const online = () => setOffline(!navigator.onLine);
    window.addEventListener('online', online);
    window.addEventListener('offline', online);
    let alive = true;
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      void navigator.serviceWorker
        .register(new URL('./browser-sw.js', document.baseURI), { scope: './' })
        .then((reg) => {
          const check = () => {
            if (alive) {
              setCached(!!reg.active);
              setUpdate(reg.waiting);
            }
          };
          check();
          reg.addEventListener('updatefound', () =>
            reg.installing?.addEventListener('statechange', check),
          );
          void navigator.serviceWorker.ready.then(() => {
            if (alive) setCached(true);
          });
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
      window.removeEventListener('online', online);
      window.removeEventListener('offline', online);
    };
  }, []);
  return (
    <div className="browser-app">
      <header className="browser-toolbar">
        <h1>
          Brainflow <span>Browser viewer</span>
        </h1>
        <BrowserSessionFiles session={session} onRestore={onRestore} />
        <Button disabled={!state.ready} onClick={() => chooser.current?.click()}>
          {state.layers.length ? 'Add overlay' : 'Open NIfTI'}
        </Button>
        <Button disabled={!state.ready} onClick={() => labelChooser.current?.click()}>
          Open labels
        </Button>
        <Button onClick={() => surfaceChooser.current?.click()}>Open surface</Button>
        <input
          ref={surfaceChooser}
          className="sr-only"
          aria-label="Choose GIfTI surface"
          type="file"
          accept=".gii,.gii.gz"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void session.loadSurface(file);
            event.target.value = '';
          }}
        />
        <input
          ref={labelChooser}
          className="sr-only"
          aria-label="Choose label image and optional table"
          type="file"
          accept=".nii,.nii.gz,.tsv,.lut,.txt"
          multiple
          onChange={(event) => {
            void session.loadLabels(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
        <Button
          variant="ghost"
          disabled={!state.layers.length && !state.surface && !state.loading}
          onClick={() => void session.reset()}
        >
          Clear workspace
        </Button>
        <input
          ref={chooser}
          className="sr-only"
          aria-label="Choose NIfTI file"
          type="file"
          accept=".nii,.nii.gz"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void session.load(file);
            event.target.value = '';
          }}
        />
      </header>
      <div className="browser-body">
        <aside className="browser-inspector" aria-label="Image controls">
          {(state.layers.length > 0 || !state.surface) && <h2>Layers</h2>}
          {!state.layers.length && !state.surface && (
            <p>Open a NIfTI image or GIfTI surface to begin. Files stay on this device.</p>
          )}
          <ul className="browser-layers">
            {state.layers.map((l) => (
              <li key={l.id} data-selected={l.id === state.selected}>
                <Button variant="ghost" onClick={() => session.select(l.id)}>
                  {l.name}
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Unload ${l.name}`}
                  onClick={() => void session.remove(l.id)}
                >
                  Unload
                </Button>
              </li>
            ))}
          </ul>
          {state.surface && (
            <>
              <h2>Surface</h2>
              <p>{state.surface.name}</p>
              <p className="browser-dimensions">
                {state.surface.vertices.toLocaleString()} vertices ·{' '}
                {state.surface.faces.toLocaleString()} triangles
              </p>
              <Button variant="ghost" onClick={() => session.setView('surface')}>
                Show surface
              </Button>
              <Button variant="ghost" onClick={() => session.unloadSurface()}>
                Unload surface
              </Button>
              {state.layers.length > 0 && (
                <Button variant="ghost" onClick={() => session.setView('slices')}>
                  Show slices
                </Button>
              )}
              <Button variant="ghost" onClick={() => overlayChooser.current?.click()}>
                {overlay ? 'Replace surface map' : 'Open surface map'}
              </Button>
              <Button variant="ghost" onClick={() => surfaceLabelChooser.current?.click()}>
                Open surface labels
              </Button>
              <input
                ref={surfaceLabelChooser}
                className="sr-only"
                aria-label="Choose label GIfTI map"
                type="file"
                accept=".gii,.gii.gz"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void session.loadSurfaceOverlay(file, true);
                  event.target.value = '';
                }}
              />
              <input
                ref={overlayChooser}
                className="sr-only"
                aria-label="Choose scalar GIfTI map"
                type="file"
                accept=".gii,.gii.gz"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void session.loadSurfaceOverlay(file);
                  event.target.value = '';
                }}
              />
              {overlay && (
                <>
                  <h2>Surface map</h2>
                  <p>{overlay.name}</p>
                  {overlay.kind === 'scalar' && (
                    <>
                      <ColormapControl
                        value={overlay.colormap}
                        options={browserColormaps}
                        onChange={(colormap) => session.updateSurfaceOverlay({ colormap })}
                      />
                      <DisplayRange
                        label="Surface range"
                        low={overlay.range[0]}
                        high={overlay.range[1]}
                        min={Math.min(overlay.dataRange[0], overlay.range[0])}
                        max={Math.max(overlay.dataRange[1], overlay.range[1])}
                        allowRangeExpansion
                        onChange={(low, high) =>
                          session.updateSurfaceOverlay({ range: [low, high] })
                        }
                      />
                    </>
                  )}
                  <OpacityControl
                    label="Map opacity"
                    stacked
                    value={overlay.opacity}
                    onChange={(opacity) => session.updateSurfaceOverlay({ opacity })}
                  />
                  {overlay.kind === 'labels' ? (
                    <p aria-label="Surface region">
                      {pickedLabel
                        ? `${pickedLabel.name} (${pickedLabel.id}) · vertex ${state.surfacePick!.vertex}`
                        : 'Click the mesh to inspect a region.'}
                    </p>
                  ) : (
                    <p aria-label="Surface value">
                      {state.surfacePick
                        ? `Vertex ${state.surfacePick.vertex} value: ${session.surfaceValues?.[state.surfacePick.vertex]}`
                        : 'Click the mesh to inspect a map value.'}
                    </p>
                  )}
                  <Button variant="ghost" onClick={() => session.removeSurfaceOverlay()}>
                    Remove surface map
                  </Button>
                </>
              )}
              <p aria-label="Surface pick">
                {state.surfacePick
                  ? `Near vertex ${state.surfacePick.vertex} · RAS ${state.surfacePick.world.map((v) => v.toFixed(2)).join(', ')} mm`
                  : 'Click the mesh to inspect a vertex.'}
              </p>
            </>
          )}
          {selected && state.view === 'slices' && (
            <>
              <h2>Display</h2>
              <p className="browser-dimensions">{selected.dims.join(' × ')} voxels</p>
              {selected.labelIds ? (
                <>
                  <p>Labels · nearest-neighbour sampling · 0 is transparent</p>
                  <p role="status" aria-label="Region at crosshair">
                    {state.selectedLabel === null
                      ? 'Outside label image'
                      : state.selectedLabel === 0
                        ? 'Background (0)'
                        : `${selected.legend?.find((entry) => entry.label_id === state.selectedLabel)?.displayName ?? `Label ${state.selectedLabel}`} (${state.selectedLabel})`}
                  </p>
                </>
              ) : (
                <>
                  <DisplayRange
                    label="Window"
                    low={selected.window[0]}
                    high={selected.window[1]}
                    min={Math.min(selected.range[0], selected.window[0])}
                    max={Math.max(selected.range[1], selected.window[1])}
                    allowRangeExpansion
                    onChange={(low, high) => {
                      if (low < high) session.update(selected.id, { window: [low, high] });
                    }}
                  />
                  <ColormapControl
                    value={selected.colormap ?? (state.layers.indexOf(selected) ? 'hot' : 'gray')}
                    options={browserColormaps}
                    onChange={(colormap) => session.update(selected.id, { colormap })}
                  />
                </>
              )}
              <OpacityControl
                stacked
                value={selected.opacity}
                onChange={(opacity) => session.update(selected.id, { opacity })}
              />
              {selected.frameCount > 1 && (
                <>
                  <h2>Time</h2>
                  <FieldRow label="Frame">
                    <NumberField
                      aria-label="Frame"
                      min={0}
                      max={selected.frameCount - 1}
                      step={1}
                      value={selected.currentFrame}
                      unit={`/ ${selected.frameCount - 1}`}
                      onValueChange={(frame) => {
                        if (frame !== null) session.setTimepoint(selected.id, frame);
                      }}
                    />
                  </FieldRow>
                  <FieldRow label="Timepoint" layout="stacked">
                    <Slider
                      className="w-full"
                      label="Timepoint"
                      min={0}
                      max={selected.frameCount - 1}
                      value={selected.currentFrame}
                      step={1}
                      onValueChange={(frame) => session.setTimepoint(selected.id, frame)}
                    />
                  </FieldRow>
                  <Button
                    variant="ghost"
                    aria-label={
                      state.playing === selected.id ? 'Pause playback' : 'Play time series'
                    }
                    onClick={() => session.togglePlayback(selected.id)}
                  >
                    {state.playing === selected.id ? 'Pause' : 'Play'}
                  </Button>
                </>
              )}
            </>
          )}
          {!!state.layers.length && (
            <>
              <h2>Crosshair</h2>
              {['R', 'A', 'S'].map((axis, i) => (
                <FieldRow key={axis} label={axis}>
                  <NumberField
                    value={Number(state.crosshair[i].toFixed(2))}
                    unit="mm"
                    step={1}
                    onValueChange={(v) => {
                      if (v !== null) {
                        const p = [...state.crosshair] as [number, number, number];
                        p[i] = v;
                        session.crosshair(p);
                      }
                    }}
                  />
                </FieldRow>
              ))}
            </>
          )}
          <details>
            <summary>Browser support</summary>
            <p>
              Up to {Math.min(4, state.gpu?.volumeSlots ?? 4)} scalar 3D or 4D NIfTI images and
              overlays: 32 million voxels per file, 64 million resident voxels total, and 256 MiB
              compressed or expanded input.
            </p>
            <p>
              Open labels accepts a 3D label NIfTI and an optional TSV or FreeSurfer LUT selected
              together. IDs must be 0–2047 with identity scaling. Label-intent NIfTI files are
              recognized automatically. One self-contained GIfTI surface can be open alongside the
              volumes: up to 64 MiB compressed or expanded XML, one million vertices and two million
              triangles. One dense scalar or label GIfTI map can be attached to the surface. Label
              names and colors come from its embedded table; label 0 is transparent. Remote mounts,
              native paths and external analysis tools require the desktop app.
            </p>
          </details>
        </aside>
        <main className="browser-workspace" data-frame-revision={state.frameRevision}>
          <div className="browser-status" role="status">
            {state.loading
              ? 'Loading image…'
              : state.view === 'surface'
                ? 'Surface viewer · local processing'
                : !state.ready
                  ? state.error
                    ? 'Browser GPU unavailable.'
                    : 'Preparing WebGPU…'
                  : state.layers.length
                    ? 'Click a slice to move the linked crosshair.'
                    : 'Open a NIfTI file to view linked slices.'}
            {state.loading && (
              <Button variant="ghost" onClick={() => session.cancelLoads()}>
                Cancel load
              </Button>
            )}
          </div>
          {state.error && (
            <div className="browser-error" role="alert">
              {state.error}
            </div>
          )}
          {state.view === 'surface' && state.surface ? (
            <Suspense fallback={<p role="status">Preparing surface view…</p>}>
              <BrowserSurfaceView session={session} />
            </Suspense>
          ) : (
            <div className="browser-views">
              {orientations.map((view) => (
                <Slice key={view} session={session} view={view} />
              ))}
            </div>
          )}
        </main>
      </div>
      <footer className="browser-footer">
        <span>
          Local processing · {offline ? 'Offline' : cached ? 'Available offline' : 'Online'}
        </span>
        <span>Volume viewer</span>
        {update && <span>Update ready. Close all viewer windows to apply.</span>}
      </footer>
    </div>
  );
}

export function BrowserApp() {
  const [session, setSession] = useState<BrowserSession | null>(null);
  const owner = useRef<BrowserSession | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const s = new BrowserSession();
    owner.current = s;
    setTransport(s.transport);
    setSession(s);
    void s.initialize();
    return () => {
      owner.current?.dispose();
      owner.current = null;
    };
  }, []);
  const replace = (next: BrowserSession) => {
    const previous = owner.current;
    owner.current = next;
    setTransport(next.transport);
    setSession(next);
    setRevision((value) => value + 1);
    previous?.dispose();
    if (!next.store.getState().ready) void next.initialize();
  };
  return session ? (
    <Viewer key={revision} session={session} onRestore={replace} />
  ) : (
    <p role="status">Starting Brainflow…</p>
  );
}
