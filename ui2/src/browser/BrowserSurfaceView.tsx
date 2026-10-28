import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { NeuroSurfaceCanvas } from '@brainflow/visualization/surface';
import { Button } from '../components/ui/Button';
import type { BrowserSession } from '../services/browser/session';

/** Same canvas, orbit controls, picking and disposal used by the desktop view. */
export default function BrowserSurfaceView({ session }: { session: BrowserSession }) {
  const state = useStore(session.store);
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [pose, setPose] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: Math.max(1, Math.floor(entry.contentRect.width)),
        height: Math.max(1, Math.floor(entry.contentRect.height)),
      }),
    );
    observer.observe(container.current!);
    return () => observer.disconnect();
  }, []);
  const mesh = session.surfaceGeometry;
  const surfaces = useMemo(() => {
    return mesh
      ? [
          {
            handle: mesh.id,
            name: mesh.name,
            geometry: { vertices: mesh.vertices, faces: mesh.faces, hemisphere: mesh.hemisphere },
            layers:
              state.surfaceOverlay && session.surfaceValues
                ? [{ ...state.surfaceOverlay, values: session.surfaceValues }]
                : [],
          },
        ]
      : [];
  }, [mesh, state.surfaceOverlay, session]);
  const onPick = useCallback(
    (world: [number, number, number], picked?: { handle: string; vertex: number }) =>
      session.pickSurface(world, picked),
    [session],
  );
  const onError = useCallback(
    (error: unknown) => session.surfaceError(state.surface?.id, error),
    [session, state.surface?.id],
  );
  return (
    <section className="browser-surface" aria-label="Surface view">
      <header>
        <span>Drag to rotate · scroll to zoom · click to pick</span>
        <Button variant="ghost" onClick={() => setPose((value) => value + 1)}>
          Reset camera
        </Button>
      </header>
      <div className="browser-surface-canvas" ref={container}>
        <NeuroSurfaceCanvas
          key={state.surface?.id}
          surfaces={surfaces}
          width={size.width}
          height={size.height}
          viewpoint="dorsal"
          viewpointNonce={pose}
          showControls={false}
          onSurfacePick={onPick}
          onError={onError}
        />
      </div>
    </section>
  );
}
