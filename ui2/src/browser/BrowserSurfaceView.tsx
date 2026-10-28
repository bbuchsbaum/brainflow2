import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { SurfaceCanvasExporter, SurfaceCameraState } from '@brainflow/visualization/surface';
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
  const sceneKey = state.surfaces.map((surface) => surface.id).join('|');
  const surfaces = useMemo(
    () =>
      state.surfaces.flatMap((surface) => {
        const resource = session.surfaceResources.get(surface.id);
        if (!resource) return [];
        const mesh = resource.geometry;
        return [
          {
            handle: mesh.id,
            name: mesh.name,
            geometry: { vertices: mesh.vertices, faces: mesh.faces, hemisphere: mesh.hemisphere },
            layers: surface.overlay
              ? [
                  {
                    ...surface.overlay,
                    values: resource.values ?? undefined,
                    rgba: resource.labels?.rgba,
                  },
                ]
              : [],
          },
        ];
      }),
    [state.surfaces, session],
  );
  const linkedHandles = useMemo(
    () => state.surfaces.filter((surface) => surface.linked).map((surface) => surface.id),
    [state.surfaces],
  );
  const onPick = useCallback(
    (world: [number, number, number], picked?: { handle: string; vertex: number }) =>
      session.pickSurface(world, picked),
    [session],
  );
  const onError = useCallback(
    (error: unknown) => session.surfaceError(sceneKey, error),
    [session, sceneKey],
  );
  const onCameraStateChange = useCallback(
    (state: SurfaceCameraState) => session.recordSurfaceCamera(state),
    [session],
  );
  const onExporterChange = useCallback(
    (exporter: SurfaceCanvasExporter | null) => {
      session.surfaceExporter = exporter;
    },
    [session],
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
          key={sceneKey}
          surfaces={surfaces}
          width={size.width}
          height={size.height}
          viewpoint="dorsal"
          viewpointNonce={pose}
          showControls={false}
          onSurfacePick={onPick}
          markerWorldPosition={
            linkedHandles.length > 0 && state.layers.length ? state.crosshair : null
          }
          markerMaxSnapDistanceMm={20}
          markerSurfaceHandles={linkedHandles}
          onError={onError}
          onExporterChange={onExporterChange}
          initialCameraState={session.surfaceCamera}
          onCameraStateChange={onCameraStateChange}
        />
      </div>
    </section>
  );
}
