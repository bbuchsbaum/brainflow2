import { useEffect, useRef, useState } from 'react';
import { populationRestoreService } from '@/services/studio/PopulationRestoreService';
import { formatTauriError } from '@/utils/formatTauriError';

export function PopulationOpenControls() {
  const active = useRef<AbortController | null>(null);
  const [fromDirectory, setFromDirectory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );
  const open = async (relocate = false) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    try {
      await populationRestoreService.chooseAndOpen(
        controller.signal,
        relocate ? fromDirectory : undefined,
      );
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
      <details className="w-full">
        <summary className="cursor-pointer text-muted-foreground">Sources moved?</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            aria-label="Original source directory"
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1"
            placeholder="Original directory from the saved study"
            value={fromDirectory}
            onChange={(e) => setFromDirectory(e.target.value)}
          />
          <button
            className="rounded border border-border px-2 py-1 disabled:opacity-40"
            disabled={busy || !fromDirectory.trim()}
            onClick={() => void open(true)}
          >
            Locate directory and open…
          </button>
          <p className="w-full text-muted-foreground">
            Choose its new location, then the saved study. Every image must match its saved content
            hash; the original study is preserved.
          </p>
        </div>
      </details>
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
