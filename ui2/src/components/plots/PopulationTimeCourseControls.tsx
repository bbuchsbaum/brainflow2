import { useEffect, useRef, useState } from 'react';
import {
  populationPlotService,
  type PinnedPopulationPlot,
} from '@/services/studio/PopulationPlotService';
import { formatTauriError } from '@/utils/formatTauriError';
const control = 'rounded border border-border bg-background px-2 py-1 text-xs';
export function PopulationTimeCourseControls({
  plot,
  onCreated,
}: {
  plot: PinnedPopulationPlot;
  onCreated: (id: string) => void;
}) {
  const [first, setFirst] = useState(1),
    [count, setCount] = useState(20),
    [start, setStart] = useState(0),
    [step, setStep] = useState(1),
    [unit, setUnit] = useState('s');
  const [aligned, setAligned] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), [plot.id]);
  if (plot.trace || plot.origins) return null;
  return (
    <details className="rounded border border-border p-2">
      <summary>Create time courses from 4D images</summary>
      <p className="my-2 text-muted-foreground">
        Sample this pinned location across actual image frames. Declare the common axis; frames are
        never interpolated or aligned automatically.
      </p>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['First frame', first, setFirst, 1],
            ['Frame count', count, setCount, 2],
            ['Start time', start, setStart, undefined],
            ['Time step', step, setStep, 0],
          ] as const
        ).map(([label, value, set, min]) => (
          <label key={label} className="flex flex-col gap-1">
            {label}
            <input
              aria-label={label}
              type="number"
              className={`${control} w-24`}
              value={value}
              min={min}
              step={label.includes('frame') || label === 'Frame count' ? 1 : 'any'}
              onChange={(e) => set(Number(e.target.value))}
            />
          </label>
        ))}
        <label className="flex flex-col gap-1">
          Time units
          <input
            aria-label="Time units"
            className={`${control} w-20`}
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
        </label>
      </div>
      <label className="my-2 flex items-start gap-2">
        <input type="checkbox" checked={aligned} onChange={(e) => setAligned(e.target.checked)} />
        These sources share this time axis and frame alignment.
      </label>
      <div className="flex gap-2">
        <button
          className={control}
          disabled={!aligned || busy || !populationPlotService.canLink(plot)}
          onClick={async () => {
            request.current?.abort();
            const abort = new AbortController();
            request.current = abort;
            setBusy(true);
            setError(null);
            try {
              const id = await populationPlotService.timeCourse(
                plot.id,
                {
                  firstFrame: first - 1,
                  count,
                  start,
                  step,
                  unit,
                  alignment: 'declared-common-axis',
                },
                abort.signal,
              );
              if (!abort.signal.aborted) onCreated(id);
            } catch (e) {
              if (!abort.signal.aborted) setError(formatTauriError(e));
            } finally {
              if (request.current === abort) setBusy(false);
            }
          }}
        >
          {busy ? 'Sampling frames…' : 'Create time courses'}
        </button>
        {busy && (
          <button
            className={control}
            onClick={() => {
              request.current?.abort();
              setBusy(false);
            }}
          >
            Cancel
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-destructive">
          {error}
        </p>
      )}
    </details>
  );
}
