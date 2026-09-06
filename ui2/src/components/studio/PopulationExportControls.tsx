import { useEffect, useRef, useState } from 'react';
import type { PopulationSliceDisplay } from '@/services/studio/PopulationSliceService';
import {
  freezePopulationExport,
  populationExportService,
} from '@/services/studio/PopulationExportService';
import { formatTauriError } from '@/utils/formatTauriError';

export function PopulationExportControls({
  display,
  current,
}: {
  display: PopulationSliceDisplay | null;
  current: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );
  async function save() {
    if (!display || !current || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const frozen = freezePopulationExport(display);
      const result = await populationExportService.chooseAndExport(frozen, controller.signal);
      if (active.current === controller)
        setMessage(
          result
            ? `Saved summary, coverage and provenance to ${result.directory}`
            : 'Export canceled.',
        );
    } catch (error) {
      if (active.current === controller) {
        if (controller.signal.aborted) setMessage('Export canceled.');
        else setError(formatTauriError(error));
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="Population export">
      <button
        type="button"
        className="rounded border border-border px-2 py-1 disabled:opacity-40 hover:bg-accent"
        disabled={!current || !display?.query.request.workingMemberIds.length || busy}
        onClick={() => void save()}
      >
        {busy ? 'Exporting…' : 'Export summary…'}
      </button>
      {busy ? (
        <button
          type="button"
          className="rounded border border-border px-2 py-1"
          onClick={() => active.current?.abort()}
        >
          Cancel export
        </button>
      ) : (
        <span className="text-muted-foreground">
          Full volume · valid counts · calculation record
        </span>
      )}
      {message && (
        <p role="status" className="w-full break-all text-muted-foreground">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="w-full text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
