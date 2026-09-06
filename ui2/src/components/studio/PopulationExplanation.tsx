import { useEffect, useRef, useState } from 'react';
import type { RelationshipFit } from '@/services/studio/PopulationRelationshipService';
import { explainRelationship } from '@/services/studio/PopulationRelationshipService';
import { useViewStateStore } from '@/stores/viewStateStore';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
const control =
  'rounded border border-border bg-background px-2 py-1 text-xs max-w-full disabled:opacity-40';
export function PopulationExplanation({
  fit,
  current,
}: {
  fit: RelationshipFit;
  current: boolean;
}) {
  const ids = fit.request.members.map((m) => m.memberId);
  const [a, setA] = useState(ids[0]);
  const [b, setB] = useState(ids[1]);
  const [kind, setKind] = useState('pair');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
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
            kind === 'pair' ? { kind: 'pair', a, b } : { kind: 'component', axis: Number(kind) },
          crosshairMm: crosshair,
          orientation: 'axial',
        },
        controller.signal,
      );
      if (controller.signal.aborted || abort.current !== controller) return;
      canvas.current?.getContext('2d')?.putImageData(result.image, 0, 0);
      setMessage(
        `${kind === 'pair' ? `${a} vs ${b}` : `Component ${Number(kind) + 1}`} · ${result.label} · axial z=${crosshair[2].toFixed(1)} mm · total ${result.total.toPrecision(5)} · display limit ${result.limit.toPrecision(4)}`,
      );
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (abort.current === controller) setBusy(false);
    }
  }
  const axis = kind === 'pair' ? 0 : Number(kind);
  const ordered = ids
    .map((id, i) => ({ id, score: fit.geometry.coordinates[i][axis] }))
    .sort((a, b) => a.score - b.score);
  return (
    <details
      className="rounded border border-border p-2"
      aria-label="Explain spatial relationships"
    >
      <summary className="cursor-pointer">Explain in the brain</summary>
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap gap-2">
          <select
            className={control}
            aria-label="Relationship explanation"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="pair">Where two maps differ</option>
            <option value="0">Component 1 loading</option>
            <option value="1">Component 2 loading</option>
          </select>
          {kind === 'pair' && (
            <>
              <select
                className={control}
                aria-label="First comparison map"
                value={a}
                onChange={(e) => setA(e.target.value)}
              >
                {ids.map((id) => (
                  <option key={id}>{id}</option>
                ))}
              </select>
              <select
                className={control}
                aria-label="Second comparison map"
                value={b}
                onChange={(e) => setB(e.target.value)}
              >
                {ids.map((id) => (
                  <option key={id}>{id}</option>
                ))}
              </select>
            </>
          )}
          <button className={control} disabled={!current || busy} onClick={() => void show()}>
            {busy ? 'Computing…' : 'Show current axial slice'}
          </button>
        </div>
        {kind !== 'pair' && (
          <p>
            Actual observations along this component:{' '}
            {[ordered[0], ordered[Math.floor(ordered.length / 2)], ordered[ordered.length - 1]].map(
              (m, i) => (
                <button
                  className={`${control} m-1`}
                  key={`${m.id}-${i}`}
                  disabled={!current}
                  onClick={() => populationProbeActions.focus(m.id)}
                >
                  {['Low', 'Middle', 'High'][i]} · {m.id}
                </button>
              ),
            )}
            These buttons focus original maps. Loadings describe the fitted space, not reconstructed
            people.
          </p>
        )}
        <canvas
          ref={canvas}
          width={128}
          height={128}
          className="block bg-black"
          style={{ width: 256, height: 'auto', aspectRatio: '1', maxWidth: '100%' }}
          aria-label="Spatial relationship explanation slice"
        />
        <p className="text-muted-foreground">
          {message || 'Choose a comparison and display the slice. The fit stays fixed.'}
        </p>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
