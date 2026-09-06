import { useEffect, useState } from 'react';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import type { PopulationSelectionOrigin } from '@/types/population';
const control = 'rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-40';
/** Keyboard-accessible range gesture with explicit commit/cancel. Until Apply,
 * neither pointer previews nor numeric edits change the scientific selection. */
export function PopulationSelectionRange({
  ids,
  origin = 'manual',
  scope,
}: {
  ids: readonly string[];
  origin?: PopulationSelectionOrigin;
  scope: string;
}) {
  const [from, setFrom] = useState(1),
    [to, setTo] = useState(1);
  const [operation, setOperation] = useState<'replace' | 'union' | 'intersection' | 'difference'>(
    'replace',
  );
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify([scope, ids]);
  useEffect(() => {
    setFrom(1);
    setTo(1);
    setError(null);
  }, [key]);
  const valid =
    Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to >= from && to <= ids.length;
  return (
    <details
      className="text-xs"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.currentTarget.open = false;
          setFrom(1);
          setTo(1);
        }
      }}
    >
      <summary className="cursor-pointer text-muted-foreground">
        Select a range of observations
      </summary>
      <div
        className="mt-2 flex flex-wrap items-center gap-2"
        aria-label="Population range selection"
      >
        <label>
          From{' '}
          <input
            className={`${control} w-16`}
            aria-label="Selection range start"
            type="number"
            min={1}
            max={ids.length}
            value={Number.isFinite(from) ? from : ''}
            onChange={(e) => setFrom(e.target.valueAsNumber)}
          />
        </label>
        <label>
          to{' '}
          <input
            className={`${control} w-16`}
            aria-label="Selection range end"
            type="number"
            min={from}
            max={ids.length}
            value={Number.isFinite(to) ? to : ''}
            onChange={(e) => setTo(e.target.valueAsNumber)}
          />
        </label>
        <select
          className={control}
          aria-label="Selection operation"
          value={operation}
          onChange={(e) => setOperation(e.target.value as typeof operation)}
        >
          <option value="replace">Replace</option>
          <option value="union">Add</option>
          <option value="intersection">Intersect</option>
          <option value="difference">Remove</option>
        </select>
        <button
          className={control}
          disabled={!valid}
          onClick={() => {
            const result = populationProbeActions.select(
              ids.slice(from - 1, to),
              operation,
              origin,
              `Range ${from}–${to}`,
            );
            setError(result.ok ? null : result.reason);
          }}
        >
          Apply selection
        </button>
        <span className="text-muted-foreground">
          {valid ? `${to - from + 1} original observations` : 'Choose a valid range'} · focus
          retained
        </span>
        {error && <p role="alert">{error}</p>}
      </div>
    </details>
  );
}
