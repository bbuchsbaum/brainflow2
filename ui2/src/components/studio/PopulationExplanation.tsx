import { Button, Notice, Select, Slider } from '@/components/ui/bf';
import { ReusableSliceViewport, SliceViewerImageSurface } from '@/components/views/sliceViewer';
import {
  populationAxisLabel,
  populationSliceActions,
} from '@/services/studio/PopulationSliceService';
import type { ViewPlane } from '@/types/coordinates';
import { useEffect, useRef, useState } from 'react';
import type { RelationshipFit } from '@/services/studio/PopulationRelationshipService';
import {
  explainRelationship,
  relationshipFittedIds,
} from '@/services/studio/PopulationRelationshipService';
import { useViewStateStore } from '@/stores/viewStateStore';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import { formatWorldPoint } from '@/utils/valueFormat';
export function PopulationExplanation({
  fit,
  current,
}: {
  fit: RelationshipFit;
  current: boolean;
}) {
  // Pairs, reconstructions and component scores use fitted members only.
  const ids = relationshipFittedIds(fit);
  const [a, setA] = useState(ids[0]);
  const [b, setB] = useState(ids[1]);
  const [kind, setKind] = useState('pair');
  const [orientation, setOrientation] = useState<'axial' | 'sagittal' | 'coronal'>('axial');
  const scores = fit.geometry.componentScores ?? fit.geometry.coordinates;
  const available = Math.min(
    scores[0]?.length ?? 0,
    fit.geometry.eigenvalues.filter((v) => v > fit.geometry.eigenvalues[0] * 1e-10).length,
  );
  const [components, setComponents] = useState(1);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [preview, setPreview] = useState<{ image: ImageBitmap; plane: ViewPlane } | null>(null);
  const crosshairState = useViewStateStore((s) => s.viewState.crosshair);
  const workspace = useViewStateStore((s) => s.activeWorkspaceKey);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.max(1, Math.floor(entry.contentRect.width));
      setWidth((previous) => (previous === next ? previous : next));
    });
    if (box.current) observer.observe(box.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => preview?.image.close(), [preview]);
  const abort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      abort.current?.abort();
      abort.current = null;
    },
    [fit.fitId],
  );
  async function show() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError(null);
    try {
      const crosshair = useViewStateStore.getState().viewState.crosshair.world_mm;
      const result = await explainRelationship(
        fit,
        {
          field:
            kind === 'pair'
              ? { kind: 'pair', a, b }
              : kind === 'reconstruction'
                ? { kind: 'reconstruction', member: a, components }
                : { kind: 'component', axis: Number(kind) },
          crosshairMm: crosshair,
          orientation,
        },
        controller.signal,
      );
      if (controller.signal.aborted || abort.current !== controller) return;
      const image = await createImageBitmap(result.image);
      if (controller.signal.aborted || abort.current !== controller) {
        image.close();
        return;
      }
      setPreview({ image, plane: result.plane });
      setMessage(
        `${kind === 'pair' ? `${a} vs ${b}` : kind === 'reconstruction' ? `Reconstruction of ${a}` : `Component ${Number(kind) + 1}`} · ${result.label} · ${orientation} ${formatWorldPoint(crosshair)} mm${kind === 'pair' ? ` · squared distance ${result.total.toPrecision(5)}` : ''} · display limit ${result.limit.toPrecision(4)}`,
      );
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (abort.current === controller) setBusy(false);
    }
  }
  const axis = kind === 'pair' || kind === 'reconstruction' ? 0 : Number(kind);
  const ordered = ids
    .map((id, i) => ({ id, score: scores[i][axis] ?? 0 }))
    .sort((a, b) => a.score - b.score);
  return (
    <details
      className="rounded-sm border border-border p-2"
      aria-label="Explain spatial relationships"
    >
      <summary className="cursor-pointer">Explain in the brain</summary>
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap gap-2">
          <Select className="w-auto max-w-full"
            aria-label="Relationship explanation"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="pair">Where two maps differ</option>
            {Array.from({ length: available }, (_, axis) => (
              <option key={axis} value={axis}>
                Component {axis + 1} loading
              </option>
            ))}
            {available > 0 && <option value="reconstruction">Reconstruct an observation</option>}
          </Select>
          {(kind === 'pair' || kind === 'reconstruction') && (
            <>
              <Select className="w-auto max-w-full"
                aria-label="First comparison map"
                value={a}
                onChange={(e) => setA(e.target.value)}
              >
                {ids.map((id) => (
                  <option key={id}>{id}</option>
                ))}
              </Select>
              {kind === 'pair' && (
                <Select className="w-auto max-w-full"
                  aria-label="Second comparison map"
                  value={b}
                  onChange={(e) => setB(e.target.value)}
                >
                  {ids.map((id) => (
                    <option key={id}>{id}</option>
                  ))}
                </Select>
              )}
            </>
          )}
          {kind === 'reconstruction' && (
            <div className="flex items-center gap-2">
              <span aria-hidden>Components</span>
              <Slider
                className="w-32"
                label="Reconstruction components"
                min={0}
                max={available}
                step={1}
                snap={1}
                value={components}
                valueText={(v) => `${Math.round(v)} of ${available} components`}
                onValueChange={(v) => setComponents(Math.round(v))}
              />
              <span>
                {components} / {available}
              </span>
            </div>
          )}
          <Select className="w-auto max-w-full"
            aria-label="Explanation orientation"
            value={orientation}
            onChange={(e) => setOrientation(e.target.value as typeof orientation)}
          >
            <option value="axial">Axial</option>
            <option value="sagittal">Sagittal</option>
            <option value="coronal">Coronal</option>
          </Select>
          <Button variant="secondary" size="sm" disabled={!current || busy} onClick={() => void show()}>
            {busy ? 'Computing…' : 'Show current slice'}
          </Button>
        </div>
        {kind !== 'pair' && kind !== 'reconstruction' && (
          <p>
            Actual observations along this component:{' '}
            {[ordered[0], ordered[Math.floor(ordered.length / 2)], ordered[ordered.length - 1]].map(
              (m, i) => (
                <Button
                  variant="secondary"
                  size="sm"
                  className="m-1"
                  key={`${m.id}-${i}`}
                  disabled={!current}
                  onClick={() => populationProbeActions.focus(m.id)}
                >
                  {['Low', 'Middle', 'High'][i]} · {m.id}
                </Button>
              ),
            )}
            These buttons focus original maps. Loadings describe the fitted space, not reconstructed
            people.
          </p>
        )}
        {kind === 'reconstruction' && (
          <p className="text-muted-foreground">
            This is a model reconstruction, not an original observation. Zero components shows the
            population center.{' '}
            <Button variant="secondary" size="sm"
              disabled={!current}
              onClick={() => populationProbeActions.focus(a)}
            >
              Focus original {a}
            </Button>
          </p>
        )}
        <div
          ref={box}
          className="relative bg-black w-full max-w-2xl"
          style={{ height: 320 }}
          aria-label="Spatial relationship explanation slice"
        >
          <ReusableSliceViewport
            width={width}
            height={320}
            viewPlane={preview?.plane}
            crosshair={crosshairState}
            onWorldClick={(world) => {
              if (current) populationSliceActions.navigate(workspace, world, true);
            }}
            renderSurface={(props) => (
              <SliceViewerImageSurface
                {...props}
                image={preview?.image ?? null}
                emptyFallback={
                  <p className="absolute inset-0 grid place-items-center text-bf-sm text-muted-foreground">
                    Choose a field and show the current slice
                  </p>
                }
              />
            )}
          />
          {preview && (
            <div className="pointer-events-none absolute inset-0 text-bf-sm text-white/80" aria-hidden>
              <span className="absolute left-1 top-1/2">
                {populationAxisLabel(preview.plane.u_mm.map((v) => -v))}
              </span>
              <span className="absolute right-1 top-1/2">
                {populationAxisLabel(preview.plane.u_mm)}
              </span>
              <span className="absolute left-1/2 top-1">
                {populationAxisLabel(preview.plane.v_mm.map((v) => -v))}
              </span>
              <span className="absolute left-1/2 bottom-1">
                {populationAxisLabel(preview.plane.v_mm)}
              </span>
            </div>
          )}
        </div>
        <p className="text-muted-foreground">
          {message || 'Choose a comparison and display the slice. The fit stays fixed.'}
        </p>
        {error && (
          <Notice role="alert" severity="danger">
            {error}
          </Notice>
        )}
      </div>
    </details>
  );
}
