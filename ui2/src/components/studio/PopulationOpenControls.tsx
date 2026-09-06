import { useEffect, useRef, useState } from 'react';
import { populationRestoreService } from '@/services/studio/PopulationRestoreService';
import { formatTauriError } from '@/utils/formatTauriError';

export function PopulationOpenControls() {
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );
  const open = async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    try {
      await populationRestoreService.chooseAndOpen(controller.signal);
    } catch (error) {
      if (active.current === controller && !controller.signal.aborted)
        setError(formatTauriError(error));
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <button
        type="button"
        className="rounded border border-border px-2 py-1 hover:bg-accent disabled:opacity-40"
        disabled={busy}
        onClick={() => void open()}
      >
        {busy ? 'Verifying saved inputs…' : 'Open saved population…'}
      </button>
      {busy && (
        <button
          type="button"
          className="rounded border border-border px-2 py-1"
          onClick={() => active.current?.abort()}
        >
          Cancel open
        </button>
      )}
      {error && (
        <p role="alert" className="w-full text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
