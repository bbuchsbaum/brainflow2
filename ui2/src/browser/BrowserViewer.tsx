import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { SliceViewerImageSurface } from '@brainflow/visualization/slice';
import type { RenderViewType } from '@brainflow/api';
import { ReusableSliceViewport } from '../components/views/sliceViewer/ReusableSliceViewport';
import { Button } from '../components/ui/Button';
import { FieldRow } from '../components/ui/bf/FieldRow';
import { NumberField } from '../components/ui/bf/Fields';
import { Slider, RangeSlider } from '../components/ui/bf/Slider';
import { BrowserSession, orientations } from '../services/browser/session';
import { setTransport } from '../services/transport';
import { DEFAULT_CROSSHAIR_COLOR } from '../stores/crosshairSettingsStore';
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

function Viewer({ session }: { session: BrowserSession }) {
  const state = useStore(session.store);
  const chooser = useRef<HTMLInputElement>(null);
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
        <Button disabled={!state.ready} onClick={() => chooser.current?.click()}>
          {state.layers.length ? 'Add overlay' : 'Open NIfTI'}
        </Button>
        <Button
          variant="ghost"
          disabled={!state.layers.length && !state.loading}
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
          <h2>Layers</h2>
          {!state.layers.length && (
            <p>Open a 3D or 4D NIfTI to begin. Files stay on this device.</p>
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
          {selected && (
            <>
              <h2>Display</h2>
              <p className="browser-dimensions">{selected.dims.join(' × ')} voxels</p>
              <FieldRow label="Window" layout="stacked">
                <RangeSlider
                  className="w-full"
                  label="Window"
                  min={Math.min(selected.range[0], selected.window[0])}
                  max={Math.max(selected.range[1], selected.window[1])}
                  value={selected.window}
                  editable
                  onValueChange={(window) => {
                    if (window[0] < window[1]) session.update(selected.id, { window });
                  }}
                />
              </FieldRow>
              <FieldRow label="Opacity" layout="stacked">
                <Slider
                  className="w-full"
                  label="Opacity"
                  min={0}
                  max={1}
                  value={selected.opacity}
                  step={0.01}
                  onValueChange={(opacity) => session.update(selected.id, { opacity })}
                />
              </FieldRow>
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
              Labels, surfaces, remote mounts, native paths and external analysis tools require the
              desktop app.
            </p>
          </details>
        </aside>
        <main className="browser-workspace" data-frame-revision={state.frameRevision}>
          <div className="browser-status" role="status">
            {state.loading
              ? 'Loading image…'
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
          <div className="browser-views">
            {orientations.map((view) => (
              <Slice key={view} session={session} view={view} />
            ))}
          </div>
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
  useEffect(() => {
    const s = new BrowserSession();
    setTransport(s.transport);
    setSession(s);
    void s.initialize();
    return () => s.dispose();
  }, []);
  return session ? <Viewer session={session} /> : <p role="status">Starting Brainflow…</p>;
}
