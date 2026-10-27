import { useEffect, useRef, useState } from 'react';
import {
  populationPlotService,
  type PinnedPopulationPlot,
} from '@/services/studio/PopulationPlotService';
import { formatTauriError } from '@/utils/formatTauriError';
import { Button, Checkbox, FieldRow, Notice, NumberField, TextField } from '@/components/ui/bf';
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
          <FieldRow key={label} label={label} layout="stacked" className="w-24">
            <NumberField
              aria-label={label}
              value={value}
              min={min}
              step={label.includes('frame') || label === 'Frame count' ? 1 : 'any'}
              onChange={(e) => set(Number(e.target.value))}
            />
          </FieldRow>
        ))}
        <FieldRow label="Time units" layout="stacked" className="w-20">
          <TextField aria-label="Time units" value={unit} onChange={(e) => setUnit(e.target.value)} />
        </FieldRow>
      </div>
      <Checkbox
        className="my-2 flex"
        checked={aligned}
        onCheckedChange={setAligned}
      >
        These sources share this time axis and frame alignment.
      </Checkbox>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
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
        </Button>
        {busy && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              request.current?.abort();
              setBusy(false);
            }}
          >
            Cancel
          </Button>
        )}
      </div>
      {error && (
        <Notice severity="danger" role="alert" className="mt-2">
          {error}
        </Notice>
      )}
    </details>
  );
}
